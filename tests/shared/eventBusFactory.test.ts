import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AppConfig } from '../../packages/shared/src/config';

let eventBusModule: typeof import('../../packages/shared/src/eventbus') | null = null;

const baseConfig: AppConfig = {
  NODE_ENV: 'test',
  PORT: 3000,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  DATABASE_MAX_POOL: 10,
  RESERVATION_TTL: 120,
  LOG_LEVEL: 'debug',
  MIGRATIONS_DIR: 'migrations',
  SERVICE_NAME: 'test-service',
  EVENT_BUS_URL: undefined,
  EVENT_BUS_DRIVER: 'in-memory',
  EVENT_BUS_EXCHANGE: 'domain.events',
  EVENT_BUS_QUEUE_GROUP: 'test-service.workers',
  AVAILABILITY_BASE_URL: undefined,
  IDEMPOTENCY_TTL_SECONDS: 86400,
  METRICS_ENABLED: true
};

const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...baseConfig,
  ...overrides
});

describe('buildEventBus', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = baseConfig.DATABASE_URL;
    process.env.EVENT_BUS_DRIVER = baseConfig.EVENT_BUS_DRIVER;
    process.env.EVENT_BUS_QUEUE_GROUP = baseConfig.EVENT_BUS_QUEUE_GROUP;
    process.env.EVENT_BUS_EXCHANGE = baseConfig.EVENT_BUS_EXCHANGE;
    process.env.SERVICE_NAME = baseConfig.SERVICE_NAME;
    eventBusModule = await import('../../packages/shared/src/eventbus');
  });

  beforeEach(() => {
    getEventBusModule().resetEventBusCache();
  });

  it('returns an in-memory event bus by default', () => {
    const { buildEventBus, InMemoryEventBus } = getEventBusModule();
    const bus = buildEventBus(createConfig({ EVENT_BUS_DRIVER: 'in-memory' }));
    expect(bus).toBeInstanceOf(InMemoryEventBus);
  });

  it('falls back to in-memory when RabbitMQ driver is configured without URL', () => {
    const { buildEventBus, InMemoryEventBus } = getEventBusModule();
    const bus = buildEventBus(
      createConfig({
        EVENT_BUS_DRIVER: 'rabbitmq',
        EVENT_BUS_URL: undefined
      })
    );

    expect(bus).toBeInstanceOf(InMemoryEventBus);
  });

  it('creates a RabbitMQ event bus when driver and URL are provided', () => {
    const { buildEventBus, RabbitMQEventBus } = getEventBusModule();
    const bus = buildEventBus(
      createConfig({
        EVENT_BUS_DRIVER: 'rabbitmq',
        EVENT_BUS_URL: 'amqp://guest:guest@localhost:5672',
        EVENT_BUS_QUEUE_GROUP: 'test.workers',
        EVENT_BUS_EXCHANGE: 'test.events'
      })
    );

    expect(bus).toBeInstanceOf(RabbitMQEventBus);
  });
});

function getEventBusModule(): typeof import('../../packages/shared/src/eventbus') {
  if (!eventBusModule) {
    throw new Error('Event bus module not initialized');
  }

  return eventBusModule;
}
