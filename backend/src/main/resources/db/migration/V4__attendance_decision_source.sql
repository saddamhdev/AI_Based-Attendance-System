ALTER TABLE attendance
    ADD COLUMN decision_source text NOT NULL DEFAULT 'NONE';

ALTER TABLE attendance
    ADD CONSTRAINT attendance_decision_source_check
    CHECK (decision_source IN ('NONE', 'AI', 'MANUAL'));
