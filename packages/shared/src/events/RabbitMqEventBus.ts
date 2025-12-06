import { randomUUID } from 'node:crypto';

import type { Channel, ChannelModel } from 'amqplib';
import { connect } from 'amqplib';

import { config } from '../config';
import { logger } from '../logger';

import type { IEventBus } from './IEventBus';

interface RabbitMqEventBusOptions {
  url: string;
  exchange: string;
}

export class RabbitMqEventBus implements IEventBus {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;
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

      const published = this.channel.publish(
        this.options.exchange,
        eventName,
        Buffer.from(JSON.stringify(envelope)),
        {
          contentType: 'application/json',
          persistent: true,
          messageId: envelope.id,
          type: eventName
        }
      );

      if (!published) {
        logger.warn({ eventName }, 'RabbitMQ publish buffer is full');
      }
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
      const connection = await connect(this.options.url);
      connection.on('error', (error: unknown) => {
        logger.error({ error }, 'RabbitMQ connection error');
        this.reset();
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        this.reset();
      });

      const channel = await connection.createChannel();
      await channel.assertExchange(this.options.exchange, 'topic', {
        durable: true
      });

      this.connection = connection;
      this.channel = channel;
    } catch (error) {
      logger.error({ error }, 'Failed to establish RabbitMQ connection');
      this.reset();
      throw error;
    }
  }

  private reset(): void {
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;

    if (channel) {
      channel
        .close()
        .catch((error) => logger.warn({ error }, 'Failed to close RabbitMQ channel'))
        .finally(() => {
          channel.removeAllListeners();
        });
    }
    if (connection) {
      connection
        .close()
        .catch((error) => logger.warn({ error }, 'Failed to close RabbitMQ connection'))
        .finally(() => {
          connection.removeAllListeners();
        });
    }
  }
}
