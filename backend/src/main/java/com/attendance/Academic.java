package com.attendance;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api")
public class Academic {
    private static final ZoneId DHaka = ZoneId.of("Asia/Dhaka");
    private final JdbcTemplate db;
    private final BCryptPasswordEncoder passwordEncoder;

    Academic(JdbcTemplate db, BCryptPasswordEncoder passwordEncoder) {
        this.db = db;
        this.passwordEncoder = passwordEncoder;
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

    private void requireOffering(UUID offeringId, Authentication authentication) {
        String sql = "select count(*) from course_offerings o where o.id=? and o.archived=false"
                + (isAdmin(authentication) ? "" : " and exists ("
                        + "select 1 from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id "
                        + "where a.offering_id=o.id and p.username=? and p.active=true "
                        + "and (a.legacy or (a.effective_from<=current_date "
                        + "and (a.effective_to is null or a.effective_to>=current_date))))");
        Integer count = isAdmin(authentication)
                ? db.queryForObject(sql, Integer.class, offeringId)
                : db.queryForObject(sql, Integer.class, offeringId, authentication.getName());
        if (count == null || count != 1) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Offering is not available to this account");
        }
    }

    @GetMapping("/academic/courses")
    Object courses(Authentication authentication) {
        requireAdmin(authentication);
        return db.queryForList(
                "select c.id,c.course_code,c.name as title,not c.archived as active,"
                        + "(select count(*) from course_offerings o where o.course_id=c.id) as offering_count "
                        + "from courses c order by c.course_code");
    }

    record NewCourse(String courseCode, String title) {}

    @PostMapping("/academic/courses")
    Object createCourse(@RequestBody NewCourse request, Authentication authentication) {
        requireAdmin(authentication);
        if (request.courseCode() == null || request.courseCode().isBlank()
                || request.title() == null || request.title().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Course code and title are required");
        }
        UUID id = UUID.randomUUID();
        try {
            db.update("insert into courses(id,course_code,name,teacher) values(?,?,?,null)",
                    id, request.courseCode().trim().toUpperCase(), request.title().trim());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Course code is already in use");
        }
        return Map.of("id", id);
    }

    @Transactional
    @PostMapping("/academic/courses/{id}/archive")
    Object archiveCourse(@PathVariable UUID id, Authentication authentication) {
        requireAdmin(authentication);
        int updated = db.update("update courses set archived=true where id=?", id);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found");
        }
        db.update("update course_offerings set archived=true where course_id=?", id);
        return Map.of("archived", true);
    }

    @PostMapping("/academic/courses/{id}/activate")
    Object activateCourse(@PathVariable UUID id, Authentication authentication) {
        requireAdmin(authentication);
        int updated = db.update("update courses set archived=false where id=?", id);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Course not found");
        }
        return Map.of("active", true);
    }

    @GetMapping("/offerings")
    Object offerings(
            @RequestParam(required = false) UUID courseId,
            @RequestParam(required = false) String term,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) UUID teacherId,
            @RequestParam(defaultValue = "false") boolean includeArchived,
            Authentication authentication) {
        StringBuilder sql = new StringBuilder("""
                select o.id,o.course_id,c.course_code,c.name as course_title,
                       o.academic_term,o.academic_year,o.batch,o.section,o.archived,o.legacy,
                       c.course_code || ' — ' || o.academic_term
                         || case when o.academic_year is null then '' else ' ' || o.academic_year end
                         || ' — Batch ' || o.batch || ' — Section ' || o.section as offering_label,
                       (select p.display_name from teacher_assignments a
                        join teacher_profiles p on p.id=a.teacher_id
                        where a.offering_id=o.id and a.assignment_role='PRIMARY'
                          and (a.legacy or (a.effective_from<=current_date
                            and (a.effective_to is null or a.effective_to>=current_date)))
                        order by a.legacy asc,a.effective_from desc nulls last limit 1) as primary_teacher,
                       (select string_agg(distinct p.display_name, ', ' order by p.display_name)
                        from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id
                        where a.offering_id=o.id
                          and (a.legacy or (a.effective_from<=current_date
                            and (a.effective_to is null or a.effective_to>=current_date)))) as teachers,
                       (select count(*) from offering_enrollments e join students s on s.id=e.student_id
                        where e.offering_id=o.id and e.status='ACTIVE' and s.archived=false) as enrolled_count,
                       (select count(*) from sessions s where s.offering_id=o.id) as session_count,
                       (select count(*)>0 from teacher_assignments a
                        join teacher_profiles p on p.id=a.teacher_id
                        where a.offering_id=o.id and p.username=? and p.active=true
                          and not a.legacy and a.effective_from<=current_date
                          and (a.effective_to is null or a.effective_to>=current_date)) as can_create_session
                from course_offerings o join courses c on c.id=o.course_id
                where c.archived=false
                """);
        var args = new java.util.ArrayList<Object>();
        args.add(authentication.getName());
        if (!isAdmin(authentication)) {
            if (includeArchived) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only administrators can view archived offerings");
            }
            sql.append(" and exists (select 1 from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id ")
                    .append("where a.offering_id=o.id and p.username=? and p.active=true ")
                    .append("and (a.legacy or (a.effective_from<=current_date ")
                    .append("and (a.effective_to is null or a.effective_to>=current_date))))");
            args.add(authentication.getName());
        }
        if (courseId != null) {
            sql.append(" and o.course_id=?");
            args.add(courseId);
        }
        if (term != null && !term.isBlank()) {
            sql.append(" and lower(o.academic_term) like lower(?)");
            args.add("%" + term.trim() + "%");
        }
        if (section != null && !section.isBlank()) {
            sql.append(" and lower(o.section)=lower(?)");
            args.add(section.trim());
        }
        if (teacherId != null) {
            if (!isAdmin(authentication)) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only administrators can filter by teacher");
            }
            sql.append(" and exists (select 1 from teacher_assignments a where a.offering_id=o.id and a.teacher_id=?)");
            args.add(teacherId);
        }
        if (!includeArchived) sql.append(" and o.archived=false");
        sql.append(" order by c.course_code,o.academic_year desc nulls last,o.academic_term,o.section");
        List<Map<String, Object>> rows = db.queryForList(sql.toString(), args.toArray());
        if (isAdmin(authentication)) {
            rows.forEach(row -> row.put("can_create_session", !Boolean.TRUE.equals(row.get("archived"))));
        }
        return rows;
    }

    record NewOffering(UUID courseId, String academicTerm, Integer academicYear, String batch, String section) {}

    @PostMapping("/offerings")
    Object createOffering(@RequestBody NewOffering request, Authentication authentication) {
        requireAdmin(authentication);
        if (request.courseId() == null || blank(request.academicTerm()) || blank(request.batch()) || blank(request.section())
                || (request.academicYear() != null
                        && (request.academicYear() < 1900 || request.academicYear() > 2200))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Course, term, batch, section, and a valid optional year are required");
        }
        if (db.queryForObject("select count(*) from courses where id=? and archived=false",
                Integer.class, request.courseId()) != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active course not found");
        }
        UUID id = UUID.randomUUID();
        try {
            db.update("insert into course_offerings(id,course_id,academic_term,academic_year,batch,section) "
                            + "values(?,?,?,?,?,?)",
                    id, request.courseId(), request.academicTerm().trim(), request.academicYear(),
                    request.batch().trim(), request.section().trim());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "An offering already exists for this course, term, batch, and section");
        }
        return Map.of("id", id);
    }

    @PostMapping("/offerings/{id}/archive")
    Object archiveOffering(@PathVariable UUID id, Authentication authentication) {
        requireAdmin(authentication);
        int updated = db.update("update course_offerings set archived=true where id=?", id);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Offering not found");
        }
        return Map.of("archived", true);
    }

    @PostMapping("/offerings/{id}/activate")
    Object activateOffering(@PathVariable UUID id, Authentication authentication) {
        requireAdmin(authentication);
        int updated = db.update("update course_offerings o set archived=false where o.id=? "
                        + "and exists(select 1 from courses c where c.id=o.course_id and c.archived=false)",
                id);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Offering or its catalog course is missing or archived");
        }
        return Map.of("active", true);
    }

    @GetMapping("/teacher-profiles")
    Object teacherProfiles(Authentication authentication) {
        requireAdmin(authentication);
        return db.queryForList("select id,username,display_name,active from teacher_profiles order by display_name");
    }

    record NewTeacherProfile(String username, String displayName, String password) {}

    @PostMapping("/teacher-profiles")
    Object createTeacherProfile(@RequestBody NewTeacherProfile request, Authentication authentication) {
        requireAdmin(authentication);
        if (request.username() == null || !request.username().matches("[A-Za-z0-9._-]{3,64}")
                || "admin".equals(request.username()) || "teacher".equals(request.username())
                || blank(request.displayName()) || request.displayName().trim().length() > 120
                || request.password() == null || request.password().length() < 12
                || request.password().length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Provide a unique username, display name, and a password between 12 and 128 characters");
        }
        UUID id = UUID.randomUUID();
        try {
            db.update("insert into teacher_profiles(id,username,display_name,password_hash) values(?,?,?,?)",
                    id, request.username(), request.displayName().trim(), passwordEncoder.encode(request.password()));
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Teacher username is already in use");
        }
        return Map.of("id", id);
    }

    @GetMapping("/teacher-assignments")
    Object assignments(
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) UUID teacherId,
            Authentication authentication) {
        requireAdmin(authentication);
        StringBuilder sql = new StringBuilder("""
                select a.id,a.offering_id,a.teacher_id,p.username,p.display_name,
                       a.assignment_role,a.effective_from,a.effective_to,a.legacy,a.created_by,
                       o.academic_term,o.academic_year,o.batch,o.section,c.course_code,c.name as course_title,
                       case when a.legacy then 'LEGACY (DATES UNKNOWN)'
                            when a.effective_from>current_date then 'UPCOMING'
                            when a.effective_to is not null and a.effective_to<current_date then 'ENDED'
                            else 'CURRENT' end as status
                from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id
                join course_offerings o on o.id=a.offering_id join courses c on c.id=o.course_id
                where 1=1
                """);
        var args = new java.util.ArrayList<Object>();
        if (offeringId != null) {
            sql.append(" and a.offering_id=?");
            args.add(offeringId);
        }
        if (teacherId != null) {
            sql.append(" and a.teacher_id=?");
            args.add(teacherId);
        }
        sql.append(" order by p.display_name,c.course_code,o.academic_year desc nulls last,a.effective_from desc nulls last");
        return db.queryForList(sql.toString(), args.toArray());
    }

    record NewAssignment(UUID offeringId, UUID teacherId, String role, LocalDate effectiveFrom, LocalDate effectiveTo) {}

    @Transactional
    @PostMapping("/teacher-assignments")
    Object assignTeacher(@RequestBody NewAssignment request, Authentication authentication) {
        requireAdmin(authentication);
        if (request.offeringId() == null || request.teacherId() == null
                || !List.of("PRIMARY", "CO_TEACHER").contains(request.role())
                || request.effectiveFrom() == null
                || (request.effectiveTo() != null && request.effectiveTo().isBefore(request.effectiveFrom()))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Valid offering, teacher, role, and dates are required");
        }
        if (db.queryForList("select id from course_offerings where id=? and archived=false for update",
                UUID.class, request.offeringId()).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active offering not found");
        }
        if (db.queryForObject("select count(*) from teacher_profiles where id=? and active=true",
                Integer.class, request.teacherId()) != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active teacher profile not found");
        }
        String overlapSql = "select count(*) from teacher_assignments "
                + "where offering_id=? and assignment_role=? and not legacy "
                + "and (effective_to is null or effective_to>=?) "
                + "and effective_from<=coalesce(?,date '9999-12-31')"
                + (request.role().equals("PRIMARY") ? "" : " and teacher_id=?");
        int overlapping = request.role().equals("PRIMARY")
                ? db.queryForObject(overlapSql, Integer.class, request.offeringId(), request.role(),
                        request.effectiveFrom(), request.effectiveTo())
                : db.queryForObject(overlapSql, Integer.class, request.offeringId(), request.role(),
                        request.effectiveFrom(), request.effectiveTo(), request.teacherId());
        if (overlapping > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    request.role().equals("PRIMARY")
                            ? "Primary teacher assignment dates overlap"
                            : "This teacher already has an overlapping assignment in this role");
        }
        UUID id = UUID.randomUUID();
        try {
            db.update("insert into teacher_assignments(id,offering_id,teacher_id,assignment_role,effective_from,effective_to,created_by) "
                            + "values(?,?,?,?,?,?,?)",
                    id, request.offeringId(), request.teacherId(), request.role(),
                    request.effectiveFrom(), request.effectiveTo(), authentication.getName());
        } catch (DataIntegrityViolationException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Assignment conflicts with an existing assignment");
        }
        return Map.of("id", id);
    }

    record EndAssignment(LocalDate effectiveTo) {}

    @PostMapping("/teacher-assignments/{id}/end")
    Object endAssignment(
            @PathVariable UUID id,
            @RequestBody EndAssignment request,
            Authentication authentication) {
        requireAdmin(authentication);
        if (request.effectiveTo() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Effective-to date is required");
        }
        int updated = db.update("update teacher_assignments set effective_to=? "
                        + "where id=? and legacy=false and (effective_to is null or effective_to>=?) "
                        + "and effective_from<=?",
                request.effectiveTo(), id, request.effectiveTo(), request.effectiveTo());
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Assignment is missing, legacy, or the end date precedes its start date");
        }
        return Map.of("ended", true);
    }

    @GetMapping("/offerings/{id}/students")
    Object offeringRoster(@PathVariable UUID id, Authentication authentication) {
        requireOffering(id, authentication);
        return db.queryForList("select s.id,s.name,s.roll from offering_enrollments e "
                        + "join students s on s.id=e.student_id "
                        + "where e.offering_id=? and e.status='ACTIVE' and s.archived=false order by s.roll",
                id);
    }

    @Transactional
    @PostMapping("/offerings/{id}/students/{studentId}")
    Object enroll(
            @PathVariable UUID id,
            @PathVariable UUID studentId,
            Authentication authentication) {
        requireAdmin(authentication);
        if (db.queryForObject("select count(*) from course_offerings where id=? and archived=false",
                Integer.class, id) != 1
                || db.queryForObject("select count(*) from students where id=? and archived=false",
                        Integer.class, studentId) != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active offering or student not found");
        }
        UUID enrollmentId = UUID.randomUUID();
        try {
            db.update("insert into offering_enrollments(id,offering_id,student_id,status,active_from,created_by) "
                            + "values(?,?,?,'ACTIVE',?,?)",
                    enrollmentId, id, studentId, LocalDate.now(DHaka), authentication.getName());
        } catch (DuplicateKeyException exception) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Student is already enrolled in this offering");
        }
        db.update("insert into offering_enrollment_audit(offering_id,student_id,actor,action) values(?,?,?,'ENROLLED')",
                id, studentId, authentication.getName());
        return Map.of("id", enrollmentId);
    }

    @Transactional
    @DeleteMapping("/offerings/{id}/students/{studentId}")
    Object withdraw(
            @PathVariable UUID id,
            @PathVariable UUID studentId,
            Authentication authentication) {
        requireAdmin(authentication);
        LocalDate today = LocalDate.now(DHaka);
        int updated = db.update("update offering_enrollments set status='ENDED',active_to=? "
                        + "where offering_id=? and student_id=? and status='ACTIVE'",
                today, id, studentId);
        if (updated != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Active offering enrollment not found");
        }
        db.update("insert into offering_enrollment_audit(offering_id,student_id,actor,action) values(?,?,?,'WITHDRAWN')",
                id, studentId, authentication.getName());
        return Map.of("withdrawn", true);
    }

    private boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
