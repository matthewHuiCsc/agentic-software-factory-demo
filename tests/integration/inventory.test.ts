import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp } from '../../services/inventory/src/app.js';

let db: Database;
beforeAll(async () => {
  const url = process.env.INVENTORY_DATABASE_URL;
  if (!url)
    throw new Error('Run integration tests through docker-compose.test.yml');
  db = connectDatabase(url);
  await migrate(
    db,
    new URL('../../services/inventory/migrations/', import.meta.url),
  );
});
afterAll(async () => {
  await db?.end();
});

it('tracks ingredient counts per store, keeps an adjustment history and prevents concurrent underflow', async () => {
  const app = createApp(db);
  try {
    const storeId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/stock',
      payload: { storeId, name: 'Tapioca pearls', unit: 'g' },
    });
    expect(response.statusCode).toBe(201);
    const id = response.json().id as string;
    expect(response.json()).toMatchObject({ storeId, onHand: 0, unit: 'g' });
    const adjust = (delta: number) =>
      app.inject({
        method: 'POST',
        url: `/stock/${id}/adjustments`,
        payload: { delta, reason: 'Stock count' },
      });
    expect((await adjust(10)).json()).toMatchObject({ onHand: 10 });
    const race = await Promise.all([adjust(-7), adjust(-7)]);
    expect(race.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(
      (await app.inject({ method: 'GET', url: `/stock/${id}` })).json(),
    ).toMatchObject({ onHand: 3 });
    const history = (
      await app.inject({ method: 'GET', url: `/stock/${id}/adjustments` })
    ).json();
    expect(history.items).toHaveLength(2);
    expect(
      history.items
        .map((item: { delta: number }) => item.delta)
        .sort((a: number, b: number) => a - b),
    ).toEqual([-7, 10]);
    const list = (
      await app.inject({ method: 'GET', url: `/stock?storeId=${storeId}` })
    ).json();
    expect(list.items).toHaveLength(1);
  } finally {
    await app.close();
  }
});
