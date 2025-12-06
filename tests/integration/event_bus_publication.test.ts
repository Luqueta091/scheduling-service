import request from 'supertest';
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from 'vitest';

import { getEventBus } from '@barbershop/shared';

import { setupTestDatabase, seedLockedReservation } from '../setup/testDb';
import { seedStaffUser } from '../setup/seedUsers';

let app: import('express').Express;
let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;
const eventBus = getEventBus();
let unsubscribeAll: Array<() => void> = [];

beforeAll(async () => {
  dbContext = await setupTestDatabase();
});

afterAll(async () => {
  await dbContext.stop();
});

afterEach(async () => {
  await dbContext.truncateAll();
  await dbContext.clearEventBus();
  unsubscribeAll.forEach((fn) => fn());
  unsubscribeAll = [];
});

describe('Event bus publications', () => {
  beforeEach(async () => {
    await dbContext.truncateAll();
    await dbContext.clearEventBus();
    const { createApp } = await import('../../src/app');
    app = createApp();
  });

  it('publishes appointment lifecycle events', async () => {
    const received = {
      AppointmentCreated: [] as Array<{ appointmentId: string }>,
      AppointmentCancelled: [] as Array<{ appointmentId: string }>,
      AppointmentNoShow: [] as Array<{ appointmentId: string; markedBy?: string }>
    };

    const unsubCreated =
      (await eventBus.subscribe?.('appointment.created', async (payload) => {
        received.AppointmentCreated.push(payload as { appointmentId: string });
      })) ?? (() => {});
    const unsubCancelled =
      (await eventBus.subscribe?.('appointment.cancelled', async (payload) => {
        received.AppointmentCancelled.push(payload as { appointmentId: string });
      })) ?? (() => {});
    const unsubNoShow =
      (await eventBus.subscribe?.('appointment.no_show', async (payload) => {
        received.AppointmentNoShow.push(
          payload as { appointmentId: string; markedBy?: string; actorRole?: string }
        );
      })) ?? (() => {});

    unsubscribeAll.push(unsubCreated, unsubCancelled, unsubNoShow);

    const baseReservation = await seedLockedReservation({
      start: new Date('2025-12-03T15:00:00Z'),
      end: new Date('2025-12-03T15:30:00Z'),
      unitId: 'd7a6821c-9887-477d-8b3c-77c12ea63c50',
      serviceId: '097c9b59-20b4-4560-8bfc-58baa6e88951'
    });

    const createResponse = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', baseReservation.reservationToken)
      .set('Idempotency-Key', 'evbus-1')
      .send({
        clientId: '9b769119-4d1e-4c6f-870f-31d7f6cf54a9',
        unitId: 'd7a6821c-9887-477d-8b3c-77c12ea63c50',
        serviceId: '097c9b59-20b4-4560-8bfc-58baa6e88951',
        start: new Date('2025-12-03T15:00:00Z').toISOString(),
        reservationToken: baseReservation.reservationToken,
        origin: 'cliente'
      });

    expect(createResponse.status).toBe(201);
    const appointmentId = createResponse.body.appointmentId;

    expect(received.AppointmentCreated.length).toBe(1);
    expect(received.AppointmentCreated[0]?.appointmentId).toBe(appointmentId);

    const cancelResponse = await request(app)
      .put(`/agendamentos/${appointmentId}/cancel`)
      .send({ reason: 'client-cancelled' });
    expect(cancelResponse.status).toBe(200);
    expect(received.AppointmentCancelled.length).toBe(1);
    expect(received.AppointmentCancelled[0]?.appointmentId).toBe(appointmentId);

    const secondReservation = await seedLockedReservation({
      start: new Date('2025-12-04T15:00:00Z'),
      end: new Date('2025-12-04T15:30:00Z'),
      unitId: 'd7a6821c-9887-477d-8b3c-77c12ea63c50',
      serviceId: '097c9b59-20b4-4560-8bfc-58baa6e88951'
    });

    const createSecond = await request(app)
      .post('/agendamentos')
      .set('x-reservation-token', secondReservation.reservationToken)
      .set('Idempotency-Key', 'evbus-2')
      .send({
        clientId: '3a72f4cb-5a1a-44ec-8ddb-62bb1a1d6b9d',
        unitId: 'd7a6821c-9887-477d-8b3c-77c12ea63c50',
        serviceId: '097c9b59-20b4-4560-8bfc-58baa6e88951',
        start: new Date('2025-12-04T15:00:00Z').toISOString(),
        reservationToken: secondReservation.reservationToken,
        origin: 'cliente'
      });

    expect(createSecond.status).toBe(201);
    const secondAppointmentId = createSecond.body.appointmentId;
    expect(received.AppointmentCreated.length).toBe(2);

    await seedStaffUser({
      email: 'barber@example.com',
      password: 'strong-password',
      role: 'barbeiro'
    });

    const login = await request(app).post('/auth/login').send({
      email: 'barber@example.com',
      password: 'strong-password'
    });

    expect(login.status).toBe(200);
    const accessToken = login.body.accessToken as string;

    const noShowResponse = await request(app)
      .put(`/agendamentos/${secondAppointmentId}/falta`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ timestamp: new Date('2025-12-04T15:45:00Z').toISOString() });

    expect(noShowResponse.status).toBe(200);
    expect(received.AppointmentNoShow.length).toBe(1);
    expect(received.AppointmentNoShow[0]?.appointmentId).toBe(secondAppointmentId);
    expect(received.AppointmentNoShow[0]?.markedBy).toBe('barbeiro');
  });
});
