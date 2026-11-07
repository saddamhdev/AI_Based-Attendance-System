package com.attendance.students;

import jakarta.validation.constraints.NotBlank;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/students")
public class StudentController {
    private final StudentRepository students;

    public StudentController(StudentRepository students) {
        this.students = students;
    }

    public record StudentUpsert(
            @NotBlank String studentCode,
            @NotBlank String fullName,
            String department,
            String batch,
            String section,
            boolean active,
            boolean faceEnrolled,
            boolean biometricConsent
    ) {}

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public List<Student> list(@RequestParam(defaultValue = "") String q) {
        if (q.isBlank()) return students.findAll();
        return students.findByFullNameContainingIgnoreCaseOrStudentCodeContainingIgnoreCase(q, q);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN','TEACHER')")
    public Student get(@PathVariable Long id) {
        return students.findById(id).orElseThrow(() -> new IllegalArgumentException("Student not found"));
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public Student create(@RequestBody StudentUpsert payload) {
        return students.save(Student.builder()
                .studentCode(payload.studentCode())
                .fullName(payload.fullName())
                .department(payload.department())
                .batch(payload.batch())
                .section(payload.section())
                .active(payload.active())
                .faceEnrolled(payload.faceEnrolled())
                .biometricConsent(payload.biometricConsent())
                .build());
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public Student update(@PathVariable Long id, @RequestBody StudentUpsert payload) {
        Student s = students.findById(id).orElseThrow(() -> new IllegalArgumentException("Student not found"));
        s.setStudentCode(payload.studentCode());
        s.setFullName(payload.fullName());
        s.setDepartment(payload.department());
        s.setBatch(payload.batch());
        s.setSection(payload.section());
        s.setActive(payload.active());
        s.setFaceEnrolled(payload.faceEnrolled());
        s.setBiometricConsent(payload.biometricConsent());
        return students.save(s);
    }
}
