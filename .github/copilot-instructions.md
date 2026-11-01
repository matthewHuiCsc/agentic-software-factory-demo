# Repository conventions

- Keep domain queries and migrations in the owning service. Each backend uses
  only its own database and credentials; shared packages contain mechanics,
  contracts or UI primitives, not cross-service domain policy.
- Orders owns composition, price snapshots and lifecycle. It publishes its own
  facts through a transactional outbox; it never calls or coordinates Inventory,
  Finance or Customers. Consumers independently apply completion effects.
- Preserve atomic domain-write/outbox commits and atomic effect/idempotency
  commits. Reuse semantic operation IDs on retries; publisher confirmation is
  not consumer success. Expose genuine pending, failed, skipped and unavailable
  states, with owner-specific repair/retry.
- Gateways perform fixed-route forwarding and read aggregation only. Apps use
  their own gateway's same-origin `/api`; neither gateway owns database/broker
  credentials or sequences domain writes.
- Follow strict Zod request/event schemas, parameterized SQL, typed shared
  helpers and logged errors. Add numbered migrations; applied checksummed
  migrations are immutable. Preserve currency-separated integer-minor-unit
  money and decimal-string aggregate totals.
- Keep the demo fictional: no real authentication, payments or stock reservation.
  Docker Compose is the application runtime; preserve `research/`.
- For run/check commands and seed data, read [README](../README.md). For event
  evolution, use `integration-event`; for endpoints, use `service-endpoint`;
  for full-stack verification or recovery, use `compose-journey`.
