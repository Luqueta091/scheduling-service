import { randomUUID } from 'node:crypto';

import type { ConfirmChannel, Connection } from 'amqplib';
import amqp from 'amqplib';

import { config } from '../config';
import { logger } from '../logger';

import type { IEventBus } from './IEventBus';

interface RabbitMqEventBusOptions {
  url: string;
  exchange: string;
}

export class RabbitMqEventBus implements IEventBus {
  private connection: Connection | null = null;
  private channel: ConfirmChannel | null = null;
  private connecting: Promise<void> | null = null;

  constructor(private readonly options: RabbitMqEventBusOptions) {}

  async publish<T>(eventName: string, payload: T): Promise<void> {
    try {
      await this.ensureChannel();
      if (!this.channel) {
        throw new Error('RabbitMQ channel is not available');
      }

      const envelope = {
        id: randomUUID(),
        event: eventName,
        occurredAt: new Date().toISOString(),
        payload
      };

      await new Promise<void>((resolve, reject) => {
        this.channel!.publish(
          this.options.exchange,
          eventName,
          Buffer.from(JSON.stringify(envelope)),
          {
            contentType: 'application/json',
            persistent: true,
            messageId: envelope.id,
            type: eventName
          },
          (err: Error | null | undefined) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          }
        );
      });
    } catch (error) {
      logger.error({ error, eventName }, 'Failed to publish event to RabbitMQ');
      if (config.NODE_ENV === 'production') {
        throw error;
      }
    }
  }

  private async ensureChannel(): Promise<void> {
    if (this.channel) {
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
      this.connection = await amqp.connect(this.options.url);
      this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange(this.options.exchange, 'topic', {
        durable: true
      });

      this.connection.on('error', (error) => {
        logger.error({ error }, 'RabbitMQ connection error');
        this.reset();
      });

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.reset();
      });
    } catch (error) {
      logger.error({ error }, 'Failed to establish RabbitMQ connection');
      this.reset();
      throw error;
    }
  }

  private reset(): void {
    if (this.channel) {
      this.channel.removeAllListeners();
    }
    if (this.connection) {
      this.connection.removeAllListeners();
    }
    this.channel = null;
    this.connection = null;
  }
}
