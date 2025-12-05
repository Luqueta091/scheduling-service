import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { beforeAll, afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setupTestDatabase } from '../setup/testDb';

let app: import('express').Express;
let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;

const UNIT_ID = randomUUID();
const SERVICE_ID = randomUUID();

async function seedTemplate(weekday: number) {
  const { getDb } = await import('@barbershop/shared');
  await getDb().query(
    `INSERT INTO availability_slot_templates (
      unit_id,
      service_id,
      weekday,
      start_time,
      end_time,
      slot_duration_minutes,
      buffer_minutes,
      capacity_per_slot
    ) VALUES ($1,$2,$3,'09:00:00','11:00:00',30,0,1)`,
    [UNIT_ID, SERVICE_ID, weekday]
  );
}

describe('Availability module', () => {
  beforeAll(async () => {
    dbContext = await setupTestDatabase();
  });

  afterAll(async () => {
    await dbContext.stop();
  });

  beforeEach(async () => {
    await dbContext.truncateAll();
    await dbContext.clearEventBus();
    await seedTemplate(new Date('2025-12-05T00:00:00Z').getUTCDay());
    const { createApp } = await import('../../src/app');
    app = createApp();
  });

  afterEach(async () => {
    await dbContext.truncateAll();
    await dbContext.clearEventBus();
  });

  it('lists availability slots for a unit/service/date', async () => {
    const response = await request(app)
      .get(`/units/${UNIT_ID}/availability`)
      .query({ serviceId: SERVICE_ID, date: '2025-12-05' });

    expect(response.status).toBe(200);
    expect(response.body.slots).toHaveLength(4);
    expect(response.body.slots[0]).toMatchObject({
      available: true,
      remainingCapacity: 1
    });
  });

  it('locks a slot and prevents double booking', async () => {
    const start = '2025-12-05T09:00:00.000Z';
    const end = '2025-12-05T09:30:00.000Z';

    const first = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start,
      end
    });

    expect(first.status).toBe(201);
    expect(first.body).toHaveProperty('reservationToken');

    const second = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start,
      end
    });

    expect(second.status).toBe(409);
  });

  it('releases a slot via API', async () => {
    const start = '2025-12-05T09:30:00.000Z';
    const lock = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start,
      end: '2025-12-05T10:00:00.000Z'
    });

    expect(lock.status).toBe(201);

    const release = await request(app).post('/slots/release').send({
      reservationToken: lock.body.reservationToken
    });

    expect(release.status).toBe(204);
  });
});
