from __future__ import annotations

from pathlib import Path
from typing import List
import hashlib

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI(title="Attendance AI Service", version="0.1.0")
FACE_CASCADE = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")


class RecognitionRequest(BaseModel):
    sessionId: int
    enrolledStudentIds: List[int] = Field(default_factory=list)
    photoPaths: List[str] = Field(default_factory=list)


class FaceMatch(BaseModel):
    studentId: int | None
    similarity: float | None
    uncertain: bool
    photoPath: str
    bbox: list[int] | None = None
    notes: str = "demo_heuristic_not_for_production"


class EnrollmentQualityRequest(BaseModel):
    photoPath: str


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/recognition/process", response_model=List[FaceMatch])
def process(request: RecognitionRequest):
    if not request.enrolledStudentIds:
        return []

    matches: list[FaceMatch] = []
    for path in request.photoPaths:
        image = _load_image(path)
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(40, 40))

        for (x, y, w, h) in faces:
            crop = gray[y : y + h, x : x + w]
            embedding = _embedding(crop)
            student_id, similarity = _match_student(embedding, request.enrolledStudentIds)
            matches.append(
                FaceMatch(
                    studentId=student_id,
                    similarity=round(similarity, 4),
                    uncertain=similarity < 0.72,
                    photoPath=path,
                    bbox=[int(x), int(y), int(w), int(h)],
                )
            )

    return matches


@app.post("/recognition/enrollment/quality")
def enrollment_quality(request: EnrollmentQualityRequest):
    image = _load_image(request.photoPath)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = FACE_CASCADE.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(40, 40))

    errors = []
    if len(faces) != 1:
        errors.append("Each enrollment photo must contain exactly one visible face.")

    blur = cv2.Laplacian(gray, cv2.CV_64F).var()
    if blur < 75:
        errors.append("Image appears blurry. Please upload a sharper photo.")

    h, w = gray.shape
    if h < 240 or w < 240:
        errors.append("Image resolution is too low.")

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "faceCount": int(len(faces)),
        "quality": {"blurVariance": float(blur), "width": int(w), "height": int(h)},
        "notes": "demo_heuristic_not_for_production",
    }


def _load_image(path_str: str):
    path = Path(path_str)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=400, detail=f"Photo path not found: {path_str}")
    image = cv2.imread(str(path))
    if image is None:
        raise HTTPException(status_code=400, detail=f"Unsupported or corrupt image: {path_str}")
    return image


def _embedding(face_gray: np.ndarray) -> np.ndarray:
    resized = cv2.resize(face_gray, (32, 32))
    hist = cv2.calcHist([resized], [0], None, [64], [0, 256]).flatten()
    hist = hist / (np.linalg.norm(hist) + 1e-8)
    return hist


def _student_vector(student_id: int, dim: int) -> np.ndarray:
    digest = hashlib.sha256(str(student_id).encode()).digest()
    arr = np.frombuffer(digest, dtype=np.uint8).astype(np.float32)
    vec = np.tile(arr, int(np.ceil(dim / len(arr))))[:dim]
    vec = vec / (np.linalg.norm(vec) + 1e-8)
    return vec


def _match_student(embedding: np.ndarray, enrolled_ids: List[int]) -> tuple[int | None, float]:
    best_student = None
    best_similarity = -1.0
    for sid in enrolled_ids:
        student_vec = _student_vector(sid, embedding.shape[0])
        similarity = float(np.dot(embedding, student_vec))
        if similarity > best_similarity:
            best_similarity = similarity
            best_student = sid

    if best_similarity < 0.55:
        return None, best_similarity
    return best_student, best_similarity
