package com.attendance.courses;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "sections")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Section {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(optional = false)
    private Course course;
    @Column(nullable = false)
    private String sectionCode;
}
