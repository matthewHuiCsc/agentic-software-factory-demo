import { describe, expect, it } from 'vitest';
import { orderEventSchema } from '../packages/contracts/src/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const base = {
  eventId: id,
  operationId: id,
  source: 'orders',
  version: 1,
  occurredAt: '2026-10-31T12:00:00Z',
};
const identity = { orderId: id, storeId: id };
const placed = {
  ...base,
  type: 'OrderPlaced',
  data: {
    ...identity,
    items: [{ productId: id, quantity: 2 }],
    totalMinor: 1200,
    currency: 'USD',
  },
};

describe('version 1 order facts', () => {
  it.each([
    placed,
    { ...base, type: 'OrderCompleted', data: identity },
    {
      ...base,
      type: 'OrderRejected',
      data: { ...identity, reason: 'Insufficient stock' },
    },
    {
      ...base,
      type: 'OrderCancelled',
      data: { ...identity, reason: 'Customer requested' },
    },
  ])('accepts $type', (event) => {
    expect(orderEventSchema.parse(event)).toEqual(event);
  });

  it('accepts version 2 completion facts with price and customer snapshots', () => {
    const completed = {
      ...base,
      version: 2,
      type: 'OrderCompleted',
      data: {
        ...identity,
        customerId: id,
        items: [{ productId: id, quantity: 2, unitPriceMinor: 550 }],
        totalMinor: 1100,
        currency: 'USD',
      },
    };
    expect(orderEventSchema.parse(completed)).toEqual(completed);
  });

  it.each([
    { ...placed, version: 2 },
    { ...placed, source: 'inventory' },
    { ...placed, operationId: undefined },
    { ...placed, occurredAt: 'yesterday' },
    { ...placed, type: 'ReserveStock' },
    { ...placed, unexpected: true },
    { ...placed, data: { ...placed.data, items: [] } },
    {
      ...placed,
      data: { ...placed.data, items: [{ productId: id, quantity: 0 }] },
    },
    { ...placed, data: { ...placed.data, totalMinor: -1 } },
    { ...placed, data: { ...placed.data, totalMinor: 1.5 } },
    { ...placed, data: { ...placed.data, currency: 'usd' } },
    { ...base, type: 'OrderRejected', data: { ...identity, reason: ' ' } },
  ])('rejects invalid or incompatible events %#', (event) => {
    expect(orderEventSchema.safeParse(event).success).toBe(false);
  });
});
