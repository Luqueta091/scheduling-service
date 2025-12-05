import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { resetAllMetrics } from '@barbershop/shared';

import { setupTestDatabase, seedLockedReservation } from '../setup/testDb';
import { seedStaffUser } from '../setup/seedUsers';

let app: import('express').Express;
let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;

beforeAll(async () => {
  dbContext = await setupTestDatabase();
});

afterAll(async () => {
  await dbContext.stop();
});

beforeEach(async () => {
  await dbContext.truncateAll();
  await dbContext.clearEventBus();
  resetAllMetrics();
  const { createApp } = await import('../../src/app');
  app = createApp();
});

afterEach(async () => {
  await dbContext.truncateAll();
  await dbContext.clearEventBus();
});

describe('Metrics exposure', () => {
  it('increments domain counters and exposes trace headers', async () => {
    const baseReservation = await seedLockedReservation({
      start: new Date('2025-12-07T12:00:00Z'),
      end: new Date('2025-12-07T12:30:00Z'),
      unitId: '6e60757a-1efd-4525-90d3-2e68b31a7d1b',
      serviceId: '2b5171c7-4bcf-4144-b88b-7ffc2c6fd07c'
    });

    const createResponse = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', baseReservation.reservationToken)
      .set('Idempotency-Key', 'metrics-1')
      .send({
        clientId: 'd4b9354f-f096-4cce-81da-efa1c8f94f61',
        unitId: '6e60757a-1efd-4525-90d3-2e68b31a7d1b',
        serviceId: '2b5171c7-4bcf-4144-b88b-7ffc2c6fd07c',
        start: new Date('2025-12-07T12:00:00Z').toISOString(),
        reservationToken: baseReservation.reservationToken,
        origin: 'cliente'
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.headers).toHaveProperty('x-trace-id');
    expect(createResponse.headers).toHaveProperty('x-span-parent');
    expect(createResponse.headers).toHaveProperty('x-response-time');
    expect(Number.parseFloat(String(createResponse.headers['x-response-time']))).toBeGreaterThan(0);
    const appointmentId = createResponse.body.appointmentId;

    const duplicate = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', baseReservation.reservationToken)
      .set('Idempotency-Key', 'metrics-conflict')
      .send({
        clientId: 'd4b9354f-f096-4cce-81da-efa1c8f94f61',
        unitId: '6e60757a-1efd-4525-90d3-2e68b31a7d1b',
        serviceId: '2b5171c7-4bcf-4144-b88b-7ffc2c6fd07c',
        start: new Date('2025-12-07T12:00:00Z').toISOString(),
        reservationToken: baseReservation.reservationToken,
        origin: 'cliente'
      });

    expect(duplicate.status).toBe(409);

    const cancelResponse = await request(app)
      .put(`/agendamentos/${appointmentId}/cancel`)
      .send({ reason: 'client requested' });

    expect(cancelResponse.status).toBe(200);

    const secondReservation = await seedLockedReservation({
      start: new Date('2025-12-08T10:00:00Z'),
      end: new Date('2025-12-08T10:30:00Z'),
      unitId: '6e60757a-1efd-4525-90d3-2e68b31a7d1b',
      serviceId: '2b5171c7-4bcf-4144-b88b-7ffc2c6fd07c'
    });

    const secondCreate = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', secondReservation.reservationToken)
      .set('Idempotency-Key', 'metrics-2')
      .send({
        clientId: 'fd6537ec-8d35-48c9-8e50-03e1bd888f71',
        unitId: '6e60757a-1efd-4525-90d3-2e68b31a7d1b',
        serviceId: '2b5171c7-4bcf-4144-b88b-7ffc2c6fd07c',
        start: new Date('2025-12-08T10:00:00Z').toISOString(),
        reservationToken: secondReservation.reservationToken,
        origin: 'cliente'
      });

    expect(secondCreate.status).toBe(201);
    const secondAppointmentId = secondCreate.body.appointmentId;

    await seedStaffUser({
      email: 'metrics-barber@example.com',
      password: 'barber-secret',
      role: 'barbeiro'
    });

    const loginResponse = await request(app).post('/auth/login').send({
      email: 'metrics-barber@example.com',
      password: 'barber-secret'
    });

    expect(loginResponse.status).toBe(200);

    const noShowResponse = await request(app)
      .put(`/agendamentos/${secondAppointmentId}/falta`)
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .send({ timestamp: new Date('2025-12-08T10:45:00Z').toISOString() });

    expect(noShowResponse.status).toBe(200);

    const metricsResponse = await request(app).get('/metrics');
    expect(metricsResponse.status).toBe(200);
    const metricsText = metricsResponse.text;

    expect(metricsText).toMatch(/appointments_created_total\s+2/);
    expect(metricsText).toMatch(/appointments_cancelled_total\s+1/);
    expect(metricsText).toMatch(/appointments_no_show_total\s+1/);
    expect(metricsText).toMatch(/appointments_conflicts_total\s+1/);
    expect(metricsText).toMatch(/appointment_creation_duration_seconds_bucket/);
    expect(metricsText).toMatch(/slot_service_health/);
  });
});
