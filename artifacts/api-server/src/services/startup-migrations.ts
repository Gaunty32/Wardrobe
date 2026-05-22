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
  // Re-point any order_items referencing worksheet 9 to worksheet 8,
  // delete the duplicate worksheet_items, and drop worksheet 9.
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM worksheets WHERE id = 9 AND worksheet_number = 'F102') THEN
        -- Re-point order_items that reference the duplicate worksheet
        UPDATE order_items SET worksheet_id = 8 WHERE worksheet_id = 9;
        -- Remove duplicate worksheet_items
        DELETE FROM worksheet_items WHERE worksheet_id = 9;
        -- Delete the duplicate worksheet
        DELETE FROM worksheets WHERE id = 9;
      END IF;
    END $$;
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // One-time backfill: process stock quantities were not incremented when
  // certain POs were marked as delivered (server restarted mid-transaction or
  // the increment logic was added after those POs were already delivered).
  // We use a _migration_flags table as a marker so this only runs once.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS _migration_flags (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW());
  `);

  await db.execute(sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM _migration_flags WHERE name = 'backfill_process_stock_from_delivered_pos_v1') THEN

        -- For every delivered PO that has process-stock lines, add any
        -- quantity_delivered that was never credited to the process_stock row.
        -- Guard: only touches rows whose stock_quantity is still 0 so we don't
        -- double-increment if the item was legitimately consumed back to zero
        -- on a future server start (the marker prevents re-entry in that case).
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
          AND ps.stock_quantity = 0;

        INSERT INTO _migration_flags (name) VALUES ('backfill_process_stock_from_delivered_pos_v1');
      END IF;
    END $$;
  `);
  // ─────────────────────────────────────────────────────────────────────────
}
