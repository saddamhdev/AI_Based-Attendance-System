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
6. Students may submit a self-registration request from the login screen. An admin reviews it in **Student Requests**; account approval does not grant biometric consent.
7. Admin: add students and consent, review submitted face photos in **Face Reviews**, then use **Academic Setup** to create reusable catalog courses, term/batch/section offerings, teacher assignments, and offering enrollments.
8. Admin or an assigned teacher: create a class session from its offering with a class date and start/end times; the responsible teacher is selected from the effective assignment. Review and explicitly confirm attendance.
9. Export finalized attendance from Reports.

No real student records, images, models, or embeddings are bundled. Without model files, all manual attendance features work and AI endpoints return 503.

## Data and behavior
PostgreSQL migrations run automatically. V6 adds reusable catalog courses, course offerings, teacher profiles/assignments, offering enrollments, and session-level teacher attribution. V7 adds a BCrypt password hash for teacher profiles created through the admin workspace. Each existing course gets one clearly labeled `Legacy (unknown)` offering; an opaque `LEGACY-<uuid>` course code is generated only because no original code was stored. Existing course enrollments are copied to that offering. Existing sessions are linked to it without changing attendance or roster rows, and their actual teacher remains explicitly unknown. Historical term, year, batch, section, and class times stay unknown/null rather than being inferred. Finalized report denominators continue to use saved session rosters. New sessions require a responsible teacher and actual start/end times, and same-day exact duplicates are rejected while overlapping sessions warn. Dates and times shown to users use Asia/Dhaka.

Offering enrollments have history. Creating a session snapshots the students currently enrolled in that offering; later enrollment changes do not modify that roster. Teacher assignment changes are recorded as effective-dated history and do not rewrite session teacher attribution. Admins can add teacher accounts from Teacher Assignments; new credentials are stored as BCrypt hashes and authentication is backed by the active teacher profile. The existing `admin` and `teacher` environment-configured logins remain compatible. A teacher sees sessions attributed to their account or sessions for which they have a session-only substitute authorization; an offering assignment does not expose another teacher's historical sessions. Reports filter by the teacher recorded on the session. Report exports are bounded to 10,000 rows, and paged results to 200 rows per request.

Student self-registration creates a pending application, not an active login. The applicant receives a private reference and status token for checking the request; an administrator must approve it and explicitly link any matching existing student profile. Admin-created accounts are also supported from the **Students** page. Student accounts authenticate independently from admin/teacher accounts and must change temporary passwords at first login. The student portal exposes only the signed-in student's offering enrollments and finalized attendance history.

Biometric enrollment is a separate, optional consent workflow. Students submit 5–10 photos from **My Face Photos**; the Python service stages embeddings, which remain inactive until an admin verifies identity and approves the submission in **Face Reviews**. Pending submissions can be cancelled and consent can be withdrawn; cleanup failures are surfaced and queued for retry. Rejected applications and rejected, cancelled, or retired photo submissions are scheduled for deletion after 90 days. The V8 migration adds account, registration, and review metadata without rewriting existing attendance. Registration/status rate limiting is currently in-memory per application instance, so it resets on restart and is not shared across replicas.

AI comparisons use only consented students on the authorized session roster. The face dropdowns and roster draft automatically select `MATCHED` detections whose raw cosine similarity is strictly greater than `AUTO_SELECT_THRESHOLD` (default `0.70`). Ambiguous and within-photo identity conflicts require review; repeated matches across photos count as present once. AI and teacher attendance sources are tracked separately in the draft. Similarity is not an accuracy probability. Recognition returns proposals and never finalizes attendance. Set `VITE_AUTO_SELECT_THRESHOLD` in `frontend/.env` to configure the threshold when building the frontend. Enrollment photos are normalized to JPEG and stored privately in `ENROLLMENT_PHOTO_DIR`; PostgreSQL stores generated enrollment/photo metadata and storage keys. The backend serves thumbnails and full images through authenticated no-store endpoints, and only admins can view them. Re-enrollment stages a versioned Python embedding and photo set before activating it; the prior active version remains usable if replacement fails. Configure encrypted volume backups and a retention policy before production use.

## Existing Python code
Original supplied files are preserved under `python-service/legacy/`. `core.py` reuses their YuNet/SFace detection, alignment, normalized embeddings, and matching. `app.py` adds roster-scoped matching, bounded uploads, exactly-one-face enrollment, atomic embedding saves, and internal authentication. Legacy scripts assume their old folder layout; they are reference copies, not the new service entry point.

To reuse existing embeddings, first create students in this system and explicitly map each old filename to the generated student UUID. Validate vector compatibility and copy only verified mappings to the biometric data volume as `<student_uuid>.npy`. Never infer student identity from display names. Re-enrollment through the UI is the supported simple path.

## Development
Frontend: copy `frontend/.env.example` to `frontend/.env`, optionally change `VITE_AUTO_SELECT_THRESHOLD`, then run `cd frontend && npm install && npm run dev` (Vite proxies localhost:8080). The setting is a Vite build-time value.
Backend: Java 21 and Maven 3.9; set DATABASE_URL, DB_PASSWORD, ADMIN_PASSWORD, TEACHER_PASSWORD, AI_SERVICE_KEY, AI_URL; `mvn spring-boot:run`.
Python: Python 3.11; `pip install -r requirements.txt`; set AI_SERVICE_KEY, MODEL_DIR, DATA_DIR; `uvicorn app:app --port 8001`.
For development outside Compose, provide your own PostgreSQL instance. No database or AI port is published by Compose.

## API
All `/api` application endpoints require HTTP Basic authentication except the student registration submission/status/resubmission endpoints. The `admin` and `teacher` accounts remain environment-configured; other teacher credentials are verified against active database profiles. Admin creates teacher profiles and initial passwords in the Academic Setup workspace. The browser uses the same-origin Nginx proxy. Admin manages courses, offerings, assignments, and enrollment; teachers are restricted to their effective assignments and session attribution. FastAPI is internal and requires `X-Service-Key`.
- POST /api/student-registrations, POST /api/student-registrations/status, POST /api/student-registrations/resubmit (public account application and token-authenticated status/resubmission)
- GET /api/admin/student-registrations, POST /api/admin/student-registrations/{id}/approve, POST /api/admin/student-registrations/{id}/reject (admin review)
- POST /api/admin/students, POST/PUT /api/students/{id}/account, POST /api/students/{id}/account/password-reset, PUT /api/students/{id}/profile (admin student/account management)
- PUT /api/account/password, GET /api/student/courses, GET /api/student/dashboard, GET /api/student/attendance, GET /api/student/attendance.csv (student-scoped)
- POST /api/student/faces, GET /api/student/faces, DELETE /api/student/faces/{enrollmentId}, DELETE /api/student/consent (student biometric-consent workflow)
- GET /api/admin/face-submissions, POST /api/admin/face-submissions/{id}/approve, POST /api/admin/face-submissions/{id}/reject (admin face-photo review)
- GET /api/me, /api/courses, /api/sessions
- GET/POST /api/students (admin)
- GET/POST /api/academic/courses (admin; catalog course code and title)
- POST /api/academic/courses/{id}/archive and `/activate` (admin)
- GET/POST /api/offerings (admin create; assigned teachers may view)
- GET /api/offerings?includeArchived=true (admin)
- POST /api/offerings/{id}/archive and `/activate` (admin)
- GET /api/offerings/{id}/students (admin or assigned teacher)
- POST/DELETE /api/offerings/{id}/students/{studentId} (admin)
- GET/POST /api/teacher-profiles, GET/POST /api/teacher-assignments (admin; profile creation sets an initial password)
- POST /api/teacher-assignments/{id}/end (admin; effective date)
- POST /api/offerings/{id}/archive (admin)
- POST/DELETE /api/students/{id}/faces (admin; multipart `images` on POST)
- POST /api/sessions: {offeringId,teacherId?,authorizeSubstitute?,date,startTime,endTime}; exact duplicates are rejected, and only admins can select another teacher or authorize a session-only substitute
- GET /api/sessions/{id}
- PUT /api/sessions/{id}: {version,states:{studentUUID:"PRESENT|ABSENT|UNCONFIRMED"},sources:{studentUUID:"NONE|AI|MANUAL"}}
- POST /api/sessions/{id}/recognize: multipart `images`
- POST /api/sessions/{id}/confirm: {version}
- GET /api/reports.csv
- GET /api/reporting/options?courseId=&offeringId=&term=&batch=&section=&teacherId=&fromDate=&toDate=&fromTime=&toTime=
- GET /api/reporting?type=COURSE|SESSION|STUDENT|DETAIL&courseId=&offeringId=&term=&batch=&section=&teacherId=&sessionId=&fromDate=&toDate=&fromTime=&toTime=&student=&status=&page=&size=&sort=&direction=
- GET /api/reporting/export.csv (same report filters; bounded to 10,000 rows)
- GET /api/reporting/export-data (all matching rows for print/PDF; bounded to 10,000 rows)
Python OpenAPI: internal http://ai:8001/docs. Direct Python recognition receives multipart `images` and comma-separated `studentIds`; caller must be the trusted backend.

## Remaining Prompt v2 scope / limitations
- No teacher password-change/reset workflow, separate department/batch/section catalog, or admin UI to deactivate teacher accounts. New teacher accounts use a minimum 12-character initial password and must be reset operationally if lost.
- No durable background queue, saved recognition evidence, processing progress, or persisted recognition jobs. Recognition is synchronous and runs in FastAPI's worker thread pool; retries recompute proposals. Backend session lock serializes same-session AI operations.
- Face correction UI allows manual face-to-student assignment, but does not persist a separate conflict-resolution ledger. Teachers must resolve uncertain detections and review all attendance before confirmation.
- No finalized corrections, bulk enrollment, UI localization, or biometric configuration screen. Reports include paginated summaries and CSV; PDF is produced through the browser print dialog using the full filtered export.
- No encryption-at-rest setup: configure encrypted host volumes and backups. Consent metadata is a boolean, not a signed consent document. Photos are not retained by the service; embeddings persist until deleted.
- Before public deployment add HTTPS, rate limits, managed identity, secret rotation, durable jobs, retention workflows, biometric consent evidence, operational monitoring, dependency/security review, and meaningful consented recognition validation.
- Authentication is a local MVP with two environment-configured accounts. Keep the default localhost-only binding; never expose HTTP Basic publicly without TLS.

## Verification
See VALIDATION.md for checks performed and checks that could not run in the generation environment.
