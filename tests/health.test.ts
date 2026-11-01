import { describe, expect, it } from 'vitest';
import { createApp as orders } from '../services/orders/src/app.js';
import { createApp as inventory } from '../services/inventory/src/app.js';
import { createApp as finance } from '../services/finance/src/app.js';
import { createApp as customers } from '../services/customers/src/app.js';
import { createApp as storefront } from '../gateways/storefront-gateway/src/app.js';
import { createApp as storeOps } from '../gateways/store-ops-gateway/src/app.js';

describe.each([
  ['orders', orders],
  ['inventory', inventory],
  ['finance', finance],
  ['customers', customers],
  ['storefront-gateway', storefront],
  ['store-ops-gateway', storeOps],
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
