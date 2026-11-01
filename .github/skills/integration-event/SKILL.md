---
name: integration-event
description: Evolve an order integration fact or its downstream effect. Use when adding/versioning event payloads, changing outbox publication, or changing consumer idempotency and recovery.
---

# Integration-event change

## 1. Trace the fact

Read [contracts](../../../packages/contracts/src/index.ts),
[Orders](../../../services/orders/src/app.ts), and
[messaging](../../../packages/messaging/src/index.ts). Read the affected consumer's
`services/<owner>/src/app.ts`, startup and migrations. Record the producer-local
mutation, required payload, subscribing owners, atomic writes and visible outcomes.
**Done:** every affected owner is named; Orders needs no downstream call or result.

## 2. Specify compatibility

Current schemas are strict: even an added optional field is rejected by an older
schema. New shapes need a distinct wire version and an explicit old/new subscriber
rollout decision. Completion v2 is self-contained; legacy v1 parses but its
completion effects fail explicitly because details are missing. Preserve existing
schemas unless the request explicitly changes compatibility.

Write one failing public-behavior test at a time using
[contract tests](../../../tests/contracts.test.ts) or
[broker/API integration tests](../../../tests/integration/events.test.ts).
**Done:** old/new valid payloads, invalid payloads and unsupported-version behavior
have explicit expectations; rollout gaps are identified, not hidden by defaults.

## 3. Wire atomic ownership

Change the contract and the producer's local transaction together. Persist stable
`eventId` and semantic `operationId` with the domain mutation; the relay confirms
publication before marking the outbox published. If a new owner publishes, give
that owner its own outbox rather than writing Orders' database.

Apply each consumer's effect using the transaction supplied by
`createEffectConsumer`; that transaction also commits the receipt's processed
marker. Add local numbered migrations for new durable data and wire startup/close
hooks if needed. A retry/redelivery keeps the operation ID and original payload;
define conflicting-ID/payload behavior explicitly rather than assuming the current
`ON CONFLICT DO NOTHING` compares payloads.
**Done:** no network-dependent business lookup, cross-database query or detached
effect write; failed effects remain repairable and pending receipts recover.

## 4. Verify facts versus effects

Through service APIs and real RabbitMQ delivery, assert exact stock/ledger/customer
changes after duplicate delivery, retained failure then owner retry, and recovery.
Include any new malformed-message behavior: current transport confirm-publishes
invalid payloads to durable invalid queues before acknowledgment.

When observable states change, inspect
[gateway aggregation](../../../packages/gateway-runtime/src/index.ts) and
[journey UI](../../../packages/web-ui/src/index.tsx). A processed placement receipt
must not stand in for completion effects. Use [README checks](../../../README.md#development-checks)
and the isolated integration Compose command there; use `compose-journey` when the
customer/staff journey changes.
**Done:** affected tests, lint, typecheck and build pass; report payload/version,
rollout assumptions, exact idempotency evidence and any unverified outage case.
