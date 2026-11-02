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

it('creates, lists and filters persisted menu items and keeps order snapshots', async () => {
  const app = createApp(db);
  const name = `Taro tea ${randomUUID()}`;
  const created = await app.inject({
    method: 'POST',
    url: '/menu',
    payload: { name, unitPriceMinor: 725, currency: 'USD', available: true },
  });
  expect(created.statusCode).toBe(201);
  const item = created.json();
  expect(item).toMatchObject({ name, unitPriceMinor: 725, available: true });
  const hidden = await app.inject({
    method: 'POST',
    url: '/menu',
    payload: {
      name: `Hidden ${randomUUID()}`,
      unitPriceMinor: 100,
      currency: 'USD',
      available: false,
    },
  });
  expect(hidden.statusCode).toBe(201);
  await app.close();

  const reopened = createApp(db);
  const all = (await reopened.inject({ method: 'GET', url: '/menu' })).json();
  expect(all.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: item.id }),
      expect.objectContaining({ id: hidden.json().id, available: false }),
      expect.objectContaining({ name: 'Classic milk tea', available: true }),
    ]),
  );
  const available = (
    await reopened.inject({ method: 'GET', url: '/menu?available=true' })
  ).json();
  expect(
    available.items.every((i: { available: boolean }) => i.available),
  ).toBe(true);
  expect(available.items.map((i: { id: string }) => i.id)).not.toContain(
    hidden.json().id,
  );

  const duplicate = await reopened.inject({
    method: 'POST',
    url: '/menu',
    payload: {
      name: `  ${name.toUpperCase()} `,
      unitPriceMinor: 1,
      currency: 'USD',
      available: true,
    },
  });
  expect(duplicate.statusCode).toBe(409);

  const placed = await reopened.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      storeId: randomUUID(),
      currency: 'USD',
      items: [
        {
          productId: item.id,
          name: item.name,
          quantity: 2,
          unitPriceMinor: item.unitPriceMinor,
        },
      ],
    },
  });
  expect(placed.statusCode).toBe(201);
  await db.query('UPDATE order_menu SET unit_price_minor = 999 WHERE id = $1', [
    item.id,
  ]);
  const stored = (
    await reopened.inject({ method: 'GET', url: `/orders/${placed.json().id}` })
  ).json();
  expect(stored.items[0]).toMatchObject({ name, unitPriceMinor: 725 });
  expect(stored.totalMinor).toBe(1450);
  await reopened.close();
});

it('keeps seeded menu rows available after migration 003', async () => {
  const result = await db.query(
    `SELECT available FROM order_menu WHERE id IN
     ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012')`,
  );
  expect(result.rows).toEqual([{ available: true }, { available: true }]);
});

it.each([
  { name: ' ', unitPriceMinor: 100, currency: 'USD', available: true },
  { name: 'Tea', unitPriceMinor: 1.5, currency: 'USD', available: true },
  { name: 'Tea', unitPriceMinor: -1, currency: 'USD', available: true },
  { name: 'Tea', unitPriceMinor: 100001, currency: 'USD', available: true },
  { name: 'Tea', unitPriceMinor: 100, currency: 'usd', available: true },
  { name: 'Tea', unitPriceMinor: 100, currency: 'USD', available: 'yes' },
  { name: 'Tea', unitPriceMinor: 100, currency: 'USD' },
  {
    name: 'Tea',
    unitPriceMinor: 100,
    currency: 'USD',
    available: true,
    id: 'x',
  },
])('rejects invalid menu item %#', async (payload) => {
  const app = createApp(db);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/menu',
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Invalid request' });
  } finally {
    await app.close();
  }
});
