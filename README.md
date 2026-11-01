# Boba platform

A fictional boba chain platform and future software-factory demonstration.
**Stage 2 adds backend foundations:** four service-owned PostgreSQL models,
migrations, fictional seed data, validated HTTP APIs, and isolated database-backed
tests. React apps and gateways remain bootstrap placeholders. Event
publishers/consumers, outboxes, cross-service workflows, gateway routing,
authentication, payments, CI, skills, custom agents, and Copilot instructions
are not implemented yet.
Existing `research/` is preserved and excluded from formatting and Docker builds.

## Architecture and boundaries

This is a TypeScript pnpm monorepo. Four Node.js/Fastify backends own their domains:
`services/orders`, `services/inventory`, `services/finance`, and
`services/customers`. Two React apps live in `apps/storefront` (customers) and
`apps/store-ops` (staff). Their Fastify gateways in `gateways/` will perform routing
and read aggregation only, never business logic. `packages/service-runtime`
shares only HTTP startup, shutdown, and health plumbing; `packages/contracts`
owns integration schemas and derived TypeScript types. `packages/persistence`
shares PostgreSQL connection/transaction/migration mechanics, not domain queries.
Every SQL model and query lives in its owning service.

Each of the eight components has its own multi-stage, non-root Docker image.
One local PostgreSQL container provides four separate databases, each owned by a
distinct non-superuser login. Public database access is revoked; each backend
receives only its own credentials. No service may read another service's tables.
The admin login is exclusively for local database administration. RabbitMQ has
its own container. Neither database nor AMQP ports are published to the host.

The planned interaction is **event-driven choreography**, with no coordinator:
Orders confirms an order on placement and will publish only facts about its orders:
`OrderPlaced`, `OrderCompleted`, `OrderRejected`, and `OrderCancelled`.
Orders must never call Inventory or Finance. Inventory, Finance, and Customers
will subscribe and independently apply their own effects. Staff can reject an order
(for example, insufficient stock), or prepare and complete it. There is no stock
reservation, real payment processing, or authentication.

Every publishing service must eventually persist its domain mutation and
transactional outbox record in the same database transaction. Consumers must
eventually record a semantic operation ID and their side effect atomically, with
a unique key scoped to the consumer/effect, so retries cannot duplicate effects.
These are requirements for later stages, not behavior hidden in the skeleton.

### Event contract versioning

`@boba/contracts` exports Zod schemas and inferred types for the four facts.
The envelope has `version: 1`, `source: "orders"`, `eventId`, `operationId`, and
an ISO timestamp `occurredAt`. Payloads identify the order and store; placement
includes product quantities, an integer total in currency minor units, and an
optional customer. These are fictional starting payloads, not a complete menu model.

`eventId` identifies the persisted event; `operationId` identifies the semantic
order mutation. Both remain unchanged across outbox retries/redelivery. Consumer
deduplication must use the semantic operation ID, scoped to the consuming effect,
not a delivery tag. Each distinct lifecycle mutation gets a new operation ID.
Schemas are strict: incompatible changes (including new fields) require a new
event version, a separate schema, and a migration/compatibility strategy for
subscribers. The package version is independent of the wire event version.

## Run locally

Docker with Compose v2 or newer is the **only application runtime for v1**.
Host Node.js is optional and used only for development checks, not running servers.

```sh
docker compose up --build --wait --wait-timeout 180
docker compose ps
```

| Component               | Local URL                    |
| ----------------------- | ---------------------------- |
| Customer app            | http://localhost:8080        |
| Staff app               | http://localhost:8081        |
| Customer gateway health | http://localhost:3001/health |
| Staff gateway health    | http://localhost:3002/health |
| RabbitMQ management     | http://localhost:15672       |

All eight components expose `/health`. Backends are internal on port 3000;
apps serve built React assets with unprivileged Nginx on port 8080.
Backend health checks query their own database and return 503 if unavailable.
Gateways/apps still expose HTTP liveness only; no broker clients exist yet. Compose waits for
PostgreSQL/RabbitMQ before starting backends, for backends before gateways, and
for each gateway before its app. Startup dependencies do not supervise later outages.
Gateway URLs in Compose are future wiring, not implemented routing.

All committed passwords are **public disposable local-development fixtures**.
RabbitMQ management uses `boba` / `boba_local`; backend database passwords are
`<service>_local`. Never reuse these credentials or deploy this stack publicly.
Published ports bind only to loopback. PostgreSQL initialization runs only on a
new volume; changing the init script requires resetting volumes.

```sh
# Stop, preserving local data:
docker compose down

# Destructive reset: delete this stack's database and broker data:
docker compose down --volumes
docker compose up --build --wait --wait-timeout 180

# Troubleshooting:
docker compose logs --tail 100
```

## Development checks

Use Node.js 24 LTS and pnpm 10.28.2 (the `packageManager` pin).
If pnpm is not installed, prefix the commands below with
`npx --yes pnpm@10.28.2` in place of `pnpm`.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build

# Run HTTP integration tests against four isolated, ephemeral databases:
docker compose -f docker-compose.test.yml run --build --rm backend-tests
docker compose -f docker-compose.test.yml down
```

Typecheck and tests build shared packages first, so they work on a clean checkout.
Vitest unit tests cover HTTP plumbing, both React placeholders, and
valid/invalid event payloads. Integration tests exercise the four backend APIs
through Fastify injection with real PostgreSQL, including concurrency,
persistence across app recreation, migrations, validation and readiness failure.
The separate test Compose project uses tmpfs storage and no host ports; it does
not write to the running application databases. `pnpm test:integration` is the
container test runner entry point (requires the four test database URLs).
`pnpm format` formats owned source and configuration,
never `research/`. Docker builds install from the committed lockfile and deploy
only production dependencies for each backend/gateway. Later CI will run this
same Compose stack through ordinary GitHub Actions steps.

## Backend API slice

All JSON endpoints are internal to the Compose network on port 3000. Lists return
`{ items, limit, offset }`, with `limit` defaulting to 50 (1..100) and `offset`
defaulting to 0 (0..10000). Unknown fields, invalid UUIDs, invalid currency codes,
and invalid amounts produce 400 responses. Missing resources produce 404,
conflicts produce 409, and unexpected errors are logged but not exposed to clients.
Responses use camelCase, UUID IDs, UTC timestamps, and `null` for absent stored
optional values. There is no authentication: use fictional customer data only.

| Service   | Endpoints                                                                                                  | Behavior                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Orders    | `POST /orders`, `GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`                               | Place, list/filter, read and transition order-local state           |
| Inventory | `POST /stock`, `GET /stock`, `GET /stock/:id`, `POST /stock/:id/adjustments`, `GET /stock/:id/adjustments` | Ingredient counts per store with atomic adjustment history          |
| Finance   | `POST /entries`, `GET /entries`, `GET /entries/:id`, `GET /summary?storeId=UUID`                           | Immutable manual income/expense entries; totals grouped by currency |
| Customers | `POST /customers`, `GET /customers`, `GET /customers/:id`, `PATCH /customers/:id`                          | Profiles with normalized, unique emails and partial updates         |

**Orders:** placement accepts `storeId`, optional `customerId`, `currency` (three
uppercase letters), and 1..50 `items`. Each item is a caller-provided snapshot:
`productId`, `name`, `quantity` (1..100), `unitPriceMinor` (0..100000). The service
computes `totalMinor`; clients cannot supply status or totals. There is no product
catalog lookup or customer lookup, and these snapshots are not trusted pricing
for a real shop. Orders start `confirmed`; transitions are `confirmed -> preparing`,
`preparing -> completed`, and `confirmed/preparing -> rejected/cancelled`.
Terminal orders cannot change state. The status PATCH accepts `{ status }`, plus
a required nonempty `reason` for rejection/cancellation. Updates condition on
the previous state atomically. Lists optionally filter by `storeId` and `status`.

**Inventory:** create accepts `{ storeId, name, unit }`, where `unit` is `g`, `ml`,
or `pieces`, and initial `onHand` is zero. Ingredient names are case-insensitively
unique per store. Adjustment accepts `{ delta, reason }`, where delta is a
nonzero integer in -1000000..1000000. Stock must remain within 0..1000000.
The count and history record commit in one transaction; competing decrements
cannot make stock negative. Lists optionally filter by `storeId`.
There are no reservations, recipes, or automatic deductions.

**Finance:** create accepts `{ storeId, kind, amountMinor, currency, memo }`,
where `kind` is `income` or `expense`, and amount is an integer in 1..100000000.
There is no update/delete endpoint and no link to payments or Orders.
Lists optionally filter by `storeId` and `currency`; summaries require `storeId`
and return `{ items }`. Each currency has `incomeMinor`, `expenseMinor`, and
`balanceMinor` as **decimal strings** to preserve aggregate integer precision.
An empty ledger returns an empty list, not invented zero entries.

**Customers:** create accepts `{ name, email, phone? }`; PATCH accepts any nonempty
subset. Emails are trimmed and lowercased, names are trimmed, and `phone: null`
clears a phone while omitted fields are preserved. No loyalty or order-history
effects exist yet. Lists optionally filter by exact normalized `email`.

For an internal read without exposing backend ports:

```sh
docker compose exec orders node -e \
  "fetch('http://localhost:3000/orders').then(r => r.json()).then(console.log)"
```

### Service-owned migrations and demo data

Each service's `migrations/` contains ordered SQL migrations, packaged in its
Docker image. Startup applies pending migrations using only that service's
database credentials, under a per-database advisory lock and transaction.
Applied migration checksums are recorded in `schema_migrations`; changing an
applied file fails startup explicitly. Add a new migration instead.
Startup failures prevent listening; shutdown drains HTTP and closes its pool.

The first migration inserts one fictional record per service exactly once.
The demo store ID is `00000000-0000-4000-8000-000000000001`. Seed record IDs end in
`101` (confirmed tea order), `201` (10000g tapioca pearls), `301` (manual USD supplies
expense), and `401` (customer `demo@example.test`). These records are independent;
seeding does not enact an order workflow. Normal restarts preserve data and do
not reseed it. Only the documented volume reset deletes application data.
