package com.attendance.courses;

import com.attendance.students.Student;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "enrollments", uniqueConstraints = @UniqueConstraint(columnNames = {"section_id", "student_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Enrollment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    private Section section;
    @ManyToOne(optional = false)
    private Student student;
}
