import { randomUUID } from 'node:crypto';
import {
  transaction,
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

const columns = `id, store_id AS "storeId", name, unit, on_hand AS "onHand", updated_at AS "updatedAt"`;
type Stock = {
  id: string;
  storeId: string;
  name: string;
  unit: string;
  onHand: number;
  updatedAt: Date;
};

export const createApp = (
  db: Database,
  bus?: RabbitMessageBus,
  readiness?: () => Promise<void>,
): HealthApp => {
  const app = createHealthApp('inventory', async () => {
    await db.query('SELECT 1');
    await readiness?.();
  });
  app.post('/stock', async (request, reply) => {
    const input = z
      .strictObject({
        storeId: z.uuid(),
        name: z.string().trim().min(1).max(120),
        unit: z.enum(['g', 'ml', 'pieces']),
      })
      .parse(request.body);
    try {
      const result = await db.query<Stock>(
        `INSERT INTO stock (id, store_id, name, unit) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [randomUUID(), input.storeId, input.name, input.unit],
      );
      return reply.code(201).send(result.rows[0]);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'Ingredient already exists at this store');
      throw error;
    }
  });
  app.get('/stock', async (request) => {
    const query = z
      .strictObject({ ...pagination, storeId: z.uuid().optional() })
      .parse(request.query);
    const result = await db.query<Stock>(
      `SELECT ${columns} FROM stock WHERE ($1::uuid IS NULL OR store_id = $1)
       ORDER BY name, id LIMIT $2 OFFSET $3`,
      [query.storeId ?? null, query.limit, query.offset],
    );
    return { items: result.rows, limit: query.limit, offset: query.offset };
  });
  app.get('/stock/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await db.query<Stock>(
      `SELECT ${columns} FROM stock WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Stock item not found');
    return result.rows[0];
  });
  app.post('/stock/:id/adjustments', async (request) => {
    const { id } = idParams.parse(request.params);
    const input = z
      .strictObject({
        delta: z
          .number()
          .int()
          .min(-1000000)
          .max(1000000)
          .refine((delta) => delta !== 0),
        reason: z.string().trim().min(1).max(500),
      })
      .parse(request.body);
    return transaction(db, async (client) => {
      const result = await client.query<Stock>(
        `UPDATE stock SET on_hand = on_hand + $2, updated_at = now()
         WHERE id = $1 AND on_hand + $2 BETWEEN 0 AND 1000000 RETURNING ${columns}`,
        [id, input.delta],
      );
      if (!result.rows[0]) {
        const exists = await client.query(
          'SELECT id FROM stock WHERE id = $1',
          [id],
        );
        if (!exists.rows[0]) throw new HttpError(404, 'Stock item not found');
        throw new HttpError(
          409,
          'Adjustment would put stock outside 0..1000000',
        );
      }
      await client.query(
        'INSERT INTO stock_adjustments (id, stock_id, delta, reason) VALUES ($1, $2, $3, $4)',
        [randomUUID(), id, input.delta, input.reason],
      );
      return result.rows[0];
    });
  });
  app.get('/stock/:id/adjustments', async (request) => {
    const { id } = idParams.parse(request.params);
    const query = z.strictObject(pagination).parse(request.query);
    const exists = await db.query('SELECT id FROM stock WHERE id = $1', [id]);
    if (!exists.rows[0]) throw new HttpError(404, 'Stock item not found');
    const result = await db.query(
      `SELECT id, stock_id AS "stockId", delta, reason, created_at AS "createdAt"
       FROM stock_adjustments WHERE stock_id = $1 ORDER BY created_at DESC, id LIMIT $2 OFFSET $3`,
      [id, query.limit, query.offset],
    );
    return { items: result.rows, limit: query.limit, offset: query.offset };
  });
  let retryOrder: ((orderId: string) => Promise<EffectRecord[]>) | undefined;
  if (bus) {
    const consumer = createEffectConsumer(db, bus, async (event, client) => {
      await applyOrderEvent(event, client);
    });
    retryOrder = consumer.retryOrder;
    app.addHook('onClose', consumer.close);
  }
  registerEffectRoutes(app, db, retryOrder);
  return app;
};

async function applyOrderEvent(
  event: OrderEvent,
  client: Transaction,
): Promise<void> {
  if (event.type !== 'OrderCompleted') return;
  if (event.version !== 2)
    throw new Error('OrderCompleted v1 does not include recipe quantities');

  const requiredByStock = new Map<string, number>();
  for (const item of event.data.items) {
    const recipe = await client.query<{
      stockId: string;
      quantityPerUnit: number;
    }>(
      `SELECT recipe.stock_id AS "stockId",
       recipe.quantity_per_unit AS "quantityPerUnit"
       FROM product_recipes recipe
       JOIN stock ON stock.id = recipe.stock_id
       WHERE recipe.product_id = $1 AND stock.store_id = $2`,
      [item.productId, event.data.storeId],
    );
    if (recipe.rows.length === 0)
      throw new Error(`No recipe for product ${item.productId} at this store`);
    for (const ingredient of recipe.rows) {
      const amount =
        item.quantity * ingredient.quantityPerUnit +
        (requiredByStock.get(ingredient.stockId) ?? 0);
      if (!Number.isSafeInteger(amount))
        throw new Error('Recipe quantity exceeds safe inventory limits');
      requiredByStock.set(ingredient.stockId, amount);
    }
  }

  for (const [stockId, amount] of requiredByStock) {
    const updated = await client.query<{ id: string }>(
      `UPDATE stock SET on_hand = on_hand - $2, updated_at = now()
       WHERE id = $1 AND on_hand >= $2 RETURNING id`,
      [stockId, amount],
    );
    if (!updated.rows[0])
      throw new Error(`Insufficient stock for ingredient ${stockId}`);
    await client.query(
      `INSERT INTO stock_adjustments
       (id, stock_id, delta, reason, operation_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        randomUUID(),
        stockId,
        -amount,
        `Order ${event.data.orderId} completed`,
        event.operationId,
      ],
    );
  }
}
