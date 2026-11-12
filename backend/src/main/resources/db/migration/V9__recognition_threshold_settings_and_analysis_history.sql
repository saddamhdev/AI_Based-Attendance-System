CREATE TABLE recognition_account_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    role text NOT NULL CHECK (role IN ('ADMIN', 'TEACHER')),
    username text NOT NULL,
    normalized_username text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (role, normalized_username)
);

INSERT INTO recognition_account_identities (role, username, normalized_username)
VALUES
    ('ADMIN', 'admin', 'admin'),
    ('TEACHER', 'teacher', 'teacher')
ON CONFLICT (role, normalized_username) DO NOTHING;

INSERT INTO recognition_account_identities (role, username, normalized_username)
SELECT 'TEACHER', username, lower(btrim(username))
FROM teacher_profiles
WHERE username IS NOT NULL AND btrim(username) <> ''
ON CONFLICT (role, normalized_username) DO NOTHING;

CREATE TABLE recognition_settings (
    account_id uuid PRIMARY KEY REFERENCES recognition_account_identities(id) ON DELETE CASCADE,
    threshold_percentage double precision NOT NULL
        CHECK (threshold_percentage >= 1 AND threshold_percentage <= 100),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE session_recognition_analyses (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    initiating_user_id uuid NOT NULL REFERENCES recognition_account_identities(id),
    threshold_percentage double precision NOT NULL
        CHECK (threshold_percentage >= 1 AND threshold_percentage <= 100),
    response jsonb NOT NULL,
    analyzed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_recognition_analyses_latest_idx
    ON session_recognition_analyses (session_id, analyzed_at DESC, id DESC);
