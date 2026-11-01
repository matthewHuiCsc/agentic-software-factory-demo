---
name: compose-journey
description: Verify the real customer-to-staff Compose journey or diagnose its processing/recovery state. Use for end-to-end acceptance, duplicate delivery, downstream failure/retry, or broker/database recovery checks.
---

# Compose journey evidence

## 1. Establish the runtime

Read [run guide](../../../README.md#run-locally),
[checks](../../../README.md#development-checks) and
[CI](../../workflows/ci.yml). Use their commands from the repository root and the
pinned package manager; host Node runs checks, not application servers.
Inspect existing Compose status before rebuilding. Preserve existing demo volumes
and unrelated changes; use the isolated test Compose project for backend fixtures.
**Done:** both Compose configurations validate and all ten normal services report
healthy, or the failing component and logs are recorded as a blocker.

## 2. Verify independent completion

Run the unit/API and isolated DB/RabbitMQ integration suites, then the browser
suite against the healthy normal stack. See
[event integration](../../../tests/integration/events.test.ts),
[browser journey](../../../tests/browser/journey.spec.ts) and
[stock recovery](../../../tests/browser/recovery.spec.ts) for the existing seams.

Observe customer placement, staff preparation/completion, published order facts,
and each completion effect separately. Assert exact stock decrease, one simulated
sale and customer count/spend changes. Duplicate delivery must change none twice.
**Done:** assertions use service/gateway APIs, RabbitMQ delivery or browser behavior;
an order's completed status alone never counts as downstream success.

## 3. Classify and repair failure

Read [recovery APIs](../../../README.md#event-status-and-recovery-apis).
Inspect `GET /api/orders/:id/journey`: unpublished facts imply publication pending;
available owner effect records distinguish pending/processed/failed/skipped;
an unavailable section is not an empty successful result. Inspect only the
`OrderCompleted` effects when judging completion.

For a failed stock effect, repair stock with a reason through staff operations,
then retry only Inventory. Verify the durable error clears and exact effects apply
once. Retain the original operation ID. Invalid-message queues need manual
inspection/repair, not an automatic retry promise.
**Done:** failure is visibly reproduced, its owner is identified, and retry either
applies exactly once or retains an explicit unresolved error.

## 4. Bound outage checks and report

If broker/database outage testing is requested, first confirm the running stack is
safe to interrupt. Save baseline API values, interrupt only the named Compose
service, and restore it even if an assertion fails. Broker loss should retain
outbox work; DB loss should expose unavailability. After recovery, verify retained
work through owner APIs without assuming restart equals successful processing.
**Done:** dependency health is restored and outcome/pending failure is observed.

Report commands/results, service health, exact effect evidence, failure/recovery
coverage and untested cases. Browser tests create fictional records; preserve demo
volumes and restore any adjusted stock fixture. Stop only isolated test resources;
leave requested app previews running. Evidence/report paths come from CI and
Playwright config, not a second command catalog.
