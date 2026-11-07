package com.attendance;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;
import java.util.logging.Logger;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class StudentDataRetention {
    private static final Logger LOG = Logger.getLogger(StudentDataRetention.class.getName());
    private final JdbcTemplate db;
    private final RestClient ai;
    private final Path photoRoot = Path.of(
            System.getenv().getOrDefault("ENROLLMENT_PHOTO_DIR", "./data/enrollment-photos"))
            .toAbsolutePath().normalize();

    StudentDataRetention(JdbcTemplate db) {
        this.db = db;
        this.ai = RestClient.builder()
                .baseUrl(System.getenv().getOrDefault("AI_URL", "http://localhost:8001"))
                .defaultHeader("X-Service-Key", System.getenv("AI_SERVICE_KEY"))
                .build();
    }

    @Scheduled(cron = "0 0 3 * * *", zone = "Asia/Dhaka")
    void purgeExpiredStudentData() {
        purgeRejectedApplications();
        List<Map<String, Object>> expired = db.queryForList("""
                select id,student_id,embedding_cleanup_pending
                from student_enrollments
                where retention_until<=now() and status in ('REJECTED','CANCELLED','RETIRED')
                order by retention_until limit 100
                """);
        for (Map<String, Object> enrollment : expired) {
            UUID enrollmentId = (UUID) enrollment.get("id");
            try {
                if (Boolean.TRUE.equals(enrollment.get("embedding_cleanup_pending"))) {
                    UUID studentId = (UUID) enrollment.get("student_id");
                    ai.delete().uri(uri -> uri.path("/enroll/" + studentId)
                                    .queryParam("version", enrollmentId).build())
                            .retrieve().toBodilessEntity();
                }
                for (Map<String, Object> photo : db.queryForList(
                        "select storage_key,thumbnail_key from enrollment_photos where enrollment_id=?",
                        enrollmentId)) {
                    deletePrivateFile((String) photo.get("storage_key"));
                    deletePrivateFile((String) photo.get("thumbnail_key"));
                }
                db.update("delete from enrollment_photos where enrollment_id=?", enrollmentId);
                db.update("update student_enrollments set embedding_cleanup_pending=false,"
                        + "retention_until=null,photos_purged_at=now() where id=?", enrollmentId);
            } catch (Exception exception) {
                LOG.log(Level.WARNING, "Student face retention cleanup will retry for " + enrollmentId, exception);
            }
        }
    }

    private void purgeRejectedApplications() {
        try {
            db.update("""
                    update student_registration_requests
                    set full_name='[retained decision]',normalized_roll='PURGED-'||id::text,
                        email='purged+'||id::text||'@invalid.local',normalized_email='purged+'||id::text||'@invalid.local',
                        username='purged-'||id::text,normalized_username='purged-'||id::text,
                        password_hash='!',department=null,batch=null,candidate_student_id=null,
                        rejection_reason='Application data purged after retention period',
                        status_token_hash='!',purged_at=now()
                    where status='REJECTED' and purge_after<=now() and purged_at is null
                    """);
        } catch (Exception exception) {
            LOG.log(Level.WARNING, "Rejected student application retention cleanup failed", exception);
        }
    }

    private void deletePrivateFile(String storageKey) throws Exception {
        Path file = photoRoot.resolve(storageKey).normalize();
        if (!file.startsWith(photoRoot)) {
            throw new IllegalStateException("Enrollment photo storage key escaped the private photo root");
        }
        Files.deleteIfExists(file);
    }
}
