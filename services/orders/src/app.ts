import { randomUUID } from 'node:crypto';
import { type Database } from '@boba/persistence';
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

export const createApp = (db: Database): HealthApp => {
  const app = createHealthApp('orders', async () => {
    await db.query('SELECT 1');
  });
  app.post('/orders', async (request, reply) => {
    const input = placeSchema.parse(request.body);
    const total = input.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPriceMinor,
      0,
    );
    const result = await db.query<Order>(
      `INSERT INTO orders (id, store_id, customer_id, status, items, total_minor, currency)
       VALUES ($1, $2, $3, 'confirmed', $4, $5, $6) RETURNING ${columns}`,
      [
        randomUUID(),
        input.storeId,
        input.customerId ?? null,
        JSON.stringify(input.items),
        total,
        input.currency,
      ],
    );
    return reply.code(201).send(result.rows[0]);
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
  app.patch('/orders/:id/status', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = transitionSchema.parse(request.body);
    const previous =
      input.status === 'preparing'
        ? ['confirmed']
        : input.status === 'completed'
          ? ['preparing']
          : ['confirmed', 'preparing'];
    const result = await db.query<Order>(
      `UPDATE orders SET status = $2, reason = $3, updated_at = now()
       WHERE id = $1 AND status = ANY($4::text[]) RETURNING ${columns}`,
      [id, input.status, 'reason' in input ? input.reason : null, previous],
    );
    if (!result.rows[0]) {
      const exists = await db.query('SELECT id FROM orders WHERE id = $1', [
        id,
      ]);
      if (!exists.rows[0]) throw new HttpError(404, 'Order not found');
      throw new HttpError(409, 'Order cannot make this status transition');
    }
    return result.rows[0];
  });
  return app;
};
