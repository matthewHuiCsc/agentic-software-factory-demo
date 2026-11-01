import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp } from '../../services/orders/src/app.js';

let db: Database;
beforeAll(async () => {
  const url = process.env.ORDERS_DATABASE_URL;
  if (!url)
    throw new Error('Run integration tests through docker-compose.test.yml');
  db = connectDatabase(url);
  await migrate(
    db,
    new URL('../../services/orders/migrations/', import.meta.url),
  );
});
afterAll(async () => {
  await db?.end();
});

it('places a confirmed order and reads it after recreating the HTTP app', async () => {
  const app = createApp(db);
  const storeId = randomUUID();
  const response = await app.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      storeId,
      items: [
        {
          productId: randomUUID(),
          name: 'Classic milk tea',
          quantity: 2,
          unitPriceMinor: 550,
        },
      ],
      currency: 'USD',
    },
  });
  expect(response.statusCode).toBe(201);
  const order = response.json();
  expect(order).toMatchObject({
    storeId,
    status: 'confirmed',
    totalMinor: 1100,
    currency: 'USD',
  });
  await app.close();
  const reopened = createApp(db);
  try {
    const read = await reopened.inject({
      method: 'GET',
      url: `/orders/${order.id}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual(order);
  } finally {
    await reopened.close();
  }
});

it('allows preparation then completion, but rejects terminal mutations and stale concurrent transitions', async () => {
  const app = createApp(db);
  try {
    const create = async () =>
      (
        await app.inject({
          method: 'POST',
          url: '/orders',
          payload: {
            storeId: randomUUID(),
            currency: 'USD',
            items: [
              {
                productId: randomUUID(),
                name: 'Tea',
                quantity: 1,
                unitPriceMinor: 550,
              },
            ],
          },
        })
      ).json().id as string;
    const id = await create();
    const update = (id: string, status: string, reason?: string) =>
      app.inject({
        method: 'PATCH',
        url: `/orders/${id}/status`,
        payload: { status, ...(reason ? { reason } : {}) },
      });
    expect((await update(id, 'completed')).statusCode).toBe(409);
    expect((await update(id, 'preparing')).json()).toMatchObject({
      status: 'preparing',
    });
    expect((await update(id, 'completed')).json()).toMatchObject({
      status: 'completed',
    });
    expect((await update(id, 'cancelled', 'Too late')).statusCode).toBe(409);
    const raceId = await create();
    const competing = await Promise.all([
      update(raceId, 'rejected', 'Insufficient stock'),
      update(raceId, 'cancelled', 'Changed mind'),
    ]);
    expect(competing.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(
      (await app.inject({ method: 'GET', url: `/orders/${raceId}` })).json(),
    ).toMatchObject(
      competing.find((response) => response.statusCode === 200)?.json(),
    );
    const rejectionId = await create();
    expect((await update(rejectionId, 'rejected')).statusCode).toBe(400);
    expect(
      (await update(rejectionId, 'rejected', 'Insufficient stock')).json(),
    ).toMatchObject({ status: 'rejected', reason: 'Insufficient stock' });
  } finally {
    await app.close();
  }
});
