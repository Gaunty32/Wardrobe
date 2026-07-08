---
name: stock_status finish_id rule for order_items
description: Any code path that sets order_items.stock_status='allocated' must check finish_id, or plain items get stuck and never reach Despatch
---

Rule: whenever purchase_required flips to false and stock_status needs setting, always use
`CASE WHEN finish_id IS NULL THEN 'complete' ELSE 'allocated' END` — never hardcode `'allocated'`.

**Why:** Despatch only promotes `'allocated'` items to `'complete'` via the decoration picking-list
workflow. Plain (undecorated) items have no picking list, so if something sets `stock_status='allocated'`
on a plain item, it's invisible to Purchasing (purchase_required=false) but can never reach Despatch —
a silent limbo state. This exact bug existed in one startup safety-net in
`artifacts/api-server/src/services/startup-migrations.ts` that set `'allocated'` unconditionally.

**How to apply:** When adding/editing any migration or route logic in api-server that resolves
purchase requirements or promotes stock coverage, grep for other `stock_status.*'allocated'` sites
in the codebase and mirror the finish_id CASE pattern used by the majority of them.
