ALTER TABLE courses ADD COLUMN course_code text;

UPDATE courses
SET course_code = 'LEGACY-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE course_code IS NULL;

ALTER TABLE courses ALTER COLUMN course_code SET NOT NULL;
ALTER TABLE courses ADD CONSTRAINT courses_course_code_unique UNIQUE (course_code);
ALTER TABLE courses ALTER COLUMN teacher DROP NOT NULL;

CREATE TABLE teacher_profiles (
    id uuid PRIMARY KEY,
    username text NOT NULL UNIQUE,
    display_name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO teacher_profiles(id, username, display_name)
SELECT gen_random_uuid(), username, username
FROM (
    SELECT DISTINCT teacher AS username
    FROM courses
    WHERE teacher IN ('admin', 'teacher')
) verified_accounts;

CREATE TABLE course_offerings (
    id uuid PRIMARY KEY,
    course_id uuid NOT NULL REFERENCES courses(id),
    academic_term text NOT NULL,
    academic_year integer,
    batch text NOT NULL,
    section text NOT NULL,
    archived boolean NOT NULL DEFAULT false,
    legacy boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (academic_year IS NULL OR academic_year BETWEEN 1900 AND 2200)
);

CREATE UNIQUE INDEX course_offerings_identity_idx
    ON course_offerings (
        course_id,
        academic_term,
        coalesce(academic_year, 0),
        batch,
        section
    );

INSERT INTO course_offerings(id, course_id, academic_term, academic_year, batch, section, legacy)
SELECT gen_random_uuid(), id, 'Legacy (unknown)', NULL, 'Legacy (unknown)', 'Legacy (unknown)', true
FROM courses;

CREATE TABLE teacher_assignments (
    id uuid PRIMARY KEY,
    offering_id uuid NOT NULL REFERENCES course_offerings(id),
    teacher_id uuid NOT NULL REFERENCES teacher_profiles(id),
    assignment_role text NOT NULL CHECK (assignment_role IN ('PRIMARY', 'CO_TEACHER')),
    effective_from date,
    effective_to date,
    legacy boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from),
    CHECK ((legacy AND effective_from IS NULL) OR (NOT legacy AND effective_from IS NOT NULL))
);

CREATE INDEX teacher_assignments_teacher_period_idx
    ON teacher_assignments (teacher_id, effective_from, effective_to);
CREATE INDEX teacher_assignments_offering_period_idx
    ON teacher_assignments (offering_id, assignment_role, effective_from, effective_to);

INSERT INTO teacher_assignments(
    id, offering_id, teacher_id, assignment_role, effective_from, effective_to, legacy, created_by
)
SELECT gen_random_uuid(), o.id, p.id, 'PRIMARY', NULL, NULL, true, 'migration'
FROM course_offerings o
JOIN courses c ON c.id = o.course_id
JOIN teacher_profiles p ON p.username = c.teacher
WHERE o.legacy;

CREATE FUNCTION prevent_overlapping_primary_assignments() RETURNS trigger AS $$
DECLARE
    overlap_count integer;
BEGIN
    IF NEW.assignment_role <> 'PRIMARY' OR NEW.legacy THEN
        RETURN NEW;
    END IF;

    PERFORM 1 FROM course_offerings WHERE id = NEW.offering_id FOR UPDATE;

    SELECT count(*) INTO overlap_count
    FROM teacher_assignments existing
    WHERE existing.offering_id = NEW.offering_id
      AND existing.assignment_role = 'PRIMARY'
      AND NOT existing.legacy
      AND existing.id <> NEW.id
      AND daterange(existing.effective_from, existing.effective_to, '[]')
          && daterange(NEW.effective_from, NEW.effective_to, '[]');

    IF overlap_count > 0 THEN
        RAISE EXCEPTION 'Primary teacher assignment dates overlap'
            USING ERRCODE = '23P01';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER teacher_assignments_no_primary_overlap
    BEFORE INSERT OR UPDATE ON teacher_assignments
    FOR EACH ROW EXECUTE FUNCTION prevent_overlapping_primary_assignments();

CREATE TABLE offering_enrollments (
    id uuid PRIMARY KEY,
    offering_id uuid NOT NULL REFERENCES course_offerings(id),
    student_id uuid NOT NULL REFERENCES students(id),
    status text NOT NULL CHECK (status IN ('ACTIVE', 'ENDED')),
    active_from date,
    active_to date,
    source text NOT NULL DEFAULT 'ADMIN',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (active_from IS NULL OR active_to IS NULL OR active_to >= active_from)
);

CREATE UNIQUE INDEX offering_enrollments_one_active
    ON offering_enrollments(offering_id, student_id) WHERE status = 'ACTIVE';
CREATE INDEX offering_enrollments_roster_idx
    ON offering_enrollments(offering_id, status, student_id);

INSERT INTO offering_enrollments(
    id, offering_id, student_id, status, source, created_by
)
SELECT gen_random_uuid(), o.id, e.student_id, 'ACTIVE', 'LEGACY', 'migration'
FROM enrollments e
JOIN course_offerings o ON o.course_id = e.course_id AND o.legacy;

CREATE TABLE offering_enrollment_audit (
    id bigserial PRIMARY KEY,
    offering_id uuid NOT NULL REFERENCES course_offerings(id),
    student_id uuid NOT NULL REFERENCES students(id),
    actor text NOT NULL,
    action text NOT NULL CHECK (action IN ('ENROLLED', 'WITHDRAWN')),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sessions ADD COLUMN offering_id uuid REFERENCES course_offerings(id);
ALTER TABLE sessions ADD COLUMN teacher_profile_id uuid REFERENCES teacher_profiles(id);

UPDATE sessions s
SET offering_id = o.id
FROM course_offerings o
WHERE o.course_id = s.course_id AND o.legacy;

ALTER TABLE sessions ALTER COLUMN offering_id SET NOT NULL;

CREATE INDEX sessions_teacher_history_idx
    ON sessions(teacher_profile_id, class_date, status);
CREATE INDEX sessions_offering_scope_idx
    ON sessions(offering_id, class_date, status);

CREATE TABLE session_substitute_authorizations (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES sessions(id),
    teacher_id uuid NOT NULL REFERENCES teacher_profiles(id),
    authorized_by text NOT NULL,
    authorized_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CHECK (revoked_at IS NULL OR revoked_at >= authorized_at)
);

CREATE UNIQUE INDEX session_substitute_one_active
    ON session_substitute_authorizations(session_id, teacher_id)
    WHERE revoked_at IS NULL;

CREATE FUNCTION require_new_session_teacher_and_times() RETURNS trigger AS $$
BEGIN
    IF NEW.offering_id IS NULL OR NEW.teacher_profile_id IS NULL
       OR NEW.class_start_time IS NULL OR NEW.class_end_time IS NULL THEN
        RAISE EXCEPTION 'New sessions require an offering, responsible teacher, and recorded class times'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.class_end_time <= NEW.class_start_time THEN
        RAISE EXCEPTION 'Class end time must be later than start time'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_require_new_academic_metadata
    BEFORE INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION require_new_session_teacher_and_times();

CREATE FUNCTION prevent_duplicate_new_session() RETURNS trigger AS $$
DECLARE
    duplicate_count integer;
BEGIN
    PERFORM 1 FROM course_offerings WHERE id = NEW.offering_id FOR UPDATE;
    SELECT count(*) INTO duplicate_count
    FROM sessions existing
    WHERE existing.offering_id = NEW.offering_id
      AND existing.class_date = NEW.class_date
      AND existing.class_start_time = NEW.class_start_time
      AND existing.class_end_time = NEW.class_end_time;
    IF duplicate_count > 0 THEN
        RAISE EXCEPTION 'An identical session already exists for this offering and time'
            USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sessions_prevent_exact_duplicate
    BEFORE INSERT ON sessions
    FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_new_session();
