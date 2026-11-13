package com.attendance;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotAcceptableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/** An application failure with a stable machine-readable code and a user-safe message. */
class ApiProblemException extends RuntimeException {
    final HttpStatus status;
    final String code;
    final Map<String, Object> extra;

    ApiProblemException(HttpStatus status, String code, String message) {
        this(status, code, message, Map.of());
    }

    ApiProblemException(HttpStatus status, String code, String message, Map<String, Object> extra) {
        super(message);
        this.status = status;
        this.code = code;
        this.extra = extra == null ? Map.of() : Map.copyOf(extra);
    }
}

/**
 * Converts controller failures to JSON bodies of the form {@code {status, code, message}}
 * so clients see the real HTTP status instead of an error-dispatch Forbidden. Unexpected
 * failures are logged with a support reference and never expose SQL, stack traces, or paths.
 * {@link FacePhotoUploadAdvice} keeps its richer response for photo submissions.
 */
@RestControllerAdvice
@Order(Ordered.LOWEST_PRECEDENCE)
class ApiErrors {
    private static final Logger LOG = Logger.getLogger(ApiErrors.class.getName());

    static Map<String, Object> body(HttpStatus status, String code, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", status.value());
        body.put("error", status.getReasonPhrase());
        body.put("code", code);
        body.put("message", message);
        return body;
    }

    static ResponseEntity<Map<String, Object>> respond(HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body(status, code, message));
    }

    static void writeJson(HttpServletResponse response, HttpStatus status, String code, String message)
            throws IOException {
        response.setStatus(status.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"status\":" + status.value() + ",\"error\":\"" + status.getReasonPhrase()
                + "\",\"code\":\"" + code + "\",\"message\":\"" + message.replace("\\", "\\\\").replace("\"", "\\\"")
                + "\"}");
    }

    static String defaultMessage(HttpStatus status) {
        return switch (status) {
            case BAD_REQUEST -> "The request is invalid.";
            case UNAUTHORIZED -> "Sign in to continue.";
            case FORBIDDEN -> "You do not have permission to perform this action.";
            case NOT_FOUND -> "The requested record was not found.";
            case CONFLICT -> "The record changed. Reload and try again.";
            case BAD_GATEWAY, SERVICE_UNAVAILABLE, GATEWAY_TIMEOUT -> "A dependent service is unavailable. Try again shortly.";
            default -> status.getReasonPhrase();
        };
    }

    @ExceptionHandler(ApiProblemException.class)
    ResponseEntity<Map<String, Object>> problem(ApiProblemException failure) {
        Map<String, Object> body = body(failure.status, failure.code, failure.getMessage());
        body.putAll(failure.extra);
        return ResponseEntity.status(failure.status).contentType(MediaType.APPLICATION_JSON).body(body);
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<Map<String, Object>> status(ResponseStatusException failure) {
        HttpStatus status = HttpStatus.resolve(failure.getStatusCode().value());
        if (status == null) status = HttpStatus.INTERNAL_SERVER_ERROR;
        String message = failure.getReason() == null || failure.getReason().isBlank()
                ? defaultMessage(status) : failure.getReason();
        return respond(status, status.name().toUpperCase(Locale.ROOT), message);
    }

    @ExceptionHandler(EmptyResultDataAccessException.class)
    ResponseEntity<Map<String, Object>> missing(EmptyResultDataAccessException failure) {
        return respond(HttpStatus.NOT_FOUND, "NOT_FOUND", "The requested record was not found.");
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<Map<String, Object>> integrity(DataIntegrityViolationException failure) {
        return respond(HttpStatus.CONFLICT, "CONFLICT", "The change conflicts with existing data. Reload and try again.");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String, Object>> tooLarge(MaxUploadSizeExceededException failure) {
        return respond(HttpStatus.PAYLOAD_TOO_LARGE, "UPLOAD_TOO_LARGE",
                "The upload is too large. Each photo must be 10 MB or smaller.");
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MissingServletRequestPartException.class,
            HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, MultipartException.class})
    ResponseEntity<Map<String, Object>> badRequest(Exception failure) {
        return respond(HttpStatus.BAD_REQUEST, "BAD_REQUEST", "The request is missing a field or has an invalid value.");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    ResponseEntity<Map<String, Object>> method(HttpRequestMethodNotSupportedException failure) {
        return respond(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "This operation is not supported.");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    ResponseEntity<Map<String, Object>> mediaType(HttpMediaTypeNotSupportedException failure) {
        return respond(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "The request format is not supported.");
    }

    @ExceptionHandler(HttpMediaTypeNotAcceptableException.class)
    ResponseEntity<Map<String, Object>> notAcceptable(HttpMediaTypeNotAcceptableException failure) {
        return respond(HttpStatus.NOT_ACCEPTABLE, "NOT_ACCEPTABLE", "The requested response format is not available.");
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, Object>> noResource(NoResourceFoundException failure) {
        return respond(HttpStatus.NOT_FOUND, "NOT_FOUND", "The requested endpoint was not found.");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception failure) {
        UUID reference = UUID.randomUUID();
        LOG.log(Level.SEVERE, "Unexpected API failure; support reference " + reference, failure);
        Map<String, Object> body = body(HttpStatus.INTERNAL_SERVER_ERROR, "UNEXPECTED_ERROR",
                "Something went wrong. Support reference: " + reference + ".");
        body.put("supportReferenceId", reference.toString());
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).contentType(MediaType.APPLICATION_JSON).body(body);
    }
}
