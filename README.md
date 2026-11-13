# AI_Based-Attendance-System

## Attendance AI settings

Administrators and teachers can configure their own minimum similarity threshold under **Attendance AI Settings**. The default is 70%; changes are stored per account and apply only to future photo analyses. Each review retains the threshold and user that produced its saved recognition results. Similarity is a comparison score, not an accuracy probability.
## Mobile app (Android & iOS)

A native Expo/React Native app lives in [`mobile/`](mobile/README.md). It uses the same Spring Boot API and
database; the phone never talks to Python or PostgreSQL directly. Mobile clients sign in with
`POST /api/auth/token` (bearer tokens, migration V10); the web app keeps using HTTP Basic. See
[docs/mobile-api-contracts.md](docs/mobile-api-contracts.md) for the audited API and the backend changes.
