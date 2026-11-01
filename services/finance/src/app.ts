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

const columns = `id, store_id AS "storeId", kind, amount_minor AS "amountMinor", currency,
  memo, created_at AS "createdAt"`;
type Entry = {
  id: string;
  storeId: string;
  kind: string;
  amountMinor: number;
  currency: string;
  memo: string;
  createdAt: Date;
};

export const createApp = (db: Database): HealthApp => {
  const app = createHealthApp('finance', async () => {
    await db.query('SELECT 1');
  });
  app.post('/entries', async (request, reply) => {
    const input = z
      .strictObject({
        storeId: z.uuid(),
        kind: z.enum(['income', 'expense']),
        amountMinor: z.number().int().min(1).max(100000000),
        currency: z.string().regex(/^[A-Z]{3}$/),
        memo: z.string().trim().min(1).max(500),
      })
      .parse(request.body);
    const result = await db.query<Entry>(
      `INSERT INTO ledger_entries (id, store_id, kind, amount_minor, currency, memo)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${columns}`,
      [
        randomUUID(),
        input.storeId,
        input.kind,
        input.amountMinor,
        input.currency,
        input.memo,
      ],
    );
    return reply.code(201).send(result.rows[0]);
  });
  app.get('/entries/:id', async (request) => {
    const { id } = idParams.parse(request.params);
    const result = await db.query<Entry>(
      `SELECT ${columns} FROM ledger_entries WHERE id = $1`,
      [id],
    );
    if (!result.rows[0]) throw new HttpError(404, 'Ledger entry not found');
    return result.rows[0];
  });
  app.get('/entries', async (request) => {
    const query = z
      .strictObject({
        ...pagination,
        storeId: z.uuid().optional(),
        currency: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .optional(),
      })
      .parse(request.query);
    const result = await db.query<Entry>(
      `SELECT ${columns} FROM ledger_entries
       WHERE ($1::uuid IS NULL OR store_id = $1) AND ($2::text IS NULL OR currency = $2)
       ORDER BY created_at DESC, id LIMIT $3 OFFSET $4`,
      [
        query.storeId ?? null,
        query.currency ?? null,
        query.limit,
        query.offset,
      ],
    );
    return { items: result.rows, limit: query.limit, offset: query.offset };
  });
  app.get('/summary', async (request) => {
    const query = z.strictObject({ storeId: z.uuid() }).parse(request.query);
    const result = await db.query<{
      currency: string;
      incomeMinor: string;
      expenseMinor: string;
      balanceMinor: string;
    }>(
      `SELECT currency,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'income'), 0)::text AS "incomeMinor",
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'expense'), 0)::text AS "expenseMinor",
         sum(CASE WHEN kind = 'income' THEN amount_minor ELSE -amount_minor END)::text AS "balanceMinor"
       FROM ledger_entries WHERE store_id = $1 GROUP BY currency ORDER BY currency`,
      [query.storeId],
    );
    return { items: result.rows };
  });
  return app;
};
