package com.attendance.attendance;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AttendancePhotoRepository extends JpaRepository<AttendancePhoto, Long> {
    List<AttendancePhoto> findBySessionId(Long sessionId);
}
