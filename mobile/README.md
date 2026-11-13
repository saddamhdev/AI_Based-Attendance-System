# Attend — mobile app (Android & iOS)

Native React Native / Expo (SDK 58) / TypeScript app for the AI Attendance Management System.
It uses the **same Spring Boot backend and PostgreSQL database** as the web app. The phone talks
only to Spring Boot; Spring Boot calls the Python YuNet/SFace service internally. API contracts:
[../docs/mobile-api-contracts.md](../docs/mobile-api-contracts.md).

## Setup

Requirements: Node 20+ (tested with 22), the backend running, and either Expo Go / a development
build on a phone, the Android emulator (Android Studio), or the iOS simulator (Xcode, macOS only).

```bash
cd mobile
npm install            # .npmrc sets legacy-peer-deps (needed by the test tooling)
cp .env.example .env   # then set EXPO_PUBLIC_API_URL
npx expo start
```

### Backend address (`EXPO_PUBLIC_API_URL`)

The value is the Spring Boot origin **without** `/api`.

| Where the app runs | Value |
|---|---|
| Android emulator | `http://10.0.2.2:8080` (the emulator's alias for your computer) |
| iOS simulator | `http://localhost:8080` |
| Physical phone (same Wi-Fi) | `http://<computer LAN IP>:8080`, e.g. `http://192.168.0.10:8080` — **not** `localhost` |
| Production | `https://…` (required; plain HTTP is rejected when `APP_ENV=production`) |

For a physical phone the backend must listen on the LAN:
- `mvn spring-boot:run` in `backend/` already listens on all interfaces (port 8080); allow it through the firewall.
- With Docker: `docker compose -f compose.yaml -f compose.mobile.yaml up` publishes port 8080 (development only).
  Through the web container's nginx (`:3000/api`) also works if you publish that port beyond 127.0.0.1.

Restart `npx expo start` after changing `.env`. The sign-in screen shows the configured server and
warns when it is `localhost`.

`APP_ENV=development` allows `http://` LAN URLs (Android cleartext is enabled only for this
build type). `APP_ENV=production` enforces HTTPS.

## Running

- **Expo Go**: scan the QR code from `npx expo start`. All modules used are part of the Expo SDK.
- **Development build** (recommended for camera/photo testing): `npx expo run:android` / `npx expo run:ios`,
  or `npx eas-cli@latest build --profile development`.
- **Builds**: `npx eas-cli@latest build --profile preview --platform android` (installable APK) or
  `--profile production --platform ios|android`. Set `EXPO_PUBLIC_API_URL` to the HTTPS backend as an EAS
  environment variable for those profiles.

## Checks

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # expo lint
npm test               # jest (unit + hook tests)
npx expo-doctor
# End-to-end API contract check against a running backend on a DISPOSABLE database:
API_URL=http://localhost:8080 ADMIN_PASSWORD=... node scripts/verify-backend.mjs
```

`scripts/verify-backend.mjs` creates uniquely named teachers, courses, students, and sessions —
never point it at production data.

## How it works

- **Auth**: `POST /api/auth/token` returns an opaque bearer token stored only in the platform keystore
  (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Passwords are never persisted. On sign-out the token
  is revoked, and the query cache, in-memory photo selections, and private temp files are cleared. A 401 or the
  token's expiry signs the user out with an explanation.
- **Role navigation**: `src/app/_layout.tsx` uses `Stack.Protected` guards — applicant, must-change-password,
  student, and staff areas; admin-only screens are nested under an extra guard. The backend enforces every rule.
- **Photos** (`src/photos`): camera permission is requested only when "Take photo" is tapped; the gallery uses the
  system picker (no library permission). Each photo gets a stable client ID and is re-encoded with
  `expo-image-manipulator`: upright orientation, HEIC/WebP/PNG → JPEG, EXIF/GPS dropped, long edge capped
  (1600 px enrollment, 3072 px classroom, never upscaled). Preparation always settles or times out (20 s).
  Files live in the app-private cache and are deleted when no longer needed and on logout. Uploads send the
  file bytes as `multipart/form-data`; the HTTP client generates the boundary.
- **Stages** shown are real: Selected → Preparing preview → Preview ready → Uploading → server processing
  (the upload-complete event comes from XHR) → Pending review / Active / Action required / Failed.
- **Retries**: reads retry on network errors; state-changing requests never auto-retry. Face submissions reuse
  their `submissionId` after a lost response (the server replays the completed result). After a lost draft-save
  or confirmation response, the app re-reads the session before deciding.
- **Review** (`src/review`): `attendanceReview.ts` is the web module, byte-for-byte (a test enforces this), so
  auto-selection (inclusive `score >= threshold`, roster-only, no ambiguous matches), merging across photos, and
  preserving manual corrections behave exactly as on the web.

## Feature checklist

Legend: ✅ implemented against the real API · ⚠️ implemented, with a noted limitation · ❌ not implemented

**Authentication & registration**
- ✅ Sign in (admin, teacher, student, pending applicant), secure token storage, logout with revoke and private-data cleanup, expiry handling
- ✅ Student self-registration → `PENDING_APPROVAL`; restricted authenticated status screen; view rejection reason; correct and resubmit
- ✅ Admin approve/reject with reason; a matching roll requires explicit verified linking (never auto-claimed)
- ✅ Admin direct student creation (approved immediately), profile-only students, add account later, temporary password → forced change, password reset, deactivate/reactivate
- ⚠️ No refresh tokens: when a token expires (default 7 days) the user signs in again

**Student**
- ✅ Dashboard (profile, academic details, offerings/terms/sections/teachers, finalized counts, present/absent, overall and per-offering %, recent attendance, account and biometric status)
- ✅ My Courses; attendance history with offering, date-range, and status filters, pagination, "No finalized classes yet"
- ✅ CSV download via the share sheet; students cannot edit attendance
- ✅ Face photos: consent, camera + multi-select gallery, combine sources, preview, remove/replace/retake, 5–10 photos, per-photo errors, pending/active galleries, rejection reasons, resubmit, cancel pending, withdraw consent

**Admin**
- ✅ Dashboard; registration queue; face-submission review (enlarge, verify identity, approve/reject)
- ✅ Student management, record consent, direct enrollment with prominent name/roll, identity + consent confirmation, active gallery, delete face data, archive/delete
- ✅ Courses, offerings (create/archive/reactivate), teacher assignments (assign/end), offering enrollment/withdrawal, session creation with substitute authorization, session delete (drafts)
- ⚠️ Teacher management is list + create only (the backend has no teacher deactivate/reset endpoint)

**Teacher (and admin)**
- ✅ Assigned offerings, session creation (date, start/end time), authorized sessions incl. substitutes, draft review
- ✅ 1–3 classroom photos (camera/gallery) analyzed through Spring Boot with the caller's saved threshold (shown on screen); face boxes; zoom/pan; photo switching; face selection highlights the roster; synchronized totals; manual corrections; conflict flags; re-analysis keeps corrections; stale responses ignored; unsaved-vs-saved indicator; save draft; explicit confirmation only
- ⚠️ Face boxes for an analysis saved on an earlier visit need the same photos to be added again (the server does not store classroom photos; same as the web)
- ✅ Reports (course/session/student/detail; course, offering, teacher, session, date, time, student, status filters) with backend totals; CSV and PDF via the share sheet
- ⚠️ PDF is rendered on the device from `/api/reporting/export-data` (the backend has no PDF endpoint; the web prints in the browser)
- ✅ Personal recognition threshold settings

**Not done by design**: offline biometric caching, background uploads, editing finalized attendance.

## What was verified (and what was not)

Verified on the development machine (Windows):
- `tsc --noEmit`, `expo lint`, `expo-doctor` (20/20) — clean.
- Jest: 49 tests — API client (auth header, 401 → sign-out, uncertain-request handling, timeouts, sanitized errors,
  multipart/stages), photo rules and preparation (timeouts, late results, format/size validation, server error
  mapping), review logic (threshold isolation and inclusivity, merging, corrections, conflicts, stale responses,
  box alignment), secure token storage and logout cleanup, draft persistence and confirmation-retry handling.
- `expo export` for Android and iOS — both JavaScript bundles build.
- `scripts/verify-backend.mjs`: **61/61 checks** against the real Spring Boot backend + PostgreSQL (isolated
  schema) + the real Python service with the YuNet/SFace models, including registration/approval restrictions,
  ownership, multipart uploads with per-photo face validation, threshold isolation between two teachers, drafts,
  confirmation retry, reports, logout, and deactivation.

**Not verified**:
- **No Android or iOS device, emulator, or simulator was run** (no Android SDK or Xcode on this machine). Camera,
  gallery, image manipulation, secure storage, sharing, gestures, and layouts have not been exercised on a device.
- The **successful** face-enrollment and recognition paths were not exercised end to end: no consented face images
  were available, so only "no face detected" validation and zero-face classroom analysis were tested.
