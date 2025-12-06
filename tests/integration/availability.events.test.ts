import { randomUUID } from 'node:crypto';

import express from 'express';
import request from 'supertest';
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it
} from 'vitest';

import type { IEventBus } from '@barbershop/shared';
import { SLOT_LOCKED_EVENT, SLOT_RELEASED_EVENT, getDb } from '@barbershop/shared';

import { AvailabilityService } from '../../src/modules/availability/application/availabilityService';
import { createAvailabilityRouter } from '../../src/modules/availability/http/availabilityController';
import { setupTestDatabase } from '../setup/testDb';

class RecordingEventBus implements IEventBus {
  public readonly events: Array<{ name: string; payload: unknown }> = [];
  public readonly attempts: string[] = [];

  constructor(private readonly shouldFail = false) {}

  async publish<T>(eventName: string, payload: T): Promise<void> {
    this.attempts.push(eventName);
    if (this.shouldFail) {
      throw new Error('injected publish failure');
    }
    this.events.push({ name: eventName, payload });
  }
}

const UNIT_ID = randomUUID();
const SERVICE_ID = randomUUID();

async function seedTemplate(weekday: number) {
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

function buildApp(bus: RecordingEventBus) {
  const app = express();
  app.use(express.json());
  const service = new AvailabilityService(bus);
  app.use(createAvailabilityRouter(service));
  return app;
}

describe('Availability events integration', () => {
  let dbContext: Awaited<ReturnType<typeof setupTestDatabase>>;
  let weekday: number;

  beforeAll(async () => {
    dbContext = await setupTestDatabase();
    weekday = new Date('2025-12-05T00:00:00Z').getUTCDay();
  });

  afterAll(async () => {
    await dbContext.stop();
  });

  beforeEach(async () => {
    await dbContext.truncateAll();
    await dbContext.clearEventBus();
    await seedTemplate(weekday);
  });

  afterEach(async () => {
    await dbContext.truncateAll();
    await dbContext.clearEventBus();
  });

  it('emits slot.locked when a slot is reserved', async () => {
    const eventBus = new RecordingEventBus();
    const app = buildApp(eventBus);

    const start = '2025-12-05T09:00:00.000Z';
    const lockResponse = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start,
      end: '2025-12-05T09:30:00.000Z'
    });

    expect(lockResponse.status).toBe(201);
    expect(eventBus.events).toHaveLength(1);
    const event = eventBus.events[0];
    expect(event.name).toBe(SLOT_LOCKED_EVENT);
    expect(event.payload).toMatchObject({
      reservationToken: lockResponse.body.reservationToken,
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      date: '2025-12-05',
      startTime: '09:00',
      endTime: '09:30',
      capacityTotal: 1,
      capacityUsed: 1
    });
  });

  it('emits slot.released after manual release', async () => {
    const eventBus = new RecordingEventBus();
    const app = buildApp(eventBus);

    const lock = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start: '2025-12-05T09:30:00.000Z',
      end: '2025-12-05T10:00:00.000Z'
    });

    expect(lock.status).toBe(201);

    const release = await request(app).post('/slots/release').send({
      reservationToken: lock.body.reservationToken
    });

    expect(release.status).toBe(204);
    expect(eventBus.events).toHaveLength(2);
    const releasedEvent = eventBus.events[1];
    expect(releasedEvent.name).toBe(SLOT_RELEASED_EVENT);
    expect(releasedEvent.payload).toMatchObject({
      reservationToken: lock.body.reservationToken,
      reason: 'manual',
      capacityUsed: 0,
      capacityTotal: 1
    });
  });

  it('continues request flow when broker publish fails', async () => {
    const failingBus = new RecordingEventBus(true);
    const app = buildApp(failingBus);

    const response = await request(app).post('/slots/lock').send({
      unitId: UNIT_ID,
      serviceId: SERVICE_ID,
      start: '2025-12-05T10:00:00.000Z',
      end: '2025-12-05T10:30:00.000Z'
    });

    expect(response.status).toBe(201);
    expect(failingBus.attempts).toContain(SLOT_LOCKED_EVENT);
    expect(failingBus.events).toHaveLength(0);
  });
});
