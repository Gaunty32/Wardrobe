# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (use `import { z } from "zod"` — NOT `zod/v4` in api-server), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite (TailwindCSS, shadcn/ui, React Query, Recharts, React Hook Form)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   ├── api-server/         # Express API server
│   ├── order-system/       # Sales Order System (React + Vite)
│   └── customer-portal/    # Customer-facing ordering portal (React + Vite)
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts
├── pnpm-workspace.yaml     # pnpm workspace
├── tsconfig.base.json      # Shared TS options
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## White-Label Intent

This application is being developed for white-labelling to other businesses. Keep the following in mind throughout development:

- **Branding must be configurable**: logo, business name, and brand colours should come from a config/settings layer, not be hard-coded. Currently SBS branding is in place as the first instance.
- **No hard-coded business names** in email templates, printed documents (labels, worksheets, purchase orders), or UI copy. Reference a `businessName` config value instead.
- **Domain-agnostic data model**: field names, categories, and terminology should stay generic enough to apply across different industries where possible.
- **Avoid assumptions** about the specific business (e.g. "garment", "embroidery") in shared code — keep those as configurable labels or confined to instance-specific configuration.
- Future work will include a settings/configuration page for business name, logo upload, contact details, and colour scheme.

## Applications

### Sales Order System (`artifacts/order-system`)

A modern web-based sales order management system replacing an old Microsoft Access system.

**Features:**
- Dashboard with key stats (orders, revenue, customers, products) and order status chart
- Sales Orders: create, view, and manage orders with status tracking (draft → confirmed → shipped → delivered → cancelled)
- Order Detail: add/remove line items, update status, view order total
- Customers: full CRUD with search, name/email/phone/address fields
- Products: full CRUD with SKU, description, unit price, stock quantity; clickable rows → Product Detail page
- Product Detail: tabbed page — Details (name/SKU/price/stock/description/supplier link), Colours (tag-based), Sizes (tag-based)
- Product Attributes: `product_attributes` table — type (colour/size) + value; managed via tags UI on Product Detail
- Suppliers: full CRUD — name, contact, email, phone, address; linked to products via supplierId/supplierCode

**Pages:**
- `/` → Dashboard
- `/orders` → Orders list
- `/orders/:id` → Order detail with line items (finish cost auto-added to unit price)
- `/customers` → Customers list
- `/customers/:id` → Customer detail (tabs: Employees, Roles, Wardrobe, Delivery Addresses, Contacts, Order History, Processes, Finishes)
  - **Employees tab**: active/inactive filter, job title, role assignment, preferred sizes (key-value pairs), reactivate button for inactive employees
  - **Roles tab**: CRUD for job roles (name, description); roles are used to assign employees and wardrobe items
  - **Wardrobe tab**: per-customer Finished Items with optional role assignment; filter pills to show all, company-wide, or per-role items
  - Processes tab: name, type, placement, price (£), process stock item link
  - Finishes tab: each finish shows constituent processes with prices + total cost badge; garment (product) assignments
- `/products` → Products list — grouped by category with filter pills; category field on add/edit; clickable rows
- `/products/:id` → Product detail (tabs: Details, Colours, Sizes)
- `/process-stock` → Process Stock (physical materials for decoration)
- `/purchasing` → Purchasing — consolidated purchase requirements by supplier with matrix view and email PO
- `/production` → Production — worksheet management with Pre-WIP / WIP / Complete tabs, A4 print view
- Order detail: Pack & Dispatch section — groups items by recipient, shows completion status per person, "Print 4×6 Label" button when all a person's items are on completed worksheets
- `/dispatch` → Post-Production Dispatch — order queue of all orders with ≥1 complete worksheet (not yet shipped), 3-stat summary bar (ready/pending/urgent), per-order production progress, smart banners (all complete → green; due today/overdue → amber), Print Wearer Labels (4×6 thermal, one per garment per named recipient), Print Delivery Note (A4 with delivery address, items by wearer, signature block), Mark Dispatched → sets status to "shipped" with timestamp
- Order detail: Required Date card in sidebar — editable date field (pencil icon), persists to DB, shows on Dispatch page for urgency calculation
- `/suppliers` → Suppliers list

### API Server (`artifacts/api-server`)

Express 5 REST API serving the order system frontend.

**Routes:**
- `GET/POST /api/customers` — list and create customers
- `GET/PATCH/DELETE /api/customers/:id` — customer operations
- `GET/POST /api/products` — list and create products
- `GET/PATCH/DELETE /api/products/:id` — product operations
- `GET/POST /api/products/:productId/attributes` — product colour/size attributes
- `DELETE /api/products/:productId/attributes/:id` — delete an attribute
- `GET/POST /api/suppliers` — list and create suppliers
- `GET/PATCH/DELETE /api/suppliers/:id` — supplier operations
- `GET/POST /api/orders` — list and create orders
- `GET/PATCH/DELETE /api/orders/:id` — order operations
- `POST /api/orders/:id/items` — add line item
- `PATCH/DELETE /api/orders/:id/items/:itemId` — update/delete line item
- `GET /api/dashboard/stats` — summary stats for dashboard

## Database Schema

Tables in PostgreSQL:
- `customers` — name, email, phone, address, city, state, postcode, notes
- `customer_delivery_addresses` — label, line1-2, city, county, postcode, country, isDefault
- `customer_contacts` — firstName, lastName, jobTitle, email, phone, notes
- `customer_roles` — customerId, name, description (job roles for grouping employees/wardrobe)
- `customer_employees` — customerId, firstName, lastName, jobTitle, roleId, email, phone, department, isActive, notes
- `customer_employee_sizes` — employeeId, label, size (preferred sizes for size suggestions)
- `customer_processes` — customerId, name, type, placement, price, processStockId
- `customer_finishes` — customerId, name, description
- `customer_finish_processes` — finishId → processId (many-to-many)
- `customer_finish_products` — finishId → productId (garment assignments)
- `customer_finished_items` — customerId, roleId (nullable), name, productId (nullable), finishId, colour, size, unitPrice, location (nullable), min_quantity (default 0) — Wardrobe + Stock
- `customer_stock_movements` — itemId, movementType (in/out/issue/adjustment), quantity, recipientName, reference, notes, createdBy, createdAt
- `products` — name, sku, description, unit_price, stock_quantity, category, supplier_id
- `product_attributes` — productId, type (colour/size), value
- `product_variants` — productId, colour, size, stockQty, price
- `orders` — order_number, customer_id, customer_name, status, total_amount, notes, order_date, required_date, delivery_address_id, dispatched_at, po_number, attention_of, portal_submitted_by_email, portal_submitted_by_name, portal_approved_by_email, portal_approved_by_name
- `order_items` — order_id, product_id, product_name, colour, size, finish_id, finish_name, recipient_type, recipient_name, quantity, unit_price, line_total, purchase_required (bool), purchase_quantity, supplier_id, supplier_name
- `purchase_orders` — po_number, supplier_id, supplier_name, supplier_email, status, notes, sent_at
- `suppliers` — name, contactName, email, phone, address
- `process_stock` — name, description, unit, stockQty, unitCost

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

- **Always typecheck from the root** — run `pnpm run typecheck`
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for validation and `@workspace/db` for persistence.

### `artifacts/order-system` (`@workspace/order-system`)

React + Vite frontend with shadcn/ui components, TailwindCSS, React Query for data fetching, Recharts for charts, React Hook Form for forms.

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `src/schema/customers.ts` — customers table
- `src/schema/products.ts` — products table
- `src/schema/orders.ts` — orders, order_items, worksheets, purchase_orders, order_logs tables
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`)

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and Orval config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package.

## User preferences

- **Shop (`artifacts/shop`) — mobile-first**: all shop UI work should be designed and optimised for mobile view first. Desktop is secondary.
- **Shop — SEO-first content**: all copy written for the shop (pages, product descriptions, Knowledge Centre articles) is written to rank on Google and ChatGPT. Use clear, direct language; answer real customer questions; avoid filler. Do not rewrite existing copy unless asked — its structure is intentional.
- **Shop — Core Web Vitals / page speed**: Google ranks on LCP, CLS, INP. Always: lazy-load below-fold images (`loading="lazy"`), use `width`/`height` on all `<img>` to prevent layout shift, code-split routes (React.lazy + Suspense), avoid render-blocking resources, keep bundle size down.
- **Knowledge Centre — "They Ask, You Answer"**: articles are structured around exact questions customers search for. Each article should directly answer the question in the opening paragraph, then expand. This approach is deliberate for both Google and AI search ranking.
- **No follow-up task suggestions**: do not propose follow-up tasks at the end of turns.
