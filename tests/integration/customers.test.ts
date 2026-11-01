import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp } from '../../services/customers/src/app.js';

let db: Database;
beforeAll(async () => {
  const url = process.env.CUSTOMERS_DATABASE_URL;
  if (!url)
    throw new Error('Run integration tests through docker-compose.test.yml');
  db = connectDatabase(url);
  await migrate(
    db,
    new URL('../../services/customers/migrations/', import.meta.url),
  );
});
afterAll(async () => {
  await db?.end();
});

it('persists profiles, normalizes unique emails and updates only supplied fields', async () => {
  const app = createApp(db);
  try {
    const email = `${randomUUID()}@example.test`;
    const response = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: {
        name: '  Demo Customer  ',
        email: email.toUpperCase(),
        phone: '+1 555 0100',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ name: 'Demo Customer', email });
    const id = response.json().id as string;
    const duplicate = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { name: 'Duplicate', email },
    });
    expect(duplicate.statusCode).toBe(409);
    const changed = await app.inject({
      method: 'PATCH',
      url: `/customers/${id}`,
      payload: { name: 'New Name', phone: null },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      name: 'New Name',
      phone: null,
      email,
    });
    expect(
      (await app.inject({ method: 'GET', url: `/customers/${id}` })).json(),
    ).toEqual(changed.json());
    expect(
      (
        await app.inject({ method: 'GET', url: `/customers?email=${email}` })
      ).json().items,
    ).toHaveLength(1);
  } finally {
    await app.close();
  }
});
