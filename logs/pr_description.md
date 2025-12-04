# Stabilize test suite & finalize DB-backed Scheduling (feature/scheduling-db-fix)

## Summary
This PR finalizes the DB-backed Scheduling service and stabilizes the test-suite. The main changes:
- `DbAppointmentService` + `PostgresAppointmentRepository` with locking and idempotency.
- Migrations: `reservations`, `appointments`, `idempotency_keys` and `20251203_03_alter_reservations_nullable_expires.sql`.
- Test isolation: `createApp()` factory, deterministic Vitest config, `truncateAll()` and `eventbus.clearAllSubscribers()` in test setup.
- Temporary debug logs used during triage have been removed.

## Evidence
- Full test-suite (deterministic) log: `./logs/full-test-suite.log` 
- Concurrency test log: `./logs/concurrency-test.log` 
- Zipped evidence: `./logs/scheduling_evidence.zip` 

## Checklist (must pass before merge)
- [ ] `npm run test:ci` passes (deterministic, single-thread).
- [ ] `npm run test:concurrency` passes (1×201 + 19×409).
- [ ] Debug logs removed.
- [ ] ADR added: `docs/adr/ADR-003-reservation-lifecycle.md`.
- [ ] CI pipeline updated to apply migrations before tests.

## Context
Business context: `/mnt/data/documento_contexto_negocio.md`  
WindSurf tasks import file: `/mnt/data/windsurf_import.yaml` 

## How to reproduce locally
```bash
export TEST_USE_LOCAL_DB=true
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/scheduling_test
npm run migrate
npm run build
npm run test:ci
npm run test:concurrency
```
