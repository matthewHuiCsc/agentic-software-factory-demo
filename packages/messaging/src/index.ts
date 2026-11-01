import amqp, {
  type Channel,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from 'amqplib';
import { orderEventSchema, type OrderEvent } from '@boba/contracts';
import {
  transaction,
  type Database,
  type Transaction,
} from '@boba/persistence';
import { HttpError, type HealthApp } from '@boba/service-runtime';
import { z } from 'zod';

const exchange = 'boba.order-events';
const routingKey = 'orders.events';
const deadLetterExchange = 'boba.order-events.invalid';
const brokerTimeoutMs = 5000;

function logFailure(message: string, error?: unknown): void {
  const detail = error instanceof Error ? error.name : 'UnknownError';
  console.error(`[messaging] ${message.slice(0, 250)} (${detail})`);
}

async function bounded<T>(
  work: Promise<T>,
  label: string,
  timeoutMs = brokerTimeoutMs,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function closeConnection(connection: ChannelModel): Promise<void> {
  try {
    await bounded(connection.close(), 'RabbitMQ close');
  } catch (error) {
    logFailure('RabbitMQ close failed; destroying transport', error);
    const transport = connection.connection;
    if (
      'stream' in transport &&
      typeof transport.stream === 'object' &&
      transport.stream !== null &&
      'destroy' in transport.stream &&
      typeof transport.stream.destroy === 'function'
    ) {
      transport.stream.destroy();
    }
  }
}
const consumerQueues = [
  'boba.inventory',
  'boba.finance',
  'boba.customers',
] as const;

export class RabbitMessageBus {
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private consumerChannel: Channel | null = null;
  private consumerTag: string | null = null;
  private readonly deliveries = new Set<Promise<void>>();
  private readonly retiringConnections = new Set<Promise<void>>();
  private attachingConsumer = false;
  private consumer: ((event: OrderEvent) => Promise<void>) | null = null;
  private closed = false;
  private readonly reconnectTask: Promise<void>;

  constructor(
    private readonly url: string,
    private readonly queue: string,
  ) {
    this.reconnectTask = this.reconnect();
  }

  get isConnected(): boolean {
    return this.channel !== null;
  }

  async publish(event: OrderEvent): Promise<void> {
    const channel = this.channel;
    if (!channel) throw new Error('RabbitMQ is unavailable');
    const message = Buffer.from(JSON.stringify(event));
    try {
      await bounded(
        new Promise<void>((resolve, reject) => {
          channel.publish(
            exchange,
            routingKey,
            message,
            {
              persistent: true,
              contentType: 'application/json',
              messageId: event.eventId,
            },
            (error: unknown) => (error ? reject(error) : resolve()),
          );
        }),
        'RabbitMQ publisher confirm',
      );
    } catch (error) {
      logFailure('RabbitMQ publish failed; reconnecting', error);
      if (this.connection) this.resetConnection(this.connection);
      throw error;
    }
  }

  subscribe(handler: (event: OrderEvent) => Promise<void>): void {
    this.consumer = handler;
    void this.attachConsumer();
  }

  async close(): Promise<void> {
    this.closed = true;
    const connection = this.connection;
    if (this.consumerChannel && this.consumerTag) {
      await bounded(
        this.consumerChannel.cancel(this.consumerTag),
        'RabbitMQ consumer cancel',
      ).catch((error: unknown) => logFailure('Consumer cancel failed', error));
    }
    await Promise.all(this.deliveries);
    this.connection = null;
    this.channel = null;
    this.consumerChannel = null;
    if (connection) await closeConnection(connection);
    await this.reconnectTask;
    await Promise.all(this.retiringConnections);
  }

  private async reconnect(): Promise<void> {
    while (!this.closed) {
      if (!this.connection) {
        let candidate: ChannelModel | null = null;
        try {
          const connecting = amqp.connect(this.url, {
            timeout: brokerTimeoutMs,
          });
          let abandoned = false;
          void connecting
            .then((late) => {
              if (abandoned) return closeConnection(late);
            })
            .catch((error: unknown) => {
              if (abandoned)
                logFailure('Late RabbitMQ connection failed', error);
            });
          let connection: ChannelModel;
          try {
            connection = await bounded(connecting, 'RabbitMQ connect');
          } catch (error) {
            abandoned = true;
            throw error;
          }
          candidate = connection;
          connection.on('error', (error: unknown) => {
            logFailure('RabbitMQ connection error; reconnecting', error);
            this.resetConnection(connection);
          });
          connection.on('close', () => {
            if (!this.closed)
              logFailure('RabbitMQ connection closed; reconnecting');
            this.resetConnection(connection);
          });
          if (this.closed) {
            await closeConnection(connection);
            return;
          }
          const channel = await bounded(
            connection.createConfirmChannel(),
            'RabbitMQ channel',
          );
          channel.on('error', (error: unknown) => {
            logFailure('RabbitMQ publisher channel error; reconnecting', error);
            this.resetConnection(connection);
          });
          channel.on('close', () => this.resetConnection(connection));
          await bounded(
            channel.assertExchange(exchange, 'topic', { durable: true }),
            'RabbitMQ exchange',
          );
          await bounded(
            channel.assertExchange(deadLetterExchange, 'direct', {
              durable: true,
            }),
            'RabbitMQ dead-letter exchange',
          );
          for (const queue of consumerQueues) {
            await bounded(
              channel.assertQueue(queue, { durable: true }),
              'RabbitMQ queue',
            );
            await bounded(
              channel.bindQueue(queue, exchange, routingKey),
              'RabbitMQ binding',
            );
            await bounded(
              channel.assertQueue(`${queue}.invalid`, { durable: true }),
              'RabbitMQ dead-letter queue',
            );
            await bounded(
              channel.bindQueue(`${queue}.invalid`, deadLetterExchange, queue),
              'RabbitMQ dead-letter binding',
            );
          }
          if (this.closed) {
            await closeConnection(connection);
            return;
          }
          this.connection = connection;
          this.channel = channel;
          await this.attachConsumer();
        } catch (error) {
          logFailure('RabbitMQ setup failed; retrying in 1 second', error);
          if (candidate) await closeConnection(candidate);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        await this.attachConsumer();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  private resetConnection(connection: ChannelModel): void {
    if (this.connection !== connection) return;
    this.connection = null;
    this.channel = null;
    this.consumerChannel = null;
    this.consumerTag = null;
    const retiring = closeConnection(connection);
    this.retiringConnections.add(retiring);
    void retiring.finally(() => this.retiringConnections.delete(retiring));
  }

  private async attachConsumer(): Promise<void> {
    const connection = this.connection;
    const handler = this.consumer;
    if (
      !connection ||
      !handler ||
      this.consumerChannel ||
      this.attachingConsumer
    )
      return;
    this.attachingConsumer = true;
    try {
      const consumerChannel = await bounded(
        connection.createChannel(),
        'RabbitMQ consumer channel',
      );
      consumerChannel.on('error', (error: unknown) => {
        logFailure('RabbitMQ consumer channel error; reconnecting', error);
        this.resetConnection(connection);
      });
      await bounded(
        consumerChannel.assertQueue(this.queue, { durable: true }),
        'RabbitMQ consumer queue',
      );
      await bounded(
        consumerChannel.bindQueue(this.queue, exchange, routingKey),
        'RabbitMQ consumer binding',
      );
      await bounded(consumerChannel.prefetch(1), 'RabbitMQ prefetch');
      const subscription = await bounded(
        consumerChannel.consume(
          this.queue,
          (message: ConsumeMessage | null) => {
            if (message) {
              const delivery = this.deliver(
                consumerChannel,
                message,
                handler,
              ).catch((error: unknown) => {
                logFailure('Delivery settlement failed; reconnecting', error);
                this.resetConnection(connection);
              });
              this.deliveries.add(delivery);
              void delivery.finally(() => this.deliveries.delete(delivery));
            } else if (!this.closed) {
              logFailure('RabbitMQ consumer cancelled; reconnecting');
              this.resetConnection(connection);
            }
          },
        ),
        'RabbitMQ subscribe',
      );
      if (this.closed || this.connection !== connection) {
        await bounded(consumerChannel.close(), 'RabbitMQ stale consumer close');
        return;
      }
      this.consumerTag = subscription.consumerTag;
      this.consumerChannel = consumerChannel;
      consumerChannel.on('close', () => {
        if (this.consumerChannel === consumerChannel)
          this.consumerChannel = null;
      });
    } catch (error) {
      logFailure('RabbitMQ consumer attach failed; reconnecting', error);
      this.resetConnection(connection);
    } finally {
      this.attachingConsumer = false;
    }
  }

  private async deliver(
    channel: Channel,
    message: ConsumeMessage,
    handler: (event: OrderEvent) => Promise<void>,
  ): Promise<void> {
    let event: OrderEvent;
    try {
      const value: unknown = JSON.parse(message.content.toString('utf8'));
      event = orderEventSchema.parse(value);
    } catch (error) {
      logFailure(
        'Invalid event; preserving in durable invalid-message queue',
        error,
      );
      const publisher = this.channel;
      if (!publisher)
        throw new Error('RabbitMQ dead-letter publisher unavailable');
      await bounded(
        new Promise<void>((resolve, reject) => {
          publisher.publish(
            deadLetterExchange,
            this.queue,
            message.content,
            {
              persistent: true,
              contentType:
                message.properties.contentType ?? 'application/octet-stream',
            },
            (failure: unknown) => (failure ? reject(failure) : resolve()),
          );
        }),
        'RabbitMQ dead-letter confirm',
      );
      channel.ack(message);
      return;
    }
    try {
      await handler(event);
      channel.ack(message);
    } catch (error) {
      logFailure('Event receipt failed; requeueing and reconnecting', error);
      try {
        channel.nack(message, false, true);
      } finally {
        if (this.connection) this.resetConnection(this.connection);
      }
    }
  }
}

export type EffectRecord = {
  eventId: string;
  operationId: string;
  orderId: string;
  type: string;
  eventType: string;
  status: 'pending' | 'processed' | 'failed' | 'skipped';
  attempts: number;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  processedAt: Date | null;
};

const effectColumns = `event_id AS "eventId", operation_id AS "operationId",
  order_id AS "orderId", event_type AS type, event_type AS "eventType",
  status, attempts, error,
  created_at AS "createdAt", updated_at AS "updatedAt", processed_at AS "processedAt"`;

export function createEffectConsumer(
  db: Database,
  bus: RabbitMessageBus,
  apply: (event: OrderEvent, client: Transaction) => Promise<void | 'skipped'>,
) {
  async function process(event: OrderEvent): Promise<void> {
    await db.query(
      `INSERT INTO event_effects (event_id, operation_id, order_id, event_type, event_payload)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (operation_id) DO NOTHING`,
      [
        event.eventId,
        event.operationId,
        event.data.orderId,
        event.type,
        JSON.stringify(event),
      ],
    );
    const current = await db.query<{ status: string }>(
      'SELECT status FROM event_effects WHERE operation_id = $1',
      [event.operationId],
    );
    if (!current.rows[0] || current.rows[0].status !== 'pending') return;

    try {
      await transaction(db, async (client) => {
        const locked = await client.query<{ status: string }>(
          'SELECT status FROM event_effects WHERE operation_id = $1 FOR UPDATE',
          [event.operationId],
        );
        if (!locked.rows[0] || locked.rows[0].status !== 'pending') return;
        const status = await apply(event, client);
        await client.query(
          `UPDATE event_effects SET status = $2, attempts = attempts + 1,
           error = NULL, updated_at = now(), processed_at = now() WHERE operation_id = $1`,
          [event.operationId, status ?? 'processed'],
        );
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Event processing failed';
      logFailure(
        `Effect ${event.operationId} failed; durable retry required`,
        error,
      );
      await db.query(
        `UPDATE event_effects SET status = 'failed', attempts = attempts + 1,
         error = $2, updated_at = now() WHERE operation_id = $1 AND status <> 'processed'`,
        [event.operationId, message.slice(0, 1000)],
      );
    }
  }

  async function recoverPending(): Promise<void> {
    const pending = await db.query<{ eventPayload: unknown }>(
      `SELECT event_payload AS "eventPayload" FROM event_effects
       WHERE status = 'pending' ORDER BY created_at, event_id LIMIT 50`,
    );
    for (const row of pending.rows) {
      if (closed) break;
      const event = orderEventSchema.parse(row.eventPayload);
      await process(event);
    }
  }

  async function retryOrder(orderId: string): Promise<EffectRecord[]> {
    const failed = await db.query<{ eventPayload: unknown }>(
      `SELECT event_payload AS "eventPayload" FROM event_effects
       WHERE order_id = $1 AND status = 'failed' ORDER BY created_at, event_id`,
      [orderId],
    );
    for (const row of failed.rows) {
      const event = orderEventSchema.parse(row.eventPayload);
      await db.query(
        `UPDATE event_effects SET status = 'pending', error = NULL, updated_at = now()
         WHERE operation_id = $1 AND status = 'failed'`,
        [event.operationId],
      );
      await process(event);
    }
    const result = await db.query<EffectRecord>(
      `SELECT ${effectColumns} FROM event_effects WHERE order_id = $1
       ORDER BY created_at, event_id`,
      [orderId],
    );
    return result.rows;
  }

  let closed = false;
  let recovery: Promise<void> | null = null;
  const runRecovery = () => {
    if (closed || recovery) return;
    recovery = recoverPending()
      .catch((error: unknown) =>
        logFailure(
          'Pending effect recovery failed; retrying in 5 seconds',
          error,
        ),
      )
      .finally(() => {
        recovery = null;
      });
  };
  bus.subscribe(process);
  runRecovery();
  const recoveryTimer = setInterval(runRecovery, 5000);
  recoveryTimer.unref();
  return {
    retryOrder,
    close: async () => {
      closed = true;
      clearInterval(recoveryTimer);
      await recovery;
    },
  };
}

export async function listEffects(
  db: Database,
  orderId: string,
): Promise<EffectRecord[]> {
  const result = await db.query<EffectRecord>(
    `SELECT ${effectColumns} FROM event_effects WHERE order_id = $1
     ORDER BY created_at, event_id`,
    [orderId],
  );
  return result.rows;
}

export async function startOutboxPublisher(
  db: Database,
  bus: RabbitMessageBus,
  intervalMs = 500,
): Promise<() => Promise<void>> {
  let stopped = false;
  let running = false;
  const publishBatch = async () => {
    if (running || stopped) return;
    running = true;
    try {
      const pending = await db.query<{
        eventId: string;
        payload: unknown;
      }>(
        `SELECT event_id AS "eventId", payload FROM order_outbox
         WHERE status = 'pending' ORDER BY created_at, event_id LIMIT 50`,
      );
      for (const row of pending.rows) {
        if (stopped) break;
        try {
          const event = orderEventSchema.parse(row.payload);
          await bus.publish(event);
          await db.query(
            `UPDATE order_outbox SET status = 'published', attempts = attempts + 1,
             last_error = NULL, published_at = now() WHERE event_id = $1 AND status = 'pending'`,
            [row.eventId],
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Publish failed';
          await db.query(
            `UPDATE order_outbox SET attempts = attempts + 1, last_error = $2
             WHERE event_id = $1 AND status = 'pending'`,
            [row.eventId, message.slice(0, 1000)],
          );
          break;
        }
      }
    } catch (error) {
      logFailure('Outbox batch failed; retrying on next publisher tick', error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void publishBatch(), intervalMs);
  timer.unref();
  await publishBatch();
  return async () => {
    stopped = true;
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 10));
  };
}

export async function readEffects(db: Database, orderId: string) {
  return listEffects(db, orderId);
}

export function registerEffectRoutes(
  app: HealthApp,
  db: Database,
  retryOrder?: (orderId: string) => Promise<EffectRecord[]>,
): void {
  const params = z.strictObject({ orderId: z.uuid() });
  app.get('/effects/:orderId', async (request) => {
    const { orderId } = params.parse(request.params);
    return { items: await listEffects(db, orderId) };
  });
  app.post('/effects/:orderId/retry', async (request) => {
    const { orderId } = params.parse(request.params);
    if (!retryOrder)
      throw new HttpError(503, 'Event retry worker is unavailable');
    try {
      return { items: await retryOrder(orderId) };
    } catch (error) {
      if (error instanceof Error)
        throw new HttpError(500, `Retry failed: ${error.message}`);
      throw error;
    }
  });
}
