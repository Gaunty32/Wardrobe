import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Idempotent schema migrations that run on every server start.
 * Safe to run multiple times — all statements use IF NOT EXISTS / IF EXISTS guards.
 * This ensures the production database stays in sync with the development schema
 * without requiring a manual migration step during deployment.
 */
export async function runStartupMigrations(): Promise<void> {
  // Add columns introduced in the product-variants schema update
  await db.execute(sql`
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS woo_variation_id integer;
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sku text;
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS price numeric(10,2);
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS image_url text;
  `);

  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS xero_contact_id text;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS logo_url text;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS xero_contact_id text;
    ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS logo_url text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS xero_invoice_id text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS xero_invoice_status text;
  `);

  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS high_level_contact_id text;
  `);

  await db.execute(sql`
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS sleeve text;
  `);

  await db.execute(sql`
    ALTER TABLE sync_logs ADD COLUMN IF NOT EXISTS progress_pct integer;
  `);

  // Clear ALL sync logs stuck in "running" — if the server restarted, every in-flight
  // sync was killed by the OS. There is no such thing as a legitimately "running" sync
  // across a process restart.
  await db.execute(sql`
    UPDATE sync_logs
    SET status = 'failed',
        message = 'Interrupted — server was restarted while sync was in progress',
        completed_at = NOW()
    WHERE status = 'running'
  `);

  // Add code columns to customer_processes and customer_finishes
  await db.execute(sql`
    ALTER TABLE customer_processes ADD COLUMN IF NOT EXISTS code text;
    ALTER TABLE customer_finishes  ADD COLUMN IF NOT EXISTS code text;
  `);

  // Backfill codes for any existing rows that don't have one yet
  await db.execute(sql`
    UPDATE customer_processes SET code = 'P' || LPAD(id::text, 3, '0') WHERE code IS NULL;
    UPDATE customer_finishes  SET code = 'F' || LPAD(id::text, 3, '0') WHERE code IS NULL;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_categories (
      id serial PRIMARY KEY,
      woo_id integer UNIQUE,
      name text NOT NULL,
      slug text,
      image_url text,
      parent_woo_id integer,
      product_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id serial PRIMARY KEY,
      title text NOT NULL,
      description text,
      priority text NOT NULL DEFAULT 'medium',
      status text NOT NULL DEFAULT 'open',
      customer_id integer REFERENCES customers(id) ON DELETE SET NULL,
      customer_name text,
      due_date timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Add customer_id to process_stock for customer-specific allocation
  await db.execute(sql`
    ALTER TABLE process_stock ADD COLUMN IF NOT EXISTS customer_id integer REFERENCES customers(id) ON DELETE SET NULL;
  `);

  // Add colour to customer_finish_products
  await db.execute(sql`
    ALTER TABLE customer_finish_products ADD COLUMN IF NOT EXISTS colour text;
  `);

  // Add tax fields to products
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_status text;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_class text;
  `);

  // Add special_price to customer_finished_items (customer-specific override price)
  await db.execute(sql`
    ALTER TABLE customer_finished_items ADD COLUMN IF NOT EXISTS special_price numeric(10,2);
  `);

  // Add image_url to customer_processes for process reference photos
  await db.execute(sql`
    ALTER TABLE customer_processes ADD COLUMN IF NOT EXISTS image_url text;
  `);

  // Add source and portal_status to orders for customer portal orders
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'internal';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_status text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_notes text;
  `);

  // Add portal submission / approval columns and misc order columns
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS po_number                  text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS attention_of               text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_submitted_by_email       text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_submitted_by_name        text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_submitted_by_employee_id integer;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_approved_by_email   text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_approved_by_name    text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispatched_at              timestamptz;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number            text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_email_sent_at      timestamptz;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_email_sent_to      text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address_id        integer;
  `);

  // Customer portal users (invite-based access, one user per customer)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_portal_users (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      email text NOT NULL UNIQUE,
      password_hash text,
      invite_token text UNIQUE,
      invite_expires_at timestamptz,
      status text NOT NULL DEFAULT 'invited',
      last_login_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Add shipping_method to orders
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_method text;
  `);

  // Add supplier_price to products
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_price numeric(10,2);
  `);

  // Add secondary supplier code/price to products and variant-level supplier overrides
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS secondary_supplier_code text;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS secondary_supplier_price numeric(10,2);
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS supplier_code text;
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS supplier_price numeric(10,2);
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS secondary_supplier_code text;
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS secondary_supplier_price numeric(10,2);
  `);

  // Add supplier_code and supplier_price to purchase_order_items
  await db.execute(sql`
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_code text;
    ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS supplier_price numeric(10,2);
  `);

  // Add estimated_delivery_date to purchase_orders
  await db.execute(sql`
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS estimated_delivery_date timestamptz;
  `);

  // Add stock allocation tracking to order_items
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_status text;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS stock_allocated_at timestamptz;
  `);

  // Add portal_role to customer_portal_users (may not exist if table was created before this column was added)
  await db.execute(sql`
    ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS portal_role text NOT NULL DEFAULT 'member';
  `);

  // Fix phone numbers missing leading 0 (stripped during CSV import)
  // Safe: only updates numbers that are 9-11 digits and don't already start with 0 or +
  await db.execute(sql`
    UPDATE customers
    SET phone = '0' || phone
    WHERE phone IS NOT NULL
      AND phone != ''
      AND phone !~ '^0'
      AND phone !~ '^[+]'
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 9 AND 11;
  `);
  await db.execute(sql`
    UPDATE customer_contacts
    SET phone = '0' || phone
    WHERE phone IS NOT NULL
      AND phone != ''
      AND phone !~ '^0'
      AND phone !~ '^[+]'
      AND length(regexp_replace(phone, '[^0-9]', '', 'g')) BETWEEN 9 AND 11;
  `);

  // Wishlist / inspiration enquiry tables for the customer portal
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_enquiries (
      id          serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      portal_user_id integer REFERENCES customer_portal_users(id),
      enquiry_ref text NOT NULL,
      status      text NOT NULL DEFAULT 'pending',
      notes       text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS customer_enquiry_items (
      id              serial PRIMARY KEY,
      enquiry_id      integer NOT NULL REFERENCES customer_enquiries(id) ON DELETE CASCADE,
      product_id      integer REFERENCES products(id),
      product_name    text NOT NULL,
      image_url       text,
      colour          text,
      desired_processes text,
      item_notes      text,
      created_at      timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Demo leads capture table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS demo_leads (
      id          serial PRIMARY KEY,
      first_name  text NOT NULL,
      last_name   text NOT NULL,
      email       text NOT NULL,
      company     text NOT NULL,
      ip          text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Portal order audit timestamps
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_submitted_at timestamptz;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_approved_at  timestamptz;
  `);

  // Carriage / shipping cost
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS carriage_amount numeric(10,2) NOT NULL DEFAULT 0;
  `);

  // Link portal users to their employee record (used to restrict member ordering to self)
  await db.execute(sql`
    ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS linked_employee_id integer REFERENCES customer_employees(id) ON DELETE SET NULL;
  `);

  console.log("[startup] Migrations complete");

  // ── Repair Bespoke Ties variants ────────────────────────────────────────────
  // Rename legacy size values, ensure all 3 variants exist with correct SKUs and
  // primary supplier info. Safe to run multiple times (idempotent).
  await db.execute(sql`
    UPDATE product_attributes
    SET value = 'Full Length Tie'
    WHERE type = 'size' AND value = 'Full Length'
  `);
  await db.execute(sql`
    UPDATE product_attributes
    SET value = 'Clip-On Tie'
    WHERE type = 'size' AND value = 'Clip-On'
  `);

  const bespokeTieRows = await db.execute(sql`
    SELECT id, sku, supplier_id, supplier_code, supplier_price
    FROM products
    WHERE category = 'Bespoke Ties' AND sku IS NOT NULL AND sku <> ''
  `);

  const sizeVariants = [
    { label: "Full Length Tie", suffix: "FLT" },
    { label: "Clip-On Tie",     suffix: "COT" },
    { label: "Clip-on Cravat",  suffix: "COC" },
  ];

  for (const p of bespokeTieRows.rows as any[]) {
    // Ensure size attributes
    for (const sv of sizeVariants) {
      await db.execute(sql`
        INSERT INTO product_attributes (product_id, type, value, sort_order)
        SELECT ${p.id}, 'size', ${sv.label}, 0
        WHERE NOT EXISTS (
          SELECT 1 FROM product_attributes
          WHERE product_id = ${p.id} AND type = 'size' AND value = ${sv.label}
        )
      `);
    }

    // Ensure variant rows with SKU and supplier info
    for (const sv of sizeVariants) {
      const variantSku = `${p.sku}-${sv.suffix}`;
      await db.execute(sql`
        INSERT INTO product_variants (product_id, size, sku, stock_quantity, primary_supplier_id, supplier_code, supplier_price)
        SELECT ${p.id}, ${sv.label}, ${variantSku}, 0, ${p.supplier_id}, ${p.supplier_code}, ${p.supplier_price}
        WHERE NOT EXISTS (
          SELECT 1 FROM product_variants
          WHERE product_id = ${p.id} AND size = ${sv.label}
        )
      `);
    }

    // Back-fill supplier info on existing variants missing it
    if (p.supplier_id) {
      await db.execute(sql`
        UPDATE product_variants
        SET primary_supplier_id = ${p.supplier_id},
            supplier_code = ${p.supplier_code},
            supplier_price = ${p.supplier_price}
        WHERE product_id = ${p.id}
          AND primary_supplier_id IS NULL
      `);
    }
  }

  if (bespokeTieRows.rows.length > 0) {
    console.log(`[startup] Repaired ${bespokeTieRows.rows.length} Bespoke Ties product(s)`);
  }

  // Employee self-referencing manager assignment
  await db.execute(sql`
    ALTER TABLE customer_employees ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES customer_employees(id) ON DELETE SET NULL;
  `);

  // Team manager (employee) reference on customer_teams
  await db.execute(sql`
    ALTER TABLE customer_teams ADD COLUMN IF NOT EXISTS manager_id integer REFERENCES customer_employees(id) ON DELETE SET NULL;
  `);

  // Customer stock management — extend finished items with location & min stock level
  // Also make product_id nullable so customers can create stock items without linking to an SBS product
  await db.execute(sql`
    ALTER TABLE customer_finished_items ADD COLUMN IF NOT EXISTS location text;
    ALTER TABLE customer_finished_items ADD COLUMN IF NOT EXISTS min_quantity integer NOT NULL DEFAULT 0;
    ALTER TABLE customer_finished_items ALTER COLUMN product_id DROP NOT NULL;
  `);

  // Audit trail for customer stock movements (in / out / adjustment / issue / transfer)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_stock_movements (
      id               serial PRIMARY KEY,
      customer_id      integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      stock_item_id    integer NOT NULL REFERENCES customer_finished_items(id) ON DELETE CASCADE,
      movement_type    text NOT NULL,
      quantity         integer NOT NULL,
      reference        text,
      recipient_name   text,
      notes            text,
      created_by_name  text,
      created_at       timestamptz NOT NULL DEFAULT now()
    );
  `);

  // In-app notifications for portal users
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_notifications (
      id             serial PRIMARY KEY,
      customer_id    integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      portal_user_id integer REFERENCES customer_portal_users(id) ON DELETE CASCADE,
      title          text NOT NULL,
      body           text,
      link           text,
      type           text NOT NULL DEFAULT 'info',
      is_read        boolean NOT NULL DEFAULT false,
      created_at     timestamptz NOT NULL DEFAULT now()
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS portal_baskets (
      id               serial PRIMARY KEY,
      portal_user_id   integer NOT NULL REFERENCES customer_portal_users(id) ON DELETE CASCADE,
      customer_id      integer NOT NULL,
      customer_name    text,
      user_email       text,
      items            jsonb NOT NULL DEFAULT '[]',
      item_count       integer NOT NULL DEFAULT 0,
      estimated_total  numeric(10,2) NOT NULL DEFAULT 0,
      mode             text,
      step             integer NOT NULL DEFAULT 1,
      updated_at       timestamptz NOT NULL DEFAULT now(),
      created_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE(portal_user_id)
    )
  `);

  // Per-employee annual allowance (spend budget)
  await db.execute(sql`ALTER TABLE customer_employees ADD COLUMN IF NOT EXISTS allowance numeric(10,2);`);

  // ── Backfill stock allocation for confirmed orders that were never processed ──
  // Finds confirmed orders where items still have purchase_required IS NULL
  // (i.e., confirmed before the allocation-on-confirm feature was deployed).
  {
    const unallocatedOrders = await db.execute(sql`
      SELECT DISTINCT o.id AS order_id
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      WHERE o.status = 'confirmed'
        AND oi.purchase_required IS NULL
        AND oi.product_id IS NOT NULL
    `);

    for (const row of unallocatedOrders.rows as any[]) {
      const orderId = row.order_id;
      try {
        const itemRows = await db.execute(sql`
          SELECT id, product_id, quantity FROM order_items
          WHERE order_id = ${orderId} AND product_id IS NOT NULL AND purchase_required IS NULL
        `);
        const items = itemRows.rows as { id: number; product_id: number; quantity: number }[];
        if (items.length === 0) continue;

        const productIds = [...new Set(items.map(i => i.product_id))];
        const stockRows = await db.execute(sql`
          SELECT p.id, p.stock_quantity, p.supplier_id, s.name AS supplier_name
          FROM products p
          LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE p.id = ANY(${productIds}::int[])
        `);
        const stockMap = new Map<number, { stockQuantity: number; supplierId: number | null; supplierName: string | null }>(
          (stockRows.rows as any[]).map(r => [r.id, {
            stockQuantity: Number(r.stock_quantity ?? 0),
            supplierId: r.supplier_id ?? null,
            supplierName: r.supplier_name ?? null,
          }])
        );
        const remaining = new Map(Array.from(stockMap.entries()).map(([id, s]) => [id, s.stockQuantity]));

        for (const item of items) {
          const stock = stockMap.get(item.product_id);
          if (!stock) {
            await db.execute(sql`UPDATE order_items SET purchase_required = false WHERE id = ${item.id}`);
            continue;
          }
          const available = remaining.get(item.product_id) ?? 0;
          const qty = Number(item.quantity ?? 0);
          const allocated = Math.min(available, qty);
          const shortfall = qty - allocated;
          remaining.set(item.product_id, available - allocated);

          if (shortfall > 0) {
            await db.execute(sql`
              UPDATE order_items SET purchase_required = true, purchase_quantity = ${shortfall},
                supplier_id = ${stock.supplierId}, supplier_name = ${stock.supplierName}
              WHERE id = ${item.id}
            `);
          } else {
            await db.execute(sql`UPDATE order_items SET purchase_required = false WHERE id = ${item.id}`);
          }
        }

        // Commit stock decrements
        for (const [productId, rem] of remaining.entries()) {
          const orig = stockMap.get(productId);
          if (orig && orig.stockQuantity - rem > 0) {
            await db.execute(sql`UPDATE products SET stock_quantity = ${rem} WHERE id = ${productId}`);
          }
        }

        // Auto-create worksheet for the order if none exists and there are allocated items
        const allocatedItemIds = (await db.execute(sql`
          SELECT id FROM order_items WHERE order_id = ${orderId} AND purchase_required = false
        `)).rows.map((r: any) => r.id);

        if (allocatedItemIds.length > 0) {
          const existing = await db.execute(sql`SELECT id FROM worksheets WHERE order_id = ${orderId} LIMIT 1`);
          if (existing.rows.length === 0) {
            const orderRow = (await db.execute(sql`
              SELECT order_number, customer_id, customer_name FROM orders WHERE id = ${orderId}
            `)).rows[0] as any;
            const lastWs = (await db.execute(sql`
              SELECT worksheet_number FROM worksheets WHERE worksheet_number ~ '^F[0-9]+$'
              ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC LIMIT 1
            `)).rows[0] as any;
            const wsNum = `F${(lastWs?.worksheet_number ? parseInt(lastWs.worksheet_number.slice(1), 10) : 99) + 1}`;
            const wsRow = (await db.execute(sql`
              INSERT INTO worksheets (worksheet_number, status, order_id, order_number, customer_id, customer_name)
              VALUES (${wsNum}, 'pre_wip', ${orderId}, ${orderRow?.order_number ?? null}, ${orderRow?.customer_id ?? null}, ${orderRow?.customer_name ?? null})
              RETURNING id
            `)).rows[0] as any;
            const wsItems = (await db.execute(sql`
              SELECT id, product_name, colour, size, quantity, recipient_type, recipient_name, finish_id, finish_name
              FROM order_items WHERE id = ANY(${allocatedItemIds}::int[])
            `)).rows as any[];
            for (const oi of wsItems) {
              await db.execute(sql`
                INSERT INTO worksheet_items (worksheet_id, order_item_id, product_name, colour, size, quantity, recipient_type, recipient_name, finish_id, finish_name)
                VALUES (${wsRow.id}, ${oi.id}, ${oi.product_name}, ${oi.colour ?? null}, ${oi.size ?? null},
                  ${Number(oi.quantity ?? 1)}, ${oi.recipient_type ?? 'stock'}, ${oi.recipient_name ?? null},
                  ${oi.finish_id ?? null}, ${oi.finish_name ?? null})
              `);
            }
          }
        }
      } catch (_) {
        // Non-fatal — skip this order and continue
      }
    }

    if (unallocatedOrders.rows.length > 0) {
      console.log(`[startup] Backfilled stock allocation for ${unallocatedOrders.rows.length} order(s)`);
    }
  }

  // Role-level annual allowance (default budget for all employees in that role)
  await db.execute(sql`ALTER TABLE customer_roles ADD COLUMN IF NOT EXISTS annual_allowance numeric(10,2);`);

  // Per-employee top-up credits (extra budget granted by a manager on top of role/override allowance)
  await db.execute(sql`ALTER TABLE customer_employees ADD COLUMN IF NOT EXISTS allowance_topup numeric(10,2) NOT NULL DEFAULT 0;`);

  // Per-employee department field and delivery address assignment
  await db.execute(sql`ALTER TABLE customer_employees ADD COLUMN IF NOT EXISTS department text;`);
  await db.execute(sql`ALTER TABLE customer_employees ADD COLUMN IF NOT EXISTS delivery_address_id integer REFERENCES customer_delivery_addresses(id) ON DELETE SET NULL;`);

  // Customer references (internal notes & media store per customer)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_references (
      id serial PRIMARY KEY,
      customer_id integer NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      title text,
      notes text,
      image_url text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  // Stripe Payment Link columns on orders
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_link_url text;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_payment_link_id text;
  `);

  // Email send log — one row per customer email sent
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_email_logs (
      id serial PRIMARY KEY,
      order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      email_type text NOT NULL DEFAULT 'acknowledgement',
      to_email text NOT NULL,
      subject text,
      sent_by text,
      sent_at timestamptz NOT NULL DEFAULT now(),
      success boolean NOT NULL DEFAULT true,
      error text
    );
  `);

  // Add role_id to customer_finishes so each finish can be associated with a role.
  // Items (customer_finished_items) inherit the finish's role when their own role_id is NULL.
  await db.execute(sql`
    ALTER TABLE customer_finishes ADD COLUMN IF NOT EXISTS role_id integer REFERENCES customer_roles(id) ON DELETE SET NULL;
  `);

  // Normalise employee names from ALL CAPS to Title Case using initcap().
  // initcap() is idempotent — running on already-capitalised names is a no-op.
  await db.execute(sql`
    UPDATE customer_employees
    SET
      first_name = initcap(first_name),
      last_name  = initcap(last_name)
    WHERE
      first_name IS DISTINCT FROM initcap(first_name)
      OR last_name IS DISTINCT FROM initcap(last_name);
  `);

  // Normalise supplier names from ALL CAPS / CAPS to Title Case using initcap().
  await db.execute(sql`
    UPDATE suppliers
    SET name = initcap(name)
    WHERE name IS DISTINCT FROM initcap(name);
  `);

  // Internal order messaging tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_messages (
      id serial PRIMARY KEY,
      order_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      order_number text NOT NULL,
      author_name text NOT NULL,
      body text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS order_message_reads (
      id serial PRIMARY KEY,
      message_id integer NOT NULL REFERENCES order_messages(id) ON DELETE CASCADE,
      reader_name text NOT NULL,
      read_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(message_id, reader_name)
    );
  `);

  // Add attachments JSONB column for portal-submitted file uploads
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS attachments jsonb;`);

  // Link purchase_order_items to process_stock for process material POs
  await db.execute(sql`ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS process_stock_id integer;`);

  // Add attachments JSONB column to purchase_orders for process stock PDF files
  await db.execute(sql`ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS attachments jsonb;`);

  // Multi-business portal support:
  // 1. Drop the old UNIQUE constraint on email (was one email = one customer)
  // 2. Add a per-(email, customer) unique constraint instead
  // 3. Add selection_token columns for the business-picker handshake
  await db.execute(sql`ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS selection_token text;`);
  await db.execute(sql`ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS selection_expires_at timestamptz;`);
  await db.execute(sql`
    DO $$
    BEGIN
      -- Drop old single-email unique constraint if it exists
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_portal_users_email_key'
          AND conrelid = 'customer_portal_users'::regclass
      ) THEN
        ALTER TABLE customer_portal_users DROP CONSTRAINT customer_portal_users_email_key;
      END IF;
      -- Add (email, customer_id) unique if not already present
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'customer_portal_users_email_customer_unique'
          AND conrelid = 'customer_portal_users'::regclass
      ) THEN
        ALTER TABLE customer_portal_users ADD CONSTRAINT customer_portal_users_email_customer_unique UNIQUE (email, customer_id);
      END IF;
    END $$;
  `);

  // Remove orphaned worksheets (pre_wip or wip) whose order has been deleted
  // (order_id IS NULL or references a non-existent order). These were left
  // behind before worksheet cleanup was added to the order delete/cancel flow.
  await db.execute(sql`
    DELETE FROM worksheets
    WHERE status IN ('pre_wip', 'wip')
      AND (
        order_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM orders WHERE orders.id = worksheets.order_id)
      );
  `);

  // Add sale pricing columns to products table
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS regular_price text;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS on_sale boolean NOT NULL DEFAULT false;
  `);

  // Consolidated PO lines: store all contributing order item IDs so that a
  // single PO line can represent multiple order items for the same SKU.
  await db.execute(sql`
    ALTER TABLE purchase_order_items
      ADD COLUMN IF NOT EXISTS source_order_item_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
  `);

  // Unique employee number per customer (partial — only when non-empty).
  // Allows bulk import and manual entry to safely upsert by employee number.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS customer_employees_emp_num_unique
    ON customer_employees(customer_id, employee_number)
    WHERE employee_number IS NOT NULL AND employee_number <> '';
  `);

  // Restore purchase requirements for order items that fell out of sync —
  // typically because PO lines were deleted without the flag being restored,
  // or because the purchaseQuantity was cleared and never reinstated.
  //
  // Rule: any order item on a confirmed/active order that is NOT currently
  // on any non-cancelled PO (directly via order_item_id or indirectly via
  // source_order_item_ids), that has purchase_required=false and
  // purchase_quantity IS NULL, is an orphan that the system should surface
  // again so staff can action it.  We use the order item's own quantity as
  // the restored purchase quantity — a safe default that staff can adjust.
  //
  // Items excluded: cancelled/archived/draft orders; items still on active or
  // delivered (non-cancelled) POs; items with no linked product (custom text
  // lines that were never meant to be purchased via the requirements flow).
  const { rowCount } = await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = true,
        purchase_quantity  = oi.quantity
    FROM orders o
    WHERE oi.order_id  = o.id
      AND o.status NOT IN ('cancelled', 'archived', 'draft')
      AND oi.purchase_required  = false
      AND oi.purchase_quantity  IS NULL
      AND oi.product_id         IS NOT NULL
      AND oi.id NOT IN (
        -- Items directly linked to any non-cancelled PO
        SELECT poi.order_item_id
        FROM   purchase_order_items poi
        JOIN   purchase_orders      po  ON po.id = poi.po_id
        WHERE  poi.order_item_id IS NOT NULL
          AND  po.status <> 'cancelled'

        UNION

        -- Items referenced via the consolidated source_order_item_ids array
        SELECT (elem.value)::integer
        FROM   purchase_order_items poi
        JOIN   purchase_orders      po  ON po.id = poi.po_id,
        jsonb_array_elements_text(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) AS elem(value)
        WHERE  jsonb_array_length(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) > 0
          AND  po.status <> 'cancelled'
      )
  `);
  if ((rowCount ?? 0) > 0) {
    console.log(`[startup] Restored ${rowCount} orphaned purchase requirement(s)`);
  }

  // Reset portal users who show as 'invited' but never actually received an email
  // (they were created via create-user or auto-inserted from employee records).
  // If they've never logged in, 'invited' is misleading — set back to 'pending'.
  await db.execute(sql`
    UPDATE customer_portal_users
    SET status = 'pending', updated_at = now()
    WHERE status = 'invited' AND last_login_at IS NULL
  `);

  // ── Select Extra: monthly gift offer tables ──────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS select_extra_offers (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      title TEXT NOT NULL,
      product_name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      product_url TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      min_spend NUMERIC(10,2) NOT NULL DEFAULT 250.00,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (year, month)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS select_extra_claims (
      id SERIAL PRIMARY KEY,
      offer_id INTEGER NOT NULL REFERENCES select_extra_offers(id) ON DELETE CASCADE,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      order_number TEXT,
      customer_name TEXT,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (offer_id, customer_id)
    )
  `);

  // Seed May 2026 offer if it doesn't exist
  await db.execute(sql`
    INSERT INTO select_extra_offers (year, month, title, product_name, description, image_url, product_url, quantity, min_spend)
    VALUES (
      2026, 5,
      'Select Extra — May 2026',
      '12× Handled Aluminium Water Bottle',
      'Spend £250 or more (before VAT) on any order this month and we''ll include 12 free handled aluminium water bottles with your delivery. One claim per customer.',
      'https://www.selectuniforms.co.uk/wp-content/uploads/FCC4009-100x100.png',
      'https://www.selectuniforms.co.uk/shop/accessories/additions/12xhandled-aluminium-water-bottle/',
      12, 250.00
    )
    ON CONFLICT (year, month) DO UPDATE SET
      image_url = COALESCE(select_extra_offers.image_url, EXCLUDED.image_url)
  `);

  // Auto-expire Select Extra offers from past months
  {
    const _now = new Date();
    await db.execute(sql`
      UPDATE select_extra_offers SET is_active = false
      WHERE is_active = true
        AND (
          year < ${_now.getFullYear()}
          OR (year = ${_now.getFullYear()} AND month < ${_now.getMonth() + 1})
        )
    `);
  }

  // ── Auto-register staff email accounts from STAFF_EMAILS env var ──────────
  // Format: comma-separated emails, e.g. "chris@example.com,alice@example.com"
  // On each startup any listed addresses are merged into the staff_accounts
  // setting so OTP email login always works after a fresh deploy.
  const staffEmailsEnv = process.env.STAFF_EMAILS?.trim();
  if (staffEmailsEnv) {
    const rawRows = await db.execute(sql`
      SELECT value FROM settings WHERE key = 'staff_accounts' LIMIT 1
    `);
    let existing: Array<{ name: string; email: string }> = [];
    try { existing = JSON.parse((rawRows.rows[0] as any)?.value ?? "[]"); } catch { existing = []; }

    const envEmails = staffEmailsEnv.split(",").map(e => e.trim().toLowerCase()).filter(Boolean);
    let changed = false;
    for (const email of envEmails) {
      if (!existing.some(a => a.email === email)) {
        const namePart = email.split("@")[0].replace(/[._-]/g, " ");
        const name = namePart.split(" ").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
        existing.push({ name, email });
        changed = true;
        console.log(`[startup] Registered staff account: ${email}`);
      }
    }
    if (changed) {
      const value = JSON.stringify(existing);
      await db.execute(sql`
        INSERT INTO settings (key, value) VALUES ('staff_accounts', ${value})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `);
    }
  }

  // Add per-item and per-product VAT rate columns (UK zero-rated items e.g. children's clothing)
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2000;
    ALTER TABLE products    ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(5,4) NOT NULL DEFAULT 0.2000;
  `);

  // Backfill vat_rate from tax_class for products already imported from WooCommerce
  await db.execute(sql`
    UPDATE products SET vat_rate = 0.0000 WHERE tax_class = 'zero-rate'    AND vat_rate = 0.2000;
    UPDATE products SET vat_rate = 0.0500 WHERE tax_class = 'reduced-rate' AND vat_rate = 0.2000;
  `);

  // Backfill order_items.vat_rate from the linked product wherever the order
  // item still has the old default (0.2000) but the product now has a lower rate.
  // This corrects existing orders created before the VAT fix was applied.
  await db.execute(sql`
    UPDATE order_items oi
    SET vat_rate = p.vat_rate
    FROM products p
    WHERE oi.product_id = p.id
      AND oi.vat_rate = 0.2000
      AND p.vat_rate <> 0.2000;
  `);

  // Finish stock — decorated/logo'd items held per customer
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_finish_stock (
      id          SERIAL PRIMARY KEY,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      colour      TEXT,
      size        TEXT,
      sku         TEXT,
      quantity    INTEGER NOT NULL DEFAULT 0,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Backfill products.stock_quantity from variant totals for all products that have variants
  await db.execute(sql`
    UPDATE products p
    SET stock_quantity = (
      SELECT COALESCE(SUM(pv.stock_quantity), 0)
      FROM product_variants pv
      WHERE pv.product_id = p.id
    )
    WHERE EXISTS (
      SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id
    )
  `);

  // Fix worksheets whose worksheet_number was set to the PostgreSQL column default '{}' instead
  // of a proper F-number. Assign them sequential numbers below the current minimum F-number.
  await db.execute(sql`
    DO $$
    DECLARE
      min_num integer;
      ws_id   integer;
      counter integer := 1;
    BEGIN
      -- Find the lowest existing F-number so we can slot bad rows in below it
      SELECT COALESCE(MIN(CAST(SUBSTRING(worksheet_number FROM 2) AS integer)), 101)
      INTO min_num
      FROM worksheets
      WHERE worksheet_number ~ '^F[0-9]+$';

      -- Assign each malformed worksheet a number in the gap below min_num
      FOR ws_id IN
        SELECT id FROM worksheets
        WHERE worksheet_number IS NULL OR worksheet_number NOT LIKE 'F%'
        ORDER BY created_at ASC
      LOOP
        UPDATE worksheets
        SET worksheet_number = 'F' || (min_num - counter)
        WHERE id = ws_id;
        counter := counter + 1;
      END LOOP;
    END $$;
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // One-time cleanup: worksheet F102 (id=9) is a duplicate of F101 (id=8) —
  // both cover the same 7 order items for P21 (Pro Fit Security Ltd).
  {
    const dup = await db.execute(sql`SELECT id FROM worksheets WHERE id = 9 AND worksheet_number = 'F102'`);
    if (dup.rows.length > 0) {
      await db.execute(sql`DELETE FROM worksheet_items WHERE worksheet_id = 9`);
      await db.execute(sql`DELETE FROM worksheets WHERE id = 9`);
      console.log("[startup] Removed duplicate worksheet F102");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // One-time backfill: process stock quantities were not incremented when
  // certain POs were marked as delivered (server restarted mid-transaction or
  // the increment logic was added after those POs were already delivered).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migration_flags (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());
  `);

  {
    const flag = await db.execute(sql`
      SELECT 1 FROM _migration_flags WHERE name = 'backfill_process_stock_from_delivered_pos_v1'
    `);
    if (flag.rows.length === 0) {
      await db.execute(sql`
        UPDATE process_stock ps
        SET stock_quantity = ps.stock_quantity + sub.total_delivered
        FROM (
          SELECT poi.process_stock_id, SUM(poi.quantity_delivered) AS total_delivered
          FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status = 'delivered'
            AND poi.process_stock_id IS NOT NULL
            AND poi.quantity_delivered > 0
          GROUP BY poi.process_stock_id
        ) sub
        WHERE ps.id = sub.process_stock_id
          AND ps.stock_quantity = 0
      `);
      await db.execute(sql`
        INSERT INTO _migration_flags (name) VALUES ('backfill_process_stock_from_delivered_pos_v1')
      `);
      console.log("[startup] Backfilled process stock quantities from delivered POs");
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_date timestamptz;
  `);

  await db.execute(sql`
    CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS xero_invoice_number text;
  `);

  // Clean up stale purchase_required flags on items from orders that are no
  // longer active (shipped, completed, delivered, invoiced, cancelled, archived).
  // These were left behind because the requirements query previously only
  // excluded 'cancelled' and 'archived', allowing shipped orders to bleed through.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity = NULL
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.purchase_required = true
      AND o.status IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived')
  `);

  // Promote stock-covered items on active orders to 'allocated' so they appear
  // in the picking list. Previously, only PO delivery set stock_status='allocated';
  // items already in stock (purchase_required=false) were never promoted and so
  // were invisible to the production picking/worksheet workflow.
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status = 'allocated',
        stock_allocated_at = NOW()
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.purchase_required = false
      AND oi.stock_status IS NULL
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived')
  `);
  console.log("[startup] Promoted stock-covered items to picking list");

  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_at timestamptz;
  `);
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_scheduled_send_at timestamptz;
  `);

  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS requires_prepayment boolean NOT NULL DEFAULT false;
  `);

  // One-time data fix: order items whose worksheet is already 'complete' but
  // stock_status is still 'allocated' (caused by the POST /worksheets route not
  // updating order item status). Mark them complete so they leave the picking list.
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status = 'complete'
    FROM worksheet_items wi
    JOIN worksheets w ON w.id = wi.worksheet_id
    WHERE wi.order_item_id = oi.id
      AND w.status = 'complete'
      AND oi.stock_status = 'allocated'
  `);

  // One-time data fix: process stock items that were ordered and delivered outside
  // the system (Fast Lane Club print/embroidery materials PS0006–PS0016). Set
  // stock_quantity to the total required by confirmed orders so they no longer
  // appear as outstanding purchasing requirements.
  // IMPORTANT: restricted to PS0006–PS0016 only — without the SKU filter this
  // migration fires for every process stock item on every boot and incorrectly
  // marks newly-created items as "in stock".
  await db.execute(sql`
    UPDATE process_stock ps
    SET stock_quantity = sub.total_needed
    FROM (
      SELECT cp.process_stock_id AS ps_id,
             SUM(oi.quantity)    AS total_needed
      FROM order_items oi
      JOIN orders o               ON o.id  = oi.order_id
      JOIN customer_finish_processes cfp ON cfp.finish_id = oi.finish_id
      JOIN customer_processes cp  ON cp.id = cfp.process_id
      WHERE o.status = 'confirmed'
        AND oi.finish_id IS NOT NULL
        AND cp.process_stock_id IS NOT NULL
      GROUP BY cp.process_stock_id
    ) sub
    WHERE ps.id = sub.ps_id
      AND ps.sku IN ('PS0006','PS0007','PS0008','PS0009','PS0010','PS0011','PS0012','PS0013','PS0014','PS0015','PS0016')
      AND ps.stock_quantity < sub.total_needed
  `);

  // Data fix: PS0035 (and any other non-Fast-Lane-Club items) had their
  // stock_quantity incorrectly inflated to "total needed" by the unfiltered
  // version of the migration above.  Reset any process stock item whose SKU is
  // not in the Fast Lane Club range and whose stock_quantity was set by the
  // buggy migration (i.e. it exactly equals the sum of confirmed order quantities
  // and has no actual deliveries recorded against it).
  await db.execute(sql`
    UPDATE process_stock ps
    SET stock_quantity = 0
    WHERE ps.sku NOT IN ('PS0006','PS0007','PS0008','PS0009','PS0010','PS0011','PS0012','PS0013','PS0014','PS0015','PS0016')
      AND ps.stock_quantity > 0
      AND ps.stock_quantity = (
        SELECT COALESCE(SUM(oi.quantity), 0)
        FROM order_items oi
        JOIN orders o               ON o.id  = oi.order_id
        JOIN customer_finish_processes cfp ON cfp.finish_id = oi.finish_id
        JOIN customer_processes cp  ON cp.id = cfp.process_id
        WHERE o.status = 'confirmed'
          AND oi.finish_id IS NOT NULL
          AND cp.process_stock_id = ps.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM purchase_order_items poi
        WHERE poi.process_stock_id = ps.id
          AND poi.quantity_delivered > 0
      )
  `);

  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS zero_vat boolean NOT NULL DEFAULT false;
  `);

  // ── Quotes system ─────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS quotes (
      id           serial PRIMARY KEY,
      quote_number text NOT NULL UNIQUE,
      customer_id  integer REFERENCES customers(id) ON DELETE SET NULL,
      customer_name text NOT NULL,
      status       text NOT NULL DEFAULT 'draft',
      notes        text,
      cover_text   text,
      expires_at   timestamptz,
      token        uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS quote_items (
      id           serial PRIMARY KEY,
      quote_id     integer NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      product_id   integer REFERENCES products(id) ON DELETE SET NULL,
      product_name text NOT NULL,
      colour       text,
      size         text,
      finish_id    integer,
      finish_name  text,
      quantity     integer NOT NULL DEFAULT 1,
      unit_price   numeric(10,2) NOT NULL DEFAULT 0,
      vat_rate     numeric(6,4) NOT NULL DEFAULT 0.20,
      notes        text,
      sort_order   integer NOT NULL DEFAULT 0,
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE SEQUENCE IF NOT EXISTS quote_number_seq START 1;
  `);

  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_id integer REFERENCES quotes(id) ON DELETE SET NULL;
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS enquiries (
      id              serial PRIMARY KEY,
      hl_contact_id   text NOT NULL UNIQUE,
      name            text NOT NULL,
      email           text,
      phone           text,
      source_tag      text NOT NULL DEFAULT 'unknown',
      last_synced_at  timestamptz NOT NULL DEFAULT now(),
      created_at      timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS enquiry_id integer REFERENCES enquiries(id) ON DELETE SET NULL;
    ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS company text;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS customer_logo_url text;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS permalink text;
    ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS product_url text;
  `);

  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS woo_order_id integer;
    CREATE UNIQUE INDEX IF NOT EXISTS orders_woo_order_id_idx ON orders (woo_order_id) WHERE woo_order_id IS NOT NULL;
  `);

  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false;
  `);

  // Mark known service products as is_service = true (these have no physical stock)
  await db.execute(sql`
    UPDATE products
    SET is_service = true
    WHERE is_service = false
      AND (
        LOWER(name) LIKE '%logo conversion%'
        OR LOWER(name) LIKE '%digitising%'
        OR LOWER(name) LIKE '%digitizing%'
        OR LOWER(name) LIKE '%artwork%'
        OR LOWER(sku)  = 'svc-pkg'
      );
  `);

  // Deduplicate service products: where the same product name exists as both a plain
  // product (synced from WooCommerce) and a manually-created service product, mark the
  // WooCommerce-linked record as is_service = true and delete the manual duplicate.
  await db.execute(sql`
    -- Step 1: promote WooCommerce-linked records to service where a service twin exists
    UPDATE products p
    SET is_service = true
    WHERE p.is_service = false
      AND p.woo_commerce_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM products p2
        WHERE LOWER(p2.name) = LOWER(p.name)
          AND p2.is_service = true
          AND p2.id != p.id
      );
  `);

  await db.execute(sql`
    -- Step 2: delete the now-redundant manual (non-woo) duplicates
    DELETE FROM products
    WHERE is_service = true
      AND woo_commerce_id IS NULL
      AND EXISTS (
        SELECT 1 FROM products p2
        WHERE LOWER(p2.name) = LOWER(name)
          AND p2.is_service = true
          AND p2.woo_commerce_id IS NOT NULL
          AND p2.id != id
      );
  `);

  // Add first_name / last_name to customer_portal_users (used when personalising quote emails)
  await db.execute(sql`
    ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS first_name text;
    ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS last_name  text;
  `);

  // Multi-finish support: child decoration rows link back to a parent product row
  await db.execute(sql`
    ALTER TABLE quote_items ADD COLUMN IF NOT EXISTS parent_item_id integer REFERENCES quote_items(id) ON DELETE CASCADE;
  `);

  // Store resolved contact name directly on the quote so it survives even for
  // quotes not linked to a customer record.
  await db.execute(sql`
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_first_name text;
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_last_name  text;
  `);

  // Stock bins + per-variant bin location and minimum stock level
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS stock_bins (
      id         serial PRIMARY KEY,
      bin_number text   NOT NULL UNIQUE,
      notes      text,
      max_qty    integer NOT NULL DEFAULT 15,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS bin_location  text;
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS min_stock_qty integer NOT NULL DEFAULT 5;
  `);

  await db.execute(sql`
    ALTER TABLE quotes ADD COLUMN IF NOT EXISTS contact_email text;
  `);

  // Pricing visibility per portal user. Default OFF; managers get ON automatically.
  await db.execute(sql`
    ALTER TABLE customer_portal_users ADD COLUMN IF NOT EXISTS show_pricing boolean NOT NULL DEFAULT false;
  `);
  // Backfill: existing managers should be able to see pricing.
  await db.execute(sql`
    UPDATE customer_portal_users SET show_pricing = true
    WHERE portal_role = 'manager' AND show_pricing = false;
  `);

  // One-time deletion of erroneously generated portal order P51.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migration_flags (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());
  `);
  const deleteP51Flag = await db.execute(sql`
    SELECT 1 FROM _migration_flags WHERE name = 'delete_erroneous_order_P51'
  `);
  if (deleteP51Flag.rows.length === 0) {
    await db.execute(sql`
      DELETE FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_number = 'P51');
      DELETE FROM orders WHERE order_number = 'P51';
      INSERT INTO _migration_flags (name) VALUES ('delete_erroneous_order_P51');
    `);
  }

  // Bulk stock orders can optionally be added to the customer's Stores on confirmation
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS add_to_stores boolean NOT NULL DEFAULT false;
  `);

  // Minimum reorder quantity per stock item — how many to order when restocking
  await db.execute(sql`
    ALTER TABLE customer_finished_items ADD COLUMN IF NOT EXISTS reorder_quantity INTEGER NOT NULL DEFAULT 0;
  `);

  // Default shipping option pre-selected in the ordering portal
  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_shipping_option TEXT;
  `);

  // Track which secondary order numbers were absorbed into a merged primary order
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS absorbed_order_numbers text[];
  `);

  await db.execute(sql`
    ALTER TABLE customer_finished_items ADD COLUMN IF NOT EXISTS sleeve text;
  `);

  // Re-queue order items that are stuck as stock-allocated but have no actual stock
  // backing them and are not currently on any active purchase order or worksheet.
  // This can happen when: (a) stock existed at confirmation but was later consumed,
  // (b) an item was deleted from a PO but the restore logic didn't fire correctly.
  // Safe to re-run: condition becomes a no-op once purchase_required is restored.
  await db.execute(sql`
    UPDATE order_items
    SET purchase_required  = true,
        purchase_quantity  = quantity,
        stock_status       = NULL,
        stock_allocated_at = NULL
    FROM orders o
    WHERE order_items.order_id = o.id
      AND order_items.purchase_required = false
      AND order_items.stock_status = 'allocated'
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived')
      AND EXISTS (
        SELECT 1 FROM products p
        WHERE p.id = order_items.product_id
          AND COALESCE(p.is_service, false) = false
          AND COALESCE(p.stock_quantity, 0) < order_items.quantity
      )
      AND NOT EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po2 ON po2.id = poi.po_id
        WHERE po2.status NOT IN ('cancelled')
          AND (poi.order_item_id = order_items.id
               OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(order_items.id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = order_items.id
      )
  `);
  console.log("[startup] Re-queued stock-phantom items for purchasing");

  // Re-queue order items that are marked as allocated (stockStatus='allocated') but
  // are still covered by an OUTSTANDING purchase order line (quantity_delivered <
  // quantity_ordered).  This happens when stock was incorrectly recorded as present
  // at confirmation time, a PO was later raised for the same item, and the earlier
  // phantom-requeue migration skipped it because "a PO exists".  The item ends up
  // showing as "All stock in" in Production even though it hasn't arrived.
  // Safe to re-run: becomes a no-op once the PO is fully delivered.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required  = true,
        purchase_quantity  = oi.quantity,
        stock_status       = NULL,
        stock_allocated_at = NULL
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.stock_status = 'allocated'
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived')
      AND NOT EXISTS (
        SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
      )
      AND EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po2 ON po2.id = poi.po_id
        WHERE po2.status NOT IN ('cancelled')
          AND poi.quantity_delivered < poi.quantity_ordered
          AND (poi.order_item_id = oi.id
               OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
      )
  `);
  console.log("[startup] Re-queued allocated-but-outstanding PO items for purchasing");

  // PO Number Required flag on customers — blocks invoice send until PO is set
  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS po_number_required boolean NOT NULL DEFAULT false;
  `);

  // ── Archived products ────────────────────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
  `);

  // Auto-archive all "10 x" bundle products (WooCommerce qty-pack listings).
  // These are superseded by the native price-break system and should no longer
  // appear in order entry, purchasing, or WooCommerce sync.
  await db.execute(sql`
    UPDATE products
    SET is_archived = true
    WHERE name ILIKE '10 x %'
      AND is_archived = false
  `);

  // Apply a £2/item price break at qty ≥ 10 for all Olympic products that
  // don't already have explicitly-set price breaks.  Matches either the product
  // name ("Olympic Hoodie" etc.) or the SKU prefix ("OLYMPIC…").
  await db.execute(sql`
    UPDATE products
    SET price_breaks = jsonb_build_array(
          jsonb_build_object('qty', 10, 'price', (unit_price::numeric - 2))
        )
    WHERE (name ILIKE 'Olympic %' OR sku ILIKE 'OLYMPIC%')
      AND is_archived = false
      AND COALESCE(is_service, false) = false
      AND (
        price_breaks IS NULL
        OR price_breaks = 'null'::jsonb
        OR jsonb_array_length(price_breaks) = 0
      )
  `);
}
