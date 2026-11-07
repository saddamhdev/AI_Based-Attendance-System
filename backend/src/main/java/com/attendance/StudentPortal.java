package com.attendance;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.ZoneId;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class StudentPortal {
    private static final ZoneId DHaka = ZoneId.of("Asia/Dhaka");
    private static final int PASSWORD_MIN_LENGTH = 12;
    private static final Duration WINDOW = Duration.ofMinutes(15);
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate db;
    private final BCryptPasswordEncoder passwordEncoder;
    private final ConcurrentHashMap<String, RateWindow> rateWindows = new ConcurrentHashMap<>();

    StudentPortal(JdbcTemplate db, BCryptPasswordEncoder passwordEncoder) {
        this.db = db;
        this.passwordEncoder = passwordEncoder;
    }

    private record RateWindow(long startMillis, int requests) {}

    private void rateLimit(HttpServletRequest request, String endpoint, int limit) {
        long now = System.currentTimeMillis();
        String key = endpoint + ":" + request.getRemoteAddr();
        rateWindows.compute(key, (ignored, current) -> current == null || now - current.startMillis() >= WINDOW.toMillis()
                ? new RateWindow(now, 1)
                : new RateWindow(current.startMillis(), current.requests() + 1));
        if (rateWindows.size() > 10_000) {
            rateWindows.entrySet().removeIf(entry -> now - entry.getValue().startMillis() > WINDOW.toMillis());
        }
        if (rateWindows.get(key).requests() > limit) {
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many requests. Try again later.");
        }
    }

    private String normalizeRoll(String roll) {
        return roll.trim().replaceAll("\\s+", "").toUpperCase();
    }

    private String normalizeEmail(String email) {
        return email.trim().toLowerCase();
    }

    private String normalizeUsername(String username) {
        return username.trim().toLowerCase();
    }

    private boolean validEmail(String email) {
        return email.length() <= 254 && email.matches("(?i)^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$");
    }

    private void validateRegistration(String name, String roll, String email, String username, String password) {
        if (name == null || name.isBlank() || name.trim().length() > 160
                || roll == null || roll.isBlank() || roll.trim().length() > 64
                || email == null || !validEmail(email.trim())
                || username == null || !username.trim().matches("[A-Za-z0-9._-]{3,64}")
                || password == null || password.length() < PASSWORD_MIN_LENGTH || password.length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Provide a valid name, roll, email, username, and a password of 12–128 characters");
        }
    }

    private void ensureAccountIdentifiersAvailable(String username, String email) {
        int usernameConflict = db.queryForObject(
                "select (select count(*) from teacher_profiles where lower(btrim(username))=?)"
                        + "+(select count(*) from student_accounts where lower(btrim(username))=?)",
                Integer.class, username, username);
        int emailConflict = db.queryForObject(
                "select count(*) from student_accounts where lower(btrim(email))=?",
                Integer.class, email);
        if (usernameConflict > 0 || emailConflict > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Those account details cannot be used. Check the username and email or contact an administrator.");
        }
    }

    private String createStatusToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hashToken(String token) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by the runtime", exception);
        }
    }

    private Map<String, Object> statusRequest(String reference, String token) {
        UUID id;
        try {
            id = UUID.fromString(reference);
        } catch (RuntimeException exception) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Registration status could not be verified");
        }
        List<Map<String, Object>> rows = db.queryForList(
                "select id,status,status_token_hash,submitted_at,rejection_reason from student_registration_requests where id=?",
                id);
        if (rows.isEmpty() || token == null || token.length() > 128
                || !MessageDigest.isEqual(
                        ((String) rows.get(0).get("status_token_hash")).getBytes(StandardCharsets.UTF_8),
                        hashToken(token).getBytes(StandardCharsets.UTF_8))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Registration status could not be verified");
        }
        return rows.get(0);
    }

    record Registration(
            String name, String roll, String email, String username, String password,
            String department, String batch) {}

    record StatusLookup(String reference, String token) {}

    record Resubmission(String reference, String token, Registration application) {}

    @Transactional
    @PostMapping("/api/student-registrations")
    Object register(
            @RequestBody Registration request,
            HttpServletRequest servletRequest) {
        rateLimit(servletRequest, "register", 5);
        validateRegistration(request.name(), request.roll(), request.email(), request.username(), request.password());
        if (request.department() != null && request.department().trim().length() > 120
                || request.batch() != null && request.batch().trim().length() > 80) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Academic details are too long");
        }
        String username = normalizeUsername(request.username());
        String email = normalizeEmail(request.email());
        String roll = normalizeRoll(request.roll());
        ensureAccountIdentifiersAvailable(username, email);
        if (db.queryForObject("select count(*) from student_registration_requests where status='PENDING_APPROVAL' "
                        + "and (normalized_username=? or normalized_email=? or normalized_roll=?)",
                Integer.class, username, email, roll) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A request with these details is already pending");
        }
        UUID candidate = db.query(
                "select id from students where upper(regexp_replace(btrim(roll),'\\s+','','g'))=?",
                rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null, roll);
        UUID reference = UUID.randomUUID();
        String statusToken = createStatusToken();
        try {
            db.update("""
                    insert into student_registration_requests(
                        id,full_name,normalized_roll,email,normalized_email,username,normalized_username,
                        password_hash,department,batch,candidate_student_id,status,status_token_hash)
                    values(?,?,?,?,?,?,?,?,?, ?,?,'PENDING_APPROVAL',?)
                    """, reference, request.name().trim(), roll, email, email, username, username,
                    passwordEncoder.encode(request.password()), blankToNull(request.department()),
                    blankToNull(request.batch()), candidate, hashToken(statusToken));
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A request with these details is already pending");
        }
        return Map.of("reference", reference, "statusToken", statusToken, "status", "PENDING_APPROVAL");
    }

    @PostMapping("/api/student-registrations/status")
    Object registrationStatus(@RequestBody StatusLookup lookup, HttpServletRequest request) {
        rateLimit(request, "registration-status", 10);
        Map<String, Object> row = statusRequest(lookup.reference(), lookup.token());
        return Map.of(
                "reference", lookup.reference(),
                "status", row.get("status"),
                "submittedAt", row.get("submitted_at"),
                "rejectionReason", row.get("rejection_reason") == null ? "" : row.get("rejection_reason"));
    }

    @Transactional
    @PostMapping("/api/student-registrations/resubmit")
    Object resubmit(@RequestBody Resubmission request, HttpServletRequest servletRequest) {
        rateLimit(servletRequest, "registration-resubmission", 3);
        if (request.application() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Application details are required");
        }
        Map<String, Object> existing = statusRequest(request.reference(), request.token());
        if (!"REJECTED".equals(existing.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only rejected applications can be resubmitted");
        }
        Registration application = request.application();
        validateRegistration(application.name(), application.roll(), application.email(),
                application.username(), application.password());
        String username = normalizeUsername(application.username());
        String email = normalizeEmail(application.email());
        String roll = normalizeRoll(application.roll());
        ensureAccountIdentifiersAvailable(username, email);
        UUID candidate = db.query(
                "select id from students where upper(regexp_replace(btrim(roll),'\\s+','','g'))=?",
                rs -> rs.next() ? UUID.fromString(rs.getString(1)) : null, roll);
        int updated = db.update("""
                update student_registration_requests set full_name=?,normalized_roll=?,email=?,normalized_email=?,
                    username=?,normalized_username=?,password_hash=?,department=?,batch=?,candidate_student_id=?,
                    status='PENDING_APPROVAL',rejection_reason=null,reviewer=null,reviewed_at=null,
                    student_id=null,submitted_at=now(),purge_after=null,purged_at=null,status_token_hash=?
                where id=? and status='REJECTED' and status_token_hash=?
                """, application.name().trim(), roll, email, email, username, username,
                passwordEncoder.encode(application.password()), blankToNull(application.department()),
                blankToNull(application.batch()), candidate, hashToken(request.token()), UUID.fromString(request.reference()),
                hashToken(request.token()));
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "The application changed; check its current status");
        }
        return Map.of("reference", request.reference(), "status", "PENDING_APPROVAL");
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private boolean isAdmin(Authentication authentication) {
        return authentication.getAuthorities().stream()
                .anyMatch(authority -> authority.getAuthority().equals("ROLE_ADMIN"));
    }

    private void requireAdmin(Authentication authentication) {
        if (!isAdmin(authentication)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Administrator access required");
        }
    }

    @GetMapping("/api/admin/student-registrations")
    Object registrationQueue(
            @RequestParam(defaultValue = "PENDING_APPROVAL") String status,
            @RequestParam(required = false) String search,
            Authentication authentication) {
        requireAdmin(authentication);
        if (!List.of("PENDING_APPROVAL", "APPROVED", "REJECTED").contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid request status");
        }
        String sql = """
                select r.id,r.full_name,r.normalized_roll as roll,r.email,r.username,r.department,r.batch,
                       r.candidate_student_id,r.status,r.rejection_reason,r.submitted_at,
                       s.name as candidate_name,s.roll as candidate_roll,
                       exists(select 1 from student_accounts a where a.student_id=s.id) as candidate_has_account
                from student_registration_requests r
                left join students s on s.id=r.candidate_student_id
                where r.status=?
                """;
        if (search != null && !search.isBlank()) {
            sql += " and (lower(r.full_name) like lower(?) or lower(r.normalized_roll) like lower(?) "
                    + "or lower(r.email) like lower(?) or lower(r.username) like lower(?))";
            String term = "%" + search.trim() + "%";
            return db.queryForList(sql + " order by r.submitted_at", status, term, term, term, term);
        }
        return db.queryForList(sql + " order by r.submitted_at", status);
    }

    record ReviewDecision(UUID existingStudentId) {}
    record Rejection(String reason) {}

    @Transactional
    @PostMapping("/api/admin/student-registrations/{id}/approve")
    Object approveRegistration(
            @PathVariable UUID id,
            @RequestBody(required = false) ReviewDecision decision,
            Authentication authentication) {
        requireAdmin(authentication);
        Map<String, Object> row = db.queryForMap(
                "select * from student_registration_requests where id=? for update", id);
        if ("APPROVED".equals(row.get("status"))) {
            return Map.of("status", "APPROVED", "studentId", row.get("student_id"));
        }
        if (!"PENDING_APPROVAL".equals(row.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only pending applications can be approved");
        }
        String username = (String) row.get("normalized_username");
        String email = (String) row.get("normalized_email");
        ensureAccountIdentifiersAvailable(username, email);
        UUID candidate = (UUID) row.get("candidate_student_id");
        UUID chosen = decision == null ? null : decision.existingStudentId();
        UUID studentId;
        if (candidate != null) {
            if (!candidate.equals(chosen)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "This roll matches an existing student. Verify identity and explicitly link that profile.");
            }
            if (db.queryForObject("select count(*) from student_accounts where student_id=?",
                    Integer.class, candidate) > 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The matched student already has an account. Direct the applicant to account recovery.");
            }
            if (db.queryForObject("select count(*) from students where lower(btrim(email))=? and id<>?",
                    Integer.class, email, candidate) > 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "The email is already used by another student profile");
            }
            studentId = candidate;
            db.update("update students set email=?,department=?,batch=? where id=?",
                    email, row.get("department"), row.get("batch"), studentId);
        } else {
            if (chosen != null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "An application without an existing-roll match cannot be linked to another student");
            }
            if (db.queryForObject("select count(*) from students where lower(btrim(email))=?",
                    Integer.class, email) > 0) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The email is already attached to a student profile; verify and explicitly link the correct record.");
            }
            studentId = UUID.randomUUID();
            try {
                db.update("insert into students(id,name,roll,email,department,batch,consent,profile_source,created_by) "
                                + "values(?,?,?,?,?,?,false,'SELF_REGISTRATION',?)",
                        studentId, row.get("full_name"), row.get("normalized_roll"), email,
                        row.get("department"), row.get("batch"), authentication.getName());
            } catch (DataIntegrityViolationException exception) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "The student profile changed while reviewing this request; reload and verify the roll.");
            }
        }
        try {
            db.update("""
                    insert into student_accounts(
                        id,student_id,username,email,password_hash,account_status,active,must_change_password,
                        registration_source,created_by)
                    values(?,?,?,?,?,'APPROVED',true,false,'SELF_REGISTRATION',?)
                    """, UUID.randomUUID(), studentId, username, email, row.get("password_hash"),
                    authentication.getName());
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "An account already uses these details; reload and resolve the conflict.");
        }
        db.update("update student_registration_requests set status='APPROVED',student_id=?,reviewer=?,reviewed_at=now() where id=?",
                studentId, authentication.getName(), id);
        return Map.of("status", "APPROVED", "studentId", studentId);
    }

    @Transactional
    @PostMapping("/api/admin/student-registrations/{id}/reject")
    Object rejectRegistration(
            @PathVariable UUID id,
            @RequestBody Rejection rejection,
            Authentication authentication) {
        requireAdmin(authentication);
        if (rejection.reason() == null || rejection.reason().isBlank()
                || rejection.reason().trim().length() < 5 || rejection.reason().trim().length() > 1000) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A rejection reason of 5–1000 characters is required");
        }
        Map<String, Object> row = db.queryForMap(
                "select status from student_registration_requests where id=? for update", id);
        if ("REJECTED".equals(row.get("status"))) {
            return Map.of("status", "REJECTED");
        }
        if (!"PENDING_APPROVAL".equals(row.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only pending applications can be rejected");
        }
        db.update("update student_registration_requests set status='REJECTED',rejection_reason=?,reviewer=?,reviewed_at=now(),purge_after=now()+interval '90 days' where id=?",
                rejection.reason().trim(), authentication.getName(), id);
        return Map.of("status", "REJECTED");
    }

    record NewStudentAccount(
            String name, String roll, String email, String department, String batch,
            String username, String temporaryPassword, boolean consent) {}

    @Transactional
    @PostMapping("/api/admin/students")
    Object createStudent(
            @RequestBody NewStudentAccount request,
            Authentication authentication) {
        requireAdmin(authentication);
        if (request.name() == null || request.name().isBlank() || request.name().trim().length() > 160
                || request.roll() == null || request.roll().isBlank() || request.roll().trim().length() > 64) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Student name and roll are required");
        }
        boolean hasUsername = request.username() != null && !request.username().isBlank();
        boolean hasPassword = request.temporaryPassword() != null && !request.temporaryPassword().isBlank();
        if (hasUsername != hasPassword) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Username and temporary password must be provided together");
        }
        if (hasUsername) {
            validateRegistration(request.name(), request.roll(),
                    request.email() == null ? "" : request.email(),
                    request.username(), request.temporaryPassword());
            ensureAccountIdentifiersAvailable(normalizeUsername(request.username()), normalizeEmail(request.email()));
        }
        if (request.email() != null && !request.email().isBlank() && !validEmail(request.email().trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Provide a valid email address");
        }
        UUID id = UUID.randomUUID();
        try {
            db.update("insert into students(id,name,roll,email,department,batch,consent,consent_updated_at,consent_source,profile_source,created_by) "
                            + "values(?,?,?,?,?,?,?,case when ? then now() else null end,case when ? then 'ADMIN' else null end,'ADMIN',?)",
                    id, request.name().trim(), normalizeRoll(request.roll()),
                    request.email() == null || request.email().isBlank() ? null : normalizeEmail(request.email()),
                    blankToNull(request.department()), blankToNull(request.batch()),request.consent(),
                    request.consent(),request.consent(),authentication.getName());
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A student profile already uses this roll or email");
        }
        if (hasUsername) {
            createAdminAccount(id, request.username(), request.email(), request.temporaryPassword(), authentication);
        }
        return Map.of("id", id, "accountCreated", hasUsername);
    }

    @PostMapping("/api/students/{id}/account")
    @Transactional
    Object addAccount(
            @PathVariable UUID id,
            @RequestBody NewStudentAccount request,
            Authentication authentication) {
        requireAdmin(authentication);
        if (request.username() == null || request.email() == null
                || request.temporaryPassword() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Username, email, and temporary password are required");
        }
        validateRegistration("Student", "student", request.email(), request.username(), request.temporaryPassword());
        if (db.queryForObject("select count(*) from students where id=? and archived=false", Integer.class, id) != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active student profile not found");
        }
        ensureAccountIdentifiersAvailable(normalizeUsername(request.username()), normalizeEmail(request.email()));
        createAdminAccount(id, request.username(), request.email(), request.temporaryPassword(), authentication);
        return Map.of("accountCreated", true);
    }

    private void createAdminAccount(
            UUID studentId, String username, String email, String temporaryPassword,
            Authentication authentication) {
        if (email == null || !validEmail(email.trim())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A valid email is required for a student account");
        }
        if (db.queryForObject("select count(*) from students where lower(btrim(email))=? and id<>?",
                Integer.class, normalizeEmail(email), studentId) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Another student profile uses this email");
        }
        db.update("""
                insert into student_accounts(
                    id,student_id,username,email,password_hash,account_status,active,must_change_password,
                    registration_source,created_by)
                values(?,?,?,?,?,'APPROVED',true,true,'ADMIN',?)
                """, UUID.randomUUID(), studentId, normalizeUsername(username), normalizeEmail(email),
                passwordEncoder.encode(temporaryPassword), authentication.getName());
        db.update("update students set email=? where id=?", normalizeEmail(email), studentId);
    }

    record AccountActive(boolean active) {}
    record PasswordReset(String temporaryPassword) {}
    record ProfileUpdate(String name, String email, String department, String batch) {}

    @PutMapping("/api/students/{id}/account")
    @Transactional
    Object updateAccount(
            @PathVariable UUID id,
            @RequestBody AccountActive request,
            Authentication authentication) {
        requireAdmin(authentication);
        int updated = db.update("update student_accounts set active=?,account_status=?,updated_at=now() where student_id=?",
                request.active(), request.active() ? "APPROVED" : "DEACTIVATED", id);
        if (updated != 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Student account not found");
        return Map.of("active", request.active());
    }

    @PostMapping("/api/students/{id}/account/password-reset")
    @Transactional
    Object resetAccountPassword(
            @PathVariable UUID id,
            @RequestBody PasswordReset request,
            Authentication authentication) {
        requireAdmin(authentication);
        if (request.temporaryPassword() == null || request.temporaryPassword().length() < PASSWORD_MIN_LENGTH
                || request.temporaryPassword().length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Temporary password must be 12–128 characters");
        }
        int updated = db.update("update student_accounts set password_hash=?,must_change_password=true,updated_at=now() "
                        + "where student_id=? and active=true and account_status='APPROVED'",
                passwordEncoder.encode(request.temporaryPassword()), id);
        if (updated != 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active student account not found");
        return Map.of("passwordReset", true, "mustChangePassword", true);
    }

    @PutMapping("/api/students/{id}/profile")
    Object updateProfile(
            @PathVariable UUID id,
            @RequestBody ProfileUpdate request,
            Authentication authentication) {
        requireAdmin(authentication);
        if (request.name() == null || request.name().isBlank() || request.name().trim().length() > 160
                || request.email() != null && !request.email().isBlank() && !validEmail(request.email().trim())
                || request.department() != null && request.department().trim().length() > 120
                || request.batch() != null && request.batch().trim().length() > 80) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid student profile fields");
        }
        try {
            int updated = db.update("update students set name=?,email=?,department=?,batch=? where id=? and archived=false",
                    request.name().trim(), request.email() == null || request.email().isBlank() ? null : normalizeEmail(request.email()),
                    blankToNull(request.department()), blankToNull(request.batch()), id);
            if (updated != 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active student not found");
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Another student profile uses this email");
        }
        return Map.of("updated", true);
    }

    record PasswordChange(String currentPassword, String newPassword, String confirmPassword) {}

    @PutMapping("/api/account/password")
    Object changePassword(@RequestBody PasswordChange request, Authentication authentication) {
        if (request.newPassword() == null || request.newPassword().length() < PASSWORD_MIN_LENGTH
                || request.newPassword().length() > 128
                || !request.newPassword().equals(request.confirmPassword())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "New password must be 12–128 characters and both entries must match");
        }
        Map<String, Object> account;
        try {
            account = db.queryForMap(
                    "select id,password_hash from student_accounts where lower(username)=lower(?) and active=true "
                            + "and account_status='APPROVED'",
                    authentication.getName());
        } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "Password changes for this account must be handled by its administrator");
        }
        if (request.currentPassword() == null
                || !passwordEncoder.matches(request.currentPassword(), (String) account.get("password_hash"))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Current password is incorrect");
        }
        db.update("update student_accounts set password_hash=?,must_change_password=false,updated_at=now() where id=?",
                passwordEncoder.encode(request.newPassword()), account.get("id"));
        return Map.of("passwordChanged", true, "mustChangePassword", false);
    }

    private UUID authenticatedStudentId(Authentication authentication) {
        List<UUID> ids = db.query("select a.student_id from student_accounts a join students s on s.id=a.student_id "
                        + "where lower(a.username)=lower(?) and a.active=true and a.account_status='APPROVED' and s.archived=false",
                (rs, row) -> rs.getObject(1, UUID.class), authentication.getName());
        if (ids.size() != 1) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "An active approved student account is required");
        }
        return ids.get(0);
    }

    private void validateDateRange(java.time.LocalDate fromDate, java.time.LocalDate toDate) {
        if (fromDate != null && toDate != null && fromDate.isAfter(toDate)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "From date must not be after To date");
        }
    }

    @GetMapping("/api/student/courses")
    Object studentCourses(Authentication authentication) {
        UUID studentId = authenticatedStudentId(authentication);
        return db.queryForList("""
                select o.id as offering_id,c.course_code,c.name as course_title,
                       o.academic_term,o.academic_year,o.batch,o.section,
                       c.course_code || ' — ' || o.academic_term
                         || case when o.academic_year is null then '' else ' ' || o.academic_year end
                         || ' — Batch ' || o.batch || ' — Section ' || o.section as offering_label,
                       (select string_agg(distinct p.display_name, ', ' order by p.display_name)
                        from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id
                        where a.offering_id=o.id and p.active=true
                          and (a.legacy or (a.effective_from<=current_date
                            and (a.effective_to is null or a.effective_to>=current_date)))) as teachers
                from offering_enrollments e join course_offerings o on o.id=e.offering_id
                join courses c on c.id=o.course_id
                where e.student_id=? and e.status='ACTIVE' and o.archived=false and c.archived=false
                order by c.course_code,o.academic_year desc nulls last,o.academic_term,o.section
                """, studentId);
    }

    private Map<String, Object> attendanceTotals(
            UUID studentId, UUID offeringId, java.time.LocalDate fromDate, java.time.LocalDate toDate) {
        validateDateRange(fromDate, toDate);
        StringBuilder sql = new StringBuilder("""
                select count(distinct s.id) as finalized_sessions,count(a.student_id) as eligible_records,
                       coalesce(sum(case when a.state='PRESENT' then 1 else 0 end),0) as present_count,
                       coalesce(sum(case when a.state='ABSENT' then 1 else 0 end),0) as absent_count
                from sessions s join attendance a on a.session_id=s.id
                where s.status='FINALIZED' and a.student_id=?
                """);
        java.util.ArrayList<Object> args = new java.util.ArrayList<>();
        args.add(studentId);
        if (offeringId != null) {
            sql.append(" and s.offering_id=?");
            args.add(offeringId);
        }
        if (fromDate != null) {
            sql.append(" and s.class_date>=?");
            args.add(fromDate);
        }
        if (toDate != null) {
            sql.append(" and s.class_date<=?");
            args.add(toDate);
        }
        return db.queryForMap(sql.toString(), args.toArray());
    }

    @GetMapping("/api/student/dashboard")
    Object studentDashboard(
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) java.time.LocalDate fromDate,
            @RequestParam(required = false) java.time.LocalDate toDate,
            Authentication authentication) {
        UUID studentId = authenticatedStudentId(authentication);
        validateDateRange(fromDate, toDate);
        Map<String, Object> profile = db.queryForMap(
                "select s.id,s.name,s.roll,s.email,s.department,s.batch,s.consent,"
                        + "a.account_status,a.must_change_password from students s "
                        + "join student_accounts a on a.student_id=s.id where s.id=?",
                studentId);
        List<Map<String, Object>> courses = castRows(studentCourses(authentication));
        Map<String, Object> totals = attendanceTotals(studentId, offeringId, fromDate, toDate);
        long denominator = ((Number) totals.get("eligible_records")).longValue();
        Double percentage = denominator == 0 ? null
                : 100.0 * ((Number) totals.get("present_count")).doubleValue() / denominator;
        List<Map<String, Object>> recent = attendanceRows(studentId, offeringId, fromDate, toDate,
                "ALL", 0, 10).rows();
        StringBuilder courseStatsSql = new StringBuilder("""
                select o.id as offering_id,c.course_code,
                       c.course_code || ' — ' || o.academic_term
                         || case when o.academic_year is null then '' else ' ' || o.academic_year end
                         || ' — Batch ' || o.batch || ' — Section ' || o.section as offering_label,
                       count(distinct s.id) as finalized_sessions,count(a.student_id) as eligible_records,
                       sum(case when a.state='PRESENT' then 1 else 0 end) as present_count,
                       sum(case when a.state='ABSENT' then 1 else 0 end) as absent_count
                from sessions s join attendance a on a.session_id=s.id
                join course_offerings o on o.id=s.offering_id join courses c on c.id=s.course_id
                where s.status='FINALIZED' and a.student_id=?
                """);
        java.util.ArrayList<Object> courseStatsArgs = new java.util.ArrayList<>();
        courseStatsArgs.add(studentId);
        if (offeringId != null) {
            courseStatsSql.append(" and s.offering_id=?");
            courseStatsArgs.add(offeringId);
        }
        if (fromDate != null) {
            courseStatsSql.append(" and s.class_date>=?");
            courseStatsArgs.add(fromDate);
        }
        if (toDate != null) {
            courseStatsSql.append(" and s.class_date<=?");
            courseStatsArgs.add(toDate);
        }
        courseStatsSql.append(" group by o.id,c.course_code,o.academic_term,o.academic_year,o.batch,o.section order by c.course_code");
        List<Map<String, Object>> courseTotals = db.queryForList(courseStatsSql.toString(), courseStatsArgs.toArray());
        courseTotals.forEach(row -> {
            Number eligible = (Number) row.get("eligible_records");
            row.put("attendance_percentage", eligible.longValue() == 0 ? null
                    : 100.0 * ((Number) row.get("present_count")).doubleValue() / eligible.doubleValue());
        });
        Map<String, Object> response = new java.util.LinkedHashMap<>();
        response.put("profile", profile);
        response.put("courses", courses);
        response.put("totals", totals);
        response.put("attendancePercentage", percentage);
        response.put("recentAttendance", recent);
        response.put("attendanceByOffering", courseTotals);
        response.put("noFinalizedClasses", denominator == 0);
        return response;
    }

    private record AttendancePage(List<Map<String, Object>> rows, int total) {}

    private AttendancePage attendanceRows(
            UUID studentId, UUID offeringId, java.time.LocalDate fromDate, java.time.LocalDate toDate,
            String status, int page, int size) {
        validateDateRange(fromDate, toDate);
        if (page < 0 || page > 100_000 || size < 1 || size > 200
                || !List.of("ALL", "PRESENT", "ABSENT").contains(status)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid attendance pagination or status filter");
        }
        StringBuilder where = new StringBuilder(" where s.status='FINALIZED' and a.student_id=?");
        java.util.ArrayList<Object> args = new java.util.ArrayList<>();
        args.add(studentId);
        if (offeringId != null) {
            where.append(" and s.offering_id=?");
            args.add(offeringId);
        }
        if (fromDate != null) {
            where.append(" and s.class_date>=?");
            args.add(fromDate);
        }
        if (toDate != null) {
            where.append(" and s.class_date<=?");
            args.add(toDate);
        }
        if (!status.equals("ALL")) {
            where.append(" and a.state=?");
            args.add(status);
        }
        int total = db.queryForObject("select count(*) from sessions s join attendance a on a.session_id=s.id"
                + where, Integer.class, args.toArray());
        args.add(size);
        args.add(Math.multiplyExact(page, size));
        List<Map<String, Object>> rows = db.queryForList("""
                select s.id as session_id,s.class_date,s.class_start_time,s.class_end_time,s.status,
                       a.state as attendance_status,o.id as offering_id,c.course_code,c.name as course_title,
                       o.academic_term,o.academic_year,o.batch,o.section,
                       c.course_code || ' — ' || o.academic_term
                         || case when o.academic_year is null then '' else ' ' || o.academic_year end
                         || ' — Batch ' || o.batch || ' — Section ' || o.section as offering_label,
                       p.display_name as teacher_name
                from sessions s join attendance a on a.session_id=s.id
                join course_offerings o on o.id=s.offering_id join courses c on c.id=s.course_id
                left join teacher_profiles p on p.id=s.teacher_profile_id
                """ + where + " order by s.class_date desc,s.class_start_time desc nulls last,s.id limit ? offset ?",
                args.toArray());
        return new AttendancePage(rows, total);
    }

    @GetMapping("/api/student/attendance")
    Object studentAttendance(
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) java.time.LocalDate fromDate,
            @RequestParam(required = false) java.time.LocalDate toDate,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            Authentication authentication) {
        UUID studentId = authenticatedStudentId(authentication);
        AttendancePage result = attendanceRows(studentId, offeringId, fromDate, toDate, status, page, size);
        return Map.of("rows", result.rows(), "total", result.total(), "page", page, "size", size);
    }

    @GetMapping(value = "/api/student/attendance.csv", produces = "text/csv")
    ResponseEntity<byte[]> exportStudentAttendance(
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) java.time.LocalDate fromDate,
            @RequestParam(required = false) java.time.LocalDate toDate,
            Authentication authentication) {
        UUID studentId = authenticatedStudentId(authentication);
        Map<String, Object> totals = attendanceTotals(studentId, offeringId, fromDate, toDate);
        int count = ((Number) totals.get("eligible_records")).intValue();
        if (count > 10_000) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "Export exceeds 10,000 rows. Narrow the date range or select an offering.");
        }
        List<Map<String, Object>> rows = attendanceRows(studentId, offeringId, fromDate, toDate,
                "ALL", 0, 10_000).rows();
        StringBuilder csv = new StringBuilder("Course,Offering,Class date,Start time,End time,Teacher,Status\n");
        for (Map<String, Object> row : rows) {
            csv.append(csvCell(row.get("course_code"))).append(',')
                    .append(csvCell(row.get("offering_label"))).append(',')
                    .append(csvCell(row.get("class_date"))).append(',')
                    .append(csvCell(row.get("class_start_time"))).append(',')
                    .append(csvCell(row.get("class_end_time"))).append(',')
                    .append(csvCell(row.get("teacher_name"))).append(',')
                    .append(csvCell(row.get("attendance_status"))).append('\n');
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=student-attendance.csv")
                .contentType(new MediaType("text", "csv"))
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private String csvCell(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        if (text.matches("^[=+@-].*")) text = "'" + text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> castRows(Object value) {
        return (List<Map<String, Object>>) value;
    }
}
