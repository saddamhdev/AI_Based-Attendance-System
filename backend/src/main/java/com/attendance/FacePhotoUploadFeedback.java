package com.attendance;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

record FacePhotoError(int photoIndex, String code, String message) {}

final class FacePhotoUploadException extends RuntimeException {
    final HttpStatus status;
    final String code;
    final String studentLabel;
    final List<FacePhotoError> photoErrors;
    final UUID supportReferenceId;
    final boolean previousEnrollmentPreserved;
    final String message;

    FacePhotoUploadException(HttpStatus status, String code, String message, String studentLabel,
            List<FacePhotoError> photoErrors, UUID supportReferenceId,
            boolean previousEnrollmentPreserved) {
        super(message);
        this.status = status;
        this.code = code;
        this.message = message;
        this.studentLabel = studentLabel;
        this.photoErrors = photoErrors == null ? List.of() : List.copyOf(photoErrors);
        this.supportReferenceId = supportReferenceId;
        this.previousEnrollmentPreserved = previousEnrollmentPreserved;
    }

    static FacePhotoUploadException validation(String code, String message, String studentLabel,
            List<FacePhotoError> errors, boolean previousEnrollmentPreserved) {
        return new FacePhotoUploadException(HttpStatus.UNPROCESSABLE_ENTITY, code, message,
                studentLabel, errors, null, previousEnrollmentPreserved);
    }

    static FacePhotoUploadException known(HttpStatus status, String code, String message,
            String studentLabel, boolean previousEnrollmentPreserved) {
        return new FacePhotoUploadException(status, code, message, studentLabel,
                List.of(), null, previousEnrollmentPreserved);
    }

    static FacePhotoUploadException unexpected(String code, String message, String studentLabel,
            boolean previousEnrollmentPreserved) {
        return new FacePhotoUploadException(HttpStatus.BAD_GATEWAY, code, message,
                studentLabel, List.of(), UUID.randomUUID(), previousEnrollmentPreserved);
    }
}

@RestControllerAdvice
@Order(Ordered.HIGHEST_PRECEDENCE)
class FacePhotoUploadAdvice {
    @ExceptionHandler(FacePhotoUploadException.class)
    ResponseEntity<Map<String, Object>> handle(FacePhotoUploadException failure) {
        StringBuilder message = new StringBuilder("Enrollment for ")
                .append(failure.studentLabel).append(" could not be completed. ");
        if (!failure.photoErrors.isEmpty()) {
            for (int i = 0; i < failure.photoErrors.size(); i++) {
                if (i > 0) message.append(' ');
                FacePhotoError error = failure.photoErrors.get(i);
                message.append("Photo ").append(error.photoIndex()).append(' ')
                        .append(error.message());
            }
            message.append(" Replace these photos and submit again.");
        } else {
            message.append(failure.message);
        }
        if (failure.supportReferenceId != null) {
            message.append(" Support reference: ").append(failure.supportReferenceId).append('.');
        }
        if (failure.previousEnrollmentPreserved) {
            message.append(" The previous active enrollment remains unchanged.");
        }
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("code", failure.code);
        response.put("message", message.toString());
        response.put("photoErrors", failure.photoErrors);
        response.put("supportReferenceId",
                failure.supportReferenceId == null ? null : failure.supportReferenceId.toString());
        response.put("previousEnrollmentPreserved", failure.previousEnrollmentPreserved);
        return ResponseEntity.status(failure.status).body(response);
    }
}
