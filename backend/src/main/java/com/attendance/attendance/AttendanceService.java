package com.attendance.attendance;

import com.attendance.auth.AppUser;
import com.attendance.auth.AppUserRepository;
import com.attendance.auth.CustomUserPrincipal;
import com.attendance.auth.Role;
import com.attendance.courses.*;
import com.attendance.students.Student;
import jakarta.transaction.Transactional;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class AttendanceService {
    private final AttendanceSessionRepository sessions;
    private final AttendanceRecordRepository records;
    private final AttendancePhotoRepository photos;
    private final AuditLogRepository auditLogs;
    private final CourseRepository courses;
    private final SectionRepository sections;
    private final EnrollmentRepository enrollments;
    private final TeacherAssignmentRepository assignments;
    private final AppUserRepository users;
    private final AiClient aiClient;

    public AttendanceService(AttendanceSessionRepository sessions, AttendanceRecordRepository records,
                             AttendancePhotoRepository photos, AuditLogRepository auditLogs, CourseRepository courses,
                             SectionRepository sections, EnrollmentRepository enrollments,
                             TeacherAssignmentRepository assignments, AppUserRepository users, AiClient aiClient) {
        this.sessions = sessions;
        this.records = records;
        this.photos = photos;
        this.auditLogs = auditLogs;
        this.courses = courses;
        this.sections = sections;
        this.enrollments = enrollments;
        this.assignments = assignments;
        this.users = users;
        this.aiClient = aiClient;
    }

    public record CreateSessionRequest(Long courseId, Long sectionId, LocalDate classDate, String classTime) {}
    public record SessionReviewResponse(AttendanceSession session, List<AttendanceRecord> roster,
                                        int enrolledStudents, long proposedPresent, long proposedAbsent,
                                        long reviewRequired, String draftNotice, long unrecognizedFaces) {}

    @Transactional
    public AttendanceSession createSession(CreateSessionRequest req, CustomUserPrincipal user) {
        if (user.getRole() != Role.TEACHER && user.getRole() != Role.ADMIN) {
            throw new SecurityException("Only teachers and admins can create attendance sessions");
        }

        Course course = courses.findById(req.courseId()).orElseThrow(() -> new IllegalArgumentException("Course not found"));
        Section section = sections.findById(req.sectionId()).orElseThrow(() -> new IllegalArgumentException("Section not found"));

        if (user.getRole() == Role.TEACHER && !assignments.existsBySectionIdAndTeacherId(section.getId(), user.getId())) {
            throw new SecurityException("Teacher is not assigned to this section");
        }

        AppUser teacher = users.findById(user.getId()).orElseThrow(() -> new IllegalArgumentException("Teacher not found"));

        AttendanceSession session = sessions.save(AttendanceSession.builder()
                .course(course)
                .section(section)
                .teacher(teacher)
                .classDate(req.classDate())
                .classTime(req.classTime())
                .state(SessionState.DRAFT)
                .processingState(ProcessingState.IDLE)
                .processingMessage("Draft created")
                .build());

        initializeDraftRecords(session);
        addAudit(session, teacher, "SESSION_CREATED", "Draft session created");
        return session;
    }

    @Transactional
    public void initializeDraftRecords(AttendanceSession session) {
        List<Enrollment> enrolled = enrollments.findBySectionId(session.getSection().getId());
        for (Enrollment e : enrolled) {
            records.save(AttendanceRecord.builder()
                    .session(session)
                    .student(e.getStudent())
                    .status(AttendanceStatus.PROPOSED_ABSENT)
                    .source("SYSTEM")
                    .build());
        }
    }

    @Transactional
    public AttendanceSession uploadPhotos(Long sessionId, List<MultipartFile> files, CustomUserPrincipal user) {
        AttendanceSession session = getTeacherSession(sessionId, user);
        if (files.size() < 2 || files.size() > 3) {
            throw new IllegalArgumentException("Upload exactly 2-3 classroom photos");
        }
        session.setProcessingState(ProcessingState.UPLOADING);
        sessions.save(session);

        try {
            Path dir = Path.of("/tmp/attendance-uploads", String.valueOf(sessionId));
            Files.createDirectories(dir);
            photos.deleteAll(photos.findBySessionId(sessionId));
            List<String> saved = new ArrayList<>();
            for (MultipartFile file : files) {
                if (file.isEmpty() || !Objects.requireNonNull(file.getContentType()).startsWith("image/")) {
                    throw new IllegalArgumentException("Only image files are supported");
                }
                Path path = dir.resolve(UUID.randomUUID() + "-" + file.getOriginalFilename());
                file.transferTo(path);
                photos.save(AttendancePhoto.builder()
                        .session(session)
                        .fileName(file.getOriginalFilename())
                        .storagePath(path.toString())
                        .build());
                saved.add(path.toString());
            }
            processAiAsync(sessionId, saved, user.getId());
            return session;
        } catch (Exception ex) {
            session.setProcessingState(ProcessingState.FAILED);
            session.setProcessingMessage("Upload failed: " + ex.getMessage());
            return sessions.save(session);
        }
    }

    @Async
    @Transactional
    public void processAiAsync(Long sessionId, List<String> photoPaths, Long userId) {
        AttendanceSession session = sessions.findById(sessionId).orElseThrow();
        AppUser actor = users.findById(userId).orElseThrow();
        try {
            session.setProcessingState(ProcessingState.DETECTING);
            sessions.save(session);
            List<Long> enrolledIds = enrollments.findBySectionId(session.getSection().getId()).stream()
                    .map(e -> e.getStudent().getId()).toList();

            session.setProcessingState(ProcessingState.MATCHING);
            sessions.save(session);

            List<Map<String, Object>> aiResults = aiClient.analyze(sessionId, enrolledIds, photoPaths);
            applyAiResults(session, aiResults);

            session.setProcessingState(ProcessingState.READY_FOR_REVIEW);
            session.setProcessingMessage("AI suggestions ready. Review before confirming.");
            sessions.save(session);
            addAudit(session, actor, "AI_PROCESSING_COMPLETE", "AI draft prepared");
        } catch (Exception ex) {
            session.setProcessingState(ProcessingState.FAILED);
            session.setProcessingMessage("AI service unavailable. Continue with manual attendance.");
            sessions.save(session);
            addAudit(session, actor, "AI_PROCESSING_FAILED", ex.getMessage());
        }
    }

    @Transactional
    void applyAiResults(AttendanceSession session, List<Map<String, Object>> aiResults) {
        Set<Long> assignedStudents = new HashSet<>();
        for (Map<String, Object> result : aiResults) {
            Number studentIdNum = (Number) result.get("studentId");
            if (studentIdNum == null) continue;
            long studentId = studentIdNum.longValue();
            if (assignedStudents.contains(studentId)) continue;
            AttendanceRecord record = records.findBySessionIdAndStudentId(session.getId(), studentId).orElse(null);
            if (record == null) continue;
            Double score = result.get("similarity") instanceof Number n ? n.doubleValue() : null;
            boolean uncertain = Boolean.TRUE.equals(result.get("uncertain"));
            record.setSimilarityScore(score);
            if (uncertain) {
                record.setStatus(AttendanceStatus.REVIEW_REQUIRED);
            } else {
                record.setStatus(AttendanceStatus.PROPOSED_PRESENT);
            }
            record.setSource("AI");
            records.save(record);
            assignedStudents.add(studentId);
        }
    }

    public List<AttendanceSession> listSessions(CustomUserPrincipal user, SessionState state) {
        if (user.getRole() == Role.TEACHER) {
            return sessions.findByTeacherId(user.getId()).stream()
                    .filter(s -> state == null || s.getState() == state)
                    .toList();
        }
        if (user.getRole() == Role.STUDENT) {
            if (user.getStudentId() == null) return List.of();
            return records.findByStudentId(user.getStudentId()).stream()
                    .map(AttendanceRecord::getSession)
                    .filter(s -> state == null || s.getState() == state)
                    .distinct()
                    .toList();
        }
        if (state == null) return sessions.findAll();
        return sessions.findByState(state);
    }

    public SessionReviewResponse getReview(Long sessionId, CustomUserPrincipal user) {
        AttendanceSession session = getTeacherSession(sessionId, user);
        List<AttendanceRecord> roster = records.findBySessionId(sessionId);
        int enrolled = roster.size();
        long proposedPresent = roster.stream().filter(r -> r.getStatus() == AttendanceStatus.PROPOSED_PRESENT || r.getStatus() == AttendanceStatus.PRESENT).count();
        long proposedAbsent = roster.stream().filter(r -> r.getStatus() == AttendanceStatus.PROPOSED_ABSENT || r.getStatus() == AttendanceStatus.ABSENT).count();
        long reviewRequired = roster.stream().filter(r -> r.getStatus() == AttendanceStatus.REVIEW_REQUIRED).count();
        return new SessionReviewResponse(session, roster, enrolled, proposedPresent, proposedAbsent,
                reviewRequired, "AI suggestions are drafts. Review before confirming.", 0);
    }

    @Transactional
    public AttendanceRecord markAttendance(Long sessionId, Long studentId, AttendanceStatus status, String reason,
                                           CustomUserPrincipal user) {
        AttendanceSession session = getTeacherSession(sessionId, user);
        if (session.getState() == SessionState.FINALIZED) {
            throw new IllegalArgumentException("Session already finalized");
        }

        AttendanceRecord record = records.findBySessionIdAndStudentId(sessionId, studentId)
                .orElseThrow(() -> new IllegalArgumentException("Student not in roster"));
        record.setStatus(status);
        record.setSource("MANUAL");
        record.setCorrectionReason(reason);
        AttendanceRecord saved = records.save(record);
        AppUser actor = users.findById(user.getId()).orElseThrow();
        addAudit(session, actor, "ATTENDANCE_CORRECTED", "Student " + studentId + " => " + status);
        return saved;
    }

    @Transactional
    public AttendanceSession confirm(Long sessionId, CustomUserPrincipal user) {
        AttendanceSession session = getTeacherSession(sessionId, user);
        List<AttendanceRecord> roster = records.findBySessionId(sessionId);
        if (roster.stream().anyMatch(r -> r.getStatus() == AttendanceStatus.REVIEW_REQUIRED)) {
            throw new IllegalArgumentException("Resolve review-required items before confirmation");
        }

        roster.forEach(r -> {
            if (r.getStatus() == AttendanceStatus.PROPOSED_PRESENT) r.setStatus(AttendanceStatus.PRESENT);
            if (r.getStatus() == AttendanceStatus.PROPOSED_ABSENT) r.setStatus(AttendanceStatus.ABSENT);
        });
        records.saveAll(roster);

        session.setState(SessionState.FINALIZED);
        session.setConfirmedAt(LocalDateTime.now());
        sessions.save(session);

        AppUser actor = users.findById(user.getId()).orElseThrow();
        addAudit(session, actor, "SESSION_CONFIRMED", "Attendance finalized");
        return session;
    }

    public List<AuditLog> audit(Long sessionId, CustomUserPrincipal user) {
        getTeacherSession(sessionId, user);
        return auditLogs.findBySessionIdOrderByCreatedAtDesc(sessionId);
    }

    private AttendanceSession getTeacherSession(Long sessionId, CustomUserPrincipal user) {
        AttendanceSession session = sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));
        if (user.getRole() == Role.TEACHER && !Objects.equals(session.getTeacher().getId(), user.getId())) {
            throw new SecurityException("Not allowed to access this session");
        }
        return session;
    }

    private void addAudit(AttendanceSession session, AppUser actor, String action, String details) {
        auditLogs.save(AuditLog.builder()
                .session(session)
                .actor(actor)
                .action(action)
                .details(details)
                .createdAt(LocalDateTime.now())
                .build());
    }
}
