import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

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
  const { createApp } = await import('../../src/app');
  app = createApp();
});

afterEach(async () => {
  await dbContext.truncateAll();
  await dbContext.clearEventBus();
});

describe('AuthController', () => {
  it('allows staff to login and refresh tokens', async () => {
    await seedStaffUser({
      email: 'barber@example.com',
      password: 'secret-pass',
      role: 'barbeiro'
    });

    const loginResponse = await request(app).post('/auth/login').send({
      email: 'barber@example.com',
      password: 'secret-pass'
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body).toHaveProperty('accessToken');
    expect(loginResponse.body.user.role).toBe('barbeiro');

    const refreshResponse = await request(app).post('/auth/refresh').send({
      refreshToken: loginResponse.body.refreshToken
    });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.accessToken).not.toBe(loginResponse.body.accessToken);
  });

  it('rejects invalid credentials', async () => {
    await seedStaffUser({
      email: 'admin@example.com',
      password: 'super-secret',
      role: 'admin'
    });

    const response = await request(app).post('/auth/login').send({
      email: 'admin@example.com',
      password: 'wrong'
    });

    expect(response.status).toBe(401);
  });

  it('protects barber-only endpoints', async () => {
    const { reservationToken } = await seedLockedReservation({
      start: new Date('2025-12-05T10:00:00Z'),
      end: new Date('2025-12-05T10:30:00Z'),
      unitId: 'ae5cbbc8-c0e3-4a40-9d51-f63b42b7f59d',
      serviceId: 'bd2a8704-5156-4ce6-8d0d-3d3139c1ec74'
    });

    const createResponse = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', reservationToken)
      .set('Idempotency-Key', 'auth-test')
      .send({
        clientId: '5a4ffd49-84a8-4cc4-8ea7-f2545e0ae8da',
        unitId: 'ae5cbbc8-c0e3-4a40-9d51-f63b42b7f59d',
        serviceId: 'bd2a8704-5156-4ce6-8d0d-3d3139c1ec74',
        start: new Date('2025-12-05T10:00:00Z').toISOString(),
        reservationToken,
        origin: 'cliente'
      });

    expect(createResponse.status).toBe(201);
    const appointmentId = createResponse.body.appointmentId;

    await seedStaffUser({
      email: 'barber-sec@example.com',
      password: 'barber-pass',
      role: 'barbeiro'
    });

    const barberLogin = await request(app).post('/auth/login').send({
      email: 'barber-sec@example.com',
      password: 'barber-pass'
    });

    const authorized = await request(app)
      .put(`/agendamentos/${appointmentId}/falta`)
      .set('Authorization', `Bearer ${barberLogin.body.accessToken}`)
      .send({ timestamp: new Date('2025-12-05T10:35:00Z').toISOString() });

    expect(authorized.status).toBe(200);

    await seedStaffUser({
      email: 'admin-only@example.com',
      password: 'admin-pass',
      role: 'admin'
    });

    const adminLogin = await request(app).post('/auth/login').send({
      email: 'admin-only@example.com',
      password: 'admin-pass'
    });

    const secondReservation = await seedLockedReservation({
      start: new Date('2025-12-06T10:00:00Z'),
      end: new Date('2025-12-06T10:30:00Z'),
      unitId: 'ae5cbbc8-c0e3-4a40-9d51-f63b42b7f59d',
      serviceId: 'bd2a8704-5156-4ce6-8d0d-3d3139c1ec74'
    });

    const secondCreate = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', secondReservation.reservationToken)
      .set('Idempotency-Key', 'auth-test-admin')
      .send({
        clientId: '0a1213fc-86f2-49ad-b2b8-2103c0185340',
        unitId: 'ae5cbbc8-c0e3-4a40-9d51-f63b42b7f59d',
        serviceId: 'bd2a8704-5156-4ce6-8d0d-3d3139c1ec74',
        start: new Date('2025-12-06T10:00:00Z').toISOString(),
        reservationToken: secondReservation.reservationToken,
        origin: 'cliente'
      });

    expect(secondCreate.status).toBe(201);
    const secondAppointmentId = secondCreate.body.appointmentId;

    const forbidden = await request(app)
      .put(`/agendamentos/${secondAppointmentId}/falta`)
      .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
      .send({ timestamp: new Date('2025-12-06T10:45:00Z').toISOString() });

    expect(forbidden.status).toBe(403);
  });
});
