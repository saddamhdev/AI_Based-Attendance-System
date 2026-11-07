ALTER TABLE students ADD COLUMN email text;
ALTER TABLE students ADD COLUMN department text;
ALTER TABLE students ADD COLUMN batch text;
ALTER TABLE students ADD COLUMN consent_updated_at timestamptz;
ALTER TABLE students ADD COLUMN consent_source text;
ALTER TABLE students ADD COLUMN profile_source text NOT NULL DEFAULT 'LEGACY';
ALTER TABLE students ADD COLUMN created_by text;
ALTER TABLE students ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX students_normalized_roll_unique
    ON students (upper(regexp_replace(btrim(roll), '\s+', '', 'g')));
CREATE UNIQUE INDEX students_normalized_email_unique
    ON students (lower(btrim(email))) WHERE email IS NOT NULL;

CREATE TABLE student_accounts (
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL UNIQUE REFERENCES students(id),
    username text NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    account_status text NOT NULL CHECK (account_status IN ('APPROVED', 'DEACTIVATED')),
    active boolean NOT NULL DEFAULT true,
    must_change_password boolean NOT NULL DEFAULT false,
    registration_source text NOT NULL CHECK (registration_source IN ('ADMIN', 'SELF_REGISTRATION')),
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((account_status = 'APPROVED' AND active) OR account_status = 'DEACTIVATED')
);

CREATE UNIQUE INDEX student_accounts_normalized_username_unique
    ON student_accounts (lower(btrim(username)));
CREATE UNIQUE INDEX student_accounts_normalized_email_unique
    ON student_accounts (lower(btrim(email)));
CREATE INDEX student_accounts_active_username_idx
    ON student_accounts (lower(username), active, account_status);

CREATE UNIQUE INDEX teacher_profiles_normalized_username_unique
    ON teacher_profiles (lower(btrim(username)));

CREATE TABLE student_registration_requests (
    id uuid PRIMARY KEY,
    full_name text NOT NULL,
    normalized_roll text NOT NULL,
    email text NOT NULL,
    normalized_email text NOT NULL,
    username text NOT NULL,
    normalized_username text NOT NULL,
    password_hash text NOT NULL,
    department text,
    batch text,
    candidate_student_id uuid REFERENCES students(id),
    status text NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
    rejection_reason text,
    status_token_hash text NOT NULL,
    reviewer text,
    reviewed_at timestamptz,
    student_id uuid REFERENCES students(id),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    purge_after timestamptz,
    purged_at timestamptz,
    CHECK ((status = 'REJECTED' AND rejection_reason IS NOT NULL)
        OR (status <> 'REJECTED' AND rejection_reason IS NULL))
);

CREATE UNIQUE INDEX student_registration_pending_username_unique
    ON student_registration_requests (normalized_username)
    WHERE status = 'PENDING_APPROVAL';
CREATE UNIQUE INDEX student_registration_pending_email_unique
    ON student_registration_requests (normalized_email)
    WHERE status = 'PENDING_APPROVAL';
CREATE UNIQUE INDEX student_registration_pending_roll_unique
    ON student_registration_requests (normalized_roll)
    WHERE status = 'PENDING_APPROVAL';
CREATE INDEX student_registration_review_queue_idx
    ON student_registration_requests (status, submitted_at);

ALTER TABLE student_enrollments ADD COLUMN rejection_reason text;
ALTER TABLE student_enrollments ADD COLUMN reviewed_by text;
ALTER TABLE student_enrollments ADD COLUMN reviewed_at timestamptz;
ALTER TABLE student_enrollments ADD COLUMN submission_source text NOT NULL DEFAULT 'ADMIN';
ALTER TABLE student_enrollments ADD COLUMN retention_until timestamptz;
ALTER TABLE student_enrollments ADD COLUMN embedding_cleanup_pending boolean NOT NULL DEFAULT false;
ALTER TABLE student_enrollments ADD COLUMN photos_purged_at timestamptz;

CREATE UNIQUE INDEX student_enrollments_one_pending_review
    ON student_enrollments (student_id)
    WHERE status = 'PENDING_REVIEW';
CREATE INDEX student_enrollments_review_queue_idx
    ON student_enrollments (status, created_at);
CREATE INDEX student_enrollments_retention_idx
    ON student_enrollments (retention_until)
    WHERE retention_until IS NOT NULL;

CREATE TABLE student_photo_submission_audit (
    id bigserial PRIMARY KEY,
    enrollment_id uuid NOT NULL REFERENCES student_enrollments(id),
    student_id uuid NOT NULL REFERENCES students(id),
    actor text NOT NULL,
    action text NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'CLEANUP_RETRIED')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);
