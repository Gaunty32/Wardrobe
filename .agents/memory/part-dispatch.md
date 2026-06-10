---
name: Part-Dispatch Design
description: How part-shipment works — per-item dispatched_at, part_shipped order status, queue/invoice/email rules
---

## The rule

When dispatching, only items that are "ready now" get marked with `dispatched_at = now`. If any undispatched items remain, the order status becomes `part_shipped` instead of `shipped`.

**Why:** Customers sometimes order decorated goods (worksheets) + plain/purchase goods together. The decorated items can ship first; the purchased goods follow when the PO is received.

## Schema

`order_items.dispatched_at timestamptz` — null means not yet shipped. Added via startup migration (`IF NOT EXISTS`).

## Readiness logic in dispatch POST

Items are dispatched in this event if:
1. Their order item ID is in a **completed** worksheet, OR
2. `stock_status IN ('complete', 'allocated')`

Items not meeting either criterion remain undispatched → order stays `part_shipped`.

## Dispatch queue (GET /dispatch/orders)

- `part_shipped` is NOT in `excludedStatuses` — these orders always appear in the queue.
- For `part_shipped` orders: `allComplete` (→ `productionComplete` on the response) = all remaining undispatched items have `stockStatus = 'complete' OR 'allocated'`.
- For `confirmed` orders: existing decoration-aware logic (worksheets complete / all stock complete).

## Ready check (GET /dispatch/orders/:id/ready)

Same split: for `part_shipped`, check remaining items only. `incompleteItemIds` excludes `allocated` items (they're ready, just not decorated).

## Invoice filtering

Both WHERE clauses in `invoices.ts` use `IN ('shipped', 'dispatched', 'part_shipped')`.

`buildInvoiceDataForOrder` in `email.ts` filters `allItems` to `dispatchedAt != null` when `order.status === 'part_shipped'` — so the invoice only covers what has actually shipped.

## Frontend (Dispatch.tsx)

- `DispatchItem` has `dispatchedAt: string | null`.
- `part_shipped` orders show an amber **"Part Shipped"** badge in the header.
- Info banner: "Part dispatched — N item line(s) awaiting delivery" when remaining items aren't ready; "Remaining items in stock" green banner when they are.
- Dispatch button becomes amber "Dispatch Remaining".
- `onSuccess` toast says "Part dispatched — remaining items will follow when ready."
- Overdue/due-today banner is suppressed for `part_shipped` orders (uses different messaging).

## How to apply

Any time dispatch is triggered, the POST handler automatically determines what's ready and what isn't. No extra UI action needed. When the follow-up PO is received and stock allocated, the order reappears in the dispatch queue with `productionComplete=true`.
