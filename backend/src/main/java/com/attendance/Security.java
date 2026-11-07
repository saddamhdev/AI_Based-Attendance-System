package com.attendance;

import java.util.List;
import java.util.Map;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
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

    @Bean
    SecurityFilterChain filter(HttpSecurity http, JdbcTemplate db) throws Exception {
        return http
                .csrf(csrf -> csrf.disable())
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers("/api/student-registrations", "/api/student-registrations/status",
                                "/api/student-registrations/resubmit").permitAll()
                        .requestMatchers("/api/me", "/api/account/password").authenticated()
                        .requestMatchers("/api/student/**").access((authentication, context) -> {
                            var current = authentication.get();
                            if (current == null || !current.isAuthenticated()
                                    || current.getAuthorities().stream()
                                            .noneMatch(authority -> authority.getAuthority().equals("ROLE_STUDENT"))) {
                                return new AuthorizationDecision(false);
                            }
                            boolean mustChange = db.queryForObject(
                                    "select count(*)>0 from student_accounts where lower(username)=lower(?) "
                                            + "and must_change_password=true",
                                    Boolean.class, current.getName());
                            return new AuthorizationDecision(!mustChange);
                        })
                        .requestMatchers("/api/**").access((authentication, context) -> {
                            var current = authentication.get();
                            if (current == null || !current.isAuthenticated()
                                    || current.getAuthorities().stream()
                                            .anyMatch(authority -> authority.getAuthority().equals("ROLE_STUDENT"))) {
                                return new AuthorizationDecision(false);
                            }
                            boolean mustChange = db.queryForObject(
                                    "select count(*)>0 from student_accounts where lower(username)=lower(?) "
                                            + "and must_change_password=true",
                                    Boolean.class, current.getName());
                            return new AuthorizationDecision(!mustChange);
                        })
                        .anyRequest().denyAll())
                .httpBasic(basic -> basic.authenticationEntryPoint(
                        (request, response, exception) -> response.sendError(HttpServletResponse.SC_UNAUTHORIZED)))
                .sessionManagement(session -> session.sessionCreationPolicy(
                        org.springframework.security.config.http.SessionCreationPolicy.STATELESS))
                .build();
    }
}
