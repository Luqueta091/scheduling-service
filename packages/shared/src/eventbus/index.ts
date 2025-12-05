import { randomUUID } from 'node:crypto';
import { setTimeout as scheduleTimeout } from 'node:timers/promises';
import type {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage
} from 'amqplib';
import * as amqp from 'amqplib';

import { config } from '../config';
import type { AppConfig } from '../config';
import { logger } from '../logger';

export interface EventEnvelope<T = unknown> {
  type: string;
  payload: T;
  occurredAt?: Date;
  metadata?: (Record<string, unknown> & { messageId?: string }) | undefined;
}

export type EventHandler<T = unknown> = (event: EventEnvelope<T>) => Promise<void> | void;

export interface EventBus {
  publish<T>(event: EventEnvelope<T>): Promise<void>;
  subscribe<T>(type: string, handler: EventHandler<T>): () => void;
  clearAllSubscribers(): void;
}

type SubscriptionEntry = {
  handlers: Set<EventHandler<unknown>>;
  consumerTag?: string;
};

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

interface RabbitMQOptions {
  url: string;
  exchange: string;
  queueGroup: string;
  reconnectDelayMs?: number;
  prefetch?: number;
}

export class RabbitMQEventBus implements EventBus {
  private connection: ChannelModel | null = null;
  private publisherChannel: ConfirmChannel | null = null;
  private consumerChannel: Channel | null = null;
  private readonly subscriptions = new Map<string, SubscriptionEntry>();
  private connecting: Promise<void> | null = null;
  private shuttingDown = false;

  constructor(private readonly options: RabbitMQOptions) {}

  async publish<T>(event: EventEnvelope<T>): Promise<void> {
    await this.ensureConnection();

    if (!this.publisherChannel) {
      throw new Error('RabbitMQ publisher channel is not available');
    }

    const envelope: EventEnvelope<T> = {
      metadata: {
        messageId: randomUUID()
      },
      occurredAt: event.occurredAt ?? new Date(),
      ...event
    };

    const payload = Buffer.from(JSON.stringify(envelope));

    await new Promise<void>((resolve, reject) => {
      try {
        this.publisherChannel!.publish(
          this.options.exchange,
          event.type,
          payload,
          {
            contentType: 'application/json',
            persistent: true,
            type: event.type,
            messageId: envelope.metadata?.messageId
          },
          (err: Error | null | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  subscribe<T>(type: string, handler: EventHandler<T>): () => void {
    const entry = this.subscriptions.get(type) ?? {
      handlers: new Set<EventHandler<unknown>>()
    };

    entry.handlers.add(handler as EventHandler<unknown>);
    this.subscriptions.set(type, entry);

    this.ensureConnection()
      .then(() => this.ensureConsumer(type).catch(this.handleError))
      .catch(this.handleError);

    return () => {
      entry.handlers.delete(handler as EventHandler<unknown>);
      if (entry.handlers.size === 0) {
        this.subscriptions.delete(type);
        void this.cancelConsumer(type);
      }
    };
  }

  clearAllSubscribers(): void {
    for (const type of this.subscriptions.keys()) {
      void this.cancelConsumer(type);
    }
    this.subscriptions.clear();
  }

  private async ensureConnection(): Promise<void> {
    if (this.shuttingDown) {
      throw new Error('RabbitMQEventBus is shutting down');
    }

    if (this.publisherChannel && this.consumerChannel) {
      return;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = this.connect();

    try {
      await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<void> {
    try {
      const connection = await amqp.connect(this.options.url);
      this.connection = connection;

      connection.on('error', (error: unknown) => {
        logger.error({ error }, 'RabbitMQ connection error');
      });

      connection.on('close', () => {
        if (this.shuttingDown) return;
        logger.warn('RabbitMQ connection closed, attempting to reconnect');
        this.resetConnection();
        this.scheduleReconnect();
      });

      this.publisherChannel = await connection.createConfirmChannel();
      await this.publisherChannel.assertExchange(this.options.exchange, 'topic', {
        durable: true
      });

      this.consumerChannel = await connection.createChannel();
      await this.consumerChannel.assertExchange(this.options.exchange, 'topic', {
        durable: true
      });
      await this.consumerChannel.prefetch(this.options.prefetch ?? 20);

      await this.resubscribeAll();
    } catch (error) {
      logger.error({ error }, 'Failed to connect to RabbitMQ event bus');
      this.resetConnection();
      this.scheduleReconnect();
      throw error;
    }
  }

  private async ensureConsumer(type: string): Promise<void> {
    if (!this.consumerChannel) {
      return;
    }

    const entry = this.subscriptions.get(type);
    if (!entry) return;

    if (entry.consumerTag) {
      return;
    }

    const queueName = `${this.options.queueGroup}.${type}`;

    await this.consumerChannel.assertQueue(queueName, {
      durable: true
    });

    await this.consumerChannel.bindQueue(queueName, this.options.exchange, type);

    const { consumerTag } = await this.consumerChannel.consume(
      queueName,
      async (message: ConsumeMessage | null) => {
        if (!message) return;
        await this.dispatchMessage(type, entry, message);
      },
      {
        noAck: false
      }
    );

    entry.consumerTag = consumerTag;
  }

  private async dispatchMessage(
    type: string,
    entry: SubscriptionEntry,
    message: ConsumeMessage
  ): Promise<void> {
    if (!this.consumerChannel) return;

    try {
      const content = message.content.toString();
      const envelope = JSON.parse(content) as EventEnvelope<unknown>;

      if (!envelope.type) {
        envelope.type = type;
      }

      await Promise.all(
        Array.from(entry.handlers.values()).map(async (handler) => {
          await (handler as EventHandler<unknown>)(envelope);
        })
      );

      this.consumerChannel.ack(message);
    } catch (error) {
      logger.error({ error, type }, 'Failed to process RabbitMQ event');
      this.consumerChannel.nack(message, false, true);
    }
  }

  private async cancelConsumer(type: string): Promise<void> {
    if (!this.consumerChannel) {
      return;
    }

    const entry = this.subscriptions.get(type);
    if (!entry?.consumerTag) {
      return;
    }

    try {
      await this.consumerChannel.cancel(entry.consumerTag);
    } catch (error) {
      logger.warn({ error }, 'Failed to cancel RabbitMQ consumer');
    }

    entry.consumerTag = undefined;
  }

  private async resubscribeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.subscriptions.keys()).map((type) =>
        this.ensureConsumer(type).catch(this.handleError)
      )
    );
  }

  private resetConnection(): void {
    this.publisherChannel = null;
    this.consumerChannel = null;
    if (this.connection) {
      this.connection.removeAllListeners();
    }
    this.connection = null;

    for (const entry of this.subscriptions.values()) {
      entry.consumerTag = undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown) {
      return;
    }

    const delayMs = this.options.reconnectDelayMs ?? 5000;

    scheduleTimeout(delayMs).then(() =>
      this.ensureConnection().catch((error) =>
        logger.error({ error }, 'RabbitMQ reconnection attempt failed')
      )
    );
  }

  private readonly handleError = (error: unknown) => {
    logger.error({ error }, 'RabbitMQEventBus encountered an error');
  };
}

export type EventBusDriver = AppConfig['EVENT_BUS_DRIVER'];

function buildRabbitEventBus(appConfig: AppConfig): EventBus {
  if (!appConfig.EVENT_BUS_URL) {
    logger.warn('EVENT_BUS_URL not provided; falling back to in-memory event bus');
    return new InMemoryEventBus();
  }

  return new RabbitMQEventBus({
    url: appConfig.EVENT_BUS_URL,
    exchange: appConfig.EVENT_BUS_EXCHANGE,
    queueGroup: appConfig.EVENT_BUS_QUEUE_GROUP,
    reconnectDelayMs: 5000,
    prefetch: 50
  });
}

export function buildEventBus(appConfig: AppConfig = config): EventBus {
  switch (appConfig.EVENT_BUS_DRIVER) {
    case 'rabbitmq':
      return buildRabbitEventBus(appConfig);
    case 'nats':
      logger.warn('NATS event bus driver not implemented yet; using in-memory fallback');
      return new InMemoryEventBus();
    case 'in-memory':
    default:
      return new InMemoryEventBus();
  }
}

let cachedEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!cachedEventBus) {
    cachedEventBus = buildEventBus();
  }

  return cachedEventBus;
}

export function resetEventBusCache(): void {
  cachedEventBus = null;
}

export const eventBus = getEventBus();
