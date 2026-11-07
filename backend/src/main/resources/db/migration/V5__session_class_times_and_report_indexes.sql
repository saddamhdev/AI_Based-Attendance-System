ALTER TABLE sessions ADD COLUMN class_start_time time;
ALTER TABLE sessions ADD COLUMN class_end_time time;
ALTER TABLE sessions
    ADD CONSTRAINT sessions_class_time_order_check
        CHECK (class_start_time IS NULL OR class_end_time IS NULL OR class_start_time <= class_end_time);

CREATE INDEX sessions_report_scope_idx
    ON sessions (course_id, status, class_date, class_start_time);

CREATE INDEX attendance_report_student_idx
    ON attendance (student_id, session_id, state);
