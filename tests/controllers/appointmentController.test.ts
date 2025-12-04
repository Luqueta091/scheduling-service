import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { setupTestDatabase, seedLockedReservation } from '../setup/testDb';

let app: import('express').Express;
let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;
let truncateAll: Awaited<ReturnType<typeof setupTestDatabase>>['truncateAll'];
let clearEventBus: Awaited<ReturnType<typeof setupTestDatabase>>['clearEventBus'];

describe('AppointmentController', () => {
  beforeAll(async () => {
    dbContext = await setupTestDatabase();
    truncateAll = dbContext.truncateAll;
    clearEventBus = dbContext.clearEventBus;
  });

  beforeEach(async () => {
    await truncateAll();
    await clearEventBus();
    const { createApp } = await import('../../src/app');
    app = createApp();
  });

  afterAll(async () => {
    await dbContext.stop();
  });

  afterEach(async () => {
    await truncateAll();
    await clearEventBus();
  });

  it('returns 201 when creating an appointment with valid payload', async () => {
    const start = new Date('2025-12-03T15:00:00Z');
    const end = new Date('2025-12-03T15:30:00Z');
    const { reservationToken } = await seedLockedReservation({
      start,
      end,
      unitId: 'a3d932ae-f23c-4ce5-9ed3-2f2eca4a0df8',
      serviceId: '5b6ad154-42d8-4a73-8c23-5ce77e9d0b74',
      barberId: 'e5a7b492-991a-4e54-892d-8c4191dcf689'
    });

    const response = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', reservationToken)
      .set('Idempotency-Key', 'test-key-1')
      .send({
        clientId: 'ef8730bd-8dbe-45b6-b5b4-2cb4c2ff01d8',
        unitId: 'a3d932ae-f23c-4ce5-9ed3-2f2eca4a0df8',
        serviceId: '5b6ad154-42d8-4a73-8c23-5ce77e9d0b74',
        barberId: 'e5a7b492-991a-4e54-892d-8c4191dcf689',
        start: start.toISOString(),
        reservationToken,
        origin: 'cliente'
      });

    expect(response.status).toBe(201);
    expect(response.body).toHaveProperty('appointmentId');
  });

  it('returns 422 for invalid payload', async () => {
    const response = await request(app).post('/agendamentos').send({});

    expect(response.status).toBe(422);
    expect(response.body.error).toBe('ValidationError');
  });

  it('returns 404 when appointment not found', async () => {
    const response = await request(app).get('/agendamentos/00000000-0000-0000-0000-000000000000');

    expect(response.status).toBe(404);
  });
});
