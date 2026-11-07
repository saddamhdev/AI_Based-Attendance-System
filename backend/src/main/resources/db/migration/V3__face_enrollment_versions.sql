CREATE TABLE student_enrollments(
    id uuid PRIMARY KEY,
    student_id uuid NOT NULL REFERENCES students(id),
    status text NOT NULL,
    accepted_photo_count integer,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    activated_at timestamptz
);
CREATE UNIQUE INDEX student_enrollments_one_active
    ON student_enrollments(student_id) WHERE status='ACTIVE';

CREATE TABLE enrollment_photos(
    id uuid PRIMARY KEY,
    enrollment_id uuid NOT NULL REFERENCES student_enrollments(id),
    storage_key text NOT NULL UNIQUE,
    thumbnail_key text NOT NULL UNIQUE,
    photo_index integer NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL
);
