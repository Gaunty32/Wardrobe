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
│   └── order-system/       # Sales Order System (React + Vite)
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
- `/customers/:id` → Customer detail (tabs: Delivery Addresses, Contacts, Order History, Processes, Finishes, Employees)
  - Processes tab: name, type, placement, price (£), process stock item link
  - Finishes tab: each finish shows constituent processes with prices + total cost badge; garment (product) assignments
- `/products` → Products list (clickable rows)
- `/products/:id` → Product detail (tabs: Details, Colours, Sizes)
- `/process-stock` → Process Stock (physical materials for decoration)
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
- `products` — name, sku, description, unit_price, stock_quantity
- `orders` — order_number, customer_id, customer_name, status, total_amount, notes, order_date
- `order_items` — order_id, product_id, product_name, quantity, unit_price, line_total

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
- `src/schema/orders.ts` — orders and order_items tables
- `drizzle.config.ts` — Drizzle Kit config (requires `DATABASE_URL`)

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and Orval config. Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec.

### `scripts` (`@workspace/scripts`)

Utility scripts package.
