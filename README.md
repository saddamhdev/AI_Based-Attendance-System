# AI-Based Attendance System (MVP)

A full-stack MVP for AI-assisted student attendance with explicit teacher review and confirmation.

## Stack
- **Frontend:** React + TypeScript + Tailwind + shadcn-style UI components + Lucide icons
- **Backend:** Spring Boot, Spring Security, JPA, Flyway
- **AI Service:** FastAPI + OpenCV (demo heuristic; not production-grade recognition)
- **Database:** PostgreSQL
- **Local runtime:** Docker Compose

## Key Workflow
1. Teacher logs in and creates a **draft attendance session**.
2. Teacher uploads **2–3 classroom photos**.
3. Backend sends processing request to AI service, constrained to **enrolled students only**.
4. AI suggestions populate draft roster (`PROPOSED_PRESENT`, `PROPOSED_ABSENT`, `REVIEW_REQUIRED`).
5. Teacher manually reviews/edits and then **explicitly confirms**.
6. Attendance is finalized and audit entries are recorded.

> AI suggestions are drafts. Review before confirming.

## Demo Accounts
Password for all demo users: `Password@123`
- Admin: `admin`
- Teacher: `teacher1`
- Student: `student1`

## Run with Docker Compose
```bash
cp .env.example .env
docker compose up --build
```

Apps:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8080
- AI service: http://localhost:8000

## Local Development
### Backend
```bash
cd backend
mvn spring-boot:run
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### AI Service
```bash
cd ai-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## Deliverables Covered
- Working responsive frontend with role-aware navigation
- Spring Boot backend with JWT auth and role-based endpoint controls
- FastAPI recognition service (demo heuristic + image quality validation)
- PostgreSQL migration (`backend/src/main/resources/db/migration/V1__init.sql`)
- Docker Compose environment
- `.env.example` (no secrets)
- API documentation in `docs/API.md`
- Demo data without real biometric data
- Tests for access control, duplicate prevention, merge de-duplication, and final confirmation rules

## Notes
- Recognition in this MVP is intentionally labeled as **demo heuristic** and is not a calibrated production model.
- Unknown/unmatched faces are not auto-identified or registered.
- Manual attendance remains fully usable when AI processing is unavailable.
