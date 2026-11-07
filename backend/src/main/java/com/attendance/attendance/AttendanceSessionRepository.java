package com.attendance.attendance;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AttendanceSessionRepository extends JpaRepository<AttendanceSession, Long> {
    List<AttendanceSession> findByTeacherId(Long teacherId);
    List<AttendanceSession> findByState(SessionState state);
}
