import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { type HealthApp } from '../../packages/service-runtime/src/index.js';
import { createApp as orders } from '../../services/orders/src/app.js';
import { createApp as inventory } from '../../services/inventory/src/app.js';
import { createApp as finance } from '../../services/finance/src/app.js';
import { createApp as customers } from '../../services/customers/src/app.js';

async function withService(
  name: string,
  create: (db: Database) => HealthApp,
  check: (app: HealthApp) => Promise<void>,
): Promise<void> {
  const url = process.env[`${name.toUpperCase()}_DATABASE_URL`];
  if (!url)
    throw new Error('Run integration tests through docker-compose.test.yml');
  const db = connectDatabase(url);
  const app = create(db);
  try {
    await migrate(
      db,
      new URL(`../../services/${name}/migrations/`, import.meta.url),
    );
    await check(app);
  } finally {
    await app.close();
    await db.end();
  }
}

it('computes the maximum permitted order total exactly and filters only that store', async () => {
  await withService('orders', orders, async (app) => {
    const storeId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/orders',
      payload: {
        storeId,
        customerId: randomUUID(),
        currency: 'USD',
        items: Array.from({ length: 50 }, () => ({
          productId: randomUUID(),
          name: 'Maximum demo item',
          quantity: 100,
          unitPriceMinor: 100000,
        })),
      },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().totalMinor).toBe(500000000);
    const list = await app.inject({
      method: 'GET',
      url: `/orders?storeId=${storeId}&status=confirmed`,
    });
    expect(list.json().items).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/orders?storeId=${storeId}&status=completed`,
        })
      ).json().items,
    ).toHaveLength(0);
  });
});

it('rejects duplicate ingredients, invalid adjustments and overflow without changing history', async () => {
  await withService('inventory', inventory, async (app) => {
    const storeId = randomUUID();
    const payload = { storeId, name: 'Green tea', unit: 'ml' };
    const response = await app.inject({
      method: 'POST',
      url: '/stock',
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/stock',
          payload: { ...payload, name: ' GREEN TEA ' },
        })
      ).statusCode,
    ).toBe(409);
    const id = response.json().id as string;
    for (const delta of [0, 0.5, 1000001, -1000001]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/stock/${id}/adjustments`,
            payload: { delta, reason: 'Count' },
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/stock/${id}/adjustments`,
          payload: { delta: 1000000, reason: 'Opening count' },
        })
      ).json().onHand,
    ).toBe(1000000);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/stock/${id}/adjustments`,
          payload: { delta: 1, reason: 'Overflow' },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({ method: 'GET', url: `/stock/${id}/adjustments` })
      ).json().items,
    ).toHaveLength(1);
    expect(
      (await app.inject({ method: 'GET', url: `/stock/${id}` })).json().onHand,
    ).toBe(1000000);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/stock/${randomUUID()}/adjustments`,
          payload: { delta: 1, reason: 'Count' },
        })
      ).statusCode,
    ).toBe(404);
  });
});

it('accepts the maximum manual ledger amount and reports an empty store honestly', async () => {
  await withService('finance', finance, async (app) => {
    const storeId = randomUUID();
    expect(
      (
        await app.inject({ method: 'GET', url: `/summary?storeId=${storeId}` })
      ).json(),
    ).toEqual({ items: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/entries',
      payload: {
        storeId,
        kind: 'income',
        amountMinor: 100000000,
        currency: 'USD',
        memo: 'Maximum demo',
      },
    });
    expect(response.statusCode).toBe(201);
    expect(
      (
        await app.inject({ method: 'GET', url: `/summary?storeId=${storeId}` })
      ).json().items,
    ).toEqual([
      {
        currency: 'USD',
        incomeMinor: '100000000',
        expenseMinor: '0',
        balanceMinor: '100000000',
      },
    ]);
  });
});

it('preserves customer data on invalid patches and unique-email conflicts', async () => {
  await withService('customers', customers, async (app) => {
    const email = `${randomUUID()}@example.test`;
    const response = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { name: 'Original', email, phone: '555-0100' },
    });
    expect(response.statusCode).toBe(201);
    const second = await app.inject({
      method: 'POST',
      url: '/customers',
      payload: { name: 'Second', email: `${randomUUID()}@example.test` },
    });
    const id = response.json().id as string;
    for (const payload of [
      {},
      { name: '' },
      { email: null },
      { loyaltyPoints: 1 },
    ]) {
      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/customers/${id}`,
            payload,
          })
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/customers/${second.json().id}`,
          payload: { email: email.toUpperCase() },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await app.inject({ method: 'GET', url: `/customers/${id}` })).json(),
    ).toEqual(response.json());
    const updated = await app.inject({
      method: 'PATCH',
      url: `/customers/${id}`,
      payload: { name: 'Changed' },
    });
    expect(updated.json()).toMatchObject({
      name: 'Changed',
      email,
      phone: '555-0100',
    });
  });
});
