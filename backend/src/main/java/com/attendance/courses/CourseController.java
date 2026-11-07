package com.attendance.courses;

import com.attendance.auth.AppUser;
import com.attendance.auth.AppUserRepository;
import com.attendance.auth.Role;
import com.attendance.students.Student;
import com.attendance.students.StudentRepository;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/courses")
public class CourseController {
    private final CourseRepository courses;
    private final SectionRepository sections;
    private final EnrollmentRepository enrollments;
    private final TeacherAssignmentRepository assignments;
    private final StudentRepository students;
    private final AppUserRepository users;

    public CourseController(CourseRepository courses, SectionRepository sections, EnrollmentRepository enrollments,
                            TeacherAssignmentRepository assignments, StudentRepository students, AppUserRepository users) {
        this.courses = courses;
        this.sections = sections;
        this.enrollments = enrollments;
        this.assignments = assignments;
        this.students = students;
        this.users = users;
    }

    public record CoursePayload(String code, String name) {}
    public record SectionPayload(Long courseId, String sectionCode) {}
    public record EnrollmentPayload(Long sectionId, Long studentId) {}
    public record AssignPayload(Long sectionId, Long teacherId) {}

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER','STUDENT')")
    public List<Course> list() { return courses.findAll(); }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public Course create(@RequestBody CoursePayload payload) {
        return courses.save(Course.builder().code(payload.code()).name(payload.name()).build());
    }

    @GetMapping("/sections")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public List<Section> listSections(@RequestParam(required = false) Long courseId) {
        return courseId == null ? sections.findAll() : sections.findByCourseId(courseId);
    }

    @PostMapping("/sections")
    @PreAuthorize("hasRole('ADMIN')")
    public Section createSection(@RequestBody SectionPayload payload) {
        Course course = courses.findById(payload.courseId()).orElseThrow(() -> new IllegalArgumentException("Course not found"));
        return sections.save(Section.builder().course(course).sectionCode(payload.sectionCode()).build());
    }

    @PostMapping("/enrollments")
    @PreAuthorize("hasRole('ADMIN')")
    public Enrollment enroll(@RequestBody EnrollmentPayload payload) {
        Section section = sections.findById(payload.sectionId()).orElseThrow(() -> new IllegalArgumentException("Section not found"));
        Student student = students.findById(payload.studentId()).orElseThrow(() -> new IllegalArgumentException("Student not found"));
        return enrollments.save(Enrollment.builder().section(section).student(student).build());
    }

    @GetMapping("/enrollments")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public List<Enrollment> listEnrollments(@RequestParam Long sectionId) {
        return enrollments.findBySectionId(sectionId);
    }

    @PostMapping("/assignments")
    @PreAuthorize("hasRole('ADMIN')")
    public TeacherAssignment assignTeacher(@RequestBody AssignPayload payload) {
        Section section = sections.findById(payload.sectionId()).orElseThrow(() -> new IllegalArgumentException("Section not found"));
        AppUser teacher = users.findById(payload.teacherId()).orElseThrow(() -> new IllegalArgumentException("Teacher not found"));
        if (teacher.getRole() != Role.TEACHER) throw new IllegalArgumentException("User is not teacher");
        return assignments.save(TeacherAssignment.builder().section(section).teacher(teacher).build());
    }
}
