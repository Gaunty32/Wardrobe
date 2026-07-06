---
  name: Whole-pound pricing enforcement
  description: Shared usePriceConfirm hook enforces whole-£ unit prices across order-system with a confirm-if-not-whole dialog
  ---

  Customer-facing "Unit Price" fields in order-system must default to whole pounds (spinner step="1") and show a confirmation dialog if the user tries to save a price with pence.

  **Why:** User explicitly requested this (chose "whole-£ spinner + confirmation dialog" over other options) after noticing decimal unit prices (e.g. 44.96) appearing where whole pounds were expected.

  **How to apply:** Use `usePriceConfirm()` from `artifacts/order-system/src/components/PriceConfirmDialog.tsx` — it exposes `confirmIfNotWhole(price)` (async, returns false if user cancels) and `dialog` (render once near the component's closing tag). Applied to: Products.tsx (create/edit Unit Price), ProductDetail.tsx (main Unit Price), Bundles.tsx (Bundle Price), OrderDetail.tsx (custom/service line item Unit Price in `handleAddItem`).

  Deliberately OUT of scope (left as decimal/step 0.01): supplier/cost price fields, CustomerDetail.tsx "Price per unit" / "Annual Allowance", and ProductDetail.tsx price-break tier prices — these aren't the "unit price" the user meant.
  