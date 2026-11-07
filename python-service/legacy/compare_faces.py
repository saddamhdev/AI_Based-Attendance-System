import json
from pathlib import Path

import cv2
import numpy as np


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

REGISTERED_STUDENTS_DIR = (
    PROJECT_ROOT
    / "data"
    / "registered_students"
)

SEPARATED_FACES_DIR = (
    PROJECT_ROOT
    / "data"
    / "separated_faces"
)

EMBEDDINGS_DIR = (
    PROJECT_ROOT
    / "data"
    / "embeddings"
)

OUTPUT_PATH = (
    PROJECT_ROOT
    / "output"
    / "recognition_results.json"
)

IMAGE_EXTENSIONS = {
    ".jpg",
    ".jpeg",
    ".png",
    ".bmp",
}

DETECTION_THRESHOLD = 0.70

# Starting value only. Validate it using your own test data.
MATCH_THRESHOLD = 0.40

# Require separation between best and second-best scores.
AMBIGUITY_MARGIN = 0.05


def normalize_embedding(embedding):
    embedding = embedding.astype(np.float32).flatten()

    norm = np.linalg.norm(embedding)

    if norm == 0:
        raise ValueError("The generated embedding has zero length.")

    return embedding / norm


def create_detector(image_width, image_height):
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


def extract_embedding(image_path, recognizer):
    image = cv2.imread(str(image_path))

    if image is None:
        print(f"Cannot read image: {image_path}")
        return None

    image_height, image_width = image.shape[:2]

    detector = create_detector(
        image_width,
        image_height,
    )

    detector.setInputSize(
        (image_width, image_height)
    )

    _, faces = detector.detect(image)

    if faces is None or len(faces) == 0:
        print(f"No face detected: {image_path}")
        return None

    if len(faces) > 1:
        print(
            f"Warning: multiple faces found in {image_path}. "
            "Using the largest face."
        )

    largest_face = max(
        faces,
        key=lambda face: float(face[2] * face[3]),
    )

    aligned_face = recognizer.alignCrop(
        image,
        largest_face,
    )

    embedding = recognizer.feature(
        aligned_face
    )

    return normalize_embedding(embedding)


def create_student_embeddings(recognizer):
    student_embeddings = {}

    if not REGISTERED_STUDENTS_DIR.exists():
        raise FileNotFoundError(
            f"Directory does not exist: "
            f"{REGISTERED_STUDENTS_DIR}"
        )

    EMBEDDINGS_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    student_directories = sorted(
        path
        for path in REGISTERED_STUDENTS_DIR.iterdir()
        if path.is_dir()
    )

    for student_directory in student_directories:
        student_id = student_directory.name

        image_paths = sorted(
            path
            for path in student_directory.iterdir()
            if path.suffix.lower() in IMAGE_EXTENSIONS
        )

        collected_embeddings = []

        for image_path in image_paths:
            embedding = extract_embedding(
                image_path,
                recognizer,
            )

            if embedding is not None:
                collected_embeddings.append(
                    embedding
                )

                print(
                    f"Accepted registration image: "
                    f"{student_id}/{image_path.name}"
                )

        if not collected_embeddings:
            print(
                f"Student skipped: {student_id}. "
                "No valid face images."
            )
            continue

        average_embedding = np.mean(
            collected_embeddings,
            axis=0,
        )

        average_embedding = normalize_embedding(
            average_embedding
        )

        student_embeddings[student_id] = (
            average_embedding
        )

        embedding_path = (
            EMBEDDINGS_DIR
            / f"{student_id}.npy"
        )

        np.save(
            embedding_path,
            average_embedding,
        )

        print(
            f"Registered student {student_id} "
            f"using {len(collected_embeddings)} images."
        )

    return student_embeddings


def cosine_similarity(first_embedding, second_embedding):
    return float(
        np.dot(
            first_embedding,
            second_embedding,
        )
    )


def recognize_face(face_embedding, student_embeddings):
    scores = []

    for student_id, student_embedding in student_embeddings.items():
        score = cosine_similarity(
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
        key=lambda item: item["score"],
        reverse=True,
    )

    if not scores:
        return {
            "status": "UNKNOWN",
            "studentId": None,
            "score": None,
        }

    best_match = scores[0]

    second_score = (
        scores[1]["score"]
        if len(scores) > 1
        else -1.0
    )

    score_difference = (
        best_match["score"]
        - second_score
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
        "score": round(best_match["score"], 4),
        "secondBestScore": round(second_score, 4),
        "scoreDifference": round(
            score_difference,
            4,
        ),
    }


def recognize_separated_faces(
    recognizer,
    student_embeddings,
):
    results = []

    face_images = sorted(
        path
        for path in SEPARATED_FACES_DIR.iterdir()
        if path.suffix.lower() in IMAGE_EXTENSIONS
    )

    for face_image in face_images:
        embedding = extract_embedding(
            face_image,
            recognizer,
        )

        if embedding is None:
            results.append(
                {
                    "faceImage": face_image.name,
                    "status": "INVALID_FACE",
                    "studentId": None,
                }
            )
            continue

        result = recognize_face(
            embedding,
            student_embeddings,
        )

        result["faceImage"] = face_image.name

        results.append(result)

        print(
            f"{face_image.name} → "
            f"{result['status']} → "
            f"{result['studentId']} → "
            f"score={result['score']}"
        )

    return results


def main():
    if not DETECTOR_MODEL.exists():
        raise FileNotFoundError(
            f"Detector model missing: {DETECTOR_MODEL}"
        )

    if not RECOGNIZER_MODEL.exists():
        raise FileNotFoundError(
            f"Recognizer model missing: {RECOGNIZER_MODEL}"
        )

    if not SEPARATED_FACES_DIR.exists():
        raise FileNotFoundError(
            f"Separated-face directory missing: "
            f"{SEPARATED_FACES_DIR}"
        )

    OUTPUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    recognizer = create_recognizer()

    print("Creating registered student embeddings...")
    student_embeddings = create_student_embeddings(
        recognizer
    )

    if not student_embeddings:
        raise RuntimeError(
            "No valid registered student embeddings were created."
        )

    print()
    print(
        f"Registered students: "
        f"{len(student_embeddings)}"
    )

    print()
    print("Comparing separated classroom faces...")

    results = recognize_separated_faces(
        recognizer,
        student_embeddings,
    )

    matched_student_ids = sorted(
        {
            result["studentId"]
            for result in results
            if result["status"] == "MATCHED"
        }
    )

    output = {
        "registeredStudentCount": len(
            student_embeddings
        ),
        "processedFaceCount": len(results),
        "matchedStudentIds": matched_student_ids,
        "results": results,
    }

    with OUTPUT_PATH.open(
        "w",
        encoding="utf-8",
    ) as output_file:
        json.dump(
            output,
            output_file,
            indent=2,
        )

    print()
    print("Comparison completed.")
    print(
        f"Matched students: "
        f"{matched_student_ids}"
    )
    print(f"Result file: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()