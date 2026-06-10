---
name: Bundle Feature
description: Design decisions and gotchas for the bundle (pre-defined product set) feature in the SBS order system.
---

# Bundle Feature

## Schema
- `bundles` — master bundle definitions (id, name, sku, description, price, is_active, notes)
- `bundle_components` — products included in each bundle (bundle_id, product_id, product_name, quantity, finish_id, finish_name)
- `order_items` additions: `bundle_ref TEXT`, `is_bundle_header BOOLEAN DEFAULT false`, `bundle_def_id INTEGER`

## How bundles expand into orders
- `POST /api/bundles/:bundleId/add-to-order/:orderId` with body `{ quantity: N }`
- Creates one **header row** (is_bundle_header=true, price=bundle price × qty, bundle_ref=uuid)
- Creates one **component row per bundle component** (is_bundle_header=false, unit_price=0, line_total=0, same bundle_ref)
- Order total recalculated via `SUM(line_total)` — works naturally since components are £0

## Frontend patterns
- `apiFetch` in Bundles.tsx is defined locally (as `async function apiFetch(...)`), NOT imported from `@/lib/api` (doesn't exist)
- `useToast` in order-system pages comes from `@/hooks/use-toast` not `@/components/ui/use-toast`
- bundles query key: `["bundles"]` — invalidated after add-to-order in OrderDetail.tsx

## PDF rendering (email.ts generateOrderAcknowledgementPdf)
- Group type extended with `bundleRef` and `isBundleHeader`
- Sort: bundle items come first (sorted by bundleRef, header before components), then regular items
- Bundle header group key: `__BDL_HDR__:${bundleRef}`
- Bundle component group key: `__BDL_CMP__:${bundleRef}:${productName}||${finishName}`
- Rendering: bundle header → dark navy row with "BUNDLE" label + name + qty + total; skip colour matrix
- Bundle components → lighter grey background, "└ " prefix, "incl." instead of price
- `allSizes` excludes bundle header items (they don't render colour matrix rows)

## Acknowledgement PDF items query (orders.ts)
- Switched from Drizzle `.select()` to raw `db.execute(sql`...`)` to include `bundle_ref` and `is_bundle_header`
- Raw result accessed as `rows.rows ?? rows` (snake_case keys from pg driver)

**Why:** Drizzle `.select()` only returns columns defined in the schema; bundle_ref/is_bundle_header were added by raw ALTER TABLE so they're not in the Drizzle schema.
