# API contracts used by the mobile app

All mobile traffic goes to Spring Boot under `/api`. Spring Boot alone calls the Python
YuNet/SFace service (`AI_URL`, authenticated with the internal `X-Service-Key`) and PostgreSQL.
The mobile app never receives `AI_SERVICE_KEY`, database credentials, or storage paths.

## Audit summary (before mobile work)

| Area | Existing implementation | Mobile gap | Resolution |
|---|---|---|---|
| Authentication | HTTP Basic, stateless; web keeps the credential in memory | A phone must not persist a password | **Added** opaque bearer tokens (`/api/auth/token`, V10 `api_tokens`). Basic still works. |
| Authorization rule for staff APIs | `/api/**` allowed "any authenticated non-student" | A new restricted principal would have been treated as staff | **Changed** to explicit `ADMIN` or `TEACHER` (equivalent for existing roles). |
| Error responses | `anyRequest().denyAll()` also blocked the `/error` dispatch, so controller errors could arrive as a bare 401/403 | Mobile needs the real status and message | **Added** `ApiErrors` advice (JSON `{status, code, message}`), permitted the error dispatch, JSON 401/403 handlers, support reference IDs for unexpected 500s. |
| Pending applicant status | Public lookup with `reference` + `statusToken` | Spec asks for an authenticated, restricted status screen | **Added** applicant sign-in (role `APPLICANT`) and `/api/applicant/registration[/resubmit]`. |
| Face submission retries | `submissionId` was the enrollment id, but a retry after success re-staged and its cleanup could delete the successful enrollment's template/photos | Mobile retries after lost responses | **Fixed**: a known `submissionId` replays the stored outcome (`replayed: true`) and never re-stages. |
| Classroom photo errors | Python decode errors surfaced as a generic 500 | Per-photo feedback | **Added** `photoIndex` in Python `/recognize` errors; Spring maps to 422/503 problems. |
| Recording consent for an existing profile | Only possible at creation | Admin direct enrollment requires recorded consent | **Added** `POST /api/students/{id}/consent` (admin, record only). |
| Student CSV export | Called the paged query with size 10 000, which the page validator (max 200) rejected — export always failed | Students download their report | **Fixed** validation to allow the internal export size. |
| `DB_PASSWORD` | Hard-coded in `application.properties`; compose's variable was ignored | — | Now `${DB_PASSWORD:evan}` (same default). |

Everything else (registration, approval/rejection, direct creation, accounts, password reset,
face review, galleries, consent withdrawal, retention, offerings, assignments, substitutes,
sessions, drafts, confirmation, per-user thresholds, reports) was reused unchanged.

## Authentication

| Method | Path | Body | Result |
|---|---|---|---|
| POST | `/api/auth/token` | `{username, password, clientName?}` | `200 {accessToken, tokenType:"Bearer", expiresAt, role}`; `401 INVALID_CREDENTIALS`; `403 ACCOUNT_INACTIVE` (only after a correct password); `429 TOO_MANY_SIGN_IN_ATTEMPTS` |
| DELETE | `/api/auth/token` | — (bearer header) | `204`, idempotent revoke |
| GET | `/api/me` | — | `{username, role: ADMIN\|TEACHER\|STUDENT\|APPLICANT, mustChangePassword, studentId?, name?, roll?, registrationStatus?}` |
| PUT | `/api/account/password` | `{currentPassword, newPassword, confirmPassword}` | Students; revokes the account's other tokens |

Tokens: 32 random bytes, prefixed `att_`; only SHA-256 is stored. Lifetime `MOBILE_TOKEN_TTL_HOURS`
(default 168). Roles are re-derived on every request, so deactivation, archival, approval, and
password reset take effect immediately. Invalid/expired/revoked → `401 SESSION_EXPIRED`.
Admin password reset and deactivation revoke all of that student's tokens.

## Applicant (role `APPLICANT`, nothing else reachable)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/student-registrations` | Public. Creates `PENDING_APPROVAL`; a matching roll is recorded as a *candidate*, never claimed. |
| GET | `/api/applicant/registration` | Own request: status, details, rejection reason, `signInAgain` once approved. |
| POST | `/api/applicant/registration/resubmit` | Rejected only. `{name, roll, email, department?, batch?, newPassword?}`; username unchanged. |

## Student (role `STUDENT`, identity from the token)

`GET /api/student/dashboard?offeringId&fromDate&toDate`, `GET /api/student/courses`,
`GET /api/student/attendance?offeringId&fromDate&toDate&status&page&size`,
`GET /api/student/attendance.csv`, `GET|POST /api/student/faces` (multipart `images[]`, `consent`,
`submissionId`), `GET /api/student/faces/{enrollment}/photos[/{photo}[/thumbnail]]`,
`DELETE /api/student/faces/{enrollment}` (cancel pending), `DELETE /api/student/consent`.
Must-change-password accounts get `403 PASSWORD_CHANGE_REQUIRED` here.

Photo submission errors: `400 CONSENT_REQUIRED | PHOTO_COUNT_INVALID`, `409 PENDING_SUBMISSION_EXISTS |
SUBMISSION_ID_REUSED`, `422 FACE_PHOTO_VALIDATION_FAILED` with `photoErrors[{photoIndex (1-based), code, message}]`
(`NO_DETECTABLE_FACE`, `MULTIPLE_FACES`, `LOW_QUALITY`, `INVALID_IMAGE`, ...), `502` with `supportReferenceId`.

## Admin

Registrations: `GET /api/admin/student-registrations?status&search`, `POST .../{id}/approve {existingStudentId?}`,
`POST .../{id}/reject {reason}`. Students: `GET /api/students`, `POST /api/admin/students`,
`POST|PUT /api/students/{id}/account`, `POST /api/students/{id}/account/password-reset`,
`PUT /api/students/{id}/profile`, `POST /api/students/{id}/consent`, `DELETE /api/students/{id}` (archive if history),
`POST|GET|DELETE /api/students/{id}/faces`, `GET /api/students/{id}/faces/{photo}[/thumbnail]?enrollmentId`.
Face review: `GET /api/admin/face-submissions`, `GET .../{enrollment}/photos[/{photo}[/thumbnail]]`,
`POST .../{enrollment}/approve`, `POST .../{enrollment}/reject {reason}`. Academic: `/api/academic/courses`,
`/api/offerings`, `/api/teacher-profiles`, `/api/teacher-assignments`, `/api/offerings/{id}/students/{studentId}`.

## Staff (admin + teacher)

`GET /api/offerings`, `GET /api/offerings/{id}/students`, `GET|POST /api/sessions`
(`{offeringId, date, startTime, endTime, teacherId?, authorizeSubstitute?}`), `GET|PUT /api/sessions/{id}`
(`{version, states, sources}`; stale version → 409), `POST /api/sessions/{id}/confirm {version}` (idempotent once
finalized), `POST /api/sessions/{id}/recognize` (multipart 1–3 `images`; uses the caller's saved threshold;
`422` with `photoIndex`, `503 AI_TIMEOUT_OR_UNAVAILABLE | AI_MODEL_UNAVAILABLE`), `GET|PUT /api/me/recognition-settings`,
`GET /api/reporting[/options|/export-data|/export.csv]`. Session access follows the existing rules: owner with an
effective assignment, session-only substitute, owner of historical finalized sessions, or admin.
