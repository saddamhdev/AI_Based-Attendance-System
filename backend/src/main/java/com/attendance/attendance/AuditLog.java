package com.attendance.attendance;

import com.attendance.auth.AppUser;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "attendance_audit_logs")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AuditLog {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private AttendanceSession session;

    @ManyToOne(optional = false)
    private AppUser actor;

    @Column(nullable = false)
    private String action;

    @Lob
    private String details;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
