package com.attendance;

import com.attendance.attendance.*;
import com.attendance.auth.AppUser;
import com.attendance.auth.AppUserRepository;
import com.attendance.auth.AuthDtos;
import com.attendance.auth.Role;
import com.attendance.courses.*;
import com.attendance.students.Student;
import com.attendance.students.StudentRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class SecurityAndWorkflowIntegrationTest {

    @Autowired MockMvc mockMvc;
    @Autowired ObjectMapper objectMapper;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired AppUserRepository userRepository;
    @Autowired StudentRepository studentRepository;
    @Autowired CourseRepository courseRepository;
    @Autowired SectionRepository sectionRepository;
    @Autowired EnrollmentRepository enrollmentRepository;
    @Autowired TeacherAssignmentRepository teacherAssignmentRepository;
    @Autowired AttendanceSessionRepository attendanceSessionRepository;
    @Autowired AttendanceRecordRepository attendanceRecordRepository;
    @Autowired AuditLogRepository auditLogRepository;
    @Autowired AttendancePhotoRepository attendancePhotoRepository;

    Long teacherId;
    Long sectionId;
    Long courseId;
    Long student1Id;

    @BeforeEach
    void setUp() {
        attendanceRecordRepository.deleteAll();
        attendancePhotoRepository.deleteAll();
        auditLogRepository.deleteAll();
        attendanceSessionRepository.deleteAll();
        teacherAssignmentRepository.deleteAll();
        enrollmentRepository.deleteAll();
        sectionRepository.deleteAll();
        courseRepository.deleteAll();
        userRepository.deleteAll();
        studentRepository.deleteAll();

        Student s1 = studentRepository.save(Student.builder().studentCode("S1").fullName("Student One").active(true).faceEnrolled(true).biometricConsent(true).build());
        Student s2 = studentRepository.save(Student.builder().studentCode("S2").fullName("Student Two").active(true).faceEnrolled(false).biometricConsent(false).build());
        student1Id = s1.getId();

        AppUser teacher = userRepository.save(AppUser.builder()
                .username("teacher")
                .email("teacher@test.com")
                .passwordHash(passwordEncoder.encode("Password@123"))
                .role(Role.TEACHER)
                .build());
        teacherId = teacher.getId();

        userRepository.save(AppUser.builder()
                .username("student")
                .email("student@test.com")
                .passwordHash(passwordEncoder.encode("Password@123"))
                .role(Role.STUDENT)
                .studentId(s1.getId())
                .build());

        Course course = courseRepository.save(Course.builder().code("C1").name("Course One").build());
        courseId = course.getId();
        Section section = sectionRepository.save(Section.builder().course(course).sectionCode("A").build());
        sectionId = section.getId();
        enrollmentRepository.save(Enrollment.builder().section(section).student(s1).build());
        enrollmentRepository.save(Enrollment.builder().section(section).student(s2).build());
        teacherAssignmentRepository.save(TeacherAssignment.builder().section(section).teacher(teacher).build());
    }

    @Test
    void studentCannotCreateStudents() throws Exception {
        String token = login("student", "Password@123");
        String payload = """
                {"studentCode":"S99","fullName":"New","active":true,"faceEnrolled":false,"biometricConsent":false}
                """;

        mockMvc.perform(post("/api/students")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isForbidden());
    }

    @Test
    void preventsDuplicateAttendanceRecordsPerSession() throws Exception {
        String token = login("teacher", "Password@123");
        Long sessionId = createSession(token);

        AttendanceSession session = attendanceSessionRepository.findById(sessionId).orElseThrow();
        Student student = studentRepository.findById(student1Id).orElseThrow();

        assertThatThrownBy(() -> attendanceRecordRepository.saveAndFlush(AttendanceRecord.builder()
                .session(session)
                .student(student)
                .status(AttendanceStatus.PROPOSED_PRESENT)
                .source("MANUAL")
                .build())).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void finalConfirmationRequiresReviewItemsResolved() throws Exception {
        String token = login("teacher", "Password@123");
        Long sessionId = createSession(token);

        AttendanceRecord record = attendanceRecordRepository.findBySessionId(sessionId).get(0);
        record.setStatus(AttendanceStatus.REVIEW_REQUIRED);
        attendanceRecordRepository.save(record);

        mockMvc.perform(post("/api/attendance/sessions/{id}/confirm", sessionId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Resolve review-required items before confirmation"));

        String manualPayload = """
                {"status":"ABSENT","reason":"Manual review complete"}
                """;

        mockMvc.perform(put("/api/attendance/sessions/{id}/records/{studentId}", sessionId, record.getStudent().getId())
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(manualPayload))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/attendance/sessions/{id}/confirm", sessionId)
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.state").value("FINALIZED"));
    }

    private Long createSession(String token) throws Exception {
        String payload = objectMapper.writeValueAsString(new AttendanceService.CreateSessionRequest(
                courseId, sectionId, LocalDate.now(), "10:00 AM"
        ));
        String response = mockMvc.perform(post("/api/attendance/sessions")
                        .header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        return objectMapper.readTree(response).get("id").asLong();
    }

    private String login(String username, String password) throws Exception {
        String response = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new AuthDtos.LoginRequest(username, password))))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        return objectMapper.readTree(response).get("token").asText();
    }
}
