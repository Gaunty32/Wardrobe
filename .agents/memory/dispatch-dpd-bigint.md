---
name: Dispatch DPD job ID overflow
description: dpd_job_id column overflow crashed dispatch after a successful courier booking, blocking despatch note production
---

DPD's `shipmentId` values (e.g. `2670855216921369`) exceed Postgres `integer`
range (~2.1B). The `orders.dpd_job_id` column was defined as `integer`, so
after DPD successfully booked a shipment, the final `UPDATE orders SET
dpd_job_id = ...` threw an uncaught "integer out of range" error. This crashed
the whole dispatch route with a raw 500 — even though the courier booking had
already succeeded — and because the frontend only produces the despatch/
delivery note in the mutation's `onSuccess` handler, no note was ever
generated.

**Why:** A DB write failure downstream of an already-successful external
side effect (the DPD booking) must not be allowed to make the whole request
look like total failure, or the user loses both the note and visibility into
the fact DPD actually succeeded.

**How to apply:** `orders.dpd_job_id` is now `bigint`. Additionally, the order
update in `dispatch.ts` is wrapped in try/catch: if saving DPD-specific fields
fails for any reason, it retries the same update without those fields so the
order still dispatches and the despatch note can still be produced, surfacing
the save failure via `dpdError` instead of crashing. Apply the same pattern
(never let a post-success persistence failure block the user-facing outcome)
if other integrations get bolted onto dispatch/fulfillment flows later.
