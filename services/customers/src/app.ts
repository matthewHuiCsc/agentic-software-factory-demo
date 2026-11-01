import { randomUUID } from 'node:crypto';
import {
  isUniqueViolation,
  type Database,
  type Transaction,
} from '@boba/persistence';
import {
  createHealthApp,
  HttpError,
  idParams,
  pagination,
  type HealthApp,
} from '@boba/service-runtime';
import {
  createEffectConsumer,
  RabbitMessageBus,
  registerEffectRoutes,
  type EffectRecord,
} from '@boba/messaging';
import type { OrderEvent } from '@boba/contracts';
import { z } from 'zod';

const emailSchema = z.string().trim().max(254).toLowerCase().pipe(z.email());
const profileSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  phone: z.string().trim().min(1).max(40).nullable().optional(),
});
const updateSchema = profileSchema
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    'Provide at least one profile field',
  );
const columns = `id, name, email, phone, created_at AS "createdAt", updated_at AS "updatedAt"`;
type Customer = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function customerProfile(db: Database, customer: Customer) {
  const totals = await db.query<{
    currency: string;
    totalMinor: string;
  }>(
    `SELECT currency, total_minor::text AS "totalMinor"
     FROM customer_order_totals WHERE customer_id = $1 ORDER BY currency`,
    [customer.id],
  );
  const counts = await db.query<{ completedOrderCount: string }>(
    `SELECT coalesce(sum(completed_order_count), 0)::text AS "completedOrderCount"
     FROM customer_order_totals WHERE customer_id = $1`,
    [customer.id],
  );
  const completedOrderCount = Number(counts.rows[0]?.completedOrderCount ?? 0);
  if (!Number.isSafeInteger(completedOrderCount))
    throw new Error(
      'Customer completed-order count exceeds safe integer range',
    );
  return {
    ...customer,
    completedOrderCount,
    totalSpend: totals.rows,
  };
}

export const createApp = (
  db: Database,
  bus?: RabbitMessageBus,
  readiness?: () => Promise<void>,
): HealthApp => {
  const app = createHealthApp('customers', async () => {
    await db.query('SELECT 1');
    await readiness?.();
  });
  app.post('/customers', async (request, reply) => {
    const input = profileSchema.parse(request.body);
    try {
      const result = await db.query<Customer>(
        `INSERT INTO customers (id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [randomUUID(), input.name, input.email, input.phone ?? null],
      );
      if (!result.rows[0])
        throw new Error('Customer creation returned no profile');
      return reply.code(201).send(await customerProfile(db, result.rows[0]));
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'Email already belongs to a customer');
      throw error;
    }
  });
  app.get('/customers/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await db.query<Customer>(
      `SELECT ${columns} FROM customers WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Customer not found');
    return customerProfile(db, result.rows[0]);
  });
  app.get('/customers', async (request) => {
    const query = z
      .strictObject({ ...pagination, email: emailSchema.optional() })
      .parse(request.query);
    const result = await db.query<Customer>(
      `SELECT ${columns} FROM customers WHERE ($1::text IS NULL OR email = $1)
       ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [query.email ?? null, query.limit, query.offset],
    );
    return {
      items: await Promise.all(
        result.rows.map((customer) => customerProfile(db, customer)),
      ),
      limit: query.limit,
      offset: query.offset,
    };
  });
  app.patch('/customers/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = updateSchema.parse(request.body);
    try {
      const result = await db.query<Customer>(
        `UPDATE customers SET name = coalesce($2, name), email = coalesce($3, email),
         phone = CASE WHEN $4::boolean THEN $5::text ELSE phone END, updated_at = now()
         WHERE id = $1 RETURNING ${columns}`,
        [
          id,
          input.name ?? null,
          input.email ?? null,
          'phone' in input,
          input.phone ?? null,
        ],
      );
      if (!result.rows[0]) throw new HttpError(404, 'Customer not found');
      return customerProfile(db, result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'Email already belongs to a customer');
      throw error;
    }
  });
  let retryOrder: ((orderId: string) => Promise<EffectRecord[]>) | undefined;
  if (bus) {
    const consumer = createEffectConsumer(db, bus, async (event, client) =>
      applyOrderEvent(event, client),
    );
    retryOrder = consumer.retryOrder;
    app.addHook('onClose', consumer.close);
  }
  registerEffectRoutes(app, db, retryOrder);
  return app;
};

async function applyOrderEvent(
  event: OrderEvent,
  client: Transaction,
): Promise<void | 'skipped'> {
  if (event.type !== 'OrderCompleted') return;
  if (event.version !== 2)
    throw new Error('OrderCompleted v1 does not include customer totals');
  if (!event.data.customerId) return 'skipped';
  const customer = await client.query(
    'SELECT id FROM customers WHERE id = $1',
    [event.data.customerId],
  );
  if (!customer.rows[0])
    throw new Error(`Customer ${event.data.customerId} does not exist`);
  await client.query(
    `INSERT INTO customer_order_totals
     (customer_id, currency, completed_order_count, total_minor)
     VALUES ($1, $2, 1, $3)
     ON CONFLICT (customer_id, currency) DO UPDATE SET
       completed_order_count = customer_order_totals.completed_order_count + 1,
       total_minor = customer_order_totals.total_minor + EXCLUDED.total_minor`,
    [event.data.customerId, event.data.currency, event.data.totalMinor],
  );
}
