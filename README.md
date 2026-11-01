# Boba platform

A fictional boba chain platform and future software-factory demonstration.
**Stage 1 is bootstrap only:** health endpoints, React placeholder pages, validated
event contracts, and a working container stack. No domain APIs, database tables,
event publishers/consumers, outboxes, gateway routing, authentication, payments,
CI, skills, custom agents, or Copilot instructions are implemented yet.
Existing `research/` is preserved and excluded from formatting and Docker builds.

## Architecture and boundaries

This is a TypeScript pnpm monorepo. Four Node.js/Fastify backends own their domains:
`services/orders`, `services/inventory`, `services/finance`, and
`services/customers`. Two React apps live in `apps/storefront` (customers) and
`apps/store-ops` (staff). Their Fastify gateways in `gateways/` will perform routing
and read aggregation only, never business logic. `packages/service-runtime`
shares only HTTP startup, shutdown, and health plumbing; `packages/contracts`
owns integration schemas and derived TypeScript types.

Each of the eight components has its own multi-stage, non-root Docker image.
One local PostgreSQL container provides four separate databases, each owned by a
distinct non-superuser login. Public database access is revoked; each backend
receives only its own credentials. No service may read another service's tables.
The admin login is exclusively for local database administration. RabbitMQ has
its own container. Neither database nor AMQP ports are published to the host.

The planned interaction is **event-driven choreography**, with no coordinator:
Orders confirms an order on placement and publishes only facts about its orders:
`OrderPlaced`, `OrderCompleted`, `OrderRejected`, and `OrderCancelled`.
Orders must never call Inventory or Finance. Inventory, Finance, and Customers
subscribe and independently apply their own effects. Staff can reject an order
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
Health means the skeleton HTTP server is alive, **not** that domain dependencies
are connected: database and broker clients do not exist yet. Compose waits for
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
```

Typecheck and tests build shared packages first, so they work on a clean checkout.
Vitest covers all six Fastify health skeletons, both React placeholders, and
valid/invalid event payloads. `pnpm format` formats owned source and configuration,
never `research/`. Docker builds install from the committed lockfile and deploy
only production dependencies for each backend/gateway. Later CI will run this
same Compose stack through ordinary GitHub Actions steps.
