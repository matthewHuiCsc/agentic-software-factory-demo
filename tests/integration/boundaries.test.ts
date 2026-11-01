import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import { createApp as orders } from '../../services/orders/src/app.js';
import { createApp as inventory } from '../../services/inventory/src/app.js';
import { createApp as finance } from '../../services/finance/src/app.js';
import { createApp as customers } from '../../services/customers/src/app.js';

const services = [
  { name: 'orders', create: orders, resource: '/orders', seed: '101' },
  { name: 'inventory', create: inventory, resource: '/stock', seed: '201' },
  { name: 'finance', create: finance, resource: '/entries', seed: '301' },
  { name: 'customers', create: customers, resource: '/customers', seed: '401' },
] as const;

describe.each(services)(
  '$name HTTP boundary',
  ({ name, create, resource, seed }) => {
    let db: Database;
    beforeAll(async () => {
      const url = process.env[`${name.toUpperCase()}_DATABASE_URL`];
      if (!url)
        throw new Error(
          'Run integration tests through docker-compose.test.yml',
        );
      db = connectDatabase(url);
      const directory = new URL(
        `../../services/${name}/migrations/`,
        import.meta.url,
      );
      await migrate(db, directory);
      await migrate(db, directory);
    });
    afterAll(async () => {
      await db?.end();
    });

    it('keeps seed data readable after repeated migrations and checks database readiness', async () => {
      const app = create(db);
      try {
        expect(
          (await app.inject({ method: 'GET', url: '/health' })).json(),
        ).toEqual({ status: 'ok', component: name });
        const response = await app.inject({
          method: 'GET',
          url: `${resource}/00000000-0000-4000-8000-000000000${seed}`,
        });
        expect(response.statusCode).toBe(200);
      } finally {
        await app.close();
      }
    });

    it.each([
      'limit=0',
      'limit=101',
      'limit=abc',
      'offset=-1',
      'offset=10001',
      'unexpected=true',
    ])('rejects invalid list query %s', async (query) => {
      const app = create(db);
      try {
        const response = await app.inject({
          method: 'GET',
          url: `${resource}?${query}`,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: 'Invalid request' });
      } finally {
        await app.close();
      }
    });

    it('distinguishes malformed identifiers, missing resources, and invalid bodies', async () => {
      const app = create(db);
      try {
        expect(
          (await app.inject({ method: 'GET', url: `${resource}/not-a-uuid` }))
            .statusCode,
        ).toBe(400);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `${resource}/${randomUUID()}`,
            })
          ).statusCode,
        ).toBe(404);
        expect(
          (await app.inject({ method: 'POST', url: resource, payload: {} }))
            .statusCode,
        ).toBe(400);
        const malformed = await app.inject({
          method: 'POST',
          url: resource,
          payload: '{broken',
          headers: { 'content-type': 'application/json' },
        });
        expect(malformed.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });

    it('reports a lost database as unavailable rather than healthy or successful', async () => {
      const url = process.env[`${name.toUpperCase()}_DATABASE_URL`];
      if (!url) throw new Error('Missing test database URL');
      const disconnected = connectDatabase(url);
      await disconnected.end();
      const app = create(disconnected);
      try {
        const health = await app.inject({ method: 'GET', url: '/health' });
        expect(health.statusCode).toBe(503);
        expect(health.json()).toEqual({
          status: 'unavailable',
          component: name,
        });
        const list = await app.inject({ method: 'GET', url: resource });
        expect(list.statusCode).toBe(500);
        expect(list.json()).toEqual({ error: 'Internal server error' });
      } finally {
        await app.close();
      }
    });
  },
);
