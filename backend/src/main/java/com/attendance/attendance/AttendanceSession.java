package com.attendance.attendance;

import com.attendance.auth.AppUser;
import com.attendance.courses.Course;
import com.attendance.courses.Section;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "attendance_sessions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AttendanceSession {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private Course course;

    @ManyToOne(optional = false)
    private Section section;

    @ManyToOne(optional = false)
    private AppUser teacher;

    private LocalDate classDate;
    private String classTime;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private SessionState state;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ProcessingState processingState;

    private String processingMessage;
    private LocalDateTime confirmedAt;
}
