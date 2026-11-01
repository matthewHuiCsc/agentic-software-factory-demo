import { expect, it } from 'vitest';
import { createHealthApp } from '../packages/service-runtime/src/index.js';
import { createApp as storefront } from '../gateways/storefront-gateway/src/app.js';
import { createApp as staff } from '../gateways/store-ops-gateway/src/app.js';

it('routes the storefront menu and preserves service validation errors', async () => {
  const upstream = createHealthApp('upstream');
  upstream.get('/menu', async () => ({
    items: [{ id: 'tea', name: 'Classic milk tea' }],
  }));
  upstream.post('/orders', async (_request, reply) =>
    reply.code(400).send({ error: 'Invalid order' }),
  );
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const app = storefront({
    orders: url,
    inventory: url,
    finance: url,
    customers: url,
  });
  try {
    const menu = await app.inject({ method: 'GET', url: '/api/menu' });
    expect(menu.statusCode).toBe(200);
    expect(menu.json()).toEqual({
      items: [{ id: 'tea', name: 'Classic milk tea' }],
    });
    const invalid = await app.inject({
      method: 'POST',
      url: '/api/orders',
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'Invalid order' });
  } finally {
    await app.close();
    await upstream.close();
  }
});

it('keeps a partial staff dashboard honest when an upstream service is unavailable', async () => {
  const upstream = createHealthApp('upstream');
  upstream.get('/orders', async () => ({
    items: [{ id: 'order', status: 'confirmed' }],
  }));
  upstream.get('/stock', async (_request, reply) =>
    reply.code(503).send({ error: 'Database unavailable' }),
  );
  upstream.get('/entries', async () => ({ items: [] }));
  upstream.get('/customers', async () => ({ items: [] }));
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const app = staff({
    orders: url,
    inventory: url,
    finance: url,
    customers: url,
  });
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard?storeId=00000000-0000-4000-8000-000000000001',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      orders: {
        status: 'available',
        data: { items: [{ id: 'order', status: 'confirmed' }] },
      },
      inventory: { status: 'unavailable', error: 'Database unavailable' },
    });
  } finally {
    await app.close();
    await upstream.close();
  }
});

it('aggregates real processing states without converting failed or pending effects into success', async () => {
  const upstream = createHealthApp('upstream');
  const id = '00000000-0000-4000-8000-000000000101';
  upstream.get('/orders/:id', async () => ({ id, status: 'completed' }));
  upstream.get('/orders/:id/events', async () => ({
    items: [{ type: 'OrderCompleted', status: 'pending' }],
  }));
  upstream.get('/effects/:id', async () => ({
    items: [
      {
        eventType: 'OrderCompleted',
        status: 'failed',
        error: 'Insufficient stock',
        attempts: 3,
      },
    ],
  }));
  upstream.post('/effects/:id/retry', async () => ({ status: 'pending' }));
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const urls = {
    orders: url,
    inventory: url,
    finance: url,
    customers: url,
  };
  const app = staff(urls);
  const publicApp = storefront(urls);
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/orders/${id}/journey`,
    });
    expect(response.json()).toMatchObject({
      events: {
        status: 'available',
        data: { items: [{ type: 'OrderCompleted', status: 'pending' }] },
      },
      inventory: {
        status: 'available',
        data: {
          items: [{ status: 'failed', error: 'Insufficient stock' }],
        },
      },
    });
    const retry = await app.inject({
      method: 'POST',
      url: `/api/effects/inventory/${id}/retry`,
      payload: {},
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ status: 'pending' });
    expect(
      (
        await publicApp.inject({
          method: 'PATCH',
          url: `/api/orders/${id}/status`,
          payload: { status: 'completed' },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/effects/orders/${id}/retry`,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await app.close();
    await publicApp.close();
    await upstream.close();
  }
});

it('rejects non-JSON and network upstream failures explicitly', async () => {
  const upstream = createHealthApp('upstream');
  upstream.get('/menu', async (_request, reply) =>
    reply.type('text/html').send('<html>Not JSON</html>'),
  );
  const url = await upstream.listen({ port: 0, host: '127.0.0.1' });
  const app = storefront({
    orders: url,
    inventory: url,
    finance: url,
    customers: url,
  });
  try {
    expect(
      (await app.inject({ method: 'GET', url: '/api/menu' })).statusCode,
    ).toBe(502);
    await upstream.close();
    const response = await app.inject({ method: 'GET', url: '/api/menu' });
    expect(response.statusCode).toBe(502);
    expect(response.json().error).toContain('Service unreachable');
  } finally {
    await app.close();
    await upstream.close();
  }
});
