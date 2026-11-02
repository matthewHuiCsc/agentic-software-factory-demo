import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { connectDatabase, type Database } from '@boba/persistence';
import { createApp } from '../services/orders/src/app.js';

let db: Database;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  db = connectDatabase('postgresql://localhost/menu-rate-limit-test');
  vi.spyOn(db, 'query').mockImplementation(async () => ({
    command: 'SELECT',
    rowCount: 1,
    oid: 0,
    fields: [],
    rows: [
      {
        id: '00000000-0000-4000-8000-000000000011',
        name: 'Tea',
        unitPriceMinor: 100,
        currency: 'USD',
        available: true,
      },
    ],
  }));
});
afterEach(async () => {
  await db.end();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  { method: 'GET', max: 120, status: 200 },
  { method: 'POST', max: 30, status: 201 },
] as const)(
  'limits $method /menu to $max requests before database access',
  async ({ method, max, status }) => {
    const app = createApp(db);
    const startedAt = Date.now();
    const payload =
      method === 'POST'
        ? { name: 'Tea', unitPriceMinor: 100, currency: 'USD', available: true }
        : undefined;
    const send = (headers = {}, remoteAddress = '192.0.2.1') =>
      app.inject({
        method,
        url: '/menu',
        ...(payload === undefined ? {} : { payload }),
        headers,
        remoteAddress,
      });
    try {
      const permitted = await Promise.all(
        Array.from({ length: max }, () => send()),
      );
      expect(
        permitted.every((response) => response.statusCode === status),
      ).toBe(true);
      expect(db.query).toHaveBeenCalledTimes(max);
      const limited = await send();
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error).toMatch(/Rate limit exceeded/);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
      const spoofed = await send({ 'x-forwarded-for': '192.0.2.2' });
      expect(spoofed.statusCode).toBe(429);
      expect(db.query).toHaveBeenCalledTimes(max);
      expect((await send({}, '192.0.2.2')).statusCode).toBe(status);
      expect(db.query).toHaveBeenCalledTimes(max + 1);
      const otherMethod = await app.inject({
        method: method === 'GET' ? 'POST' : 'GET',
        url: '/menu',
        remoteAddress: '192.0.2.1',
        ...(method === 'GET'
          ? {
              payload: {
                name: 'Tea',
                unitPriceMinor: 100,
                currency: 'USD',
                available: true,
              },
            }
          : {}),
      });
      expect(otherMethod.statusCode).toBe(method === 'GET' ? 201 : 200);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/health',
            remoteAddress: '192.0.2.1',
          })
        ).statusCode,
      ).toBe(200);
      vi.setSystemTime(startedAt + 59999);
      expect((await send()).statusCode).toBe(429);
      vi.setSystemTime(startedAt + 60000);
      expect((await send()).statusCode).toBe(status);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/orders',
            remoteAddress: '192.0.2.1',
          })
        ).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  },
);

it('counts invalid creates toward the limit without database access', async () => {
  const app = createApp(db);
  const send = () =>
    app.inject({
      method: 'POST',
      url: '/menu',
      payload: {
        name: 'Tea',
        unitPriceMinor: 100,
        currency: 'EUR',
        available: true,
      },
    });
  try {
    for (let request = 0; request < 30; request++) {
      expect((await send()).statusCode).toBe(400);
    }
    expect((await send()).statusCode).toBe(429);
    expect(db.query).not.toHaveBeenCalled();
  } finally {
    await app.close();
  }
});
