# Validation performed

- Frontend: `npm run build` passed, including TypeScript checking and the Vite production bundle.
- Frontend tests: `npm run test:review` passed all six recognition/review workflow tests.
- Backend: `mvn -q test` passed, including academic management and report authorization/filter tests.
- Python: `python -m unittest discover -s tests -v` passed all nine biometric service tests. Pylance syntax checks passed for `app.py`, `core.py`, and `tests/test_service.py`.
- `git diff --check` passed.

## Not validated here

- Flyway V6/V7 were not executed against a disposable PostgreSQL database. The test suite uses H2 and does not exercise PostgreSQL-specific migration triggers.
- Docker Compose and end-to-end browser/database integration were not run because Docker is unavailable.
- ONNX models and consented face data were not provided, so real-world detection accuracy and model inference were not verified.

## Additional local checks

1. Apply migrations against a disposable PostgreSQL database and verify the legacy backfill preserves attendance totals and saved session rosters.
2. With two teacher accounts, verify offering assignment access, session-only substitute access, historical attribution, and unauthorized session denial.
3. Exercise course/offering archive and reactivation, teacher-account login, assignment date overlap, and offering enrollment workflows in the UI.
4. Verify report previews and CSV/PDF print exports agree under combined filters and status selection.
