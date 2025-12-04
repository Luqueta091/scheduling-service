import { randomUUID } from 'node:crypto';

import { logger } from '../logger';

export interface EventEnvelope<T = unknown> {
  type: string;
  payload: T;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;

export interface EventBus {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  subscribe<T>(type: string, handler: EventHandler<T>): () => void;
  clearAllSubscribers(): void;
}

export class InMemoryEventBus implements EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<unknown>>>();

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    const handlers = this.handlers.get(event.type);

    if (!handlers || handlers.size === 0) {
      logger.debug({ eventType: event.type }, 'No handlers registered for event');
      return;
    }

    const envelope: EventEnvelope<T> = {
      metadata: {
        messageId: randomUUID()
      },
      occurredAt: event.occurredAt ?? new Date(),
      ...event
    };

    await Promise.all(
      Array.from(handlers.values()).map(async (handler) =>
        (handler as EventHandler<T>)(envelope)
      )
    );
  }

  subscribe<T>(type: string, handler: EventHandler<T>): () => void {
    const handlers = this.handlers.get(type) ?? new Set<EventHandler<unknown>>();
    handlers.add(handler as EventHandler<unknown>);
    this.handlers.set(type, handlers);

    return () => {
      const registered = this.handlers.get(type);
      if (!registered) return;
      registered.delete(handler as EventHandler<unknown>);
      if (registered.size === 0) {
        this.handlers.delete(type);
      }
    };
  }

  clearAllSubscribers(): void {
    this.handlers.clear();
  }
}

export const eventBus = new InMemoryEventBus();
