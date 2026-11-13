package com.attendance;

import java.util.List;
import java.util.Map;

import jakarta.servlet.DispatcherType;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.www.BasicAuthenticationFilter;
import org.springframework.security.authorization.AuthorizationDecision;

@Configuration
public class Security {
    @Bean
    BCryptPasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService users(JdbcTemplate db, BCryptPasswordEncoder encoder) {
        return username -> {
            if ("admin".equals(username)) {
                return User.withUsername(username)
                        .password(encoder.encode(System.getenv("ADMIN_PASSWORD")))
                        .roles("ADMIN")
                        .build();
            }
            if ("teacher".equals(username)) {
                return User.withUsername(username)
                        .password(encoder.encode(System.getenv("TEACHER_PASSWORD")))
                        .roles("TEACHER")
                        .build();
            }

            List<Map<String, Object>> studentAccounts = db.queryForList(
                    "select a.password_hash,a.active,a.account_status,s.archived from student_accounts a "
                            + "join students s on s.id=a.student_id where lower(a.username)=lower(?)",
                    username);
            if (!studentAccounts.isEmpty()) {
                Map<String, Object> account = studentAccounts.get(0);
                boolean enabled = Boolean.TRUE.equals(account.get("active"))
                        && "APPROVED".equals(account.get("account_status"))
                        && !Boolean.TRUE.equals(account.get("archived"));
                return User.withUsername(username)
                        .password((String) account.get("password_hash"))
                        .roles("STUDENT")
                        .disabled(!enabled)
                        .build();
            }

            List<Map<String, Object>> profiles = db.queryForList(
                    "select password_hash,active from teacher_profiles where username=?", username);
            if (profiles.isEmpty() || profiles.get(0).get("password_hash") == null) {
                throw new UsernameNotFoundException("Teacher account not found");
            }
            Map<String, Object> profile = profiles.get(0);
            return User.withUsername(username)
                    .password((String) profile.get("password_hash"))
                    .roles("TEACHER")
                    .disabled(!Boolean.TRUE.equals(profile.get("active")))
                    .build();
        };
    }

    static boolean hasRole(org.springframework.security.core.Authentication authentication, String role) {
        return authentication != null && authentication.isAuthenticated()
                && authentication.getAuthorities().stream()
                        .anyMatch(authority -> authority.getAuthority().equals("ROLE_" + role));
    }

    static boolean mustChangePassword(JdbcTemplate db, String username) {
        return Boolean.TRUE.equals(db.queryForObject(
                "select count(*)>0 from student_accounts where lower(username)=lower(?) and must_change_password=true",
                Boolean.class, username));
    }

    @Bean
    SecurityFilterChain filter(HttpSecurity http, JdbcTemplate db, ApiTokenService tokens) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .addFilterBefore(new BearerTokenFilter(tokens), BasicAuthenticationFilter.class)
                .authorizeHttpRequests(authorize -> authorize
                        // Let controller errors reach the client with their real status instead of a
                        // Forbidden produced by authorizing the container's /error dispatch.
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers("/error").permitAll()
                        .requestMatchers("/api/auth/token").permitAll()
                        .requestMatchers("/api/student-registrations", "/api/student-registrations/status",
                                "/api/student-registrations/resubmit").permitAll()
                        .requestMatchers("/api/me").authenticated()
                        .requestMatchers("/api/applicant/**").hasRole("APPLICANT")
                        .requestMatchers("/api/account/password").hasAnyRole("ADMIN", "TEACHER", "STUDENT")
                        .requestMatchers("/api/student/**").access((authentication, context) -> {
                            var current = authentication.get();
                            if (!hasRole(current, "STUDENT")) return new AuthorizationDecision(false);
                            return new AuthorizationDecision(!mustChangePassword(db, current.getName()));
                        })
                        // Staff endpoints. Previously "any non-student"; now explicit so restricted
                        // principals such as registration applicants are excluded.
                        .requestMatchers("/api/**").access((authentication, context) -> {
                            var current = authentication.get();
                            if (!hasRole(current, "ADMIN") && !hasRole(current, "TEACHER")) {
                                return new AuthorizationDecision(false);
                            }
                            return new AuthorizationDecision(!mustChangePassword(db, current.getName()));
                        })
                        .anyRequest().denyAll())
                .httpBasic(basic -> basic.authenticationEntryPoint(
                        (request, response, exception) -> ApiErrors.writeJson(response,
                                org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED",
                                "Sign in to continue.")))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) -> ApiErrors.writeJson(response,
                                org.springframework.http.HttpStatus.UNAUTHORIZED, "UNAUTHENTICATED",
                                "Sign in to continue."))
                        .accessDeniedHandler((request, response, exception) -> {
                            var current = org.springframework.security.core.context.SecurityContextHolder
                                    .getContext().getAuthentication();
                            if (hasRole(current, "STUDENT") && mustChangePassword(db, current.getName())) {
                                ApiErrors.writeJson(response, org.springframework.http.HttpStatus.FORBIDDEN,
                                        "PASSWORD_CHANGE_REQUIRED", "Change your temporary password to continue.");
                            } else if (hasRole(current, "APPLICANT")) {
                                ApiErrors.writeJson(response, org.springframework.http.HttpStatus.FORBIDDEN,
                                        "REGISTRATION_NOT_APPROVED",
                                        "Your registration has not been approved yet.");
                            } else {
                                ApiErrors.writeJson(response, org.springframework.http.HttpStatus.FORBIDDEN,
                                        "FORBIDDEN", "You do not have permission to perform this action.");
                            }
                        }))
                .sessionManagement(session -> session.sessionCreationPolicy(
                        org.springframework.security.config.http.SessionCreationPolicy.STATELESS))
                .build();
    }
}
