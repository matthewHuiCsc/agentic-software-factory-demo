import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { connectDatabase, migrate, type Database } from '@boba/persistence';
import {
  RabbitMessageBus,
  startOutboxPublisher,
} from '../../packages/messaging/dist/index.js';
import { orderEventSchema } from '../../packages/contracts/src/index.js';
import { createApp as createCustomersApp } from '../../services/customers/src/app.js';
import { createApp as createFinanceApp } from '../../services/finance/src/app.js';
import { createApp as createInventoryApp } from '../../services/inventory/src/app.js';
import { createApp as createOrdersApp } from '../../services/orders/src/app.js';

const migrationUrl = (service: string) =>
  new URL(`../../services/${service}/migrations/`, import.meta.url);
const storeId = '00000000-0000-4000-8000-000000000001';
const demoCustomerId = '00000000-0000-4000-8000-000000000401';
const tapiocaStockId = '00000000-0000-4000-8000-000000000201';

type EventSummary = {
  eventId: string;
  operationId: string;
  type: string;
  eventType: string;
  status: string;
};
type EffectSummary = {
  operationId: string;
  type: string;
  eventType: string;
  status: string;
  attempts: number;
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object response');
  return Object.fromEntries(Object.entries(value));
}

function stringField(value: unknown, key: string): string {
  const field = record(value)[key];
  if (typeof field !== 'string') throw new Error(`Expected ${key} to be text`);
  return field;
}

function numberField(value: unknown, key: string): number {
  const field = record(value)[key];
  if (typeof field !== 'number' || !Number.isInteger(field))
    throw new Error(`Expected ${key} to be an integer`);
  return field;
}

function eventSummaries(value: unknown): EventSummary[] {
  const items = record(value).items;
  if (!Array.isArray(items)) throw new Error('Expected an items array');
  return items.map((item) => ({
    eventId: stringField(item, 'eventId'),
    operationId: stringField(item, 'operationId'),
    type: stringField(item, 'type'),
    eventType: stringField(item, 'eventType'),
    status: stringField(item, 'status'),
  }));
}

function effectSummaries(value: unknown): EffectSummary[] {
  const items = record(value).items;
  if (!Array.isArray(items)) throw new Error('Expected an items array');
  return items.map((item) => ({
    operationId: stringField(item, 'operationId'),
    type: stringField(item, 'type'),
    eventType: stringField(item, 'eventType'),
    status: stringField(item, 'status'),
    attempts: numberField(item, 'attempts'),
  }));
}

function currencySpend(value: unknown, currency: string): bigint {
  const totals = record(value).totalSpend;
  if (!Array.isArray(totals)) throw new Error('Expected totalSpend array');
  const total = totals.find(
    (item) => stringField(item, 'currency') === currency,
  );
  return total ? BigInt(stringField(total, 'totalMinor')) : 0n;
}

let ordersDb: Database;
let inventoryDb: Database;
let financeDb: Database;
let customersDb: Database;
let ordersBus: RabbitMessageBus;
let inventoryBus: RabbitMessageBus;
let financeBus: RabbitMessageBus;
let customersBus: RabbitMessageBus;
let stopPublisher: (() => Promise<void>) | undefined;
let ordersApp: ReturnType<typeof createOrdersApp>;
let inventoryApp: ReturnType<typeof createInventoryApp>;
let financeApp: ReturnType<typeof createFinanceApp>;
let customersApp: ReturnType<typeof createCustomersApp>;

async function waitFor(
  description: string,
  check: () => Promise<boolean>,
): Promise<void> {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

beforeAll(async () => {
  const orders = process.env.ORDERS_DATABASE_URL;
  const inventory = process.env.INVENTORY_DATABASE_URL;
  const finance = process.env.FINANCE_DATABASE_URL;
  const customers = process.env.CUSTOMERS_DATABASE_URL;
  const rabbitUrl = process.env.RABBITMQ_URL;
  if (!orders || !inventory || !finance || !customers || !rabbitUrl)
    throw new Error(
      'Run integration tests with PostgreSQL and RabbitMQ from docker-compose.test.yml',
    );
  ordersDb = connectDatabase(orders);
  inventoryDb = connectDatabase(inventory);
  financeDb = connectDatabase(finance);
  customersDb = connectDatabase(customers);
  await Promise.all([
    migrate(ordersDb, migrationUrl('orders')),
    migrate(inventoryDb, migrationUrl('inventory')),
    migrate(financeDb, migrationUrl('finance')),
    migrate(customersDb, migrationUrl('customers')),
  ]);
  ordersBus = new RabbitMessageBus(rabbitUrl, 'boba.orders.events');
  inventoryBus = new RabbitMessageBus(rabbitUrl, 'boba.inventory');
  financeBus = new RabbitMessageBus(rabbitUrl, 'boba.finance');
  customersBus = new RabbitMessageBus(rabbitUrl, 'boba.customers');
  ordersApp = createOrdersApp(ordersDb, async () => {
    if (!ordersBus.isConnected) throw new Error('RabbitMQ is unavailable');
  });
  inventoryApp = createInventoryApp(inventoryDb, inventoryBus, async () => {
    if (!inventoryBus.isConnected) throw new Error('RabbitMQ is unavailable');
  });
  financeApp = createFinanceApp(financeDb, financeBus, async () => {
    if (!financeBus.isConnected) throw new Error('RabbitMQ is unavailable');
  });
  customersApp = createCustomersApp(customersDb, customersBus, async () => {
    if (!customersBus.isConnected) throw new Error('RabbitMQ is unavailable');
  });
  stopPublisher = await startOutboxPublisher(ordersDb, ordersBus);
  await Promise.all([
    ordersApp.ready(),
    inventoryApp.ready(),
    financeApp.ready(),
    customersApp.ready(),
  ]);
  await waitFor('RabbitMQ connections', async () =>
    [ordersBus, inventoryBus, financeBus, customersBus].every(
      (bus) => bus.isConnected,
    ),
  );
});

afterAll(async () => {
  await stopPublisher?.();
  await Promise.all([
    ordersApp?.close(),
    inventoryApp?.close(),
    financeApp?.close(),
    customersApp?.close(),
    ordersBus?.close(),
    inventoryBus?.close(),
    financeBus?.close(),
    customersBus?.close(),
    ordersDb?.end(),
    inventoryDb?.end(),
    financeDb?.end(),
    customersDb?.end(),
  ]);
});

it('publishes a completed order and applies inventory, finance, and customer effects once', async () => {
  const menu = await ordersApp.inject({ method: 'GET', url: '/menu' });
  expect(menu.statusCode).toBe(200);
  expect(menu.json().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000011',
        name: 'Classic milk tea',
        unitPriceMinor: 550,
        currency: 'USD',
      }),
      expect.objectContaining({
        id: '00000000-0000-4000-8000-000000000012',
        name: 'Brown sugar milk tea',
        unitPriceMinor: 650,
        currency: 'USD',
      }),
    ]),
  );

  const beforeResponse = await inventoryApp.inject({
    method: 'GET',
    url: `/stock/${tapiocaStockId}`,
  });
  const stockBefore = numberField(beforeResponse.json(), 'onHand');
  const customerBeforeResponse = await customersApp.inject({
    method: 'GET',
    url: `/customers/${demoCustomerId}`,
  });
  const customerBefore: unknown = customerBeforeResponse.json();
  const create = await ordersApp.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      storeId,
      customerId: demoCustomerId,
      items: [
        {
          productId: '00000000-0000-4000-8000-000000000011',
          name: 'Classic milk tea',
          quantity: 2,
          unitPriceMinor: 550,
        },
      ],
      currency: 'USD',
    },
  });
  expect(create.statusCode).toBe(201);
  const orderId = stringField(create.json(), 'id');
  expect(
    (
      await ordersApp.inject({
        method: 'PATCH',
        url: `/orders/${orderId}/status`,
        payload: { status: 'preparing' },
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await ordersApp.inject({
        method: 'PATCH',
        url: `/orders/${orderId}/status`,
        payload: { status: 'completed' },
      })
    ).statusCode,
  ).toBe(200);

  await waitFor('all completed-order effects', async () => {
    const [inventory, finance, customers] = await Promise.all([
      inventoryApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
      financeApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
      customersApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
    ]);
    return [inventory, finance, customers].every((response) =>
      response
        .json()
        .items.some(
          (effect: { type: string; status: string }) =>
            effect.type === 'OrderCompleted' && effect.status === 'processed',
        ),
    );
  });

  const outboxResponse = await ordersApp.inject({
    method: 'GET',
    url: `/orders/${orderId}/events`,
  });
  const completedFact = eventSummaries(outboxResponse.json()).find(
    (event) => event.type === 'OrderCompleted',
  );
  if (!completedFact) throw new Error('Completed event was not written');
  const duplicate = orderEventSchema.parse({
    eventId: completedFact.eventId,
    operationId: completedFact.operationId,
    version: 2,
    source: 'orders',
    occurredAt: new Date().toISOString(),
    type: 'OrderCompleted',
    data: {
      orderId,
      storeId,
      customerId: demoCustomerId,
      items: [
        {
          productId: '00000000-0000-4000-8000-000000000011',
          quantity: 2,
          unitPriceMinor: 550,
        },
      ],
      totalMinor: 1100,
      currency: 'USD',
    },
  });
  await ordersBus.publish(duplicate);
  await ordersBus.publish(duplicate);
  const barrier = orderEventSchema.parse({
    eventId: randomUUID(),
    operationId: randomUUID(),
    version: 1,
    source: 'orders',
    occurredAt: new Date().toISOString(),
    type: 'OrderPlaced',
    data: {
      orderId,
      storeId,
      customerId: demoCustomerId,
      items: [
        {
          productId: '00000000-0000-4000-8000-000000000011',
          quantity: 2,
        },
      ],
      totalMinor: 1100,
      currency: 'USD',
    },
  });
  await ordersBus.publish(barrier);
  await waitFor('duplicate messages to drain', async () => {
    const responses = await Promise.all([
      inventoryApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
      financeApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
      customersApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
    ]);
    return responses.every((response) =>
      effectSummaries(response.json()).some(
        (effect) =>
          effect.operationId === barrier.operationId &&
          effect.status === 'processed',
      ),
    );
  });

  const [stockAfter, customer, entries, outbox] = await Promise.all([
    inventoryApp.inject({ method: 'GET', url: `/stock/${tapiocaStockId}` }),
    customersApp.inject({
      method: 'GET',
      url: `/customers/${demoCustomerId}`,
    }),
    financeApp.inject({
      method: 'GET',
      url: `/entries?storeId=${storeId}&currency=USD`,
    }),
    ordersApp.inject({ method: 'GET', url: `/orders/${orderId}/events` }),
  ]);
  expect(numberField(stockAfter.json(), 'onHand')).toBe(stockBefore - 100);
  const effectResponses = await Promise.all([
    inventoryApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
    financeApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
    customersApp.inject({ method: 'GET', url: `/effects/${orderId}` }),
  ]);
  for (const response of effectResponses) {
    const completion = effectSummaries(response.json()).find(
      (effect) => effect.operationId === completedFact.operationId,
    );
    expect(completion).toMatchObject({
      type: 'OrderCompleted',
      status: 'processed',
      attempts: 1,
    });
  }
  expect(customer.json()).toMatchObject({
    completedOrderCount: expect.any(Number),
    totalSpend: expect.arrayContaining([
      expect.objectContaining({
        currency: 'USD',
        totalMinor: expect.any(String),
      }),
    ]),
  });
  expect(numberField(customer.json(), 'completedOrderCount')).toBe(
    numberField(customerBefore, 'completedOrderCount') + 1,
  );
  expect(currencySpend(customer.json(), 'USD')).toBe(
    currencySpend(customerBefore, 'USD') + 1100n,
  );
  const listedCustomers = await customersApp.inject({
    method: 'GET',
    url: '/customers?email=demo@example.test',
  });
  const listedItems = record(listedCustomers.json()).items;
  if (!Array.isArray(listedItems) || listedItems.length !== 1)
    throw new Error('Expected the completed-order customer in the list');
  expect(numberField(listedItems[0], 'completedOrderCount')).toBe(
    numberField(customer.json(), 'completedOrderCount'),
  );
  expect(entries.json().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'income',
        amountMinor: 1100,
        memo: `Completed order ${orderId}`,
      }),
    ]),
  );
  const ledgerItems = record(entries.json()).items;
  if (!Array.isArray(ledgerItems)) throw new Error('Expected ledger items');
  expect(
    ledgerItems.filter(
      (item) => stringField(item, 'memo') === `Completed order ${orderId}`,
    ),
  ).toHaveLength(1);
  expect(outbox.json().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'OrderPlaced', status: 'published' }),
      expect.objectContaining({ type: 'OrderCompleted', status: 'published' }),
    ]),
  );
});

it('keeps recipe failures visible and retries them through the effects API', async () => {
  const productId = randomUUID();
  const create = await ordersApp.inject({
    method: 'POST',
    url: '/orders',
    payload: {
      storeId,
      items: [
        {
          productId,
          name: 'Unconfigured tea',
          quantity: 1,
          unitPriceMinor: 550,
        },
      ],
      currency: 'USD',
    },
  });
  expect(create.statusCode).toBe(201);
  const actualOrderId = stringField(create.json(), 'id');
  await ordersApp.inject({
    method: 'PATCH',
    url: `/orders/${actualOrderId}/status`,
    payload: { status: 'preparing' },
  });
  await ordersApp.inject({
    method: 'PATCH',
    url: `/orders/${actualOrderId}/status`,
    payload: { status: 'completed' },
  });
  await waitFor('inventory recipe failure', async () => {
    const response = await inventoryApp.inject({
      method: 'GET',
      url: `/effects/${actualOrderId}`,
    });
    return response
      .json()
      .items.some(
        (effect: { type: string; status: string }) =>
          effect.type === 'OrderCompleted' && effect.status === 'failed',
      );
  });

  const customerEffects = await customersApp.inject({
    method: 'GET',
    url: `/effects/${actualOrderId}`,
  });
  expect(effectSummaries(customerEffects.json())).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        eventType: 'OrderCompleted',
        status: 'skipped',
      }),
    ]),
  );
  const retry = await inventoryApp.inject({
    method: 'POST',
    url: `/effects/${actualOrderId}/retry`,
  });
  expect(retry.statusCode).toBe(200);
  expect(retry.json().items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'OrderCompleted',
        status: 'failed',
        attempts: 2,
        error: expect.stringContaining('No recipe'),
      }),
    ]),
  );
});

it('logs outbox database outages and stops without an unhandled rejection', async () => {
  const url = process.env.ORDERS_DATABASE_URL;
  if (!url) throw new Error('ORDERS_DATABASE_URL is required');
  const unavailableDb = connectDatabase(url);
  await unavailableDb.end();
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  let stop: (() => Promise<void>) | undefined;
  try {
    stop = await startOutboxPublisher(unavailableDb, ordersBus, 20);
    await waitFor(
      'logged database retry',
      async () => log.mock.calls.length >= 2,
    );
    expect(log.mock.calls).toEqual(
      expect.arrayContaining([
        [expect.stringContaining('Outbox batch failed; retrying')],
      ]),
    );
    await stop();
    stop = undefined;
  } finally {
    await stop?.();
    log.mockRestore();
  }
});
