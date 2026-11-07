# Validation performed

- Frontend: `npm install --ignore-scripts` and `npm run build` passed, including strict TypeScript checking and Vite production bundle.
- Python: all source files compile; seven unittest checks passed for service authentication, health response, malformed identifiers, idempotent embedding deletion, explicit missing-model failure, invalid image rejection, and valid PNG decoding.
- Backend Maven dependencies resolved using the workspace proxy. Compilation could not run: the environment has a Java runtime but no Java 21 javac compiler. Backend compilation and PostgreSQL integration remain unverified.
- Docker is unavailable here; Docker Compose startup and end-to-end browser/database integration were not run.
- ONNX files and consented face data were not provided, so actual detection/matching accuracy, multi-photo identity handling, and model inference were not verified.

## Checks to run locally
1. `docker compose build` (uses a complete Java 21 Maven image).
2. Start Compose and create admin students, course enrollment, and a teacher session.
3. Verify teacher cannot access another teacher's sessions; current local demo has one teacher account.
4. Verify a session containing an unconfirmed student cannot finalize.
5. Save two copies of the same draft; the second stale save must fail.
6. Finalize; subsequent save/recognize operations must fail.
7. Retry confirmation; it must return the same finalized session.
8. Test recognition with consented data including unknown, blurred, duplicate, and uncertain faces. Verify the candidate set contains only the session roster.
9. Compare the CSV against finalized session records.
10. Review the explicitly unfinished Prompt v2 requirements in README.md before extending or deploying.
