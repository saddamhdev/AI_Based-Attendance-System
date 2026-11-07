package com.attendance.courses;

import com.attendance.auth.AppUser;
import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "teacher_assignments", uniqueConstraints = @UniqueConstraint(columnNames = {"section_id", "teacher_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class TeacherAssignment {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    private Section section;
    @ManyToOne(optional = false)
    @JoinColumn(name = "teacher_id")
    private AppUser teacher;
}
