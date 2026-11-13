package com.attendance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.zaxxer.hikari.HikariDataSource;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class ApiTokenServiceTest {
    private HikariDataSource dataSource;
    private JdbcTemplate jdbc;
    private ApiTokenService tokens;
    private final UUID student = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        dataSource = new HikariDataSource();
        dataSource.setJdbcUrl("jdbc:h2:mem:api-tokens;MODE=PostgreSQL;DB_CLOSE_DELAY=-1;DATABASE_TO_LOWER=TRUE");
        dataSource.setUsername("sa");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("drop all objects");
        jdbc.execute("create table students(id uuid primary key, archived boolean not null default false)");
        jdbc.execute("""
                create table student_accounts(id uuid primary key, student_id uuid, username varchar(64), active boolean,
                    account_status varchar(20))
                """);
        jdbc.execute("create table teacher_profiles(id uuid primary key, username varchar(64), active boolean, password_hash varchar(100))");
        jdbc.execute("""
                create table student_registration_requests(id uuid primary key, normalized_username varchar(64),
                    status varchar(20), purged_at timestamp with time zone)
                """);
        jdbc.execute("""
                create table api_tokens(id uuid primary key, token_hash varchar(100) unique not null, principal_kind varchar(20) not null,
                    username varchar(64) not null, normalized_username varchar(64) not null, registration_request_id uuid,
                    client_name varchar(80), created_at timestamp with time zone not null default current_timestamp,
                    expires_at timestamp with time zone not null, last_used_at timestamp with time zone,
                    revoked_at timestamp with time zone)
                """);
        jdbc.update("insert into students(id) values(?)", student);
        jdbc.update("insert into student_accounts values(?,?,?,true,'APPROVED')", UUID.randomUUID(), student, "Student.One");
        jdbc.update("insert into teacher_profiles values(?,?,true,'$2a$hash')", UUID.randomUUID(), "teacher.one");
        tokens = new ApiTokenService(jdbc);
    }

    @AfterEach
    void tearDown() {
        dataSource.close();
    }

    @Test
    void storesOnlyAHashAndResolvesRolesOnEachRequest() {
        var issued = tokens.issueAccountToken("Student.One", "test");
        String stored = jdbc.queryForObject("select token_hash from api_tokens where id=?", String.class, issued.id());
        assertNotEquals(issued.token(), stored);
        assertEquals(ApiTokenService.hash(issued.token()), stored);
        var authentication = tokens.authenticate(issued.token()).orElseThrow();
        assertEquals("Student.One", authentication.getName());
        assertTrue(authentication.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_STUDENT")));
        assertEquals(issued.id(), ApiTokenService.currentTokenId(authentication));
    }

    @Test
    void deactivationOrArchivalTakesEffectImmediately() {
        var issued = tokens.issueAccountToken("Student.One", null);
        jdbc.update("update student_accounts set active=false,account_status='DEACTIVATED'");
        assertTrue(tokens.authenticate(issued.token()).isEmpty());
        jdbc.update("update student_accounts set active=true,account_status='APPROVED'");
        jdbc.update("update students set archived=true");
        assertTrue(tokens.authenticate(issued.token()).isEmpty());
    }

    @Test
    void expiredRevokedAndForgedTokensAreRejected() {
        var issued = tokens.issueAccountToken("teacher.one", null);
        assertTrue(tokens.authenticate(issued.token()).isPresent());
        assertTrue(tokens.authenticate("att_forged").isEmpty());
        assertTrue(tokens.authenticate("not-a-token").isEmpty());
        jdbc.update("update api_tokens set expires_at=dateadd('SECOND', -1, current_timestamp) where id=?", issued.id());
        assertTrue(tokens.authenticate(issued.token()).isEmpty());
        var second = tokens.issueAccountToken("teacher.one", null);
        tokens.revoke(second.token());
        assertTrue(tokens.authenticate(second.token()).isEmpty());
    }

    @Test
    void revokeAllKeepsOnlyTheCurrentDeviceAndStudentResetRevokesEverything() {
        var current = tokens.issueAccountToken("Student.One", "phone");
        var other = tokens.issueAccountToken("student.one", "tablet");
        assertEquals(1, tokens.revokeAll("STUDENT.ONE", current.id()));
        assertTrue(tokens.authenticate(current.token()).isPresent());
        assertTrue(tokens.authenticate(other.token()).isEmpty());
        tokens.revokeAllForStudent(student);
        assertTrue(tokens.authenticate(current.token()).isEmpty());
    }

    @Test
    void applicantTokensCarryOnlyTheApplicantRoleAndEndWhenTheRequestIsPurged() {
        UUID request = UUID.randomUUID();
        jdbc.update("insert into student_registration_requests values(?,?,'PENDING_APPROVAL',null)", request, "applicant1");
        var issued = tokens.issueApplicantToken("Applicant1", request, null);
        var authentication = tokens.authenticate(issued.token()).orElseThrow();
        assertEquals(1, authentication.getAuthorities().size());
        assertTrue(authentication.getAuthorities().stream().allMatch(a -> a.getAuthority().equals("ROLE_APPLICANT")));
        assertEquals(request, ((ApplicantPrincipal) authentication.getPrincipal()).requestId());
        jdbc.update("update student_registration_requests set purged_at=current_timestamp");
        assertTrue(tokens.authenticate(issued.token()).isEmpty());
    }
}
