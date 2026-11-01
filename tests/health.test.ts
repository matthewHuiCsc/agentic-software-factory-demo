import { describe, expect, it } from 'vitest';
import { createHealthApp } from '../packages/service-runtime/src/index.js';

describe.each([
  ['health-plumbing', () => createHealthApp('health-plumbing')],
  ['storefront-gateway', () => createHealthApp('storefront-gateway')],
  ['store-ops-gateway', () => createHealthApp('store-ops-gateway')],
] as const)('%s skeleton', (component, createApp) => {
  it('exposes health without domain routes', async () => {
    const app = createApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/health' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok', component });
      expect(
        (await app.inject({ method: 'GET', url: '/orders' })).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
