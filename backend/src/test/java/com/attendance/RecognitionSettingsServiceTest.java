package com.attendance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.DoubleNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zaxxer.hikari.HikariDataSource;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;

class RecognitionSettingsServiceTest {
    private HikariDataSource dataSource;
    private JdbcTemplate jdbc;
    private RecognitionSettingsService settings;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:h2:mem:recognition-settings;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        dataSource.setUsername("sa");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("drop all objects");
        jdbc.execute("""
                create table recognition_account_identities(
                    id uuid primary key, role varchar(20) not null, username varchar(100) not null,
                    normalized_username varchar(100) not null, unique(role, normalized_username))
                """);
        jdbc.execute("""
                create table recognition_settings(
                    account_id uuid primary key, threshold_percentage double precision not null,
                    updated_at timestamp with time zone not null default current_timestamp)
                """);
        jdbc.execute("""
                create table sessions(id uuid primary key, status varchar(20) not null default 'DRAFT')
                """);
        jdbc.execute("""
                create table attendance(session_id uuid, student_id uuid, state varchar(20))
                """);
        jdbc.execute("""
                create table session_recognition_analyses(
                    id uuid primary key, session_id uuid, initiating_user_id uuid,
                    threshold_percentage double precision, response jsonb, analyzed_at timestamp with time zone)
                """);
        seedIdentity("ADMIN", "admin");
        seedIdentity("TEACHER", "teacher");
        seedIdentity("TEACHER", "teacher-one");
        seedIdentity("TEACHER", "teacher-two");
        settings = new RecognitionSettingsService(jdbc, objectMapper);
    }

    @AfterEach
    void tearDown() {
        dataSource.close();
    }

    @Test
    void storesIndependentThresholdsByStableRoleAndUsernameIdentity() {
        var admin = account("admin", "ADMIN");
        var teacherOne = account("teacher-one", "TEACHER");
        var teacherTwo = account("teacher-two", "TEACHER");

        assertEquals(70, settings.threshold(admin));
        assertEquals(70, settings.threshold(teacherOne));
        assertEquals(70, settings.threshold(teacherTwo));
        assertEquals(83.5, settings.update(admin, threshold(83.5)).get("threshold"));
        assertEquals(62.25, settings.update(teacherOne, threshold(62.25)).get("threshold"));

        assertEquals(83.5, settings.threshold(admin));
        assertEquals(62.25, settings.threshold(teacherOne));
        assertEquals(70, settings.threshold(teacherTwo));
    }

    @Test
    void resetUsesUnsavedDefaultAndInvalidInputsAreRejected() {
        var teacher = account("teacher", "TEACHER");
        settings.update(teacher, threshold(85));
        ObjectNode reset = objectMapper.createObjectNode().put("reset", true);
        Map<String, Object> resetResult = settings.update(teacher, reset);
        assertEquals(70.0, resetResult.get("threshold"));
        assertFalse((Boolean) resetResult.get("saved"));
        assertEquals(70.0, settings.threshold(teacher));

        assertThrows(ResponseStatusException.class, () -> settings.update(teacher, null));
        assertThrows(ResponseStatusException.class,
                () -> settings.update(teacher, objectMapper.createObjectNode().put("threshold", "70")));
        assertThrows(ResponseStatusException.class,
                () -> settings.update(teacher, objectMapper.createObjectNode()
                        .put("threshold", 70).put("userId", "another-user")));
        assertThrows(ResponseStatusException.class, () -> settings.update(teacher, threshold(0)));
        assertThrows(ResponseStatusException.class, () -> settings.update(teacher, threshold(101)));
        assertThrows(ResponseStatusException.class,
                () -> settings.update(teacher, objectMapper.createObjectNode()
                        .set("threshold", DoubleNode.valueOf(Double.NaN))));
    }

    @Test
    void studentsCannotReadOrChangeSettings() {
        var student = new UsernamePasswordAuthenticationToken("student", "",
                List.of(new SimpleGrantedAuthority("ROLE_STUDENT")));
        assertThrows(ResponseStatusException.class, () -> settings.settings(student));
        assertThrows(ResponseStatusException.class, () -> settings.update(student, threshold(80)));
    }

    @Test
    void savedAnalysisRetainsThresholdAndInitiatingUserAfterSettingChanges() {
        var teacher = account("teacher", "TEACHER");
        UUID sessionId = UUID.randomUUID();
        jdbc.update("insert into sessions(id) values (?)", sessionId);
        settings.update(teacher, threshold(78));
        Map<String, Object> snapshot = settings.saveAnalysis(sessionId, teacher, 78,
                Map.of("photos", List.of(), "matchedStudentIds", List.of()));
        settings.update(teacher, threshold(82));

        Map<String, Object> latest = settings.latestAnalysis(sessionId);
        assertEquals(snapshot.get("analysisId"), latest.get("analysisId"));
        assertEquals(78.0, latest.get("thresholdPercentage"));
        assertEquals("teacher", latest.get("initiatingUser"));
        assertTrue(latest.containsKey("photos"));
        assertEquals(82.0, settings.threshold(teacher));
    }

    @Test
    void changingSettingsDoesNotRewriteFinalizedAttendance() {
        UUID sessionId = UUID.randomUUID();
        UUID studentId = UUID.randomUUID();
        jdbc.update("insert into sessions(id, status) values (?, 'FINALIZED')", sessionId);
        jdbc.update("insert into attendance(session_id, student_id, state) values (?, ?, 'PRESENT')",
                sessionId, studentId);

        settings.update(account("admin", "ADMIN"), threshold(88));

        assertEquals("FINALIZED", jdbc.queryForObject(
                "select status from sessions where id=?", String.class, sessionId));
        assertEquals("PRESENT", jdbc.queryForObject(
                "select state from attendance where session_id=? and student_id=?",
                String.class, sessionId, studentId));
    }

    private ObjectNode threshold(double value) {
        return objectMapper.createObjectNode().put("threshold", value);
    }

    private void seedIdentity(String role, String username) {
        jdbc.update("""
                insert into recognition_account_identities(id, role, username, normalized_username)
                values (?, ?, ?, ?)
                """, UUID.randomUUID(), role, username, username);
    }

    private UsernamePasswordAuthenticationToken account(String username, String role) {
        return new UsernamePasswordAuthenticationToken(username, "",
                List.of(new SimpleGrantedAuthority("ROLE_" + role)));
    }
}
