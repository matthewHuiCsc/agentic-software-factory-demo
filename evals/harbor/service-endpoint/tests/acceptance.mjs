import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const root = '/workspace';
const { createHealthApp } = await import(
  pathToFileURL(`${root}/packages/service-runtime/dist/index.js`)
);
const { createGateway } = await import(
  pathToFileURL(`${root}/packages/gateway-runtime/dist/index.js`)
);
const id = '00000000-0000-4000-8000-000000000301';
const history = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000302',
      stockId: id,
      delta: -2,
      reason: 'Fictional count correction',
      createdAt: '2026-01-01T12:00:00.000Z',
    },
  ],
};
let status = 200;
let payload = history;
const seen = [];
const upstream = createHealthApp('fixture-inventory');
upstream.get('/stock/:id/adjustments', async (request, reply) => {
  seen.push(request.url);
  return reply.code(status).send(payload);
});
upstream.post('/stock/:id/adjustments', async (_request, reply) =>
  reply.code(201).send({ id, delta: 1 }),
);
const inventory = await upstream.listen({ port: 0, host: '127.0.0.1' });
// Any forwarding to the wrong owner fails, rather than hitting the same fixture.
const urls = {
  inventory,
  orders: 'http://127.0.0.1:1',
  finance: 'http://127.0.0.1:1',
  customers: 'http://127.0.0.1:1',
};
const staff = createGateway('staff-fixture', urls, true);
const customer = createGateway('customer-fixture', urls, false);
const path = `/api/stock/${id}/adjustments`;
try {
  let response = await staff.inject({
    method: 'GET',
    url: `${path}?limit=2&offset=1`,
  });
  assert.equal(response.statusCode, 200, 'staff history is forwarded');
  assert.deepEqual(response.json(), history, 'owner body is unchanged');
  assert.equal(seen.at(-1), `/stock/${id}/adjustments?limit=2&offset=1`);

  const before = seen.length;
  response = await customer.inject({ method: 'GET', url: path });
  assert.equal(response.statusCode, 404, 'customer must not expose history');
  assert.equal(seen.length, before, 'customer must not contact Inventory');
  response = await staff.inject({
    method: 'GET',
    url: '/api/stock/not-a-uuid/adjustments',
  });
  assert.equal(
    response.statusCode,
    400,
    'existing UUID validation is preserved',
  );
  assert.equal(seen.length, before, 'invalid UUID must not contact Inventory');

  for (const [code, body, query] of [
    [200, { items: [] }, ''],
    [400, { error: 'Invalid pagination' }, '?limit=0'],
    [404, { error: 'Stock not found' }, ''],
    [503, { error: 'Database unavailable' }, ''],
  ]) {
    status = code;
    payload = body;
    response = await staff.inject({ method: 'GET', url: path + query });
    assert.equal(response.statusCode, code);
    assert.deepEqual(
      response.json(),
      body,
      'empty/error responses retain truth',
    );
    assert.equal(seen.at(-1), `/stock/${id}/adjustments${query}`);
  }
  response = await staff.inject({
    method: 'POST',
    url: path,
    payload: { delta: 1, reason: 'Fictional correction' },
  });
  assert.equal(response.statusCode, 201, 'existing POST still works');
  assert.deepEqual(response.json(), { id, delta: 1 });
} finally {
  await staff.close();
  await customer.close();
  await upstream.close();
}
const unreachable = createGateway(
  'unreachable-fixture',
  { ...urls, inventory: 'http://127.0.0.1:1' },
  true,
);
try {
  const response = await unreachable.inject({ method: 'GET', url: path });
  assert.equal(
    response.statusCode,
    502,
    'network failure is not empty history',
  );
  assert.match(response.json().error, /Service unreachable/);
} finally {
  await unreachable.close();
}
console.log(
  'PASS: staff-only history, owner/query fidelity, validation, failures, POST',
);
