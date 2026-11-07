# Attend — AI-assisted attendance MVP

Three integrated source folders: `frontend/`, `backend/`, `python-service/`.
This is an MVP based on Prompt v2, not the complete production specification.

## Run
1. Install Docker Desktop with Compose (Windows: enable WSL2).
2. Copy `.env.example` to `.env`; replace all four passwords/keys.
3. Copy your two existing ONNX files into `python-service/models/`:
   - face_detection_yunet_2023mar.onnx
   - face_recognition_sface_2021dec.onnx
4. From this folder run `docker compose up --build`.
5. Open http://localhost:3000. Log in as `admin` or `teacher` with the corresponding configured password.
6. Admin: create students and record consent, enroll 5–10 photos, create a course/section and assign `teacher`, then enroll students into that course.
7. Teacher: create a dated session, upload 1–3 group photos, analyze, inspect overlays, apply suggested matches, manually review each student, save, and confirm.
8. Export finalized attendance from Reports.

No real student records, images, models, or embeddings are bundled. Without model files, all manual attendance features work and AI endpoints return 503.

## Data and behavior
PostgreSQL migrations run automatically. Session roster names/rolls are snapshots. Each student has at most one attendance record per session. Finalization locks the session and checks draft version and unresolved roster states. Finalized sessions are immutable in this MVP. CSV percentages count only finalized sessions containing the student. Audit captures draft state changes and confirmation.

AI comparisons use only consented students on the authorized session roster. Within-photo collisions are marked UNCERTAIN. Repeated matches across photos merge into one student suggestion. Recognition returns proposals and never writes final attendance. Photos and recognition results remain transient in the browser/request; save the attendance draft before navigating away. Scores are cosine similarities, not probabilities. Thresholds require local validation.

## Existing Python code
Original supplied files are preserved under `python-service/legacy/`. `core.py` reuses their YuNet/SFace detection, alignment, normalized embeddings, and matching. `app.py` adds roster-scoped matching, bounded uploads, exactly-one-face enrollment, atomic embedding saves, and internal authentication. Legacy scripts assume their old folder layout; they are reference copies, not the new service entry point.

To reuse existing embeddings, first create students in this system and explicitly map each old filename to the generated student UUID. Validate vector compatibility and copy only verified mappings to the biometric data volume as `<student_uuid>.npy`. Never infer student identity from display names. Re-enrollment through the UI is the supported simple path.

## Development
Frontend: `cd frontend && npm install && npm run dev` (Vite proxies localhost:8080).
Backend: Java 21 and Maven 3.9; set DATABASE_URL, DB_PASSWORD, ADMIN_PASSWORD, TEACHER_PASSWORD, AI_SERVICE_KEY, AI_URL; `mvn spring-boot:run`.
Python: Python 3.11; `pip install -r requirements.txt`; set AI_SERVICE_KEY, MODEL_DIR, DATA_DIR; `uvicorn app:app --port 8001`.
For development outside Compose, provide your own PostgreSQL instance. No database or AI port is published by Compose.

## API
All `/api` application endpoints require HTTP Basic authentication. Users are configured by environment and credentials are kept in frontend memory. The browser uses the same-origin Nginx proxy. Admin manages students/courses; teachers are restricted by course assignment. FastAPI is internal and requires `X-Service-Key`.
- GET /api/me, /api/courses, /api/sessions
- GET/POST /api/students (admin)
- POST /api/courses (admin)
- GET /api/courses/{id}/students
- POST /api/courses/{id}/students/{student} (admin)
- POST/DELETE /api/students/{id}/faces (admin; multipart `images` on POST)
- POST /api/sessions: {courseId,date}
- GET /api/sessions/{id}
- PUT /api/sessions/{id}: {version,states:{studentUUID:"PRESENT|ABSENT|UNCONFIRMED"}}
- POST /api/sessions/{id}/recognize: multipart `images`
- POST /api/sessions/{id}/confirm: {version}
- GET /api/reports.csv
Python OpenAPI: internal http://ai:8001/docs. Direct Python recognition receives multipart `images` and comma-separated `studentIds`; caller must be the trusted backend.

## Remaining Prompt v2 scope / limitations
- No student login, dynamic user management/password change, department/batch management, or separate section entity (use course/section names).
- No durable background queue, saved recognition evidence, processing progress, or persisted recognition jobs. Recognition is synchronous and runs in FastAPI's worker thread pool; retries recompute proposals. Backend session lock serializes same-session AI operations.
- Face correction UI lets teachers manually mark a roster student; there is no persisted face-to-student assignment or conflict-resolution ledger. Teachers must resolve uncertain detections before applying/finalizing roster decisions. Applying suggestions is an explicit teacher action.
- No finalized corrections, PDF export, date-filtered reports, bulk enrollment, automated retention, UI localization, or biometric configuration screen.
- No encryption-at-rest setup: configure encrypted host volumes and backups. Consent metadata is a boolean, not a signed consent document. Photos are not retained by the service; embeddings persist until deleted.
- Before public deployment add HTTPS, rate limits, managed identity, secret rotation, durable jobs, retention workflows, biometric consent evidence, operational monitoring, dependency/security review, and meaningful consented recognition validation.
- Authentication is a local MVP with two environment-configured accounts. Keep the default localhost-only binding; never expose HTTP Basic publicly without TLS.

## Verification
See VALIDATION.md for checks performed and checks that could not run in the generation environment.
