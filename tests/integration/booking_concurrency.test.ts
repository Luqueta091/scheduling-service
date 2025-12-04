import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { getDb } from '@barbershop/shared';

import { setupTestDatabase, seedLockedReservation } from '../setup/testDb';

let app: import('express').Express;
let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;
let clearEventBus: Awaited<ReturnType<typeof setupTestDatabase>>['clearEventBus'];

beforeAll(async () => {
  dbContext = await setupTestDatabase();
  clearEventBus = dbContext.clearEventBus;
});

describe('Booking concurrency', () => {
  beforeEach(async () => {
    await dbContext.truncateAll();
    await clearEventBus();
    const { createApp } = await import('../../src/app');
    app = createApp();
  });

  afterAll(async () => {
    await dbContext.stop();
  });

  afterEach(async () => {
    await dbContext.truncateAll();
    await clearEventBus();
  });

  it('confirms only one appointment for the same reservation token under load and honors idempotency', async () => {
    const start = new Date('2025-12-03T15:00:00Z');
    const end = new Date('2025-12-03T15:30:00Z');
    const { reservationId, reservationToken } = await seedLockedReservation({
      start,
      end,
      unitId: 'f62e5d42-7b61-49da-8b44-64df61de708c',
      serviceId: '90b9f6d8-46f9-4f53-b91b-f2078fc9f2c1'
    });

    const payload = {
      clientId: 'f4e2d667-82d2-4aff-9f8e-4d27f698e9f3',
      unitId: 'f62e5d42-7b61-49da-8b44-64df61de708c',
      serviceId: '90b9f6d8-46f9-4f53-b91b-f2078fc9f2c1',
      start: start.toISOString(),
      reservationToken,
      origin: 'cliente' as const
    };

    const concurrentRequests = Array.from({ length: 20 }).map((_, index) => ({
      key: `concurrency-${index}`,
      call: request(app)
        .post('/agendamentos')
        .set('x-reservation-token', reservationToken)
        .set('Idempotency-Key', `concurrency-${index}`)
        .send(payload)
    }));

    const concurrentResponses = await Promise.allSettled(
      concurrentRequests.map(async ({ key, call }) => ({ key, response: await call }))
    );

    const successes = concurrentResponses.filter(
      (result): result is PromiseFulfilledResult<{ key: string; response: request.Response }> =>
        result.status === 'fulfilled' && result.value.response.status === 201
    );
    const conflicts = concurrentResponses.filter(
      (result): result is PromiseFulfilledResult<{ key: string; response: request.Response }> =>
        result.status === 'fulfilled' && result.value.response.status === 409
    );

    expect(successes.length).toBe(1);
    expect(conflicts.length + successes.length).toBe(20);

    const { key: successKey, response: successResponse } = successes[0].value;
    const appointmentId = successResponse.body.appointmentId;

    const repeat = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', reservationToken)
      .set('Idempotency-Key', successKey)
      .send(payload);

    expect(repeat.status).toBe(201);
    expect(repeat.body.appointmentId).toBe(appointmentId);

    const { rows } = await getDb().query<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM appointments WHERE reservation_id = $1',
      [reservationId]
    );

    expect(rows[0]?.total).toBe(1);

    const { rows: reservationRows } = await getDb().query<{ expires: Date | null }>(
      'SELECT expires_at AS expires FROM reservations WHERE id = $1',
      [reservationId]
    );

    expect(reservationRows[0]?.expires).toBeNull();
  });
});
