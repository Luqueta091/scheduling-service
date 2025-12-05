import { logger } from '../logger';

import type { EventHandler, IEventBus } from './IEventBus';

export class InMemoryEventBus implements IEventBus {
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();

  async publish<T>(eventName: string, payload: T): Promise<void> {
    const handlers = this.handlers.get(eventName);
    if (!handlers || handlers.size === 0) {
      logger.debug({ eventName }, 'No handlers registered for event');
      return;
    }

    await Promise.all(
      Array.from(handlers.values()).map(async (handler) => handler(payload))
    );
  }

  async subscribe<T>(eventName: string, handler: EventHandler<T>): Promise<() => void> {
    const handlers = this.handlers.get(eventName) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(eventName, handlers);

    return () => {
      const set = this.handlers.get(eventName);
      if (!set) return;
      set.delete(handler as EventHandler<unknown>);
      if (set.size === 0) {
        this.handlers.delete(eventName);
      }
    };
  }

  clearAllSubscribers(): void {
    this.handlers.clear();
  }
}
