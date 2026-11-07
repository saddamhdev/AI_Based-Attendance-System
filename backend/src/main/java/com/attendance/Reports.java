package com.attendance;

import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/reporting")
public class Reports {
    private static final ZoneId REPORT_ZONE = ZoneId.of("Asia/Dhaka");
    private static final int MAX_PAGE_SIZE = 200;
    private static final int MAX_EXPORT_ROWS = 10_000;

    private final NamedParameterJdbcTemplate db;

    Reports(NamedParameterJdbcTemplate db) {
        this.db = db;
    }

    @GetMapping("/options")
    Object options(
            @RequestParam(required = false) UUID courseId,
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) String term,
            @RequestParam(required = false) String batch,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) UUID teacherId,
            @RequestParam(required = false) LocalDate fromDate,
            @RequestParam(required = false) LocalDate toDate,
            @RequestParam(required = false) LocalTime fromTime,
            @RequestParam(required = false) LocalTime toTime,
            Authentication authentication) {
        validateDates(fromDate, toDate, fromTime, toTime);
        validateTeacherFilter(teacherId, authentication);
        var params = new MapSqlParameterSource();
        String scope = permittedCourseScope(authentication, params);
        StringBuilder courseSql = new StringBuilder(
                "select c.id,c.course_code,c.name from courses c where exists "
                        + "(select 1 from sessions s where s.course_id=c.id and s.status='FINALIZED' " + scope + ")");
        if (courseId != null) {
            requirePermittedCourse(courseId, authentication);
        }
        courseSql.append(" order by c.name");
        var courseOptions = db.queryForList(courseSql.toString(), params);

        var sessionParams = new MapSqlParameterSource();
        String sessionScope = permittedCourseScope(authentication, sessionParams);
        StringBuilder sessionSql = new StringBuilder(
                "select s.id,s.course_id,o.id as offering_id,c.course_code,c.name as course_name,"
                        + "o.academic_term,o.academic_year,o.batch,o.section,p.display_name as teacher_name,s.class_date,"
                        + "s.class_start_time,s.class_end_time from sessions s "
                        + "join courses c on c.id=s.course_id "
                        + "join course_offerings o on o.id=s.offering_id "
                        + "left join teacher_profiles p on p.id=s.teacher_profile_id "
                        + "where s.status='FINALIZED' " + sessionScope);
        if (courseId != null) {
            sessionSql.append(" and s.course_id=:courseId");
            sessionParams.addValue("courseId", courseId);
        }
        appendAcademicFilters(sessionSql, sessionParams, offeringId, term, batch, section, teacherId);
        appendDateFilters(sessionSql, sessionParams, fromDate, toDate);
        appendTimeFilters(sessionSql, sessionParams, fromTime, toTime);
        sessionSql.append(" order by s.class_date desc,s.class_start_time desc nulls last,s.id");
        var offeringParams = new MapSqlParameterSource();
        String offeringScope = permittedCourseScope(authentication, offeringParams);
        StringBuilder offeringSql = new StringBuilder(
                "select distinct o.id,o.course_id,c.course_code,c.name as course_name,"
                        + "o.academic_term,o.academic_year,o.batch,o.section "
                        + "from sessions s join course_offerings o on o.id=s.offering_id "
                        + "join courses c on c.id=o.course_id where s.status='FINALIZED' " + offeringScope);
        if (courseId != null) {
            offeringSql.append(" and s.course_id=:courseId");
            offeringParams.addValue("courseId", courseId);
        }
        appendAcademicFilters(offeringSql, offeringParams, offeringId, term, batch, section, teacherId);
        appendDateFilters(offeringSql, offeringParams, fromDate, toDate);
        appendTimeFilters(offeringSql, offeringParams, fromTime, toTime);
        offeringSql.append(" order by c.course_code,o.academic_year desc nulls last,o.academic_term,o.section");
        var teacherParams = new MapSqlParameterSource();
        String teacherScope = permittedCourseScope(authentication, teacherParams);
        StringBuilder teacherSql = new StringBuilder(
                "select distinct p.id,p.display_name from sessions s "
                        + "join teacher_profiles p on p.id=s.teacher_profile_id "
                        + "join course_offerings o on o.id=s.offering_id "
                        + "where s.status='FINALIZED' " + teacherScope);
        if (courseId != null) {
            teacherSql.append(" and s.course_id=:courseId");
            teacherParams.addValue("courseId", courseId);
        }
        appendAcademicFilters(teacherSql, teacherParams, offeringId, term, batch, section, teacherId);
        appendDateFilters(teacherSql, teacherParams, fromDate, toDate);
        appendTimeFilters(teacherSql, teacherParams, fromTime, toTime);
        teacherSql.append(" order by p.display_name");
        return Map.of(
                "courses", courseOptions,
                "offerings", db.queryForList(offeringSql.toString(), offeringParams),
                "teachers", db.queryForList(teacherSql.toString(), teacherParams),
                "sessions", db.queryForList(sessionSql.toString(), sessionParams));
    }

    @GetMapping
    Object report(
            @RequestParam(defaultValue = "COURSE") String type,
            @RequestParam(required = false) UUID courseId,
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) String term,
            @RequestParam(required = false) String batch,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) UUID teacherId,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) LocalDate fromDate,
            @RequestParam(required = false) LocalDate toDate,
            @RequestParam(required = false) LocalTime fromTime,
            @RequestParam(required = false) LocalTime toTime,
            @RequestParam(required = false) String student,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(defaultValue = "") String sort,
            @RequestParam(defaultValue = "asc") String direction,
            Authentication authentication) {
        var filter = filter(type, courseId, offeringId, term, batch, section, teacherId, sessionId, fromDate, toDate, fromTime, toTime,
                student, status, page, size, sort, direction, authentication);
        return execute(filter, false);
    }

    @GetMapping(value = "/export.csv", produces = "text/csv")
    org.springframework.http.ResponseEntity<byte[]> exportCsv(
            @RequestParam(defaultValue = "COURSE") String type,
            @RequestParam(required = false) UUID courseId,
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) String term,
            @RequestParam(required = false) String batch,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) UUID teacherId,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) LocalDate fromDate,
            @RequestParam(required = false) LocalDate toDate,
            @RequestParam(required = false) LocalTime fromTime,
            @RequestParam(required = false) LocalTime toTime,
            @RequestParam(required = false) String student,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(defaultValue = "course") String sort,
            @RequestParam(defaultValue = "asc") String direction,
            Authentication authentication) {
        var filter = filter(type, courseId, offeringId, term, batch, section, teacherId, sessionId, fromDate, toDate, fromTime, toTime,
                student, status, 0, MAX_EXPORT_ROWS, sort, direction, authentication);
        Map<String, Object> result = castMap(execute(filter, true));
        var rows = castRows(result.get("rows"));
        var summary = castMap(result.get("summary"));
        StringBuilder csv = new StringBuilder();
        csv.append(csvCell(filter.title())).append('\n');
        csv.append(csvCell("Timezone")).append(',').append(csvCell(REPORT_ZONE.getId())).append('\n');
        csv.append(csvCell("Generated")).append(',').append(csvCell(generatedAt())).append('\n');
        csv.append(csvCell("Filters")).append(',').append(csvCell(filter.description())).append('\n');
        csv.append(csvCell("Finalized sessions")).append(',').append(csvCell(summary.get("finalizedSessions"))).append('\n');
        csv.append(csvCell("Distinct students")).append(',').append(csvCell(summary.get("distinctStudents"))).append('\n');
        csv.append(csvCell("Present student-session records")).append(',').append(csvCell(summary.get("presentRecords"))).append('\n');
        csv.append(csvCell("Absent student-session records")).append(',').append(csvCell(summary.get("absentRecords"))).append('\n');
        csv.append(csvCell("Attendance percentage")).append(',').append(csvCell(summary.get("attendancePercentage"))).append("\n\n");
        List<String> columns = columns(filter.type());
        csv.append(columns.stream().map(Reports::csvCell).reduce((a, b) -> a + "," + b).orElse("")).append('\n');
        for (var row : rows) {
            csv.append(columns.stream().map(column -> csvCell(row.get(column)))
                    .reduce((a, b) -> a + "," + b).orElse("")).append('\n');
        }
        return org.springframework.http.ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"attendance-report.csv\"")
                .contentType(new MediaType("text", "csv", StandardCharsets.UTF_8))
                .body(csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    @GetMapping("/export-data")
    Object exportData(
            @RequestParam(defaultValue = "COURSE") String type,
            @RequestParam(required = false) UUID courseId,
            @RequestParam(required = false) UUID offeringId,
            @RequestParam(required = false) String term,
            @RequestParam(required = false) String batch,
            @RequestParam(required = false) String section,
            @RequestParam(required = false) UUID teacherId,
            @RequestParam(required = false) UUID sessionId,
            @RequestParam(required = false) LocalDate fromDate,
            @RequestParam(required = false) LocalDate toDate,
            @RequestParam(required = false) LocalTime fromTime,
            @RequestParam(required = false) LocalTime toTime,
            @RequestParam(required = false) String student,
            @RequestParam(defaultValue = "ALL") String status,
            @RequestParam(defaultValue = "course") String sort,
            @RequestParam(defaultValue = "asc") String direction,
            Authentication authentication) {
        var filter = filter(type, courseId, offeringId, term, batch, section, teacherId, sessionId, fromDate, toDate, fromTime, toTime,
                student, status, 0, MAX_EXPORT_ROWS, sort, direction, authentication);
        return execute(filter, true);
    }

    private Filter filter(
            String type, UUID courseId, UUID offeringId, String term, String batch, String section, UUID teacherId,
            UUID sessionId, LocalDate fromDate, LocalDate toDate,
            LocalTime fromTime, LocalTime toTime, String student, String status,
            int page, int size, String sort, String direction, Authentication authentication) {
        String normalizedType = type.toUpperCase(Locale.ROOT);
        if (!Set.of("COURSE", "SESSION", "STUDENT", "DETAIL").contains(normalizedType)) {
            throw badRequest("Unknown report type.");
        }
        String normalizedStatus = status.toUpperCase(Locale.ROOT);
        if (!Set.of("ALL", "PRESENT", "ABSENT").contains(normalizedStatus)) {
            throw badRequest("Attendance status must be ALL, PRESENT, or ABSENT.");
        }
        validateDates(fromDate, toDate, fromTime, toTime);
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE && size != MAX_EXPORT_ROWS) {
            throw badRequest("Page must be non-negative and page size must be between 1 and " + MAX_PAGE_SIZE + ".");
        }
        if (student != null && student.length() > 120) {
            throw badRequest("Student search must be 120 characters or fewer.");
        }
        if (exceedsFilterLength(term) || exceedsFilterLength(batch) || exceedsFilterLength(section)) {
            throw badRequest("Term, batch, and section filters must be 80 characters or fewer.");
        }
        validateTeacherFilter(teacherId, authentication);
        if (courseId != null) requirePermittedCourse(courseId, authentication);
        if (offeringId != null) requirePermittedOffering(offeringId, courseId, authentication);
        if (sessionId != null) {
            requirePermittedSession(sessionId, courseId, offeringId, authentication);
            requireSessionMatches(sessionId, courseId, offeringId, term, batch, section, teacherId,
                    fromDate, toDate, fromTime, toTime);
        }
        String normalizedDirection = direction.equalsIgnoreCase("desc") ? "DESC"
                : direction.equalsIgnoreCase("asc") ? "ASC" : null;
        if (normalizedDirection == null) throw badRequest("Sort direction must be asc or desc.");
        String normalizedSort = sortKey(normalizedType, sort);
        return new Filter(normalizedType, courseId, offeringId, term, batch, section, teacherId,
                sessionId, fromDate, toDate, fromTime, toTime,
                student == null || student.isBlank() ? null : student.trim(), normalizedStatus,
                page, size, normalizedSort, normalizedDirection, authentication);
    }

    private Object execute(Filter filter, boolean export) {
        var params = new MapSqlParameterSource();
        String scope = permittedCourseScope(filter.authentication(), params);
        StringBuilder where = new StringBuilder(" where s.status='FINALIZED' " + scope);
        if (filter.courseId() != null) {
            where.append(" and s.course_id=:courseId");
            params.addValue("courseId", filter.courseId());
        }
        if (filter.sessionId() != null) {
            where.append(" and s.id=:sessionId");
            params.addValue("sessionId", filter.sessionId());
        }
        appendAcademicFilters(where, params, filter.offeringId(), filter.term(), filter.batch(),
                filter.section(), filter.teacherId());
        appendDateFilters(where, params, filter.fromDate(), filter.toDate());
        if (filter.fromTime() != null || filter.toTime() != null) {
            where.append(" and s.class_start_time is not null");
            if (filter.fromTime() != null) {
                where.append(" and s.class_start_time>=:fromTime");
                params.addValue("fromTime", filter.fromTime());
            }
            if (filter.toTime() != null) {
                where.append(" and s.class_start_time<=:toTime");
                params.addValue("toTime", filter.toTime());
            }
        }
        if (filter.student() != null) {
            where.append(" and (a.student_name ilike :student or a.roll ilike :student)");
            params.addValue("student", "%" + escapeLike(filter.student()) + "%");
        }
        String cte = "with base as (select s.id as session_id,s.course_id,c.course_code,c.name as course_name,"
                + "s.offering_id,o.academic_term,o.academic_year,o.batch,o.section,p.display_name as teacher_name,"
                + "s.class_date,s.class_start_time,s.class_end_time,a.student_id,a.student_name,a.roll,a.state "
                + "from attendance a join sessions s on s.id=a.session_id "
                + "join courses c on c.id=s.course_id "
                + "join course_offerings o on o.id=s.offering_id "
                + "left join teacher_profiles p on p.id=s.teacher_profile_id" + where
                + " and a.state in ('PRESENT','ABSENT')) ";
        var summary = db.queryForMap(cte + "select count(distinct session_id) as finalized_sessions,"
                + "count(distinct student_id) as distinct_students,"
                + "count(*) filter(where state='PRESENT') as present_records,"
                + "count(*) filter(where state='ABSENT') as absent_records,"
                + "case when count(*)=0 then null else "
                + "round(100.0*count(*) filter(where state='PRESENT')/count(*),2) end as attendance_percentage "
                + "from base", params);
        String grouped = groupedQuery(filter);
        long total = db.queryForObject(cte + countQuery(filter), params, Long.class);
        String sortColumn = sortColumn(filter.type(), filter.sort());
        String order = " order by " + sortColumn + " " + filter.direction() + " nulls last";
        if (filter.type().equals("DETAIL")) {
            order += ",class_date desc,session_id,roll";
        } else if (filter.type().equals("SESSION")) {
            order += ",class_date desc,session_id";
        } else if (filter.type().equals("COURSE")) {
            order += ",course_id";
        } else if (filter.type().equals("STUDENT")) {
            order += ",course_name,roll,student_id";
        } else {
            order += ",course_name";
        }
        var queryParams = new MapSqlParameterSource(params.getValues());
        if (export && total > MAX_EXPORT_ROWS) {
            throw new ResponseStatusException(HttpStatus.PAYLOAD_TOO_LARGE,
                    "This report has " + total + " rows; the export limit is " + MAX_EXPORT_ROWS + ".");
        }
        queryParams.addValue("limit", filter.size()).addValue("offset", export ? 0 : (long) filter.page() * filter.size());
        var rows = db.queryForList(cte + grouped + order + " limit :limit offset :offset", queryParams);
        var response = new java.util.LinkedHashMap<String, Object>();
        response.put("type", filter.type());
        response.put("title", filter.title());
        response.put("timezone", REPORT_ZONE.getId());
        response.put("generatedAt", generatedAt());
        response.put("filters", filter.displayFilters());
        response.put("summary", summaryValues(summary));
        response.put("page", filter.page());
        response.put("size", filter.size());
        response.put("totalRows", total);
        response.put("rows", rows);
        return response;
    }

    private String groupedQuery(Filter filter) {
        return switch (filter.type()) {
            case "COURSE" -> "select course_id,course_code,course_name,count(distinct session_id) as finalized_sessions,"
                    + "count(*) as student_session_records,count(*) filter(where state='PRESENT') as present_count,"
                    + "count(*) filter(where state='ABSENT') as absent_count,"
                    + percentage() + " as attendance_percentage from base group by course_id,course_code,course_name";
            case "SESSION" -> "select session_id,course_id,course_code,course_name,offering_id,academic_term,academic_year,"
                    + "batch,section,teacher_name,class_date,class_start_time,class_end_time,"
                    + "count(*) as roster_count,count(*) filter(where state='PRESENT') as present_count,"
                    + "count(*) filter(where state='ABSENT') as absent_count,"
                    + percentage() + " as attendance_percentage from base "
                    + "group by session_id,course_id,course_code,course_name,offering_id,academic_term,academic_year,"
                    + "batch,section,teacher_name,class_date,class_start_time,class_end_time";
            case "STUDENT" -> "select student_id,roll,student_name,course_id,course_code,course_name,offering_id,"
                    + "academic_term,academic_year,batch,section,"
                    + "count(distinct session_id) as eligible_sessions,"
                    + "count(*) filter(where state='PRESENT') as present_count,"
                    + "count(*) filter(where state='ABSENT') as absent_count,"
                    + percentage() + " as attendance_percentage from base "
                    + "group by student_id,roll,student_name,course_id,course_code,course_name,offering_id,"
                    + "academic_term,academic_year,batch,section";
            case "DETAIL" -> {
                String statusFilter = filter.status().equals("ALL") ? "" : " where state='" + filter.status() + "'";
                yield "select course_code,course_name,offering_id,academic_term,academic_year,batch,section,"
                        + "teacher_name,session_id,class_date,class_start_time,class_end_time,"
                        + "student_id,roll,student_name,state from base" + statusFilter;
            }

            default -> throw badRequest("Unknown report type.");
        };
    }

    private String countQuery(Filter filter) {
        return switch (filter.type()) {
            case "COURSE" -> "select count(distinct course_id) from base";
            case "SESSION" -> "select count(distinct session_id) from base";
            case "STUDENT" -> "select count(*) from (select student_id,roll,student_name,offering_id from base "
                    + "group by student_id,roll,student_name,offering_id) student_rows";
            case "DETAIL" -> "select count(*) from base"
                    + (filter.status().equals("ALL") ? "" : " where state='" + filter.status() + "'");
            default -> throw badRequest("Unknown report type.");
        };
    }

    private String percentage() {
        return "case when count(*)=0 then null else round(100.0*count(*) filter(where state='PRESENT')/count(*),2) end";
    }

    private void appendDateFilters(StringBuilder query, MapSqlParameterSource params, LocalDate from, LocalDate to) {
        if (from != null) {
            query.append(" and s.class_date>=:fromDate");
            params.addValue("fromDate", from);
        }
        if (to != null) {
            query.append(" and s.class_date<=:toDate");
            params.addValue("toDate", to);
        }
    }

    private void appendTimeFilters(
            StringBuilder query,
            MapSqlParameterSource params,
            LocalTime from,
            LocalTime to) {
        if (from != null || to != null) {
            query.append(" and s.class_start_time is not null");
            if (from != null) {
                query.append(" and s.class_start_time>=:fromTime");
                params.addValue("fromTime", from);
            }
            if (to != null) {
                query.append(" and s.class_start_time<=:toTime");
                params.addValue("toTime", to);
            }
        }
    }

    private void appendAcademicFilters(
            StringBuilder query,
            MapSqlParameterSource params,
            UUID offeringId,
            String term,
            String batch,
            String section,
            UUID teacherId) {
        if (offeringId != null) {
            query.append(" and s.offering_id=:offeringId");
            params.addValue("offeringId", offeringId);
        }
        if (term != null && !term.isBlank()) {
            query.append(" and lower(o.academic_term)=lower(:term)");
            params.addValue("term", term.trim());
        }
        if (batch != null && !batch.isBlank()) {
            query.append(" and lower(o.batch)=lower(:batch)");
            params.addValue("batch", batch.trim());
        }
        if (section != null && !section.isBlank()) {
            query.append(" and lower(o.section)=lower(:section)");
            params.addValue("section", section.trim());
        }
        if (teacherId != null) {
            query.append(" and s.teacher_profile_id=:teacherId");
            params.addValue("teacherId", teacherId);
        }
    }

    private String permittedCourseScope(Authentication authentication, MapSqlParameterSource params) {
        if (isAdmin(authentication)) return "";
        params.addValue("teacher", authentication.getName());
        return " and s.teacher_profile_id=(select id from teacher_profiles where username=:teacher and active=true)";
    }

    private void requirePermittedCourse(UUID courseId, Authentication authentication) {
        String sql = "select count(*) from courses c where c.id=:id"
                + (isAdmin(authentication) ? "" : " and (exists (select 1 from sessions s "
                        + "where s.course_id=c.id and s.status='FINALIZED' and s.teacher_profile_id="
                        + "(select id from teacher_profiles where username=:teacher and active=true)) "
                        + "or exists (select 1 from course_offerings o join teacher_assignments a "
                        + "on a.offering_id=o.id join teacher_profiles p on p.id=a.teacher_id "
                        + "where o.course_id=c.id and p.username=:teacher and p.active=true "
                        + "and (a.legacy or (a.effective_from<=current_date "
                        + "and (a.effective_to is null or a.effective_to>=current_date)))))");
        var params = new MapSqlParameterSource("id", courseId);
        if (!isAdmin(authentication)) params.addValue("teacher", authentication.getName());
        if (db.queryForObject(sql, params, Integer.class) == 0) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Course is not available for this account.");
        }
    }

    private void requirePermittedOffering(UUID offeringId, UUID courseId, Authentication authentication) {
        String sql = "select count(*) from course_offerings o where o.id=:id"
                + (courseId == null ? "" : " and o.course_id=:courseId")
                + (isAdmin(authentication) ? "" : " and (exists (select 1 from sessions s "
                        + "where s.offering_id=o.id and s.status='FINALIZED' "
                        + "and s.teacher_profile_id=(select id from teacher_profiles where username=:teacher and active=true)) "
                        + "or exists (select 1 from teacher_assignments a join teacher_profiles p on p.id=a.teacher_id "
                        + "where a.offering_id=o.id and p.username=:teacher and p.active=true "
                        + "and (a.legacy or (a.effective_from<=current_date "
                        + "and (a.effective_to is null or a.effective_to>=current_date)))))");
        var params = new MapSqlParameterSource("id", offeringId);
        if (courseId != null) params.addValue("courseId", courseId);
        if (!isAdmin(authentication)) params.addValue("teacher", authentication.getName());
        if (db.queryForObject(sql, params, Integer.class) == 0) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Offering is not available for this account.");
        }
    }

    private void requirePermittedSession(UUID sessionId, UUID courseId, UUID offeringId, Authentication authentication) {
        String sql = "select count(*) from sessions s where s.id=:id"
                + (courseId == null ? "" : " and s.course_id=:courseId")
                + (offeringId == null ? "" : " and s.offering_id=:offeringId")
                + (isAdmin(authentication) ? "" : " and s.teacher_profile_id=(select id from teacher_profiles "
                        + "where username=:teacher and active=true)");
        var params = new MapSqlParameterSource("id", sessionId);
        if (courseId != null) params.addValue("courseId", courseId);
        if (offeringId != null) params.addValue("offeringId", offeringId);
        if (!isAdmin(authentication)) params.addValue("teacher", authentication.getName());
        if (db.queryForObject(sql, params, Integer.class) == 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Selected session is unavailable or does not match the selected course.");
        }
    }

    private void requireSessionMatches(
            UUID sessionId, UUID courseId, UUID offeringId, String term, String batch, String section, UUID teacherId,
            LocalDate fromDate, LocalDate toDate, LocalTime fromTime, LocalTime toTime) {
        StringBuilder sql = new StringBuilder("select count(*) from sessions s join course_offerings o on o.id=s.offering_id where s.id=:id and s.status='FINALIZED'");
        var params = new MapSqlParameterSource("id", sessionId);
        if (courseId != null) {
            sql.append(" and s.course_id=:courseId");
            params.addValue("courseId", courseId);
        }
        if (offeringId != null) {
            sql.append(" and s.offering_id=:offeringId");
            params.addValue("offeringId", offeringId);
        }
        appendAcademicFilters(sql, params, null, term, batch, section, teacherId);
        if (fromDate != null) {
            sql.append(" and s.class_date>=:fromDate");
            params.addValue("fromDate", fromDate);
        }
        if (toDate != null) {
            sql.append(" and s.class_date<=:toDate");
            params.addValue("toDate", toDate);
        }
        if (fromTime != null || toTime != null) {
            sql.append(" and s.class_start_time is not null");
            if (fromTime != null) {
                sql.append(" and s.class_start_time>=:fromTime");
                params.addValue("fromTime", fromTime);
            }
            if (toTime != null) {
                sql.append(" and s.class_start_time<=:toTime");
                params.addValue("toTime", toTime);
            }
        }
        if (db.queryForObject(sql.toString(), params, Integer.class) == 0) {
            throw badRequest("Selected session does not match the finalized session filters.");
        }
    }

    private void validateTeacherFilter(UUID teacherId, Authentication authentication) {
        if (teacherId == null) return;
        if (isAdmin(authentication)) {
            if (db.queryForObject("select count(*) from teacher_profiles where id=:id",
                    new MapSqlParameterSource("id", teacherId), Integer.class) == 0) {
                throw badRequest("Unknown session teacher.");
            }
            return;
        }
        UUID self = db.getJdbcTemplate().query("select id from teacher_profiles where username=? and active=true",
                resultSet -> resultSet.next() ? UUID.fromString(resultSet.getString(1)) : null,
                authentication.getName());
        if (!teacherId.equals(self)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Teacher reports are restricted to the session teacher.");
        }
    }

    private static boolean exceedsFilterLength(String value) {
        return value != null && value.length() > 80;
    }

    private static void validateDates(LocalDate from, LocalDate to, LocalTime fromTime, LocalTime toTime) {
        if (from != null && to != null && from.isAfter(to)) throw badRequest("From date must not be after To date.");
        if ((from == null || to == null || from.equals(to))
                && fromTime != null && toTime != null && fromTime.isAfter(toTime)) {
            throw badRequest("From date/time must not be after To date/time.");
        }
    }

    private static String sortKey(String type, String sort) {
        Set<String> allowed = switch (type) {
            case "COURSE" -> Set.of("course", "finalizedSessions", "records", "present", "absent", "percentage");
            case "SESSION" -> Set.of("course", "date", "time", "roster", "present", "absent", "percentage");
            case "STUDENT" -> Set.of("roll", "name", "course", "sessions", "present", "absent", "percentage");
            default -> Set.of("course", "date", "time", "roll", "name", "status");
        };
        String key = sort.isBlank()
                ? switch (type) {
                    case "SESSION" -> "date";
                    case "STUDENT" -> "roll";
                    default -> "course";
                }
                : sort;
        if (!allowed.contains(key)) throw badRequest("Unsupported sort field.");
        return key;
    }

    private static String sortColumn(String type, String key) {
        return switch (key) {
            case "course" -> type.equals("COURSE") ? "course_name" : "course_name";
            case "finalizedSessions" -> "finalized_sessions";
            case "records" -> "student_session_records";
            case "date" -> "class_date";
            case "time" -> "class_start_time";
            case "roster" -> "roster_count";
            case "roll" -> "roll";
            case "name" -> "student_name";
            case "sessions" -> "eligible_sessions";
            case "present" -> "present_count";
            case "absent" -> "absent_count";
            case "percentage" -> "attendance_percentage";
            case "status" -> "state";
            default -> "course_name";
        };
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }

    private static boolean isAdmin(Authentication authentication) {
        return authentication.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_ADMIN"));
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private static String generatedAt() {
        return ZonedDateTime.now(REPORT_ZONE).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
    }

    private static Map<String, Object> summaryValues(Map<String, Object> row) {
        var values = new java.util.LinkedHashMap<String, Object>();
        values.put("finalizedSessions", row.get("finalized_sessions"));
        values.put("distinctStudents", row.get("distinct_students"));
        values.put("presentRecords", row.get("present_records"));
        values.put("absentRecords", row.get("absent_records"));
        values.put("attendancePercentage", row.get("attendance_percentage"));
        return values;
    }

    private static List<String> columns(String type) {
        return switch (type) {
            case "COURSE" -> List.of("course_code", "course_name", "finalized_sessions", "student_session_records",
                    "present_count", "absent_count", "attendance_percentage");
            case "SESSION" -> List.of("course_code", "course_name", "academic_term", "academic_year", "batch",
                    "section", "teacher_name", "session_id", "class_date", "class_start_time",
                    "class_end_time", "roster_count", "present_count", "absent_count", "attendance_percentage");
            case "STUDENT" -> List.of("roll", "student_name", "course_code", "course_name", "academic_term",
                    "academic_year", "batch", "section", "eligible_sessions",
                    "present_count", "absent_count", "attendance_percentage");
            default -> List.of("course_code", "course_name", "academic_term", "academic_year", "batch",
                    "section", "teacher_name", "session_id", "class_date", "class_start_time",
                    "class_end_time", "roll", "student_name", "state");
        };
    }

    private static String csvCell(Object value) {
        String text = value == null ? "" : value.toString();
        if (text.matches("^[\\s]*[=+@-].*")) text = "'" + text;
        return "\"" + text.replace("\"", "\"\"") + "\"";
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> castRows(Object value) {
        return (List<Map<String, Object>>) value;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> castMap(Object value) {
        return (Map<String, Object>) value;
    }

    private record Filter(
            String type, UUID courseId, UUID offeringId, String term, String batch, String section, UUID teacherId,
            UUID sessionId, LocalDate fromDate, LocalDate toDate,
            LocalTime fromTime, LocalTime toTime, String student, String status,
            int page, int size, String sort, String direction, Authentication authentication) {

        String title() {
            return switch (type) {
                case "COURSE" -> "Course attendance summary";
                case "SESSION" -> "Session attendance summary";
                case "STUDENT" -> "Student attendance summary";
                default -> "Detailed attendance records";
            };
        }

        String description() {
            return "course=" + value(courseId) + "; offering=" + value(offeringId)
                    + "; term=" + value(term) + "; batch=" + value(batch) + "; section=" + value(section)
                    + "; teacher=" + value(teacherId) + "; session=" + value(sessionId)
                    + "; fromDate=" + value(fromDate) + "; toDate=" + value(toDate)
                    + "; fromTime=" + value(fromTime) + "; toTime=" + value(toTime)
                    + "; student=" + value(student)
                    + (type.equals("DETAIL") ? "; status=" + status : "");
        }

        Map<String, Object> displayFilters() {
            var result = new java.util.LinkedHashMap<String, Object>();
            result.put("courseId", courseId);
            result.put("offeringId", offeringId);
            result.put("term", term);
            result.put("batch", batch);
            result.put("section", section);
            result.put("teacherId", teacherId);
            result.put("sessionId", sessionId);
            result.put("fromDate", fromDate);
            result.put("toDate", toDate);
            result.put("fromTime", fromTime);
            result.put("toTime", toTime);
            result.put("student", student);
            result.put("status", status);
            return result;
        }

        private static String value(Object value) {
            return value == null ? "All" : value.toString();
        }
    }
}
