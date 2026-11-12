package com.attendance;
import java.sql.Timestamp;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@Service
class RecognitionSettingsService {
    static final double DEFAULT_THRESHOLD = 70;

    private final JdbcTemplate db;
    private final ObjectMapper objectMapper;

    RecognitionSettingsService(JdbcTemplate db, ObjectMapper objectMapper) {
        this.db = db;
        this.objectMapper = objectMapper;
    }

    double threshold(Authentication authentication) {
        UUID accountId = identity(authentication);
        Double saved = db.query(
                "select threshold_percentage from recognition_settings where account_id=?",
                rs -> rs.next() ? rs.getDouble(1) : null,
                accountId);
        return saved == null ? DEFAULT_THRESHOLD : saved;
    }

    Map<String, Object> settings(Authentication authentication) {
        UUID accountId = identity(authentication);
        Double saved = db.query(
                "select threshold_percentage from recognition_settings where account_id=?",
                rs -> rs.next() ? rs.getDouble(1) : null,
                accountId);
        return Map.of("threshold", saved == null ? DEFAULT_THRESHOLD : saved,
                "saved", saved != null);
    }

    @Transactional
    Map<String, Object> update(Authentication authentication, JsonNode request) {
        UUID accountId = identity(authentication);
        if (request == null || !request.isObject()) {
            throw badRequest("Send a numeric threshold or reset=true.");
        }

        JsonNode reset = request.get("reset");
        if (reset != null) {
            if (!reset.isBoolean() || !reset.booleanValue()
                    || request.size() != 1) {
                throw badRequest("Reset must be the only setting and must be true.");
            }
            db.update("delete from recognition_settings where account_id=?", accountId);
            return Map.of("threshold", DEFAULT_THRESHOLD, "saved", false);
        }

        if (request.size() != 1 || !request.has("threshold")) {
            throw badRequest("Only the threshold may be set for the authenticated account.");
        }
        JsonNode value = request.get("threshold");
        if (value == null || !value.isNumber()) {
            throw badRequest("Threshold must be a numeric percentage from 1 to 100.");
        }
        double threshold = value.doubleValue();
        if (!Double.isFinite(threshold) || threshold < 1 || threshold > 100) {
            throw badRequest("Threshold must be a finite percentage from 1 to 100.");
        }

        saveThreshold(accountId, threshold);
        return Map.of("threshold", threshold, "saved", true);
    }

    @Transactional
    Map<String, Object> saveAnalysis(
            UUID sessionId,
            Authentication authentication,
            double threshold,
            Map<String, Object> pythonResponse) {

        UUID accountId = identity(authentication);
        String role = role(authentication);
        UUID analysisId = UUID.randomUUID();
        Instant analyzedAt = Instant.now();

        Map<String, Object> response =
                new LinkedHashMap<>(pythonResponse);

        response.put("analysisId", analysisId.toString());
        response.put("thresholdPercentage", threshold);
        response.put("initiatingUser", authentication.getName());
        response.put("initiatingRole", role);
        response.put("initiatingUserId", accountId.toString());
        response.put("analyzedAt", analyzedAt.toString());

        try {
            db.update("""
                insert into session_recognition_analyses
                    (id, session_id, initiating_user_id,
                     threshold_percentage, response, analyzed_at)
                values (?, ?, ?, ?, cast(? as jsonb), ?)
                """,
                    analysisId,
                    sessionId,
                    accountId,
                    threshold,
                    objectMapper.writeValueAsString(response),
                    Timestamp.from(analyzedAt));

        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Could not serialize recognition analysis.",
                    exception);
        }

        return response;
    }

    Map<String, Object> latestAnalysis(UUID sessionId) {
        var rows = db.queryForList("""
                select a.id, a.threshold_percentage, a.response::text as response_json,
                       i.username, i.role, a.analyzed_at
                from session_recognition_analyses a
                join recognition_account_identities i on i.id=a.initiating_user_id
                where a.session_id=?
                order by a.analyzed_at desc, a.id desc
                limit 1
                """, sessionId);
        if (rows.isEmpty()) {
            return null;
        }
        var row = rows.get(0);
        try {
            var storedResponse = objectMapper.readTree((String) row.get("response_json"));
            if (storedResponse.isTextual()) {
                storedResponse = objectMapper.readTree(storedResponse.textValue());
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> response = objectMapper.convertValue(storedResponse, Map.class);
            response.put("analysisId", row.get("id").toString());
            response.put("thresholdPercentage", ((Number) row.get("threshold_percentage")).doubleValue());
            response.put("initiatingUser", row.get("username"));
            response.put("initiatingRole", row.get("role"));
            response.put("analyzedAt", row.get("analyzed_at").toString());
            return response;
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException("Could not read saved recognition analysis.", exception);
        }
    }

    private UUID identity(Authentication authentication) {
        String role = role(authentication);
        String username = authentication.getName();
        String normalizedUsername = username.trim().toLowerCase(Locale.ROOT);
        var existing = db.query("""
                select id from recognition_account_identities
                where role=? and normalized_username=?
                """, (rs, row) -> rs.getObject("id", UUID.class), role, normalizedUsername);
        if (!existing.isEmpty()) {
            return existing.get(0);
        }

        UUID accountId = UUID.randomUUID();
        db.update("""
                insert into recognition_account_identities(id, role, username, normalized_username)
                values (?, ?, ?, ?)
                on conflict (role, normalized_username) do nothing
                """, accountId, role, username, normalizedUsername);
        return db.queryForObject("""
                select id from recognition_account_identities
                where role=? and normalized_username=?
                """, UUID.class, role, normalizedUsername);
    }

    private void saveThreshold(UUID accountId, double threshold) {
        db.queryForObject(
                "select id from recognition_account_identities where id=? for update",
                UUID.class, accountId);
        int updated = db.update("""
                update recognition_settings
                set threshold_percentage=?, updated_at=now()
                where account_id=?
                """, threshold, accountId);
        if (updated != 0) {
            return;
        }
        db.update("""
                insert into recognition_settings(account_id, threshold_percentage, updated_at)
                values (?, ?, now())
                """, accountId, threshold);
    }

    private String role(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED);
        }
        if (authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"))) {
            return "ADMIN";
        }
        if (authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_TEACHER"))) {
            return "TEACHER";
        }
        throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                "Only administrators and teachers can manage recognition settings.");
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}

@RestController
@RequestMapping("/api/me/recognition-settings")
class RecognitionSettingsController {
    private final RecognitionSettingsService settings;

    RecognitionSettingsController(RecognitionSettingsService settings) {
        this.settings = settings;
    }

    @GetMapping
    Map<String, Object> get(Authentication authentication) {
        return settings.settings(authentication);
    }

    @PutMapping
    Map<String, Object> put(@RequestBody(required = false) JsonNode request,
            Authentication authentication) {
        return settings.update(authentication, request);
    }
}
