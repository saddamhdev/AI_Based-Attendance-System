# API Documentation (MVP)

Base URL: `http://localhost:8080/api`

## Auth
- `POST /auth/login` -> `{ token, role, username }`
- `GET /auth/me`

## Students
- `GET /students?q=` (ADMIN/TEACHER)
- `GET /students/{id}` (ADMIN/TEACHER)
- `POST /students` (ADMIN)
- `PUT /students/{id}` (ADMIN)

## Courses & Sections
- `GET /courses`
- `POST /courses` (ADMIN)
- `GET /courses/sections`
- `POST /courses/sections` (ADMIN)
- `POST /courses/enrollments` (ADMIN)
- `GET /courses/enrollments?sectionId=`
- `POST /courses/assignments` (ADMIN)

## Attendance
- `POST /attendance/sessions`
- `GET /attendance/sessions`
- `POST /attendance/sessions/{id}/photos` (multipart, field: `files`, 2-3 images)
- `GET /attendance/sessions/{id}/review`
- `PUT /attendance/sessions/{id}/records/{studentId}`
- `POST /attendance/sessions/{id}/confirm`
- `GET /attendance/sessions/{id}/audit`

## Reports
- `GET /reports/summary`

## Settings
- `GET /settings`
- `PUT /settings` (ADMIN)

## AI Service (`http://localhost:8000`)
- `GET /health`
- `POST /recognition/process`
- `POST /recognition/enrollment/quality`

### Important
`/recognition/process` currently uses a **demo heuristic matcher** and is explicitly not production-grade recognition.
