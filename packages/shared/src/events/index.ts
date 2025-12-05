import { config, type AppConfig } from '../config';
import { logger } from '../logger';

import type { IEventBus } from './IEventBus';
import { InMemoryEventBus } from './InMemoryEventBus';
import { RabbitMqEventBus } from './RabbitMqEventBus';

let cachedBus: IEventBus | null = null;

function normalizeDriver(driver: string | undefined): string {
  if (!driver) return 'in-memory';
  if (driver === 'inmemory') return 'in-memory';
  return driver;
}

export function buildEventBusForConfig(appConfig: AppConfig): IEventBus {
  const driver = normalizeDriver(appConfig.EVENT_BUS_DRIVER);

  if (driver === 'rabbitmq') {
    if (!appConfig.EVENT_BUS_URL) {
      logger.warn('EVENT_BUS_URL not provided; falling back to in-memory event bus');
      return new InMemoryEventBus();
    }

    return new RabbitMqEventBus({
      url: appConfig.EVENT_BUS_URL,
      exchange: appConfig.EVENT_BUS_EXCHANGE
    });
  }

  return new InMemoryEventBus();
}

export function getEventBus(): IEventBus {
  if (!cachedBus) {
    cachedBus = buildEventBusForConfig(config);
  }

  return cachedBus;
}

export function resetEventBus(): void {
  cachedBus = null;
}

export function clearEventBusSubscribers(): void {
  if (cachedBus && typeof cachedBus.clearAllSubscribers === 'function') {
    cachedBus.clearAllSubscribers();
  }
  cachedBus = null;
}

export * from './IEventBus';
export { InMemoryEventBus } from './InMemoryEventBus';
export { RabbitMqEventBus } from './RabbitMqEventBus';
export * from './contracts';
