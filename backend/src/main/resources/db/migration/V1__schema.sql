CREATE TABLE students(id uuid PRIMARY KEY, name text NOT NULL, roll text UNIQUE NOT NULL, consent boolean NOT NULL DEFAULT false);
CREATE TABLE courses(id uuid PRIMARY KEY, name text NOT NULL, teacher text NOT NULL);
CREATE TABLE enrollments(course_id uuid REFERENCES courses, student_id uuid REFERENCES students, PRIMARY KEY(course_id, student_id));
CREATE TABLE sessions(id uuid PRIMARY KEY, course_id uuid REFERENCES courses, class_date date NOT NULL, status text NOT NULL DEFAULT 'DRAFT', version integer NOT NULL DEFAULT 0);
CREATE TABLE attendance(session_id uuid REFERENCES sessions, student_id uuid REFERENCES students, student_name text NOT NULL, roll text NOT NULL, state text NOT NULL DEFAULT 'UNCONFIRMED', PRIMARY KEY(session_id, student_id));
CREATE TABLE audit(id bigserial PRIMARY KEY, session_id uuid REFERENCES sessions, actor text NOT NULL, action text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
