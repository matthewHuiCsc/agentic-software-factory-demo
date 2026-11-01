import { randomUUID } from 'node:crypto';
import {
  transaction,
  isUniqueViolation,
  type Database,
} from '@boba/persistence';
import {
  createHealthApp,
  HttpError,
  idParams,
  pagination,
  type HealthApp,
} from '@boba/service-runtime';
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

export const createApp = (db: Database): HealthApp => {
  const app = createHealthApp('inventory', async () => {
    await db.query('SELECT 1');
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
  return app;
};
