package com.attendance;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.Principal;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.LockedException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Principal for a registration applicant whose request has not produced an approved
 * account. It can only reach {@code /api/me} and {@code /api/applicant/**}.
 */
record ApplicantPrincipal(UUID requestId, String username) implements Principal {
    @Override
    public String getName() {
        return username;
    }
}

/** Details attached to token-authenticated requests so a handler can identify the token in use. */
record ApiTokenDetails(UUID tokenId) {}

/**
 * Opaque bearer tokens for native clients. The token value is returned once at sign-in;
 * only its SHA-256 hash is stored. Roles are re-derived from the account tables on every
 * request, so deactivation, archival, or approval changes take effect immediately.
 */
@Service
class ApiTokenService {
    static final String PREFIX = "att_";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Logger LOG = Logger.getLogger(ApiTokenService.class.getName());

    private final JdbcTemplate db;
    private final Duration ttl;

    ApiTokenService(JdbcTemplate db) {
        this.db = db;
        Duration configured = Duration.ofHours(168);
        String hours = System.getenv("MOBILE_TOKEN_TTL_HOURS");
        if (hours != null && !hours.isBlank()) {
            try {
                long parsed = Long.parseLong(hours.trim());
                if (parsed >= 1 && parsed <= 24 * 90) configured = Duration.ofHours(parsed);
            } catch (NumberFormatException ignored) {
                LOG.warning("MOBILE_TOKEN_TTL_HOURS is not a whole number; using the 168 hour default.");
            }
        }
        this.ttl = configured;
    }

    record IssuedToken(String token, UUID id, Instant expiresAt) {}

    static String hash(String token) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by the runtime", exception);
        }
    }

    static String normalize(String username) {
        return username.trim().toLowerCase(Locale.ROOT);
    }

    IssuedToken issueAccountToken(String username, String clientName) {
        return issue("ACCOUNT", username, null, clientName);
    }

    IssuedToken issueApplicantToken(String username, UUID requestId, String clientName) {
        return issue("APPLICANT", username, requestId, clientName);
    }

    private IssuedToken issue(String kind, String username, UUID requestId, String clientName) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = PREFIX + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        Instant expiresAt = now.plus(ttl);
        String client = clientName == null || clientName.isBlank() ? null
                : clientName.trim().substring(0, Math.min(80, clientName.trim().length()));
        db.update("""
                insert into api_tokens(id,token_hash,principal_kind,username,normalized_username,
                    registration_request_id,client_name,created_at,expires_at)
                values(?,?,?,?,?,?,?,?,?)
                """, id, hash(token), kind, username, normalize(username), requestId, client,
                Timestamp.from(now), Timestamp.from(expiresAt));
        return new IssuedToken(token, id, expiresAt);
    }

    /** Resolves a bearer token to an authentication, or empty when invalid, expired, revoked, or disabled. */
    Optional<Authentication> authenticate(String token) {
        if (token == null || !token.startsWith(PREFIX) || token.length() > 200) return Optional.empty();
        List<Map<String, Object>> rows = db.queryForList("""
                select id,principal_kind,username,registration_request_id,last_used_at
                from api_tokens
                where token_hash=? and revoked_at is null and expires_at>now()
                """, hash(token));
        if (rows.isEmpty()) return Optional.empty();
        Map<String, Object> row = rows.get(0);
        UUID tokenId = (UUID) row.get("id");
        String username = (String) row.get("username");
        UsernamePasswordAuthenticationToken authentication;
        if ("APPLICANT".equals(row.get("principal_kind"))) {
            UUID requestId = (UUID) row.get("registration_request_id");
            Integer live = db.queryForObject("""
                    select count(*) from student_registration_requests
                    where id=? and normalized_username=? and purged_at is null
                    """, Integer.class, requestId, normalize(username));
            if (live == null || live != 1) return Optional.empty();
            authentication = UsernamePasswordAuthenticationToken.authenticated(
                    new ApplicantPrincipal(requestId, username), null,
                    List.of(new SimpleGrantedAuthority("ROLE_APPLICANT")));
        } else {
            Optional<String> role = accountRole(username);
            if (role.isEmpty()) return Optional.empty();
            authentication = UsernamePasswordAuthenticationToken.authenticated(
                    username, null, List.of(new SimpleGrantedAuthority("ROLE_" + role.get())));
        }
        authentication.setDetails(new ApiTokenDetails(tokenId));
        Object lastUsed = row.get("last_used_at");
        if (lastUsed == null || lastUsed instanceof Timestamp ts
                && ts.toInstant().isBefore(Instant.now().minus(Duration.ofMinutes(5)))) {
            db.update("update api_tokens set last_used_at=? where id=?", Timestamp.from(Instant.now()), tokenId);
        }
        return Optional.of(authentication);
    }

    /** Mirrors the account resolution in {@link Security#users} without a password comparison. */
    Optional<String> accountRole(String username) {
        if ("admin".equals(username)) {
            return present(System.getenv("ADMIN_PASSWORD")) ? Optional.of("ADMIN") : Optional.empty();
        }
        if ("teacher".equals(username)) {
            return present(System.getenv("TEACHER_PASSWORD")) ? Optional.of("TEACHER") : Optional.empty();
        }
        List<Map<String, Object>> students = db.queryForList(
                "select a.active,a.account_status,s.archived from student_accounts a "
                        + "join students s on s.id=a.student_id where lower(a.username)=lower(?)", username);
        if (!students.isEmpty()) {
            Map<String, Object> account = students.get(0);
            boolean enabled = Boolean.TRUE.equals(account.get("active"))
                    && "APPROVED".equals(account.get("account_status"))
                    && !Boolean.TRUE.equals(account.get("archived"));
            return enabled ? Optional.of("STUDENT") : Optional.empty();
        }
        List<Map<String, Object>> teachers = db.queryForList(
                "select active from teacher_profiles where username=? and password_hash is not null", username);
        if (!teachers.isEmpty() && Boolean.TRUE.equals(teachers.get(0).get("active"))) {
            return Optional.of("TEACHER");
        }
        return Optional.empty();
    }

    private static boolean present(String value) {
        return value != null && !value.isBlank();
    }

    void revoke(String token) {
        if (token == null || !token.startsWith(PREFIX)) return;
        db.update("update api_tokens set revoked_at=now() where token_hash=? and revoked_at is null", hash(token));
    }

    /** Revokes every active token of an account, optionally keeping the token making the request. */
    int revokeAll(String username, UUID exceptTokenId) {
        if (username == null) return 0;
        return exceptTokenId == null
                ? db.update("update api_tokens set revoked_at=now() where normalized_username=? and revoked_at is null",
                        normalize(username))
                : db.update("update api_tokens set revoked_at=now() where normalized_username=? and revoked_at is null and id<>?",
                        normalize(username), exceptTokenId);
    }

    int revokeAllForStudent(UUID studentId) {
        return db.update("""
                update api_tokens set revoked_at=now()
                where revoked_at is null and principal_kind='ACCOUNT'
                  and normalized_username in (select lower(btrim(username)) from student_accounts where student_id=?)
                """, studentId);
    }

    static UUID currentTokenId(Authentication authentication) {
        return authentication != null && authentication.getDetails() instanceof ApiTokenDetails details
                ? details.tokenId() : null;
    }

    @Scheduled(cron = "0 30 3 * * *", zone = "Asia/Dhaka")
    void purgeExpired() {
        try {
            db.update("delete from api_tokens where expires_at<now()-interval '30 days' "
                    + "or revoked_at<now()-interval '30 days'");
        } catch (Exception exception) {
            LOG.warning("Expired API token cleanup failed and will retry: " + exception.getClass().getSimpleName());
        }
    }
}

/** Authenticates {@code Authorization: Bearer att_...} headers; HTTP Basic is left to Spring Security. */
class BearerTokenFilter extends OncePerRequestFilter {
    private final ApiTokenService tokens;

    BearerTokenFilter(ApiTokenService tokens) {
        this.tokens = tokens;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().equals(request.getContextPath() + "/api/auth/token");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            chain.doFilter(request, response);
            return;
        }
        Optional<Authentication> authentication = tokens.authenticate(header.substring(7).trim());
        if (authentication.isEmpty()) {
            SecurityContextHolder.clearContext();
            ApiErrors.writeJson(response, HttpStatus.UNAUTHORIZED, "SESSION_EXPIRED",
                    "Your session has expired or was signed out. Sign in again.");
            return;
        }
        var context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication.get());
        SecurityContextHolder.setContext(context);
        try {
            chain.doFilter(request, response);
        } finally {
            SecurityContextHolder.clearContext();
        }
    }
}

@RestController
@RequestMapping("/api/auth/token")
class AuthTokenController {
    private static final Duration WINDOW = Duration.ofMinutes(15);
    private static final int LIMIT = 10;

    private final JdbcTemplate db;
    private final ApiTokenService tokens;
    private final BCryptPasswordEncoder encoder;
    private final DaoAuthenticationProvider provider;
    private final UserDetailsService users;
    private final ConcurrentHashMap<String, long[]> attempts = new ConcurrentHashMap<>();

    AuthTokenController(JdbcTemplate db, ApiTokenService tokens, UserDetailsService users, BCryptPasswordEncoder encoder) {
        this.db = db;
        this.tokens = tokens;
        this.encoder = encoder;
        this.users = users;
        this.provider = new DaoAuthenticationProvider();
        this.provider.setUserDetailsService(users);
        this.provider.setPasswordEncoder(encoder);
    }

    record SignIn(String username, String password, String clientName) {}

    private void rateLimit(HttpServletRequest request, String username) {
        long now = System.currentTimeMillis();
        String key = request.getRemoteAddr() + "|" + username;
        long[] window = attempts.compute(key, (ignored, current) ->
                current == null || now - current[0] >= WINDOW.toMillis() ? new long[] {now, 1}
                        : new long[] {current[0], current[1] + 1});
        if (attempts.size() > 10_000) {
            attempts.entrySet().removeIf(entry -> now - entry.getValue()[0] > WINDOW.toMillis());
        }
        if (window[1] > LIMIT) {
            throw new ApiProblemException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_SIGN_IN_ATTEMPTS",
                    "Too many sign-in attempts. Wait 15 minutes and try again.");
        }
    }

    @PostMapping
    ResponseEntity<Map<String, Object>> signIn(@RequestBody(required = false) SignIn request,
            HttpServletRequest servletRequest) {
        if (request == null || request.username() == null || request.username().isBlank()
                || request.password() == null || request.password().isEmpty()
                || request.username().length() > 64 || request.password().length() > 128) {
            throw new ApiProblemException(HttpStatus.BAD_REQUEST, "CREDENTIALS_REQUIRED",
                    "Enter your username and password.");
        }
        String username = request.username().trim();
        rateLimit(servletRequest, ApiTokenService.normalize(username));
        try {
            Authentication authenticated = provider.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(username, request.password()));
            String role = authenticated.getAuthorities().stream().map(GrantedAuthority::getAuthority)
                    .filter(authority -> authority.startsWith("ROLE_")).map(authority -> authority.substring(5))
                    .findFirst().orElseThrow();
            var issued = tokens.issueAccountToken(username, request.clientName());
            return ResponseEntity.ok(body(issued, role));
        } catch (DisabledException | LockedException exception) {
            // Spring checks the enabled flag before the password; only reveal the inactive state
            // to someone who proves the password, otherwise answer like any failed sign-in.
            if (passwordMatches(username, request.password())) {
                throw new ApiProblemException(HttpStatus.FORBIDDEN, "ACCOUNT_INACTIVE",
                        "This account is not active. Contact an administrator.");
            }
            throw new ApiProblemException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                    "The username or password is incorrect.");
        } catch (BadCredentialsException | AuthenticationServiceException exception) {
            // Applicants without an approved account can sign in to a restricted status view.
            var applicant = applicantRequest(username, request.password());
            if (applicant != null) {
                var issued = tokens.issueApplicantToken(username, applicant, request.clientName());
                return ResponseEntity.ok(body(issued, "APPLICANT"));
            }
            throw new ApiProblemException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS",
                    "The username or password is incorrect.");
        }
    }

    private boolean passwordMatches(String username, String password) {
        try {
            String hash = users.loadUserByUsername(username).getPassword();
            return hash != null && encoder.matches(password, hash);
        } catch (RuntimeException exception) {
            return false;
        }
    }

    private UUID applicantRequest(String username, String password) {
        String normalized = ApiTokenService.normalize(username);
        if (db.queryForObject("select count(*) from student_accounts where lower(btrim(username))=?",
                Integer.class, normalized) > 0) {
            return null;
        }
        List<Map<String, Object>> rows = db.queryForList("""
                select id,password_hash from student_registration_requests
                where normalized_username=? and status in ('PENDING_APPROVAL','REJECTED') and purged_at is null
                order by submitted_at desc limit 1
                """, normalized);
        if (rows.isEmpty()) return null;
        String hash = (String) rows.get(0).get("password_hash");
        return hash != null && hash.startsWith("$2") && encoder.matches(password, hash)
                ? (UUID) rows.get(0).get("id") : null;
    }

    private Map<String, Object> body(ApiTokenService.IssuedToken issued, String role) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("accessToken", issued.token());
        body.put("tokenType", "Bearer");
        body.put("expiresAt", issued.expiresAt().toString());
        body.put("role", role);
        return body;
    }

    /** Idempotent sign-out: revokes the presented bearer token if it exists. */
    @DeleteMapping
    ResponseEntity<Void> signOut(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            tokens.revoke(header.substring(7).trim());
        }
        return ResponseEntity.noContent().build();
    }
}
