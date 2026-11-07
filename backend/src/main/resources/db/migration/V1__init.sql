CREATE TABLE app_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(80) UNIQUE NOT NULL,
    email VARCHAR(120) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL,
    student_id BIGINT
);

CREATE TABLE students (
    id BIGSERIAL PRIMARY KEY,
    student_code VARCHAR(40) UNIQUE NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    department VARCHAR(100),
    batch VARCHAR(50),
    section VARCHAR(20),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    face_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
    biometric_consent BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE courses (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(120) NOT NULL
);

CREATE TABLE sections (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id),
    section_code VARCHAR(30) NOT NULL
);

CREATE TABLE enrollments (
    id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES sections(id),
    student_id BIGINT NOT NULL REFERENCES students(id),
    CONSTRAINT uq_enroll UNIQUE(section_id, student_id)
);

CREATE TABLE teacher_assignments (
    id BIGSERIAL PRIMARY KEY,
    section_id BIGINT NOT NULL REFERENCES sections(id),
    teacher_id BIGINT NOT NULL REFERENCES app_users(id),
    CONSTRAINT uq_assignment UNIQUE(section_id, teacher_id)
);

CREATE TABLE attendance_sessions (
    id BIGSERIAL PRIMARY KEY,
    course_id BIGINT NOT NULL REFERENCES courses(id),
    section_id BIGINT NOT NULL REFERENCES sections(id),
    teacher_id BIGINT NOT NULL REFERENCES app_users(id),
    class_date DATE,
    class_time VARCHAR(40),
    state VARCHAR(20) NOT NULL,
    processing_state VARCHAR(40) NOT NULL,
    processing_message TEXT,
    confirmed_at TIMESTAMP
);

CREATE TABLE attendance_records (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    student_id BIGINT NOT NULL REFERENCES students(id),
    status VARCHAR(30) NOT NULL,
    similarity_score DOUBLE PRECISION,
    source VARCHAR(20),
    correction_reason TEXT,
    CONSTRAINT uq_attendance_session_student UNIQUE(session_id, student_id)
);

CREATE TABLE attendance_photos (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    storage_path TEXT
);

CREATE TABLE attendance_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    session_id BIGINT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
    actor_id BIGINT NOT NULL REFERENCES app_users(id),
    action VARCHAR(80) NOT NULL,
    details TEXT,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE system_settings (
    id BIGSERIAL PRIMARY KEY,
    key VARCHAR(120) UNIQUE NOT NULL,
    value TEXT NOT NULL
);

INSERT INTO students(student_code, full_name, department, batch, section, active, face_enrolled, biometric_consent)
VALUES
('S001', 'Anika Rahman', 'CSE', '2024', 'A', TRUE, TRUE, TRUE),
('S002', 'Nafis Karim', 'CSE', '2024', 'A', TRUE, FALSE, FALSE),
('S003', 'Mehedi Hasan', 'EEE', '2024', 'B', TRUE, TRUE, TRUE);

-- password: Password@123
INSERT INTO app_users(username, email, password_hash, role, student_id)
VALUES
('admin', 'admin@example.com', '$2a$10$w7vAj5j7xg8kweWf5Yf4quOL8x4mAj6EI5f9fdNSfwaI45hSg8n8a', 'ADMIN', NULL),
('teacher1', 'teacher1@example.com', '$2a$10$w7vAj5j7xg8kweWf5Yf4quOL8x4mAj6EI5f9fdNSfwaI45hSg8n8a', 'TEACHER', NULL),
('student1', 'student1@example.com', '$2a$10$w7vAj5j7xg8kweWf5Yf4quOL8x4mAj6EI5f9fdNSfwaI45hSg8n8a', 'STUDENT', 1);

INSERT INTO courses(code, name) VALUES ('CSE101', 'Introduction to Computing');
INSERT INTO sections(course_id, section_code) VALUES (1, 'A');
INSERT INTO enrollments(section_id, student_id) VALUES (1,1), (1,2);
INSERT INTO teacher_assignments(section_id, teacher_id) VALUES (1,2);

INSERT INTO system_settings(key, value) VALUES
('recognition_threshold', '0.72'),
('embedding_retention_days', '90'),
('photo_retention_days', '30');
