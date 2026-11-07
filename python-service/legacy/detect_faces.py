from pathlib import Path

import cv2


# Project directories
PROJECT_ROOT = Path(__file__).resolve().parent.parent

MODEL_PATH = (
    PROJECT_ROOT
    / "models"
    / "face_detection_yunet_2023mar.onnx"
)

IMAGE_PATH = (
    PROJECT_ROOT
    / "data"
    / "group_photos"
    / "class_03.jpg"
)

SEPARATED_FACES_DIR = (
    PROJECT_ROOT
    / "data"
    / "separated_faces"
)

OUTPUT_DIR = PROJECT_ROOT / "output"


# Detection configuration
SCORE_THRESHOLD = 0.70
NMS_THRESHOLD = 0.30
TOP_K = 5000
MIN_FACE_SIZE = 30
PADDING_RATIO = 0.20


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"YuNet model was not found:\n{MODEL_PATH}"
        )

    if not IMAGE_PATH.exists():
        raise FileNotFoundError(
            f"Group photo was not found:\n{IMAGE_PATH}"
        )

    SEPARATED_FACES_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    image = cv2.imread(str(IMAGE_PATH))

    if image is None:
        raise ValueError(
            f"OpenCV could not read the image:\n{IMAGE_PATH}"
        )

    image_height, image_width = image.shape[:2]

    detector = cv2.FaceDetectorYN.create(
        str(MODEL_PATH),
        "",
        (image_width, image_height),
        SCORE_THRESHOLD,
        NMS_THRESHOLD,
        TOP_K,
    )

    detector.setInputSize((image_width, image_height))

    _, faces = detector.detect(image)

    if faces is None or len(faces) == 0:
        print("No faces were detected.")
        print("Use a clearer image or reduce SCORE_THRESHOLD.")
        return

    annotated_image = image.copy()
    saved_count = 0

    for face in faces:
        x = int(face[0])
        y = int(face[1])
        width = int(face[2])
        height = int(face[3])
        confidence = float(face[14])

        if width < MIN_FACE_SIZE or height < MIN_FACE_SIZE:
            print(
                f"Skipped small face: {width}x{height}"
            )
            continue

        padding_x = int(width * PADDING_RATIO)
        padding_y = int(height * PADDING_RATIO)

        x1 = max(0, x - padding_x)
        y1 = max(0, y - padding_y)

        x2 = min(
            image_width,
            x + width + padding_x,
        )

        y2 = min(
            image_height,
            y + height + padding_y,
        )

        cropped_face = image[y1:y2, x1:x2]

        if cropped_face.size == 0:
            continue

        saved_count += 1

        face_filename = (
            f"class_01_face_{saved_count:03d}.jpg"
        )

        face_path = (
            SEPARATED_FACES_DIR
            / face_filename
        )

        cv2.imwrite(
            str(face_path),
            cropped_face,
            [cv2.IMWRITE_JPEG_QUALITY, 95],
        )

        cv2.rectangle(
            annotated_image,
            (x, y),
            (x + width, y + height),
            (0, 255, 0),
            3,
        )

        label = (
            f"Face {saved_count}: "
            f"{confidence:.2f}"
        )

        cv2.putText(
            annotated_image,
            label,
            (x, max(25, y - 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.65,
            (0, 255, 0),
            2,
            cv2.LINE_AA,
        )

        print(
            f"Saved {face_filename} | "
            f"confidence={confidence:.4f}"
        )

    annotated_path = (
        OUTPUT_DIR
        / "class_01_detected.jpg"
    )

    cv2.imwrite(
        str(annotated_path),
        annotated_image,
        [cv2.IMWRITE_JPEG_QUALITY, 95],
    )

    print()
    print("Face detection completed.")
    print(f"Faces detected: {len(faces)}")
    print(f"Faces saved: {saved_count}")
    print(f"Separated faces: {SEPARATED_FACES_DIR}")
    print(f"Annotated image: {annotated_path}")


if __name__ == "__main__":
    main()