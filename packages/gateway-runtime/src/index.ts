import {
  createHealthApp,
  HttpError,
  idParams,
  type HealthApp,
} from '@boba/service-runtime';
import { z } from 'zod';

export type Upstreams = {
  orders: string;
  inventory: string;
  finance: string;
  customers: string;
};
const upstreamResponse = z.record(z.string(), z.unknown());

export function upstreamsFromEnvironment(): Upstreams {
  const read = (key: string) => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is required`);
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error(`${key} must be an HTTP URL`);
    return value;
  };
  return {
    orders: read('ORDERS_URL'),
    inventory: read('INVENTORY_URL'),
    finance: read('FINANCE_URL'),
    customers: read('CUSTOMERS_URL'),
  };
}

type UpstreamResult = { statusCode: number; data: Record<string, unknown> };
async function upstream(
  base: string,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<UpstreamResult> {
  let response: Response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    throw new HttpError(
      502,
      `Service unreachable: ${error instanceof Error ? error.name : 'network failure'}`,
    );
  }
  let data: Record<string, unknown>;
  try {
    data = upstreamResponse.parse(await response.json());
  } catch {
    throw new HttpError(502, 'Service returned an invalid JSON response');
  }
  return { statusCode: response.status, data };
}

export function createGateway(
  component: string,
  urls: Upstreams,
  staff: boolean,
): HealthApp {
  const app = createHealthApp(component);
  const routes: {
    method: 'GET' | 'POST' | 'PATCH';
    path: string;
    service: keyof Upstreams;
    target: string;
  }[] = [
    { method: 'GET', path: '/api/menu', service: 'orders', target: '/menu' },
    {
      method: 'POST',
      path: '/api/orders',
      service: 'orders',
      target: '/orders',
    },
    {
      method: 'GET',
      path: '/api/orders',
      service: 'orders',
      target: '/orders',
    },
    {
      method: 'GET',
      path: '/api/orders/:id',
      service: 'orders',
      target: '/orders/:id',
    },
    {
      method: 'GET',
      path: '/api/customers',
      service: 'customers',
      target: '/customers',
    },
    {
      method: 'GET',
      path: '/api/customers/:id',
      service: 'customers',
      target: '/customers/:id',
    },
  ];
  if (staff)
    routes.push(
      {
        method: 'PATCH',
        path: '/api/orders/:id/status',
        service: 'orders',
        target: '/orders/:id/status',
      },
      {
        method: 'GET',
        path: '/api/stock',
        service: 'inventory',
        target: '/stock',
      },
      {
        method: 'POST',
        path: '/api/stock/:id/adjustments',
        service: 'inventory',
        target: '/stock/:id/adjustments',
      },
      {
        method: 'GET',
        path: '/api/entries',
        service: 'finance',
        target: '/entries',
      },
      {
        method: 'GET',
        path: '/api/summary',
        service: 'finance',
        target: '/summary',
      },
      {
        method: 'POST',
        path: '/api/effects/inventory/:id/retry',
        service: 'inventory',
        target: '/effects/:id/retry',
      },
      {
        method: 'POST',
        path: '/api/effects/finance/:id/retry',
        service: 'finance',
        target: '/effects/:id/retry',
      },
      {
        method: 'POST',
        path: '/api/effects/customers/:id/retry',
        service: 'customers',
        target: '/effects/:id/retry',
      },
    );
  for (const route of routes) {
    app.route({
      method: route.method,
      url: route.path,
      handler: async (request, reply) => {
        const target = route.target.includes(':id')
          ? route.target.replace(':id', idParams.parse(request.params).id)
          : route.target;
        const search = new URL(request.url, 'http://gateway').search;
        const result = await upstream(
          urls[route.service],
          target + search,
          route.method,
          request.body,
        );
        if (result.statusCode >= 500)
          request.log.error(
            { service: route.service, status: result.statusCode },
            'Upstream request failed',
          );
        return reply.code(result.statusCode).send(result.data);
      },
    });
  }
  const section = async (service: keyof Upstreams, path: string) => {
    try {
      const result = await upstream(urls[service], path);
      if (result.statusCode >= 400) {
        app.log.warn(
          { service, status: result.statusCode },
          'Dashboard section unavailable',
        );
        return {
          status: 'unavailable',
          error:
            typeof result.data.error === 'string'
              ? result.data.error
              : `HTTP ${result.statusCode}`,
        };
      }
      return { status: 'available', data: result.data };
    } catch (error) {
      app.log.error({ err: error, service }, 'Dashboard upstream failed');
      return {
        status: 'unavailable',
        error: error instanceof Error ? error.message : 'Service unavailable',
      };
    }
  };
  app.get('/api/orders/:id/journey', async (request) => {
    const { id } = idParams.parse(request.params);
    const [order, events, inventory, finance, customers] = await Promise.all([
      section('orders', `/orders/${id}`),
      section('orders', `/orders/${id}/events`),
      section('inventory', `/effects/${id}`),
      section('finance', `/effects/${id}`),
      section('customers', `/effects/${id}`),
    ]);
    return { order, events, inventory, finance, customers };
  });
  if (staff)
    app.get('/api/dashboard', async (request) => {
      const { storeId } = z
        .strictObject({ storeId: z.uuid() })
        .parse(request.query);
      const query = `?storeId=${storeId}&limit=100`;
      const [orders, inventory, finance, customers] = await Promise.all([
        section('orders', '/orders' + query),
        section('inventory', '/stock' + query),
        section('finance', '/entries' + query),
        section('customers', '/customers?limit=100'),
      ]);
      return { orders, inventory, finance, customers };
    });
  return app;
}
