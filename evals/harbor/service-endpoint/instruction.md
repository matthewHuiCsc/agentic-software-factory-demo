For this Harbor trial, replace the original case's plan-only output request
with implementation of its **gateway-only** slice: expose the owner's existing
history through the staff gateway at `GET /api/stock/:id/adjustments`.
Do not add a UI, database query, migration or event.

Preserve the owner's response, pagination query and validation/error semantics.
Keep history unavailable through the customer gateway, keep the existing POST
adjustment route working, and do not turn upstream unavailability into empty
history. Follow the repository's fixed-route forwarding and ownership patterns.

Work in `/workspace`. Change only `packages/gateway-runtime/src/index.ts`.
The source and repository customizations are supplied for normal inspection;
dependencies are installed. You may run local checks, but there is no database,
broker or live Compose application in this environment.
