package com.attendance.courses;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface TeacherAssignmentRepository extends JpaRepository<TeacherAssignment, Long> {
    boolean existsBySectionIdAndTeacherId(Long sectionId, Long teacherId);
    Optional<TeacherAssignment> findBySectionIdAndTeacherId(Long sectionId, Long teacherId);
}
