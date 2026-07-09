---
name: Variant supplier bulk-update wipe bug
description: Root cause of the recurring "purchasing items back under default supplier" issue — bulk update mutation always sent primarySupplierId:null when no supplier was selected.
---

## The Rule
When the bulk variant update sends `primarySupplierId: null` (because the supplier dropdown is "none"), the server-side guard `if ("primarySupplierId" in req.body)` triggers and wipes ALL variant-specific supplier assignments. Fix: only include `primarySupplierId` in the request body when the user explicitly selects a real supplier.

## Why
The frontend `bulkUpdateMut` in `ProductDetail.tsx` used:
```js
...(supplierId !== "none" ? { primarySupplierId: Number(supplierId) } : { primarySupplierId: null })
```
The else branch always sent `primarySupplierId: null`. Any bulk price or code update done without changing the supplier dropdown (left at "none") would clear `product_variants.primary_supplier_id` for every selected variant. Since ALL 30,999 variants ended up with `primary_supplier_id = NULL`, items always fell back to the product-level supplier in the purchasing requirements queue.

## How to Apply
- `ProductDetail.tsx` bulk update: use `...(supplierId !== "none" ? { primarySupplierId: Number(supplierId) } : {})` — omit the field entirely when "none".
- Server-side bulk PATCH at `product-variants.ts:92` is correct — `if ("primarySupplierId" in req.body)` only applies the update when the field is present.
- Companion fix: startup migration "Variant supplier prices synced to product level" now guards `AND (pv.primary_supplier_id IS NULL OR pv.primary_supplier_id = p.supplier_id)` so variant-specific supplier prices are not overwritten by the product's default price on every restart.
