import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp as orders } from '../../services/orders/src/app.js';
import { createApp as inventory } from '../../services/inventory/src/app.js';
import { createApp as finance } from '../../services/finance/src/app.js';
import { createApp as customers } from '../../services/customers/src/app.js';

const productId = randomUUID();
const storeId = randomUUID();
const orderItem = { productId, name: 'Tea', quantity: 1, unitPriceMinor: 550 };
const order = { storeId, items: [orderItem], currency: 'USD' };
const entry = {
  storeId,
  kind: 'income',
  amountMinor: 550,
  currency: 'USD',
  memo: 'Manual',
};
const profile = { name: 'Demo', email: 'validation@example.test' };
const cases = [
  {
    name: 'orders',
    create: orders,
    resource: '/orders',
    invalid: [
      { ...order, items: [] },
      { ...order, items: Array.from({ length: 51 }, () => orderItem) },
      { ...order, items: [{ ...orderItem, quantity: 0 }] },
      { ...order, items: [{ ...orderItem, quantity: 101 }] },
      { ...order, items: [{ ...orderItem, unitPriceMinor: -1 }] },
      { ...order, items: [{ ...orderItem, unitPriceMinor: 0.5 }] },
      { ...order, currency: 'usd' },
      { ...order, totalMinor: 1 },
      { ...order, status: 'completed' },
    ],
  },
  {
    name: 'inventory',
    create: inventory,
    resource: '/stock',
    invalid: [
      { storeId, name: ' ', unit: 'g' },
      { storeId, name: 'Tea', unit: 'kg' },
      { storeId, name: 'Tea', unit: 'g', onHand: 1 },
    ],
  },
  {
    name: 'finance',
    create: finance,
    resource: '/entries',
    invalid: [
      { ...entry, amountMinor: 0 },
      { ...entry, amountMinor: -1 },
      { ...entry, amountMinor: 1.5 },
      { ...entry, amountMinor: 100000001 },
      { ...entry, currency: 'usd' },
      { ...entry, kind: 'payment' },
      { ...entry, memo: ' ' },
      { ...entry, orderId: randomUUID() },
    ],
  },
  {
    name: 'customers',
    create: customers,
    resource: '/customers',
    invalid: [
      { ...profile, email: 'invalid' },
      { ...profile, name: '' },
      { ...profile, phone: 42 },
      { ...profile, loyaltyPoints: 100 },
    ],
  },
] as const;

describe.each(cases)(
  '$name request validation',
  ({ name, create, resource, invalid }) => {
    const inputs: readonly Record<string, unknown>[] = invalid;
    let db: Database;
    beforeAll(async () => {
      const url = process.env[`${name.toUpperCase()}_DATABASE_URL`];
      if (!url)
        throw new Error(
          'Run integration tests through docker-compose.test.yml',
        );
      db = connectDatabase(url);
      await migrate(
        db,
        new URL(`../../services/${name}/migrations/`, import.meta.url),
      );
    });
    afterAll(async () => {
      await db?.end();
    });
    it.each(inputs)('rejects invalid domain input %#', async (payload) => {
      const app = create(db);
      try {
        const response = await app.inject({
          method: 'POST',
          url: resource,
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'Invalid request' });
      } finally {
        await app.close();
      }
    });
  },
);
