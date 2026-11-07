package com.attendance.reports;

import com.attendance.attendance.AttendanceRecord;
import com.attendance.attendance.AttendanceRecordRepository;
import com.attendance.attendance.AttendanceSession;
import com.attendance.attendance.AttendanceSessionRepository;
import com.attendance.attendance.SessionState;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reports")
public class ReportController {
    private final AttendanceSessionRepository sessions;
    private final AttendanceRecordRepository records;

    public ReportController(AttendanceSessionRepository sessions, AttendanceRecordRepository records) {
        this.sessions = sessions;
        this.records = records;
    }

    @GetMapping("/summary")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER','STUDENT')")
    public Map<String, Object> summary(@RequestParam(required = false) Long sectionId) {
        List<AttendanceSession> finalized = sessions.findByState(SessionState.FINALIZED).stream()
                .filter(s -> sectionId == null || s.getSection().getId().equals(sectionId))
                .toList();

        int totalPresent = 0;
        int totalRecords = 0;
        for (AttendanceSession session : finalized) {
            List<AttendanceRecord> recs = records.findBySessionId(session.getId());
            totalRecords += recs.size();
            totalPresent += recs.stream().filter(r -> r.getStatus().name().equals("PRESENT")).count();
        }

        return Map.of(
                "finalizedSessions", finalized.size(),
                "totalRecords", totalRecords,
                "presentRecords", totalPresent,
                "attendancePercentage", totalRecords == 0 ? 0 : (double) totalPresent * 100.0 / totalRecords,
                "denominatorRule", "Only finalized sessions are included"
        );
    }
}
