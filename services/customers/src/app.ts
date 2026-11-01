import { randomUUID } from 'node:crypto';
import { isUniqueViolation, type Database } from '@boba/persistence';
import {
  createHealthApp,
  HttpError,
  idParams,
  pagination,
  type HealthApp,
} from '@boba/service-runtime';
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

export const createApp = (db: Database): HealthApp => {
  const app = createHealthApp('customers', async () => {
    await db.query('SELECT 1');
  });
  app.post('/customers', async (request, reply) => {
    const input = profileSchema.parse(request.body);
    try {
      const result = await db.query<Customer>(
        `INSERT INTO customers (id, name, email, phone) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [randomUUID(), input.name, input.email, input.phone ?? null],
      );
      return reply.code(201).send(result.rows[0]);
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
    return result.rows[0];
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
    return { items: result.rows, limit: query.limit, offset: query.offset };
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
      return result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'Email already belongs to a customer');
      throw error;
    }
  });
  return app;
};
