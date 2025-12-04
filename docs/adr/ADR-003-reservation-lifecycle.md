# ADR 003 — Reservation lifecycle: confirmation clears expires_at

## Status
Proposed / Implemented

## Context
The Scheduling service uses a `reservations` table to hold temporary locks on slots (reservation_token). When a client confirms an appointment (createAppointment), we transition the reservation to a confirmed state and persist the appointment in `appointments`. The previous schema declared `reservations.expires_at` as NOT NULL. During confirmation the code sets `expires_at = NULL` to indicate it is no longer a temporary lock.

## Decision
We will make `reservations.expires_at` nullable. When a reservation is `locked`, `expires_at` must be a timestamp in the future. When a reservation is `confirmed`, `expires_at` may be `NULL`. This simplifies the confirmation flow and avoids having to set an arbitrary future value or keep the TTL after confirmation.

Implement the DB migration: `20251203_03_alter_reservations_nullable_expires.sql` (already added in migrations).

## Consequences
- Migrations must be applied **before** deploying the new service version (staging and production). CI must run `npm run migrate` as an explicit step before running the test/build/deploy pipelines.
- Consumers that query `reservations` must tolerate `expires_at IS NULL`.
- Monitoring/cleanup workers (that expire reservations) must only operate on reservations with non-null `expires_at` and status `locked`.

## Migration
Filename: `20251203_03_alter_reservations_nullable_expires.sql`  
Action: `ALTER TABLE reservations ALTER COLUMN expires_at DROP NOT NULL;` 

## Runbook / Deployment
1. Apply migration in staging. Run smoke tests.
2. Deploy new service. Verify `createAppointment` flows succeed and `expires_at` is null for confirmed reservations.
3. Monitor metrics: `appointments.created`, `locks.conflict`, `reservations.expired`.
4. After verification, deploy to production.

## Rollback
- If rollback needed, deploy previous code, ensure no `expires_at` = NULL values exist (backfill to a past timestamp is not acceptable). If rollback strictly required, coordinate with ops to stop traffic and run a migration to set `expires_at` to a safe value before reapplying the old schema — this is disruptive and must be avoided where possible.
