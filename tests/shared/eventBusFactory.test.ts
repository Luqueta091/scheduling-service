import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../packages/shared/src/config';
import {
  buildEventBusForConfig,
  InMemoryEventBus,
  RabbitMqEventBus
} from '../../packages/shared/src/events';

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
  TRACING_EXPORT_JSON: false,
  JWT_SECRET: 'test-secret',
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 604800,
  METRICS_ENABLED: true
};

const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  ...baseConfig,
  ...overrides
});

describe('buildEventBusForConfig', () => {
  it('returns an in-memory event bus by default', () => {
    const bus = buildEventBusForConfig(createConfig());
    expect(bus).toBeInstanceOf(InMemoryEventBus);
  });

  it('falls back to in-memory when RabbitMQ driver lacks URL', () => {
    const bus = buildEventBusForConfig(
      createConfig({
        EVENT_BUS_DRIVER: 'rabbitmq',
        EVENT_BUS_URL: undefined
      })
    );

    expect(bus).toBeInstanceOf(InMemoryEventBus);
  });

  it('creates a RabbitMQ event bus when URL is provided', () => {
    const bus = buildEventBusForConfig(
      createConfig({
        EVENT_BUS_DRIVER: 'rabbitmq',
        EVENT_BUS_URL: 'amqp://guest:guest@localhost:5672',
        EVENT_BUS_EXCHANGE: 'test.events'
      })
    );

    expect(bus).toBeInstanceOf(RabbitMqEventBus);
  });
});
