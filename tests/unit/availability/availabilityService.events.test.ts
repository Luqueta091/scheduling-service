import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { IEventBus } from '@barbershop/shared';
import { SLOT_LOCKED_EVENT, SLOT_RELEASED_EVENT } from '@barbershop/shared';

const sharedMocks = vi.hoisted(() => {
  const fakeClient = { query: vi.fn() };
  const metrics = {
    lockAttempts: { inc: vi.fn() },
    lockSuccess: { inc: vi.fn() },
    lockConflicts: { inc: vi.fn() },
    lockExpired: { inc: vi.fn() }
  };
  const logger = {
    warn: vi.fn(),
    info: vi.fn(),
    withContext: () => ({ info: vi.fn() })
  };

  return {
    fakeClient,
    metrics,
    logger
  };
});

vi.mock('@barbershop/shared', () => {
  const { fakeClient, metrics, logger } = sharedMocks;
  class ValidationError extends Error {}
  class ConflictError extends Error {}

  const SLOT_LOCKED_EVENT = 'slot.locked';
  const SLOT_RELEASED_EVENT = 'slot.released';

  return {
    ValidationError,
    ConflictError,
    SLOT_LOCKED_EVENT,
    SLOT_RELEASED_EVENT,
    getDb: () => ({ query: vi.fn() }),
    withTransaction: async <T>(callback: (client: typeof fakeClient) => Promise<T> | T) =>
      callback(fakeClient),
    config: { RESERVATION_TTL: 120 },
    availabilityMetrics: metrics,
    runWithSpan: async <T>(_name: string, fn: () => Promise<T> | T) => fn(),
    getEventBus: vi.fn(),
    logger
  };
});

import { AvailabilityService } from '../../../src/modules/availability/application/availabilityService';

const baseInput = {
  unitId: 'unit-1',
  serviceId: 'service-1',
  start: '2025-12-05T09:00:00.000Z',
  end: '2025-12-05T09:30:00.000Z'
};

const stubTemplate = {
  capacityPerSlot: 2
};

function stubLockDependencies(service: AvailabilityService) {
  vi.spyOn(service as unknown as Record<string, unknown>, 'validateSlotRequest').mockReturnValue({
    unitId: baseInput.unitId,
    serviceId: baseInput.serviceId,
    start: new Date(baseInput.start),
    end: new Date(baseInput.end),
    barberId: null
  });

  vi.spyOn(service as unknown as Record<string, unknown>, 'ensureSlotMatchesTemplate').mockResolvedValue({
    template: stubTemplate,
    currentCount: 0
  });

  vi.spyOn(service as unknown as Record<string, unknown>, 'ensureNoAppointment').mockResolvedValue(
    undefined
  );

  vi.spyOn(service as unknown as Record<string, unknown>, 'countActiveReservations').mockResolvedValue(
    1
  );
}

function stubReleaseDependencies(service: AvailabilityService) {
  vi.spyOn(service as unknown as Record<string, unknown>, 'countActiveReservations').mockResolvedValue(
    0
  );

  vi.spyOn(service as unknown as Record<string, unknown>, 'findTemplateForSlot').mockResolvedValue(
    stubTemplate
  );
}

function createEventBus(
  implementation?: (eventName: string, payload: unknown) => void | Promise<void>
) {
  return {
    publish: vi.fn(async (eventName: string, payload: unknown) => {
      if (implementation) {
        await implementation(eventName, payload);
      }
    })
  } as unknown as IEventBus & { publish: ReturnType<typeof vi.fn> };
}

describe('AvailabilityService event integration (unit)', () => {
  beforeEach(() => {
    sharedMocks.fakeClient.query.mockReset();
    sharedMocks.logger.warn.mockReset();
    Object.values(sharedMocks.metrics).forEach((metric) => metric.inc.mockReset());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes slot.locked event when locking succeeds', async () => {
    sharedMocks.fakeClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const eventBus = createEventBus();
    const service = new AvailabilityService(eventBus);
    stubLockDependencies(service);

    const result = await service.lockSlot(baseInput);

    expect(eventBus.publish).toHaveBeenCalledWith(
      SLOT_LOCKED_EVENT,
      expect.objectContaining({
        reservationToken: result.reservationToken,
        unitId: baseInput.unitId,
        serviceId: baseInput.serviceId,
        capacityTotal: stubTemplate.capacityPerSlot,
        capacityUsed: 1
      })
    );
  });

  it('publishes slot.released event when releasing a lock', async () => {
    const reservationToken = 'resv_test_token';
    sharedMocks.fakeClient.query.mockImplementation(async (query: string) => {
      if (query.includes('FROM reservations') && query.includes('FOR UPDATE')) {
        return {
          rows: [
            {
              id: 'res-1',
              unit_id: baseInput.unitId,
              service_id: baseInput.serviceId,
              start_ts: baseInput.start,
              end_ts: baseInput.end
            }
          ]
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const eventBus = createEventBus();
    const service = new AvailabilityService(eventBus);
    stubReleaseDependencies(service);

    await service.releaseSlot(reservationToken);

    expect(eventBus.publish).toHaveBeenCalledWith(
      SLOT_RELEASED_EVENT,
      expect.objectContaining({
        reservationToken,
        reason: 'manual',
        capacityTotal: stubTemplate.capacityPerSlot,
        capacityUsed: 0
      })
    );
  });

  it('swallows publish errors and logs a warning', async () => {
    sharedMocks.fakeClient.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const failingBus = createEventBus(() => {
      throw new Error('publish failure');
    });
    const service = new AvailabilityService(failingBus);
    stubLockDependencies(service);

    await expect(service.lockSlot(baseInput)).resolves.toBeDefined();

    expect(sharedMocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: SLOT_LOCKED_EVENT, reservationToken: expect.any(String) }),
      expect.stringContaining('slot.locked')
    );
  });
});
