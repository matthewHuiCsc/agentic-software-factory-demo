# Boba platform

A fictional boba chain platform and future software-factory demonstration.
**Stages 3 and 4 build the usable demo journey:** service-owned PostgreSQL models,
RabbitMQ choreography, durable order outboxes and consumer effects, and customer
and staff apps backed by separate routing/read-aggregation gateways.
**Stage 5 adds GitHub Actions CI** using ordinary steps and the same Compose stack.
**Stage 6 adds repository-local software-factory guidance:** focused skills,
a read-only architecture reviewer, and concise always-on Copilot instructions.
Real authentication and payments remain out of scope.
Existing `research/` is preserved and excluded from formatting and Docker builds.

## Architecture and boundaries

This is a TypeScript pnpm monorepo. Four Node.js/Fastify backends own their domains:
`services/orders`, `services/inventory`, `services/finance`, and
`services/customers`. Two React apps live in `apps/storefront` (customers) and
`apps/store-ops` (staff). Their Fastify gateways in `gateways/` perform routing
and read aggregation only, never business logic. `packages/service-runtime`
shares only HTTP startup, shutdown, and health plumbing; `packages/contracts`
owns integration schemas and derived TypeScript types. `packages/persistence`
shares PostgreSQL connection/transaction/migration mechanics, not domain queries.
Every SQL model and query lives in its owning service.
`packages/gateway-runtime` shares only bounded HTTP forwarding and read aggregation.
`packages/web-ui` shares accessible UI primitives, API response validation, and
visual tokens; it does not apply backend domain effects.

Each of the eight components has its own multi-stage, non-root Docker image.
One local PostgreSQL container provides four separate databases, each owned by a
distinct non-superuser login. Public database access is revoked; each backend
receives only its own credentials. No service may read another service's tables.
The admin login is exclusively for local database administration. RabbitMQ has
its own container. Neither database nor AMQP ports are published to the host.

The interaction is **event-driven choreography**, with no coordinator:
Orders confirms an order on placement and publishes only facts about its orders:
`OrderPlaced`, `OrderCompleted`, `OrderRejected`, and `OrderCancelled`.
Orders must never call Inventory or Finance. Inventory, Finance, and Customers
subscribe and independently apply their own effects. Staff can reject an order
(for example, insufficient stock), or prepare and complete it. There is no stock
reservation, real payment processing, or authentication.

Orders persists its domain mutation and transactional outbox record in the same
database transaction. Consumers record a semantic operation ID and their side
effect atomically, scoped to the service/effect, so retries cannot duplicate effects.
The staff app shows actual pending, applied, failed, or unavailable results
read from each owner; a completed order is never evidence that all consumers succeeded.

### Event contract versioning

`@boba/contracts` exports Zod schemas and inferred types for the four facts.
Placement, rejection, cancellation, and the legacy completion schema use
`version: 1`. New completion facts use **version 2**, with the order's product
quantities, price snapshots, total, currency, and optional customer included.
Consumers never fetch these details from Orders. A legacy v1 completion is
parseable but fails visibly in consumers because it cannot support these effects.
The envelope has `source: "orders"`, `eventId`, `operationId`, and
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
Backend health checks query their own database and check broker connectivity,
returning 503 if either is unavailable. Existing order writes can still commit
to their outbox during a later broker outage; publication waits for recovery.
Gateways/apps expose HTTP liveness. Compose waits for
PostgreSQL/RabbitMQ before starting backends, for backends before gateways, and
for each gateway before its app. Startup dependencies do not supervise later outages.
Nginx proxies same-origin `/api/` to each app's gateway; browsers do not call
backends directly. Gateways have no database or broker credentials.

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

# With the normal application Compose stack running:
pnpm exec playwright install chromium
pnpm test:browser
```

Typecheck and tests build shared packages first, so they work on a clean checkout.
Vitest tests cover HTTP plumbing, gateway routing/read aggregation and failures,
both app shells, and
valid/invalid event payloads. Integration tests exercise the four backend APIs
through Fastify injection with real PostgreSQL, including concurrency,
persistence across app recreation, migrations, validation and readiness failure.
The separate test Compose project uses tmpfs database storage, its own broker,
and no host ports; it does
not write to the running application databases. `pnpm test:integration` is the
container test runner entry point (requires the four test database URLs and
`RABBITMQ_URL`). Browser tests run desktop pickup/completion, mobile rejection,
and gateway-error recovery through the real apps. They create fictional orders
in the running app stack; they do not reset application data.
`pnpm format` formats owned source and configuration,
never `research/`. Docker builds install from the committed lockfile and deploy
only production dependencies for each backend/gateway.

## Continuous integration (Stage 5)

`.github/workflows/ci.yml` runs on pushes, pull requests (including forks), and
manual dispatch. One Ubuntu 24.04 job installs Node.js 24 and pinned pnpm, validates
the locked workspace, runs unit/API and isolated PostgreSQL/RabbitMQ integration
tests, builds every component image, waits for all ten Compose services to be
healthy, and runs the Chromium customer/staff and failure-recovery journeys.
It uses no custom container action, deployment, real credentials, or registry push.

The workflow has read-only repository permissions, SHA-pinned actions, no persisted
checkout credentials, a 30-minute job timeout and bounded Compose builds. A newer
run cancels a superseded run of the same workflow/ref. Dependencies and images are
not cached across runs: this exercises clean installs/builds without restoring
untrusted branch build outputs.

Every run uploads seven-day reports: unit/API JUnit, integration runner output,
browser HTML/JUnit and failure traces/screenshots, plus Compose status/logs.
Failed tests fail the job (including integration commands piped through `tee`);
diagnostics and cleanup use `always()`. Abrupt runner termination may prevent
final steps; GitHub disposes of the hosted runner. Reports contain fictional data only.

Local equivalents (after the development install above):

```sh
pnpm lint
pnpm typecheck
mkdir -p test-results
pnpm test --reporter=default --reporter=junit --outputFile=test-results/unit.xml
pnpm build
docker compose config --quiet
docker compose -f docker-compose.test.yml config --quiet

# The test project has separate databases/broker and no host ports.
docker compose -f docker-compose.test.yml run --build --rm backend-tests
docker compose -f docker-compose.test.yml down --volumes --remove-orphans

# Uses the normal demo stack; browser tests add fictional demo records.
docker compose up --build --wait --wait-timeout 180
pnpm exec playwright install chromium
CI=true pnpm test:browser

# Validate workflow expressions and step syntax with current actionlint:
docker run --rm -v "$PWD:/repo:ro" -w /repo rhysd/actionlint:1.7.12 \
  .github/workflows/ci.yml .github/workflows/security.yml \
  .github/workflows/skill-evals.yml
# Compiled gh-aw locks use gh-aw's compatible bundled actionlint:
gh aw lint
```

On hosted Linux, CI installs Chromium with `--with-deps` to provide system
libraries; macOS needs only the browser download. GitHub must enable Actions and
have hosted-runner minutes and network access to npm, actions, browser downloads
and Docker Hub. Hosted runs require the user to publish the reviewed commits to the configured
GitHub remote. Do not copy CI's final
`docker compose down --volumes` into normal local cleanup unless you intend to
delete demo data; use `docker compose down` to preserve it.

## Software-factory customizations (Stage 6)

[Repository instructions](.github/copilot-instructions.md) carry the always-on
architecture guardrails. The on-demand skills provide checkable workflows:
[integration-event](.github/skills/integration-event/SKILL.md) for wire evolution
and durable effects, [service-endpoint](.github/skills/service-endpoint/SKILL.md)
for an API vertical slice, and [compose-journey](.github/skills/compose-journey/SKILL.md)
for full-stack acceptance and recovery evidence. Their descriptions enable
task-based discovery; explicitly request a skill by name when desired. They
retain normal tool permission prompts and reuse the commands above.

Select [architecture-reviewer](.github/agents/architecture-reviewer.agent.md) in a
client supporting repository custom agents, or ask your agent to delegate to it
with a change list/diff and acceptance criteria. Its `read`/`search` tool allowlist
supports independent source review, not editing or running tests. Example tasks:
"Use integration-event to plan a new completion payload version",
"Use service-endpoint to add a staff-visible inventory history route", or
"Use compose-journey to verify a stock failure and owner retry".
These are usage examples, not implemented features. Customization discovery and
tool alias enforcement depend on the Copilot client; prose is guidance, not
mechanical enforcement. Plugin packaging and automations are later stages.

### Skill evaluation with the Agent Skills convention

Each skill versions plain [Agent Skills outcome cases](https://agentskills.io/skill-creation/evaluating-skills)
and [description trigger queries](https://agentskills.io/skill-creation/optimizing-descriptions)
beside its unchanged instructions:
`evals/evals.json` (three repo-grounded prompts and expected outputs) and
`evals/trigger-queries.json` (ten positive and ten negative/near-miss queries).
See [service-endpoint](.github/skills/service-endpoint/evals/),
[integration-event](.github/skills/integration-event/evals/) and
[compose-journey](.github/skills/compose-journey/evals/). These reviewed cases make
customizations reviewed factory assets. They describe evaluation data/process,
not a standalone runner; versioned cases alone are not executed evals.

Use off-the-shelf tooling such as Anthropic's
[skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator),
or run the guide's fresh with-skill/without-skill sessions. Provide the same
repository snapshot, prompt and instructions to both; preserve the
`.github/skills/<name>/` hierarchy so relative resources resolve. Ensure the
target skill is actually unavailable in the baseline, including personal/plugin
copies, rather than merely omitting its name. Keep expected outputs/trigger labels
out of the agent's task input; bundled eval files are public authoring data, not
hidden holdouts. The initial outcome prompts request read-only plans
or diagnosis of supplied observations, not changes to the running demo. Review
actual outputs against expected behavior; use deterministic scripts for mechanical
assertions when available and human review for reasoning, without treating a plan
as proof of executed recovery.

For an executable first slice, the [Harbor pilot](evals/harbor/README.md) runs
one narrow `service-endpoint` implementation task in isolated task containers.
Harbor owns trial execution, lifecycle and result collection; this repository
provides task fixtures and independent acceptance tests, not an evaluation
platform. Run `bash scripts/eval-skills.sh check` for no-model good/bad controls.
After reviewing the permission and spend boundary, use
`bash scripts/eval-skills.sh run <explicit-copilot-model>` for one fresh
candidate/baseline pair. The manual **Skill evaluation pilot** Actions workflow
uses the same command and pins on the default branch. It requires an explicitly
chosen model and a separately provisioned Copilot-authorized secret; ordinary
PR CI never runs it. There is no schedule or personal canvas dependency.

For triggering, submit each `query` without naming the skill and observe its
actual invocation from the client's logs/tool history. Repeat queries (three is a
starting point), include the near misses and keep a fixed validation subset when
tuning descriptions. Missing runtime evidence is unverified, not a successful
negative; loading/discovery is not task success. Model calls are manual, metered
and opt-in: review labels, runtime capabilities, permissions and spend first.
Keep generated results in ignored sibling `<skill>-workspace/iteration-N/`
directories, as the guide describes; never commit transcripts or credentials.
Do not run outage/browser cases against the live demo without separate approval.
Architecture-reviewer flaw/clean-diff and tool-enforcement evaluations remain a
follow-up; no runtime restriction or measured skill improvement is claimed here.
The earlier [research proposal](research/ai-skill-evaluation.md) records possible
future infrastructure, not the implementation chosen for this simpler slice.

### Issue-to-human-merged-PR loop (GitHub Agentic Workflows)

The [gh-aw research](research/gh-aw-factory-loop.md) records official sources and
limitations. Three versioned Markdown workflows and their compiler-generated
`.lock.yml` files implement a thin, opt-in loop using the **Copilot engine**:
[plan](.github/workflows/factory-plan.md),
[implement](.github/workflows/factory-implement.md), and
[independent architecture review](.github/workflows/factory-review.md).
There is no Copilot coding-agent assignment, schedule, personal canvas dependency,
automatic plan approval, automatic merge, or autonomous repair loop.

**One-time human setup:** publish this reviewed commit to `main` only when ready.
Enable GitHub Actions and its **Allow GitHub Actions to create and approve pull
requests** setting (these workflows create drafts, never approve them). Create
three labels: `factory`, `factory-approved`, `factory-review`. In repository
Settings > Secrets and variables > Actions, add `COPILOT_GITHUB_TOKEN`, a
user-owned fine-grained PAT with **Copilot Requests: Read**, issued by an account
with Copilot access. This is the same secret name the Harbor pilot expects;
ordinary `GITHUB_TOKEN` cannot authenticate personal-repository Copilot requests.
Do not put credentials in issues, source, plans or PRs. No extra write PAT/App
secret is required. Enable code scanning for the separate [CodeQL
check](.github/workflows/security.yml); GitHub Code Security licensing is required
if using a private repository. Request Copilot code review manually where the
account/repository supports it; it is not enabled by these files.

1. Open a small issue containing the specification, non-goals and numbered,
   observable acceptance criteria. A human with repository admin, maintain or
   write access applies `factory`. **Factory plan** reads local skills/source and
   posts one plan; missing scope/criteria produce a blocker, not implementation.
2. Review the plan against the issue. Apply `factory-approved` to authorize one
   **Factory implement** run. It implements/tests from the issue criteria and
   creates at most one **draft** PR through gh-aw safe outputs. Workflow/control
   files and root manifests are excluded by a file allowlist; new dependencies or
   broader factory changes require a separate human-reviewed change.
3. Inspect the draft diff and evidence before **marking it ready for review**.
   This human event runs existing **CI** and **Security / CodeQL JavaScript and
   TypeScript** on the PR. `GITHUB_TOKEN`-created PRs do not automatically trigger
   ordinary push/PR workflows; do not assume checks ran at creation. Both
   workflows explicitly include `ready_for_review`. If necessary, manually run
   CI and Security selecting the PR branch, and verify their checked SHA.
4. Request **Copilot code review** separately, then apply `factory-review` to the
   PR. A fresh gh-aw run imports the
   [architecture-reviewer](.github/agents/architecture-reviewer.agent.md)
   guidance as workflow instructions (not `engine.agent`, whose local
   `read`/`search` allowlist would hide the GitHub read and safe-output tools)
   and compares the exact PR diff with the linked issue/plan. It posts up to five
   inline findings and one summary, including the reviewed SHA and missing
   evidence; if evidence or tools are unavailable it still reports why rather
   than ending silently. This review workflow opts out of GitHub author-integrity
   filtering (`min-integrity: none`) so unmerged PR diffs/files are readable;
   PR/issue/comment content remains untrusted data, with read-only access and
   threat-detection-gated, bounded safe outputs. CodeQL is a separate non-agent
   static security check; gh-aw's bounded threat detector also gates all safe
   outputs. Neither is proof of security.
5. A person resolves findings, confirms acceptance evidence, green CI/CodeQL and
   reviews on the **current head SHA**, approves, and merges manually. Close the
   issue manually after acceptance. Configure branch protection/rulesets to
   require these checks and a human approval if enforcement is desired; these
   files do not change repository settings or bypass protections.

Only labeled events from human senders with an explicitly allowed repository
role are admitted; bots cannot advance stages with their own comments/labels.
The review uses `pull_request_target` deliberately to load the **trusted base**
workflow/persona, checks out only the base SHA, rejects forks/non-default targets,
has no shell tool and reads head source/diffs via read-only GitHub tools. Do not
change it to execute or check out PR code with secrets. The agent jobs have
read-only GitHub permissions; framework activation/reporting and isolated
safe-output jobs have their own scoped write permissions. Agent-requested
outputs are published only after threat detection. The generated PR publisher necessarily
uses authenticated git credentials in its isolated publishing job; `gh aw lint`
reports the upstream `artipacked` warning there, not in an agent checkout. Default
firewall isolation, scoped network groups, immutable action/container pins and
protected-file checks remain enabled. Prompt constraints are guidance, not a
replacement for these mechanical boundaries.

**Costs and retries:** per agent run the plan allows 12 turns / 100 AI credits /
10 minutes, implementation 30 turns / 300 AI credits / 30 minutes, and review
15 turns / 100 AI credits / 15 minutes. Each separate
threat detector allows 5 turns / 5 credits (upstream detector timeout: 10 minutes).
One pass therefore has 515 configured AI credits across agents and detectors;
credits are not dollars or a guaranteed bill, and Actions, Copilot code review,
and Harbor spend are separate. Usage can overshoot at a request boundary.
Repository variable `GH_AW_DEFAULT_MAX_DAILY_AI_CREDITS` can provide an additional admission budget;
inspect gh-aw usage/billing before enabling. Per-issue/PR concurrency prevents
overlap, not repeated spending. Removing/reapplying labels or rerunning Actions
is a new paid attempt. Never automatically retry.

Revoke approval before editing an issue or plan; review again and reapply
`factory-approved`. An open linked PR should block duplicate implementation,
but that check and plan freshness are agent-guided, not an atomic issue lock or
cryptographic approval of a plan revision. For review after a fix, remove/reapply
`factory-review`; previous findings do not cover a new SHA. Fixes are manual in
this first slice. Failures/budget exhaustion or unavailable Docker evidence are
blockers, not green acceptance; inspect run logs and only retry deliberately.
Start with a narrow existing-dependency unit-tested change. The metered hosted
journey, native agent tool exposure, and CodeQL upload remain unverified until
the first human-authorized live run.

**No-model authoring checks:** install the official CLI, use the same version that
generated the committed locks (`gh aw` v1.0.1), and never hand-edit `.lock.yml`.
Initialization was local-only (`--no-mcp --no-agent --no-skill`); it does not
install another coding-agent setup or replace our skills/reviewer.

```sh
gh extension install github/gh-aw
gh aw --version
gh aw compile --strict --validate --actionlint --no-check-update
gh aw validate --strict --no-check-update
gh aw lint
pnpm lint
pnpm typecheck
pnpm test
```

Commit regenerated `.lock.yml` and `.github/aw/actions-lock.json` alongside the
Markdown sources. Generated locks are excluded from Prettier; gh-aw/actionlint
validate them. Stock actionlint (including 1.7.12) cannot parse gh-aw-generated
`job.workflow_ref` and `concurrency.queue`; use gh-aw's compatible bundled
actionlint for locks, and stock 1.7.12 for the ordinary YAML workflows above.
These commands do not dispatch agents,
create remote labels, read/set secrets or spend model credits. Review compiler
security-escalation warnings before accepting a changed action/secret/trigger.

## Try the complete journey

1. Open http://localhost:8080. Add a tea and place a pickup order as the seeded
   Demo Customer. No payment is requested.
2. Open http://localhost:8081. Select the new order by its short receipt ID,
   choose **Start preparing**, then **Complete order**.
3. Inspect **Behind your cup** in either app. Order facts and each consumer have
   independent states. Wait for inventory, simulated sale, and customer activity
   to become applied; pending or failed is not success.
4. Staff can inspect **Inventory**, **Sales ledger**, and **Customers**. Adjust
   stock with a reason when needed; retry a failed effect after fixing its cause.

The demo uses one Downtown store and two milk teas. Browser order tracking is
stored locally as a receipt ID and restored on reload; it is not authentication.
Both interfaces refresh activity every three seconds and expose loading, empty,
validation, unavailable-service, and retry states. Latest-order/ledger views are
bounded to 100 records, not an unlimited reporting system. Staff actions are
available only through the staff gateway's routes, but this is not an authorization
boundary: the whole loopback-only stack is deliberately unauthenticated.

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

**Orders:** `GET /menu` lists items from Orders' own menu table (two seeded house
drinks plus staff-created items), including `available`; `?available=true` returns
only available items. `POST /menu` accepts strict `{ name, description?,
unitPriceMinor (0..100000), currency: 'USD', available }`, rejects non-USD
currencies with 400 and case-insensitive duplicate names with 409, and returns 201. Menu creation is USD-only while the storefront uses USD without conversion.
Only the Store Ops gateway exposes
`POST /api/menu`. New items have no Inventory recipe, so completing an order for
one shows a visible failed Inventory effect while Finance and Customers apply.
Menu requests are rate-limited by Orders using `@fastify/rate-limit`: at most
120 reads and 30 creates per minute per source IP, with separate budgets.
Excess requests are rejected before validation or database access with 429,
an `error` message, and a `Retry-After` header preserved by both gateways.
Orders does not trust forwarded IP headers, so browsers using the same gateway
share that gateway's source-IP budget. Limits are in-memory, reset on restart,
and apply only to the menu routes, not order processing or health checks.
This is demo resource protection, not authentication or production-grade
distributed throttling.
Placement accepts `storeId`, optional `customerId`, `currency` (three
uppercase letters), and 1..50 `items`. Each item is a caller-provided snapshot:
`productId`, `name`, `quantity` (1..100), `unitPriceMinor` (0..100000). The service
computes `totalMinor`; clients cannot supply status or totals. There is no product
catalog lookup or customer lookup, and these snapshots are not trusted pricing
for a real shop. Orders start `confirmed`; transitions are `confirmed -> preparing`,
`preparing -> completed`, and `confirmed/preparing -> rejected/cancelled`.
Terminal orders cannot change state. The status PATCH accepts `{ status }`, plus
a required nonempty `reason` for rejection/cancellation. Updates condition on
the previous state atomically. Lists optionally filter by `storeId` and `status`.
Placement and terminal changes each persist an outbox fact in that same transaction.
Preparation is order-local state, not a published integration fact.

**Inventory:** create accepts `{ storeId, name, unit }`, where `unit` is `g`, `ml`,
or `pieces`, and initial `onHand` is zero. Ingredient names are case-insensitively
unique per store. Adjustment accepts `{ delta, reason }`, where delta is a
nonzero integer in -1000000..1000000. Stock must remain within 0..1000000.
The count and history record commit in one transaction; competing decrements
cannot make stock negative. Lists optionally filter by `storeId`.
Both seeded drinks use a minimal service-owned recipe: 50g tapioca pearls per cup.
Completed-order events deduct recipe quantities atomically and add stock history.
Missing recipes or insufficient ingredients persist failed effects; they do
not undo the completed order or silently fabricate stock. There are no reservations.

**Finance:** create accepts `{ storeId, kind, amountMinor, currency, memo }`,
where `kind` is `income` or `expense`, and amount is an integer in 1..100000000.
There is no update/delete endpoint or payment processing.
Version 2 completed-order facts add a simulated income entry once per operation.
Lists optionally filter by `storeId` and `currency`; summaries require `storeId`
and return `{ items }`. Each currency has `incomeMinor`, `expenseMinor`, and
`balanceMinor` as **decimal strings** to preserve aggregate integer precision.
An empty ledger returns an empty list, not invented zero entries.

**Customers:** create accepts `{ name, email, phone? }`; PATCH accepts any nonempty
subset. Emails are trimmed and lowercased, names are trimmed, and `phone: null`
clears a phone while omitted fields are preserved. Completed-order effects update
a count and currency-separated spend for the linked customer. Guest completions
are explicitly skipped; a nonexistent referenced customer produces a failed effect.
Profiles expose `completedOrderCount` and `totalSpend` with decimal-string totals.
There is no loyalty program. Lists optionally filter by exact normalized `email`.

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

The first migration inserts one fictional record per service exactly once;
later migrations add the menu, recipes, outbox, effect receipts, and customer totals.
The demo store ID is `00000000-0000-4000-8000-000000000001`. Seed record IDs end in
`101` (confirmed tea order), `201` (10000g tapioca pearls), `301` (manual USD supplies
expense), and `401` (customer `demo@example.test`). These records are independent;
seeding does not enact an order workflow. Normal restarts preserve data and do
not reseed it. Only the documented volume reset deletes application data.

### Event status and recovery APIs

Orders exposes `GET /orders/:id/events` with outbox publication status, attempts,
and the last publication error. Inventory, Finance, and Customers each expose
`GET /effects/:orderId`; effect records include the event type, semantic operation
ID, `pending`/`processed`/`failed`/`skipped` status, attempt count and error.
`POST /effects/:orderId/retry` retries that owner's failed effects, never a global
workflow. A retry can still fail if the recipe, stock, or customer has not been fixed.

The gateways route the public app API under `/api/`; staff additionally exposes
stock adjustments, order status changes, and per-owner retries. Both offer
`GET /api/orders/:id/journey` for read aggregation of the order, outbox and
each owner's effects. Staff offers `GET /api/dashboard?storeId=UUID`.
Every aggregation section explicitly reports `available` with its owner's data
or `unavailable` with an error. Gateways neither apply effects nor decide that a
journey succeeded; consumer processing is identified specifically by completion
event type, never by a processed placement receipt.

RabbitMQ queues and messages are durable; publisher confirms precede marking an
outbox record published. Redelivery is expected. Each consumer persists a pending
receipt before processing, and atomically commits its side effect and processed
marker under a unique semantic operation ID. Duplicate delivery cannot deduct
stock, add a sale, or increment customer totals twice. Pending receipts recover
after worker restarts; failed effects retain their error for repair and explicit
retry. Broker outages leave facts in the outbox and reconnect automatically. Invalid
JSON or unsupported event schemas are logged and persistently quarantined in
`boba.inventory.invalid`, `boba.finance.invalid`, and `boba.customers.invalid`,
visible in RabbitMQ management; they are not silently discarded. Repairing and
replaying quarantined messages is a manual operator task, not an automatic schema
migration. Connection, setup, and publisher-confirm waits have five-second bounds.
