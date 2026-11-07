package com.attendance.students;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "students")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Student {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(unique = true, nullable = false)
    private String studentCode;
    @Column(nullable = false)
    private String fullName;
    private String department;
    private String batch;
    private String section;
    @Column(nullable = false)
    private boolean active;
    @Column(nullable = false)
    private boolean faceEnrolled;
    @Column(nullable = false)
    private boolean biometricConsent;
}
