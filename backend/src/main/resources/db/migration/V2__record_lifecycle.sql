ALTER TABLE students ADD COLUMN archived boolean NOT NULL DEFAULT false;
ALTER TABLE courses ADD COLUMN archived boolean NOT NULL DEFAULT false;

CREATE TABLE administrative_deletions(
    id bigserial PRIMARY KEY,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    actor text NOT NULL,
    action text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
