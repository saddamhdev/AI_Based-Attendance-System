package com.attendance.attendance;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "attendance_photos")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AttendancePhoto {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "session_id")
    private AttendanceSession session;

    @Column(nullable = false)
    private String fileName;

    @Lob
    private String storagePath;
}
