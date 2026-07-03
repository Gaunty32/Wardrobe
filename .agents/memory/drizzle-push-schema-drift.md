---
name: Drizzle push schema drift
description: pnpm --filter db push proposes destructive drops due to pre-existing drift between schema.ts and the live dev DB; do not accept it for scoped fixes
---

Running the db package's `push` script (`drizzle-kit push`) compares the full
`schema.ts` against the live database and will propose dropping many unrelated
tables and columns that exist in the DB but aren't declared in the current
schema file (legacy/unmigrated drift, not something the current task touched).

**Why:** Accepting the "Yes, remove tables/columns" prompt would silently
delete real data unrelated to the change being made (seen: 7 tables incl.
`customer_portal_users`, `demo_leads`, plus ~21 columns across `products`,
`orders`, `customers`, etc., all with live rows).

**How to apply:** When you only need one column type/definition changed,
do NOT run the workspace-wide `push`/`push-force` scripts. Instead apply a
scoped `ALTER TABLE ... ALTER COLUMN ...` (or equivalent) directly via
`executeSql` against the `development` environment. Reserve full schema push
for when you've verified the diff is limited to your intended change, and
always abort (do not select "Yes") if it lists unrelated drops.
