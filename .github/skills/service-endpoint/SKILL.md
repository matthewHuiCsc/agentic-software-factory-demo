---
name: service-endpoint
description: Add or change a service API endpoint and its client exposure. Use for request validation, persistence-backed routes, gateway allowlisting, or API response changes used by either app.
---

# Service endpoint vertical slice

## 1. Choose the owner and boundary

Read the owner's `services/<owner>/src/app.ts`, migrations and existing
`tests/integration/<owner>.test.ts`. Read
[HTTP conventions](../../../packages/service-runtime/src/index.ts) and
[README API slice](../../../README.md#backend-api-slice). Specify method/path,
request/response, invalid/missing/conflicting cases and the local invariant.
Decide whether the endpoint stays internal or is exposed to customer/staff clients.
**Done:** one owner can enforce the behavior using only its database; permissions
are described as demo route exposure, not real authorization.

## 2. Implement one observable slice

Start with a failing HTTP test through Fastify injection with the existing
integration fixture; avoid testing private SQL helpers as the acceptance seam.
Use strict Zod input parsing, `idParams`/`pagination` where applicable, parameterized
SQL and `HttpError` for deliberate rejections. Preserve camelCase JSON, explicit
nullable fields and existing error envelopes. Protect invariants with conditional
writes or a local transaction; add a numbered migration for persistent changes.

Use `integration-event` if a write changes an order fact or downstream effect.
**Done:** the successful response and state can be observed through HTTP; invalid
input, not-found/conflict cases and relevant competing writes are covered without
success-shaped fallbacks.

## 3. Wire only the intended clients

For an exposed endpoint, extend the allowlist in
[gateway runtime](../../../packages/gateway-runtime/src/index.ts), preserving the
customer/staff split and upstream error status. For aggregation, keep each owner
section independently available or unavailable.

If consumed by an app, update response schemas in
[web UI](../../../packages/web-ui/src/index.tsx) and the affected app. Keep
loading/empty/error states and keyboard-accessible controls. Add focused
[gateway tests](../../../tests/gateways.test.ts) and browser coverage for changed
user journeys.
**Done:** internal-only routes remain unexposed; exposed routes are exercised
through the correct gateway and UI reflects real owner responses.

## 4. Close the slice

Run the relevant tests and [development checks](../../../README.md#development-checks);
the isolated Compose integration runner builds shared packages before tests.
Update the README API slice when the public behavior changes. Use `compose-journey`
for a change affecting pickup, completion or visible processing.
**Done:** lint/typecheck/build and affected tests pass; report owner, route exposure,
response/error contract, migration and actual verification, including blockers.
