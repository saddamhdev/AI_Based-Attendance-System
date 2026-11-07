package com.attendance;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StudentConsentService {
    private final JdbcTemplate db;

    StudentConsentService(JdbcTemplate db) {
        this.db = db;
    }

    record Withdrawal(List<UUID> cancelledSubmissions) {}

    @Transactional
    Withdrawal withdraw(UUID studentId, String actor) {
        db.queryForMap("select id from students where id=? and archived=false for update", studentId);
        db.update("update students set consent=false,consent_updated_at=now(),consent_source='STUDENT_WITHDRAWAL' where id=?",
                studentId);
        db.update("update student_enrollments set status='RETIRED',retention_until=now()+interval '90 days',"
                + "embedding_cleanup_pending=true where student_id=? and status='ACTIVE'", studentId);
        List<Map<String, Object>> pending = db.queryForList(
                "select id from student_enrollments where student_id=? and status='PENDING_REVIEW' for update",
                studentId);
        List<UUID> cancelled = new ArrayList<>();
        for (Map<String, Object> row : pending) {
            UUID enrollment = (UUID) row.get("id");
            db.update("update student_enrollments set status='CANCELLED',reviewed_by=?,reviewed_at=now(),"
                    + "retention_until=now()+interval '90 days',embedding_cleanup_pending=true where id=?",
                    actor, enrollment);
            db.update("insert into student_photo_submission_audit(enrollment_id,student_id,actor,action,reason) "
                    + "values(?,?,?,'CANCELLED','Biometric consent withdrawn')", enrollment, studentId, actor);
            cancelled.add(enrollment);
        }
        return new Withdrawal(List.copyOf(cancelled));
    }
}
