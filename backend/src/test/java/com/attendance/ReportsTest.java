package com.attendance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.server.ResponseStatusException;

class ReportsTest {
    private static final UUID COURSE_A = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID COURSE_B = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID OFFERING_A = UUID.fromString("11000000-0000-0000-0000-000000000001");
    private static final UUID OFFERING_B = UUID.fromString("11000000-0000-0000-0000-000000000002");
    private static final UUID TEACHER_ID = UUID.fromString("12000000-0000-0000-0000-000000000001");
    private static final UUID ADMIN_ID = UUID.fromString("12000000-0000-0000-0000-000000000002");
    private static final UUID SESSION_1 = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID SESSION_2 = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private static final UUID SESSION_3 = UUID.fromString("20000000-0000-0000-0000-000000000003");
    private static final UUID SESSION_4 = UUID.fromString("20000000-0000-0000-0000-000000000004");
    private static final UUID SESSION_DRAFT = UUID.fromString("20000000-0000-0000-0000-000000000005");
    private static final UUID ALICE = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final UUID BOB = UUID.fromString("30000000-0000-0000-0000-000000000002");
    private static final UUID CAROL = UUID.fromString("30000000-0000-0000-0000-000000000003");

    private HikariDataSource dataSource;
    private JdbcTemplate jdbc;
    private Reports reports;

    @BeforeEach
    void setUp() {
        dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:h2:mem:reports;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        dataSource.setUsername("sa");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("drop all objects");
        jdbc.execute("create table courses(id uuid primary key,name varchar(100),teacher varchar(100),course_code varchar(32))");
        jdbc.execute("create table teacher_profiles(id uuid primary key,username varchar(100),display_name varchar(100),active boolean)");
        jdbc.execute("create table course_offerings(id uuid primary key,course_id uuid,academic_term varchar(40),academic_year int,batch varchar(40),section varchar(40))");
        jdbc.execute("create table teacher_assignments(id uuid primary key,offering_id uuid,teacher_id uuid,assignment_role varchar(20),effective_from date,effective_to date,legacy boolean)");
        jdbc.execute("create table sessions(id uuid primary key,course_id uuid,offering_id uuid,teacher_profile_id uuid,class_date date,status varchar(20))");
        jdbc.execute("create table attendance(session_id uuid,student_id uuid,student_name varchar(100),roll varchar(20),state varchar(20),primary key(session_id,student_id))");
        jdbc.execute("create table enrollments(course_id uuid,student_id uuid,primary key(course_id,student_id))");
        jdbc.update("insert into courses values(?,?,?,?)", COURSE_A, "Course A", "teacher", "CSE101");
        jdbc.update("insert into courses values(?,?,?,?)", COURSE_B, "Course B", "admin", "CSE102");
        jdbc.update("insert into teacher_profiles values(?,?,?,true)", TEACHER_ID, "teacher", "Teacher");
        jdbc.update("insert into teacher_profiles values(?,?,?,true)", ADMIN_ID, "admin", "Admin");
        jdbc.update("insert into course_offerings values(?,?,?,?,?,?)",
                OFFERING_A, COURSE_A, "Spring", 2026, "2024", "A");
        jdbc.update("insert into course_offerings values(?,?,?,?,?,?)",
                OFFERING_B, COURSE_B, "Fall", 2026, "2024", "B");
        jdbc.update("insert into teacher_assignments values(?,?,?,'PRIMARY',?,null,false)",
                UUID.randomUUID(), OFFERING_A, TEACHER_ID, LocalDate.of(2026, 1, 1));
        jdbc.update("insert into teacher_assignments values(?,?,?,'PRIMARY',?,null,false)",
                UUID.randomUUID(), OFFERING_B, ADMIN_ID, LocalDate.of(2026, 1, 1));
        LocalDate classDate = LocalDate.of(2026, 3, 12);
        jdbc.update("insert into sessions values(?,?,?,?,?,?)", SESSION_1, COURSE_A, OFFERING_A, TEACHER_ID, classDate, "FINALIZED");
        jdbc.update("insert into sessions values(?,?,?,?,?,?)", SESSION_2, COURSE_A, OFFERING_A, TEACHER_ID, classDate, "FINALIZED");
        jdbc.update("insert into sessions values(?,?,?,?,?,?)", SESSION_3, COURSE_A, OFFERING_A, TEACHER_ID, classDate, "FINALIZED");
        jdbc.update("insert into sessions values(?,?,?,?,?,?)", SESSION_4, COURSE_B, OFFERING_B, ADMIN_ID, classDate, "FINALIZED");
        jdbc.update("insert into sessions values(?,?,?,?,?,?)", SESSION_DRAFT, COURSE_A, OFFERING_A, TEACHER_ID, classDate, "DRAFT");
        new ResourceDatabasePopulator(new ClassPathResource(
                "db/migration/V5__session_class_times_and_report_indexes.sql")).execute(dataSource);
        jdbc.update("update sessions set class_start_time=?,class_end_time=? where id=?",
                LocalTime.of(9, 0), LocalTime.of(10, 0), SESSION_1);
        jdbc.update("update sessions set class_start_time=?,class_end_time=? where id=?",
                LocalTime.of(10, 0), LocalTime.of(11, 0), SESSION_2);
        jdbc.update("update sessions set class_start_time=?,class_end_time=? where id=?",
                LocalTime.of(11, 0), LocalTime.of(12, 0), SESSION_4);
        jdbc.update("update sessions set class_start_time=?,class_end_time=? where id=?",
                LocalTime.of(8, 0), LocalTime.of(9, 0), SESSION_DRAFT);
        attendance(SESSION_1, ALICE, "=Alice", "A1", "PRESENT");
        attendance(SESSION_1, BOB, "Bob", "B1", "ABSENT");
        attendance(SESSION_2, ALICE, "=Alice", "A1", "ABSENT");
        attendance(SESSION_3, BOB, "Bob", "B1", "PRESENT");
        attendance(SESSION_4, CAROL, "Carol", "C1", "ABSENT");
        attendance(SESSION_DRAFT, CAROL, "Carol", "C1", "PRESENT");
        jdbc.update("insert into enrollments values(?,?)", COURSE_A, ALICE);
        reports = new Reports(new NamedParameterJdbcTemplate(jdbc));
    }

    @AfterEach
    void tearDown() {
        dataSource.close();
    }

    private void attendance(UUID session, UUID student, String name, String roll, String state) {
        jdbc.update("insert into attendance values(?,?,?,?,?)", session, student, name, roll, state);
    }

    @Test
    void summariesUseFinalizedHistoricalRosterAndSupportSameDaySessions() {
        Map<String, Object> result = query("SESSION", null, null, null, null, null, null, null, "ALL",
                0, 50, "date", "asc", teacher());
        List<Map<String, Object>> rows = rows(result);
        assertEquals(3, rows.size());
        assertEquals(3, rows.stream().map(row -> row.get("session_id")).distinct().count());
        assertEquals(3L, number(summary(result).get("finalizedSessions")));
        assertEquals(2L, number(summary(result).get("distinctStudents")));
        assertEquals(2L, number(summary(result).get("presentRecords")));
        assertEquals(2L, number(summary(result).get("absentRecords")));
        assertEquals(50.0, ((Number) summary(result).get("attendancePercentage")).doubleValue());

        jdbc.update("delete from enrollments where course_id=?", COURSE_A);
        Map<String, Object> afterEnrollmentChange = query("COURSE", null, null, null, null, null, null, null, "ALL",
                0, 50, "course", "asc", teacher());
        assertEquals(4L, number(rows(afterEnrollmentChange).get(0).get("student_session_records")));
    }

    @Test
    void combinedFiltersAndTimeRangeExcludeSessionsWithoutRecordedTimes() {
        Map<String, Object> result = query("COURSE", COURSE_A, null,
                LocalDate.of(2026, 3, 12), LocalDate.of(2026, 3, 12),
                LocalTime.of(8, 30), LocalTime.of(9, 30), "Alice", "ALL",
                0, 50, "course", "asc", teacher());
        assertEquals(1L, number(summary(result).get("finalizedSessions")));
        assertEquals(1L, number(summary(result).get("distinctStudents")));
        assertEquals(1L, number(summary(result).get("presentRecords")));
        assertEquals(0L, number(summary(result).get("absentRecords")));
    }

    @Test
    void statusFilterDoesNotChangePercentageDenominator() {
        Map<String, Object> result = query("DETAIL", COURSE_A, null,
                LocalDate.of(2026, 3, 12), LocalDate.of(2026, 3, 12),
                null, null, null, "PRESENT", 0, 50, "date", "asc", teacher());
        assertEquals(2, rows(result).size());
        assertEquals(2L, number(summary(result).get("presentRecords")));
        assertEquals(2L, number(summary(result).get("absentRecords")));
        assertEquals(50.0, ((Number) summary(result).get("attendancePercentage")).doubleValue());
    }

    @Test
    void teacherScopeAndCourseAuthorizationAreEnforced() {
        Map<String, Object> teacherResult = query("COURSE", null, null, null, null, null, null, null,
                "ALL", 0, 50, "course", "asc", teacher());
        assertEquals(1, rows(teacherResult).size());
        assertThrows(ResponseStatusException.class, () -> query("COURSE", COURSE_B, null, null, null,
                null, null, null, "ALL", 0, 50, "course", "asc", teacher()));

        Map<String, Object> adminResult = query("COURSE", null, null, null, null, null, null, null,
                "ALL", 0, 50, "course", "asc", admin());
        assertEquals(2, rows(adminResult).size());
    }

    @Test
    void reportsUseRecordedSessionTeacherAndOfferingFilters() {
        jdbc.update("update courses set teacher='admin' where id=?", COURSE_A);
        Map<String, Object> teacherResult = queryFiltered(
                "SESSION", COURSE_A, OFFERING_A, "Spring", "2024", "A", TEACHER_ID,
                null, null, null, null, null, null, "ALL",
                0, 50, "date", "asc", teacher());
        assertEquals(3L, number(summary(teacherResult).get("finalizedSessions")));
        assertTrue(rows(teacherResult).stream().allMatch(row -> "Teacher".equals(row.get("teacher_name"))));

        assertThrows(ResponseStatusException.class, () -> queryFiltered(
                "SESSION", null, OFFERING_A, null, null, null, ADMIN_ID,
                null, null, null, null, null, null, "ALL",
                0, 50, "date", "asc", teacher()));

        Map<String, Object> adminResult = queryFiltered(
                "SESSION", null, OFFERING_B, "Fall", "2024", "B", ADMIN_ID,
                null, null, null, null, null, null, "ALL",
                0, 50, "date", "asc", admin());
        assertEquals(1L, number(summary(adminResult).get("finalizedSessions")));
    }

    @Test
    void filterOptionsRespectTeacherScopeAndCourseDateParentFilters() {
        Map<String, Object> options = cast(reports.options(COURSE_A, null, null, null, null, null,
                LocalDate.of(2026, 3, 12), LocalDate.of(2026, 3, 12), null, null, teacher()));
        List<Map<String, Object>> courses = castRows(options.get("courses"));
        List<Map<String, Object>> sessions = castRows(options.get("sessions"));
        List<Map<String, Object>> offerings = castRows(options.get("offerings"));
        assertEquals(1, courses.size());
        assertEquals(3, sessions.size());
        assertEquals(1, offerings.size());
        assertTrue(sessions.stream().allMatch(row -> COURSE_A.equals(row.get("course_id"))));
        assertThrows(ResponseStatusException.class,
                () -> reports.options(COURSE_B, null, null, null, null, null, null, null, null, null, teacher()));
    }

    @Test
    void paginationReturnsOnlyRequestedPageWithCompleteTotals() {
        Map<String, Object> first = query("SESSION", COURSE_A, null, null, null, null, null, null,
                "ALL", 0, 1, "date", "asc", teacher());
        Map<String, Object> second = query("SESSION", COURSE_A, null, null, null, null, null, null,
                "ALL", 1, 1, "date", "asc", teacher());
        assertEquals(3L, number(first.get("totalRows")));
        assertEquals(1, rows(first).size());
        assertEquals(1, rows(second).size());
        assertFalse(rows(first).get(0).get("session_id").equals(rows(second).get(0).get("session_id")));
        assertEquals(2L, number(summary(first).get("presentRecords")));
    }

    @Test
    void emptyRangeHasNullPercentageAndExportMatchesPreview() {
        Map<String, Object> empty = query("STUDENT", null, null,
                LocalDate.of(2026, 4, 1), LocalDate.of(2026, 4, 30),
                null, null, null, "ALL", 0, 50, "roll", "asc", admin());
        assertTrue(rows(empty).isEmpty());
        assertNull(summary(empty).get("attendancePercentage"));

        Map<String, Object> preview = query("DETAIL", COURSE_A, null, null, null, null, null, null,
                "ALL", 0, 50, "course", "asc", teacher());
        Map<String, Object> exported = cast(reports.exportData(
                "DETAIL", COURSE_A, null, null, null, null, null, null, null,
                null, null, null, null, "ALL", "course", "asc", teacher()));
        assertEquals(preview.get("totalRows"), exported.get("totalRows"));
        assertEquals(rows(preview).size(), rows(exported).size());
        var csv = reports.exportCsv(
                "DETAIL", COURSE_A, null, null, null, null, null, null, null,
                null, null, null, null, "ALL", "course", "asc", teacher());
        String text = new String(csv.getBody(), java.nio.charset.StandardCharsets.UTF_8);
        assertTrue(text.contains("'=Alice"));
        assertTrue(text.contains("Asia/Dhaka"));
        assertFalse(text.contains("DRAFT"));
    }

    @Test
    void filtersRejectInvalidRangesAndUnallowlistedSorts() {
        assertThrows(ResponseStatusException.class, () -> query("COURSE", null, null,
                LocalDate.of(2026, 4, 2), LocalDate.of(2026, 4, 1),
                null, null, null, "ALL", 0, 50, "course", "asc", admin()));
        assertThrows(ResponseStatusException.class, () -> query("COURSE", null, null,
                null, null, null, null, null, "ALL", 0, 50, "course_name desc; drop table attendance", "asc", admin()));
    }

    private Map<String, Object> query(
            String type, UUID courseId, UUID sessionId, LocalDate fromDate, LocalDate toDate,
            LocalTime fromTime, LocalTime toTime, String student, String status,
            int page, int size, String sort, String direction,
            UsernamePasswordAuthenticationToken authentication) {
        return cast(reports.report(type, courseId, null, null, null, null, null,
                sessionId, fromDate, toDate, fromTime, toTime,
                student, status, page, size, sort, direction, authentication));
    }

    private Map<String, Object> queryFiltered(
            String type, UUID courseId, UUID offeringId, String term, String batch, String section, UUID teacherId,
            UUID sessionId, LocalDate fromDate, LocalDate toDate, LocalTime fromTime, LocalTime toTime,
            String student, String status, int page, int size, String sort, String direction,
            UsernamePasswordAuthenticationToken authentication) {
        return cast(reports.report(type, courseId, offeringId, term, batch, section, teacherId,
                sessionId, fromDate, toDate, fromTime, toTime, student, status,
                page, size, sort, direction, authentication));
    }

    private static UsernamePasswordAuthenticationToken teacher() {
        return new UsernamePasswordAuthenticationToken("teacher", "", List.of(new SimpleGrantedAuthority("ROLE_TEACHER")));
    }

    private static UsernamePasswordAuthenticationToken admin() {
        return new UsernamePasswordAuthenticationToken("admin", "", List.of(new SimpleGrantedAuthority("ROLE_ADMIN")));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> cast(Object value) {
        return (Map<String, Object>) value;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.get("rows");
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> summary(Map<String, Object> result) {
        return (Map<String, Object>) result.get("summary");
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castRows(Object value) {
        return (List<Map<String, Object>>) value;
    }

    private static long number(Object value) {
        return ((Number) value).longValue();
    }
}
