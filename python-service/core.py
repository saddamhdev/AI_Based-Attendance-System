import os
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
    threshold,
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
        best_match["score"] >= threshold
        and score_difference >= AMBIGUITY_MARGIN
    ):
        status = "MATCHED"
        student_id = best_match["studentId"]

    elif best_match["score"] >= threshold:
        status = "UNCERTAIN"
        student_id = best_match["studentId"]

    else:
        status = "UNKNOWN"
        student_id = None

    return {
        "status": status,
        "studentId": student_id,
        "score": best_match["score"],
        "secondBestScore": second_best_score,
        "scoreDifference": score_difference,
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



DETECTOR_MODEL=Path(os.getenv("MODEL_DIR","/app/models"))/"face_detection_yunet_2023mar.onnx"
RECOGNIZER_MODEL=Path(os.getenv("MODEL_DIR","/app/models"))/"face_recognition_sface_2021dec.onnx"
AMBIGUITY_MARGIN=float(os.getenv("AMBIGUITY_MARGIN","0.05"))
