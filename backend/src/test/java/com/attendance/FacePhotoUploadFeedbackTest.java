package com.attendance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class FacePhotoUploadFeedbackTest {
    @Test
    void buildsPhotoSpecificAdminFailureWithoutClaimingMissingPreviousEnrollment() {
        FacePhotoUploadAdvice advice = new FacePhotoUploadAdvice();
        var failure = FacePhotoUploadException.validation(
                "FACE_PHOTO_VALIDATION_FAILED",
                "Some photos need to be replaced.",
                "Mahin Hasan (0112630243)",
                List.of(
                        new FacePhotoError(2, "MULTIPLE_FACES", "contains multiple faces."),
                        new FacePhotoError(4, "NO_DETECTABLE_FACE", "has no detectable face.")),
                false);

        var response = advice.handle(failure);
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, response.getStatusCode());
        assertEquals("FACE_PHOTO_VALIDATION_FAILED", response.getBody().get("code"));
        String message = (String) response.getBody().get("message");
        assertTrue(message.contains("Enrollment for Mahin Hasan (0112630243) could not be completed."));
        assertTrue(message.contains("Photo 2 contains multiple faces."));
        assertTrue(message.contains("Photo 4 has no detectable face."));
        assertTrue(message.contains("Replace these photos and submit again."));
        assertTrue(!message.contains("previous active enrollment"));
        assertEquals(List.of(
                new FacePhotoError(2, "MULTIPLE_FACES", "contains multiple faces."),
                new FacePhotoError(4, "NO_DETECTABLE_FACE", "has no detectable face.")),
                response.getBody().get("photoErrors"));
    }

    @Test
    void supportReferenceIsIncludedOnlyForUnexpectedFailures() {
        UUID supportId = UUID.randomUUID();
        var failure = new FacePhotoUploadException(HttpStatus.BAD_GATEWAY, "DATABASE_SAVE_FAILED",
                "Submission details could not be saved. Retry the upload.",
                "Mahin Hasan (0112630243)", List.of(), supportId, true);

        var response = new FacePhotoUploadAdvice().handle(failure);
        String message = (String) response.getBody().get("message");
        assertTrue(message.contains(supportId.toString()));
        assertTrue(message.contains("The previous active enrollment remains unchanged."));
        assertEquals(supportId.toString(), response.getBody().get("supportReferenceId"));
    }
}
