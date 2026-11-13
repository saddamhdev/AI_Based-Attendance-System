-- Opaque bearer tokens for native clients (mobile). HTTP Basic used by the web
-- client remains supported. Only a SHA-256 hash of each token is stored.
CREATE TABLE api_tokens (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    principal_kind text NOT NULL CHECK (principal_kind IN ('ACCOUNT', 'APPLICANT')),
    username text NOT NULL,
    normalized_username text NOT NULL,
    registration_request_id uuid REFERENCES student_registration_requests(id) ON DELETE CASCADE,
    client_name text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_used_at timestamptz,
    revoked_at timestamptz,
    CHECK ((principal_kind = 'APPLICANT') = (registration_request_id IS NOT NULL)),
    CHECK (expires_at > created_at)
);

CREATE INDEX api_tokens_active_user_idx
    ON api_tokens (normalized_username)
    WHERE revoked_at IS NULL;

CREATE INDEX api_tokens_expiry_idx
    ON api_tokens (expires_at);
