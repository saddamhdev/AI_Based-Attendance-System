from pathlib import Path
from typing import Annotated

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile


PROJECT_ROOT = Path(__file__).resolve().parent.parent

DETECTOR_MODEL = (
    PROJECT_ROOT
    / "models"
    / "face_detection_yunet_2023mar.onnx"
)

RECOGNIZER_MODEL = (
    PROJECT_ROOT
    / "models"
    / "face_recognition_sface_2021dec.onnx"
)

EMBEDDINGS_DIRECTORY = (
    PROJECT_ROOT
    / "data"
    / "embeddings"
)

ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
}

MAX_IMAGE_SIZE = 10 * 1024 * 1024

DETECTION_THRESHOLD = 0.70
MATCH_THRESHOLD = 0.40
AMBIGUITY_MARGIN = 0.05
MIN_FACE_SIZE = 30


app = FastAPI(
    title="AI Attendance Face Recognition Service",
    description=(
        "Detects faces from classroom photographs and "
        "compares them with registered student embeddings."
    ),
    version="1.0.0",
)


def normalize_embedding(embedding: np.ndarray) -> np.ndarray:
    vector = embedding.astype(
        np.float32
    ).flatten()

    norm = np.linalg.norm(vector)

    if norm == 0:
        raise ValueError(
            "Generated embedding has zero length."
        )

    return (vector / norm).copy()


def load_student_embeddings():
    if not EMBEDDINGS_DIRECTORY.exists():
        raise RuntimeError(
            "Student embeddings directory does not exist."
        )

    embeddings = {}

    for embedding_path in sorted(
        EMBEDDINGS_DIRECTORY.glob("*.npy")
    ):
        student_id = embedding_path.stem

        embedding = np.load(
            embedding_path
        )

        embeddings[student_id] = (
            normalize_embedding(embedding)
        )

    return embeddings


def create_detector(
    image_width: int,
    image_height: int,
):
    return cv2.FaceDetectorYN.create(
        str(DETECTOR_MODEL),
        "",
        (image_width, image_height),
        DETECTION_THRESHOLD,
        0.30,
        5000,
    )


def create_recognizer():
    return cv2.FaceRecognizerSF.create(
        str(RECOGNIZER_MODEL),
        "",
    )


def calculate_similarity(
    first_embedding,
    second_embedding,
):
    return float(
        np.dot(
            first_embedding,
            second_embedding,
        )
    )


def find_best_student(
    face_embedding,
    student_embeddings,
):
    scores = []

    for student_id, student_embedding in (
        student_embeddings.items()
    ):
        score = calculate_similarity(
            face_embedding,
            student_embedding,
        )

        scores.append(
            {
                "studentId": student_id,
                "score": score,
            }
        )

    scores.sort(
        key=lambda result: result["score"],
        reverse=True,
    )

    if not scores:
        return {
            "status": "UNKNOWN",
            "studentId": None,
            "score": None,
            "secondBestScore": None,
            "scoreDifference": None,
        }

    best_match = scores[0]

    second_best_score = (
        scores[1]["score"]
        if len(scores) > 1
        else -1.0
    )

    score_difference = (
        best_match["score"]
        - second_best_score
    )

    if (
        best_match["score"] >= MATCH_THRESHOLD
        and score_difference >= AMBIGUITY_MARGIN
    ):
        status = "MATCHED"
        student_id = best_match["studentId"]

    elif best_match["score"] >= MATCH_THRESHOLD:
        status = "UNCERTAIN"
        student_id = best_match["studentId"]

    else:
        status = "UNKNOWN"
        student_id = None

    return {
        "status": status,
        "studentId": student_id,
        "score": round(
            best_match["score"],
            4,
        ),
        "secondBestScore": round(
            second_best_score,
            4,
        ),
        "scoreDifference": round(
            score_difference,
            4,
        ),
    }


def remove_duplicate_student_matches(results):
    best_result_by_student = {}

    for result in results:
        if result["status"] != "MATCHED":
            continue

        student_id = result["studentId"]

        existing_result = (
            best_result_by_student.get(student_id)
        )

        if (
            existing_result is None
            or result["score"]
            > existing_result["score"]
        ):
            best_result_by_student[student_id] = (
                result
            )

    accepted_face_numbers = {
        result["faceNumber"]
        for result in best_result_by_student.values()
    }

    for result in results:
        if (
            result["status"] == "MATCHED"
            and result["faceNumber"]
            not in accepted_face_numbers
        ):
            result["status"] = "DUPLICATE"
            result["studentId"] = None

    return results


@app.on_event("startup")
def validate_models():
    if not DETECTOR_MODEL.exists():
        raise RuntimeError(
            f"Detector model missing: {DETECTOR_MODEL}"
        )

    if not RECOGNIZER_MODEL.exists():
        raise RuntimeError(
            f"Recognizer model missing: "
            f"{RECOGNIZER_MODEL}"
        )


@app.get("/health")
def health():
    embeddings = load_student_embeddings()

    return {
        "status": "UP",
        "service": "face-recognition-service",
        "registeredStudentCount": len(
            embeddings
        ),
    }


@app.post("/api/v1/faces/recognize")
async def recognize_classroom_faces(
    image: Annotated[
        UploadFile,
        File(description="Classroom group photograph"),
    ],
    class_id: Annotated[
        str | None,
        Form(alias="classId"),
    ] = None,
):
    if image.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                "Only JPEG and PNG images are supported."
            ),
        )

    image_bytes = await image.read()

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="Uploaded image is empty.",
        )

    if len(image_bytes) > MAX_IMAGE_SIZE:
        raise HTTPException(
            status_code=413,
            detail="Image must not exceed 10 MB.",
        )

    encoded_image = np.frombuffer(
        image_bytes,
        dtype=np.uint8,
    )

    classroom_image = cv2.imdecode(
        encoded_image,
        cv2.IMREAD_COLOR,
    )

    if classroom_image is None:
        raise HTTPException(
            status_code=400,
            detail="The uploaded file is not a valid image.",
        )

    student_embeddings = load_student_embeddings()

    if not student_embeddings:
        raise HTTPException(
            status_code=409,
            detail="No registered student embeddings exist.",
        )

    image_height, image_width = (
        classroom_image.shape[:2]
    )

    detector = create_detector(
        image_width,
        image_height,
    )

    detector.setInputSize(
        (image_width, image_height)
    )

    _, detected_faces = detector.detect(
        classroom_image
    )

    if (
        detected_faces is None
        or len(detected_faces) == 0
    ):
        return {
            "classId": class_id,
            "filename": image.filename,
            "detectedFaceCount": 0,
            "matchedStudentIds": [],
            "results": [],
        }

    recognizer = create_recognizer()
    results = []

    for face_index, face in enumerate(
        detected_faces,
        start=1,
    ):
        x = int(face[0])
        y = int(face[1])
        width = int(face[2])
        height = int(face[3])
        detection_confidence = float(face[14])

        if (
            width < MIN_FACE_SIZE
            or height < MIN_FACE_SIZE
        ):
            results.append(
                {
                    "faceNumber": face_index,
                    "status": "LOW_QUALITY",
                    "studentId": None,
                    "detectionConfidence": round(
                        detection_confidence,
                        4,
                    ),
                    "boundingBox": {
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                    },
                }
            )
            continue

        try:
            aligned_face = recognizer.alignCrop(
                classroom_image,
                face,
            )

            raw_embedding = recognizer.feature(
                aligned_face
            )

            face_embedding = normalize_embedding(
                raw_embedding
            )

            match_result = find_best_student(
                face_embedding,
                student_embeddings,
            )

            match_result.update(
                {
                    "faceNumber": face_index,
                    "detectionConfidence": round(
                        detection_confidence,
                        4,
                    ),
                    "boundingBox": {
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                    },
                }
            )

            results.append(match_result)

        except cv2.error:
            results.append(
                {
                    "faceNumber": face_index,
                    "status": "PROCESSING_FAILED",
                    "studentId": None,
                    "detectionConfidence": round(
                        detection_confidence,
                        4,
                    ),
                    "boundingBox": {
                        "x": x,
                        "y": y,
                        "width": width,
                        "height": height,
                    },
                }
            )

    results = remove_duplicate_student_matches(
        results
    )

    matched_student_ids = sorted(
        {
            result["studentId"]
            for result in results
            if result["status"] == "MATCHED"
        }
    )

    return {
        "classId": class_id,
        "filename": image.filename,
        "imageWidth": image_width,
        "imageHeight": image_height,
        "registeredStudentCount": len(
            student_embeddings
        ),
        "detectedFaceCount": len(
            detected_faces
        ),
        "matchedStudentCount": len(
            matched_student_ids
        ),
        "matchedStudentIds": matched_student_ids,
        "results": results,
        "attendanceStatus": "PROPOSED",
    }