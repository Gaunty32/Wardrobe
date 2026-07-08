---
name: Unsound "safety net" startup migrations
description: Startup migrations that "fix" data using indirect evidence (e.g. current stock < needed) can misfire on unrelated legitimate states and silently corrupt data on every restart/deploy.
---

A startup migration ("Safety Net F") reverted `purchase_required=true, stock_status=NULL` items back to needing purchase whenever current stock was less than the item's quantity. Its real target was a rare, specific case (a deleted fuzzy-linked PO), but the heuristic it used — "stock is currently insufficient" — is indistinguishable from the normal, correct state of a plain item that was legitimately stock-fulfilled and then had stock consumed/adjusted elsewhere. Every server restart re-ran this and re-broke already-fixed orders.

**Why:** Startup migrations run unconditionally on every deploy/restart. Any migration whose trigger condition is a *symptom* shared by both the broken case and a valid case will eventually revert legitimate data, and because it's silent (no error, no log distinguishing which items it touched and why), the regression looks like a new bug each time rather than a repeating self-inflicted one.

**How to apply:** Before writing or trusting a startup "safety net" migration, ask whether its trigger condition can *only* be true in the broken state. If not, either add a more specific discriminating condition (e.g. a marker column, a link to the specific broken entity) or don't run it automatically — make it a one-off manual script instead. When investigating a recurring data-corruption bug that "comes back after every deploy," check `services/startup-migrations.ts` for a safety-net migration with a similarly loose condition.
