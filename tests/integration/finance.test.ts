import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp } from '../../services/finance/src/app.js';

let db: Database;
beforeAll(async () => {
  const url = process.env.FINANCE_DATABASE_URL;
  if (!url)
    throw new Error('Run integration tests through docker-compose.test.yml');
  db = connectDatabase(url);
  await migrate(
    db,
    new URL('../../services/finance/migrations/', import.meta.url),
  );
});
afterAll(async () => {
  await db?.end();
});

it('records an immutable manual ledger and reports totals without mixing currencies or stores', async () => {
  const app = createApp(db);
  try {
    const storeId = randomUUID();
    const record = (
      kind: string,
      amountMinor: number,
      currency: string,
      store = storeId,
    ) =>
      app.inject({
        method: 'POST',
        url: '/entries',
        payload: {
          storeId: store,
          kind,
          amountMinor,
          currency,
          memo: 'Manual demo entry',
        },
      });
    const income = await record('income', 1100, 'USD');
    expect(income.statusCode).toBe(201);
    expect((await record('expense', 300, 'USD')).statusCode).toBe(201);
    expect((await record('income', 500, 'CAD')).statusCode).toBe(201);
    expect(
      (await record('income', 99999, 'USD', randomUUID())).statusCode,
    ).toBe(201);
    const totals = await app.inject({
      method: 'GET',
      url: `/summary?storeId=${storeId}`,
    });
    expect(totals.json().items).toEqual([
      {
        currency: 'CAD',
        incomeMinor: '500',
        expenseMinor: '0',
        balanceMinor: '500',
      },
      {
        currency: 'USD',
        incomeMinor: '1100',
        expenseMinor: '300',
        balanceMinor: '800',
      },
    ]);
    const id = income.json().id as string;
    expect(
      (await app.inject({ method: 'GET', url: `/entries/${id}` })).json(),
    ).toEqual(income.json());
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/entries/${id}`,
          payload: { amountMinor: 0 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/entries?storeId=${storeId}&limit=2`,
        })
      ).json().items,
    ).toHaveLength(2);
  } finally {
    await app.close();
  }
});
