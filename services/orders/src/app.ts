import { randomUUID } from 'node:crypto';
import {
  transaction,
  type Database,
  type Transaction,
} from '@boba/persistence';
import {
  ORDER_COMPLETION_EVENT_VERSION,
  ORDER_EVENT_VERSION,
  type OrderEvent,
} from '@boba/contracts';
import {
  createHealthApp,
  HttpError,
  idParams,
  pagination,
  type HealthApp,
} from '@boba/service-runtime';
import { z } from 'zod';

const itemSchema = z.strictObject({
  productId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(100),
  unitPriceMinor: z.number().int().min(0).max(100000),
});
const placeSchema = z.strictObject({
  storeId: z.uuid(),
  customerId: z.uuid().optional(),
  items: z.array(itemSchema).min(1).max(50),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const transitionSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('preparing') }),
  z.strictObject({ status: z.literal('completed') }),
  z.strictObject({
    status: z.literal('rejected'),
    reason: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    status: z.literal('cancelled'),
    reason: z.string().trim().min(1).max(500),
  }),
]);
const columns = `id, store_id AS "storeId", customer_id AS "customerId", status,
  items, total_minor AS "totalMinor", currency, reason,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
type Order = {
  id: string;
  storeId: string;
  customerId: string | null;
  status: string;
  items: z.infer<typeof itemSchema>[];
  totalMinor: number;
  currency: string;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const appendOutbox = async (
  client: Transaction,
  event: OrderEvent,
): Promise<void> => {
  await client.query(
    `INSERT INTO order_outbox (event_id, operation_id, order_id, event_type, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      event.eventId,
      event.operationId,
      event.data.orderId,
      event.type,
      JSON.stringify(event),
    ],
  );
};

export const createApp = (
  db: Database,
  readiness?: () => Promise<void>,
): HealthApp => {
  const app = createHealthApp('orders', async () => {
    await db.query('SELECT 1');
    await readiness?.();
  });
  app.get('/menu', async () => {
    const result = await db.query<{
      id: string;
      name: string;
      description: string;
      unitPriceMinor: number;
      currency: string;
    }>(
      `SELECT id, name, description, unit_price_minor AS "unitPriceMinor", currency
       FROM order_menu ORDER BY id`,
    );
    return { items: result.rows };
  });
  app.post('/orders', async (request, reply) => {
    const input = placeSchema.parse(request.body);
    const total = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceMinor,
      0,
    );
    const orderId = randomUUID();
    const order = await transaction(db, async (client) => {
      const result = await client.query<Order>(
        `INSERT INTO orders (id, store_id, customer_id, status, items, total_minor, currency)
         VALUES ($1, $2, $3, 'confirmed', $4, $5, $6) RETURNING ${columns}`,
        [
          orderId,
          input.storeId,
          input.customerId ?? null,
          JSON.stringify(input.items),
          total,
          input.currency,
        ],
      );
      const event: OrderEvent = {
        eventId: randomUUID(),
        operationId: randomUUID(),
        version: ORDER_EVENT_VERSION,
        source: 'orders',
        occurredAt: new Date().toISOString(),
        type: 'OrderPlaced',
        data: {
          orderId,
          storeId: input.storeId,
          ...(input.customerId ? { customerId: input.customerId } : {}),
          items: input.items.map(({ productId, quantity }) => ({
            productId,
            quantity,
          })),
          totalMinor: total,
          currency: input.currency,
        },
      };
      await appendOutbox(client, event);
      return result.rows[0];
    });
    return reply.code(201).send(order);
  });
  app.get('/orders/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await db.query<Order>(
      `SELECT ${columns} FROM orders WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Order not found');
    return result.rows[0];
  });
  app.get('/orders', async (request) => {
    const query = z
      .strictObject({
        ...pagination,
        storeId: z.uuid().optional(),
        status: z
          .enum([
            'confirmed',
            'preparing',
            'completed',
            'rejected',
            'cancelled',
          ])
          .optional(),
      })
      .parse(request.query);
    const result = await db.query<Order>(
      `SELECT ${columns} FROM orders
       WHERE ($1::uuid IS NULL OR store_id = $1) AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
      [query.storeId ?? null, query.status ?? null, query.limit, query.offset],
    );
    return { items: result.rows, limit: query.limit, offset: query.offset };
  });
  app.get('/orders/:id/events', async (request) => {
    const { id } = idParams.parse(request.params);
    const order = await db.query('SELECT id FROM orders WHERE id = $1', [id]);
    if (!order.rows[0]) throw new HttpError(404, 'Order not found');
    const events = await db.query(
      `SELECT event_id AS "eventId", operation_id AS "operationId",
       event_type AS type, event_type AS "eventType",
       status, attempts, last_error AS "lastError", created_at AS "createdAt",
       published_at AS "publishedAt" FROM order_outbox
       WHERE order_id = $1 ORDER BY created_at, event_id`,
      [id],
    );
    return { items: events.rows };
  });
  app.patch('/orders/:id/status', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = transitionSchema.parse(request.body);
    const previous =
      input.status === 'preparing'
        ? ['confirmed']
        : input.status === 'completed'
          ? ['preparing']
          : ['confirmed', 'preparing'];
    return transaction(db, async (client) => {
      const result = await client.query<Order>(
        `UPDATE orders SET status = $2, reason = $3, updated_at = now()
         WHERE id = $1 AND status = ANY($4::text[]) RETURNING ${columns}`,
        [id, input.status, 'reason' in input ? input.reason : null, previous],
      );
      const order = result.rows[0];
      if (!order) {
        const exists = await client.query(
          'SELECT id FROM orders WHERE id = $1',
          [id],
        );
        if (!exists.rows[0]) throw new HttpError(404, 'Order not found');
        throw new HttpError(409, 'Order cannot make this status transition');
      }
      if (input.status !== 'preparing') {
        const base = {
          eventId: randomUUID(),
          operationId: randomUUID(),
          source: 'orders' as const,
          occurredAt: new Date().toISOString(),
        };
        const event: OrderEvent =
          input.status === 'completed'
            ? {
                ...base,
                version: ORDER_COMPLETION_EVENT_VERSION,
                type: 'OrderCompleted',
                data: {
                  orderId: order.id,
                  storeId: order.storeId,
                  ...(order.customerId ? { customerId: order.customerId } : {}),
                  items: order.items.map((item) => ({
                    productId: item.productId,
                    quantity: item.quantity,
                    unitPriceMinor: item.unitPriceMinor,
                  })),
                  totalMinor: order.totalMinor,
                  currency: order.currency,
                },
              }
            : {
                ...base,
                version: ORDER_EVENT_VERSION,
                type:
                  input.status === 'rejected'
                    ? 'OrderRejected'
                    : 'OrderCancelled',
                data: {
                  orderId: order.id,
                  storeId: order.storeId,
                  reason: order.reason ?? '',
                },
              };
        await appendOutbox(client, event);
      }
      return order;
    });
  });
  return app;
};
