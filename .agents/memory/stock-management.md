---
name: Stock Management System
description: Schema, API, and UI decisions for the bins/plain stock overhaul
---

## Key decisions

**Schema additions (via startup-migrations.ts):**
- `product_variants.bin_location text` — which physical bin this variant lives in
- `product_variants.min_stock_qty integer NOT NULL DEFAULT 5` — per-variant low-stock threshold
- `stock_bins` table: id, bin_number (unique), notes, max_qty (default 15), created_at

**Why per-variant min_stock_qty:** The old system used a hardcoded constant of 5. Proper low-stock alerting requires per-SKU thresholds since a polo shirt needs different minimum stock to a tie.

**Bin suggestion algorithm:** Scores bins by: same variant already there (+1000) + available capacity. Bins that would overflow after adding qty are excluded from suggestions (except current bin which is shown with warning).

**Label format:** 6×4 inches, returns full HTML with print toolbar. Two types:
- Bin label: `/api/stock/bins/:id/label` — just the bin number in 72pt font
- Garment/stock label: `/api/stock/plain/:id/label` — FCC code, supplier code, name, colour, size, qty, type, bin, date

**Plain Stock UI:** Product cards (collapsed/expanded toggle), flat rows per colour+size within each product, no nested expand. Stock Take button per product opens QuickAdjustModal for bulk editing all variants of that product.

**InlineBin component:** On click, fetches `/api/stock/bins/suggest?variantId=N&qty=1` and shows suggested bins as quick-pick buttons below the input.

