import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { allocatePODelivery } from "./allocation.js";

/**
 * Idempotent schema migrations that run on every server start.
 * Safe to run multiple times — all statements use IF NOT EXISTS / IF EXISTS guards.
 * This ensures the production database stays in sync with the development schema
 * without requiring a manual migration step during deployment.
 */
export async function runStartupMigrations(): Promise<void> {
  // purchasing_queued_at — must be added before any re-queue updates reference it
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchasing_queued_at timestamptz
  `);

  // dispatched_at — per-item dispatch timestamp for part-shipment tracking
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS dispatched_at timestamptz
  `);

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
                supplier_id = ${stock.supplierId}, supplier_name = ${stock.supplierName},
                purchasing_queued_at = COALESCE(purchasing_queued_at, now())
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
        // NOTE: worksheets are NOT created here. The correct flow is:
        //   picking list → user confirms picked → worksheet created automatically.
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
        purchase_quantity  = oi.quantity,
        purchasing_queued_at = COALESCE(oi.purchasing_queued_at, now())
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

  // Also clear stale purchase_required flags on unconfirmed orders (draft,
  // portal_draft, portal_pending). These can accumulate when an order is
  // confirmed (triggering stock allocation), then reverted to draft status
  // without the cleanup that the portal unconfirm route performs.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity = NULL,
        stock_status = NULL,
        stock_allocated_at = NULL
    FROM orders o
    WHERE oi.order_id = o.id
      AND o.status IN ('draft', 'portal_draft', 'portal_pending')
      AND (oi.purchase_required = true OR oi.stock_status IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po ON poi.po_id = po.id
        WHERE poi.order_item_id = oi.id
          AND po.status IN ('draft', 'ordered')
      )
  `);

  // Promote stock-covered items on active orders to 'allocated' so they appear
  // in the picking list. Previously, only PO delivery set stock_status='allocated';
  // items already in stock (purchase_required=false) were never promoted and so
  // were invisible to the production picking/worksheet workflow.
  // Explicitly exclude draft/portal_draft/portal_pending — those orders have not
  // been confirmed so no stock should be allocated against them yet.
  // Plain items (no finish) skip the picking list and go straight to 'complete'.
  // Decorated items (finish set) land as 'allocated' to await physical picking.
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.purchase_required = false
      AND oi.stock_status IS NULL
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = oi.product_id AND p.is_service = true)
  `);

  // Retroactive fix: existing plain items that are 'allocated' should be 'complete'
  // (they were allocated before this rule existed and never need physical picking-to-production).
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status = 'complete'
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.finish_id IS NULL
      AND oi.stock_status = 'allocated'
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

  // Reset min_stock_qty default from 5 → 0 (no minimum by default)
  const minStockDefaultFlag = await db.execute(sql`
    SELECT 1 FROM _migration_flags WHERE name = 'reset_min_stock_qty_default_to_zero'
  `);
  if (minStockDefaultFlag.rows.length === 0) {
    await db.execute(sql`
      UPDATE product_variants SET min_stock_qty = 0 WHERE min_stock_qty = 5;
      ALTER TABLE product_variants ALTER COLUMN min_stock_qty SET DEFAULT 0;
      INSERT INTO _migration_flags (name) VALUES ('reset_min_stock_qty_default_to_zero');
    `);
    console.log("[startup] Reset min_stock_qty default to 0 and cleared all variant minimums seeded by old default of 5");
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
        stock_allocated_at = NULL,
        purchasing_queued_at = COALESCE(purchasing_queued_at, now())
    FROM orders o
    WHERE order_items.order_id = o.id
      AND order_items.purchase_required = false
      AND order_items.stock_status = 'allocated'
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
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
  // GUARD: never re-queue items that are already covered by a fully-delivered PO line —
  // those items genuinely have their stock and must not be sent back to purchasing.
  // IMPORTANT: only fires for OUTSTANDING POs (draft/ordered).  Delivered POs are
  // intentionally closed-out deliveries — never re-queue items on them, even if some
  // lines were only partially received.  Consolidated PO lines (sourceOrderItemIds)
  // especially must not re-queue all source items when the aggregate qty is partial.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required  = true,
        purchase_quantity  = oi.quantity,
        stock_status       = NULL,
        stock_allocated_at = NULL,
        purchasing_queued_at = COALESCE(oi.purchasing_queued_at, now())
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.stock_status = 'allocated'
      AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
      AND NOT EXISTS (
        SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
      )
      AND EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po2 ON po2.id = poi.po_id
        WHERE po2.status NOT IN ('cancelled', 'delivered')
          AND poi.quantity_delivered < poi.quantity_ordered
          AND (poi.order_item_id = oi.id
               OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
      )
      AND NOT EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po2 ON po2.id = poi.po_id
        WHERE po2.status = 'delivered'
          AND poi.quantity_delivered >= poi.quantity_ordered
          AND poi.quantity_ordered > 0
          AND (poi.order_item_id = oi.id
               OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
      )
  `);
  console.log("[startup] Re-queued allocated-but-outstanding PO items for purchasing");

  // Broader re-queue pass: catch any allocated item still linked to an
  // outstanding PO regardless of product stock_quantity (the earlier pass above
  // only fires when stock_quantity is already low; this catches cases where the
  // stock figure looks OK but the PO hasn't been delivered yet).
  // GUARD: never touch items already covered by a fully-delivered PO line.
  {
    const { rowCount: broaderCount } = await db.execute(sql`
      UPDATE order_items oi
      SET purchase_required  = true,
          purchase_quantity  = oi.quantity,
          stock_status       = NULL,
          stock_allocated_at = NULL,
          purchasing_queued_at = COALESCE(oi.purchasing_queued_at, now())
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.stock_status = 'allocated'
        AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
        AND NOT EXISTS (
          SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po2 ON po2.id = poi.po_id
          WHERE po2.status = 'delivered'
            AND poi.quantity_delivered >= poi.quantity_ordered
            AND poi.quantity_ordered > 0
            AND (poi.order_item_id = oi.id
                 OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
        )
        AND (
          EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po2 ON po2.id = poi.po_id
            WHERE po2.status NOT IN ('cancelled', 'delivered')
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.order_item_id = oi.id
          )
          OR EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po2 ON po2.id = poi.po_id
            WHERE po2.status NOT IN ('cancelled', 'delivered')
              AND poi.quantity_delivered < poi.quantity_ordered
              AND COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
          )
        )
    `);
    if ((broaderCount ?? 0) > 0) {
      console.log(`[startup] Re-queued ${broaderCount} allocated item(s) still on outstanding POs`);
    }
  }

  // Safety net A: items that reached stock_status='complete' but still have a
  // DIRECTLY-linked outstanding PO line (stock has not actually arrived).
  {
    const { rowCount: directCount } = await db.execute(sql`
      UPDATE order_items oi
      SET purchase_required    = true,
          purchase_quantity    = oi.quantity,
          stock_status         = NULL,
          stock_allocated_at   = NULL,
          purchasing_queued_at = COALESCE(oi.purchasing_queued_at, now())
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.stock_status = 'complete'
        AND oi.dispatched_at IS NULL
        AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
        AND NOT EXISTS (
          SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
        )
        AND EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po2 ON po2.id = poi.po_id
          WHERE po2.status NOT IN ('cancelled', 'delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.quantity_ordered > 0
            AND poi.order_item_id = oi.id
        )
    `);
    if ((directCount ?? 0) > 0) {
      console.log(`[startup] Re-queued ${directCount} complete item(s) with outstanding direct PO links`);
    }
  }

  // Safety net B: items that reached stock_status='complete' but still have an
  // UNLINKED outstanding PO line (poi.order_item_id IS NULL) that matches by
  // order_id + product name + colour + size AND has quantity_ordered > 0.
  // This catches the retroactive-fix false-positive: the fix previously matched
  // PO lines with quantity_ordered=0 (0>=0=true) and incorrectly set items complete.
  // Extra guard: product stock_quantity < item quantity confirms stock is not present.
  {
    const { rowCount: unlinkCount } = await db.execute(sql`
      UPDATE order_items oi
      SET purchase_required    = true,
          purchase_quantity    = oi.quantity,
          stock_status         = NULL,
          stock_allocated_at   = NULL,
          purchasing_queued_at = COALESCE(oi.purchasing_queued_at, now())
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.stock_status = 'complete'
        AND oi.dispatched_at IS NULL
        AND o.status NOT IN ('shipped', 'completed', 'delivered', 'invoiced', 'cancelled', 'archived', 'draft', 'portal_draft', 'portal_pending')
        AND NOT EXISTS (
          SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
        )
        AND EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po2 ON po2.id = poi.po_id
          WHERE po2.status NOT IN ('cancelled', 'delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND poi.quantity_ordered > 0
            AND poi.order_id = oi.order_id
            AND poi.order_item_id IS NULL
            AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
            AND LOWER(TRIM(COALESCE(poi.product_name,''))) = LOWER(TRIM(COALESCE(oi.product_name,'')))
            AND LOWER(TRIM(COALESCE(poi.colour,'')))       = LOWER(TRIM(COALESCE(oi.colour,'')))
            AND LOWER(TRIM(COALESCE(poi.size,'')))         = LOWER(TRIM(COALESCE(oi.size,'')))
        )
        AND EXISTS (
          SELECT 1 FROM products p
          WHERE p.id = oi.product_id
            AND COALESCE(p.stock_quantity, 0) < oi.quantity
        )
    `);
    if ((unlinkCount ?? 0) > 0) {
      console.log(`[startup] Re-queued ${unlinkCount} complete item(s) with outstanding unlinked PO lines (no actual stock)`);
    }
  }

  // Track when an order item first enters the purchasing queue
  await db.execute(sql`
    ALTER TABLE order_items ADD COLUMN IF NOT EXISTS purchasing_queued_at timestamptz
  `);
  // Backfill existing items: use the parent order's created_at as best available proxy
  await db.execute(sql`
    UPDATE order_items oi
    SET purchasing_queued_at = o.created_at
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.purchase_required = true
      AND oi.purchasing_queued_at IS NULL
  `);

  // PO Number Required flag on customers — blocks invoice send until PO is set
  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS po_number_required boolean NOT NULL DEFAULT false;
  `);

  // Billing email — overrides general contact email for all invoice sends
  await db.execute(sql`
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS billing_email text;
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

  // Remove worksheet items that are linked to service products — services don't
  // go through production.  Then delete any worksheets that become empty as a result.
  await db.execute(sql`
    DELETE FROM worksheet_items wi
    USING order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE wi.order_item_id = oi.id
      AND p.is_service = true
  `);
  await db.execute(sql`
    DELETE FROM worksheets w
    WHERE NOT EXISTS (
      SELECT 1 FROM worksheet_items wi WHERE wi.worksheet_id = w.id
    )
  `);

  await db.execute(sql`
    ALTER TABLE worksheet_items ADD COLUMN IF NOT EXISTS supplier_code text;
  `);

  await db.execute(sql`
    ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true;
  `);

  // ── Clean up phantom pre_wip worksheets created by the old backfill ────────
  // The backfill (now removed) used to auto-create worksheets for any confirmed
  // order with allocated items — bypassing the picking flow. These phantom
  // worksheets are identifiable because their order items are still
  // stock_status='allocated' (the real picking flow sets them to 'in_production'
  // before creating the worksheet). Delete them so the items correctly appear in
  // the Picking List instead of being stranded in Pre-Production.
  {
    const phantomRows = await db.execute(sql`
      SELECT DISTINCT w.id
      FROM worksheets w
      WHERE w.status = 'pre_wip'
        AND EXISTS (SELECT 1 FROM worksheet_items wi WHERE wi.worksheet_id = w.id)
        AND NOT EXISTS (
          SELECT 1 FROM worksheet_items wi
          JOIN order_items oi ON oi.id = wi.order_item_id
          WHERE wi.worksheet_id = w.id
            AND oi.stock_status = 'in_production'
        )
    `);
    const phantomIds = (phantomRows.rows as any[]).map((r) => r.id as number);
    if (phantomIds.length > 0) {
      await db.execute(sql`DELETE FROM worksheet_items WHERE worksheet_id = ANY(${phantomIds}::int[])`);
      await db.execute(sql`DELETE FROM worksheets WHERE id = ANY(${phantomIds}::int[])`);
      console.log(`[startup] Removed ${phantomIds.length} phantom pre-production worksheet(s) — items returned to picking list`);
    }
  }

  // ── Promote all remaining pre_wip worksheets to wip ───────────────────────
  // pre_wip no longer exists as a user-facing state: producing a worksheet
  // means the order is in WIP. Any worksheets left as pre_wip are promoted.
  {
    const promoted = await db.execute(sql`
      UPDATE worksheets SET status = 'wip' WHERE status = 'pre_wip'
    `);
    if ((promoted.rowCount ?? 0) > 0) {
      console.log(`[startup] Promoted ${promoted.rowCount} pre_wip worksheet(s) to wip`);
    }
  }

  // ── Performance indexes for stock queries ──────────────────────────────────
  // product_variants has 30k+ rows; without indexes every stock page load is a
  // full table scan. Create these CONCURRENTLY so startup doesn't block.
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_product_id ON product_variants(product_id)`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_bin_location ON product_variants(bin_location) WHERE bin_location IS NOT NULL`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_stock_qty ON product_variants(stock_quantity) WHERE stock_quantity > 0`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_variants_min_stock ON product_variants(min_stock_qty) WHERE min_stock_qty > 0`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_name ON products(name)`);
  await db.execute(sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_sku ON products(sku) WHERE sku IS NOT NULL`);
  console.log("[startup] Stock performance indexes ensured");

  // ── Product guidance columns ───────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_best_for text`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_not_ideal_for text`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_staff_recommendation text`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_badge text`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_value_rating integer`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_durability_rating integer`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_smart_rating integer`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_tags jsonb`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_badges jsonb`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS guidance_staff_quotes jsonb`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS staff_members (
      id serial PRIMARY KEY,
      name text NOT NULL,
      role text,
      profile_image_url text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  console.log("[startup] Product guidance columns ensured");

  // ── Backfill stock_bins from existing bin_location values ──────────────────
  // Variants may have bin_location set before the auto-create logic existed.
  // Insert any missing bin records now so Bin View shows them correctly.
  await db.execute(sql`
    INSERT INTO stock_bins (bin_number, max_qty)
    SELECT DISTINCT UPPER(bin_location), 15
    FROM product_variants
    WHERE bin_location IS NOT NULL AND bin_location <> ''
    ON CONFLICT (bin_number) DO NOTHING
  `);
  console.log("[startup] stock_bins backfill complete");

  // ── Add number_of_boxes to orders ──────────────────────────────────────────
  await db.execute(sql`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS number_of_boxes integer NOT NULL DEFAULT 1
  `);

  // ── Add centralised invoicing fields to customers ───────────────────────────
  await db.execute(sql`
    ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS invoice_name text,
      ADD COLUMN IF NOT EXISTS invoice_address text,
      ADD COLUMN IF NOT EXISTS invoice_city text,
      ADD COLUMN IF NOT EXISTS invoice_postcode text
  `);

  // ── Product issue flags ────────────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS issue_no_image boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS issue_low_gp boolean NOT NULL DEFAULT false`);
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS issues_checked_at timestamptz`);

  // ── WooCommerce publish status ─────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS woo_status varchar(20)`);

  // ── Cascade product-level supplier prices to variants ──────────────────────
  // Only copies a product price DOWN to its variants when:
  //   a) the product actually has a price (not NULL), AND
  //   b) the variant price differs from the product price, AND
  //   c) the variant is using the product's default supplier (no variant-specific supplier set,
  //      or the variant supplier is the same as the product supplier).
  // Guard (c) prevents overwriting a colour-specific supplier's price with the default
  // product-level price — that was the second reason purchasing re-grouped items under the
  // wrong supplier after a server restart.
  await db.execute(sql`
    UPDATE product_variants pv
    SET supplier_price = p.supplier_price,
        secondary_supplier_price = p.secondary_supplier_price
    FROM products p
    WHERE pv.product_id = p.id
      AND p.supplier_price IS NOT NULL
      AND pv.supplier_price IS DISTINCT FROM p.supplier_price
      AND (pv.primary_supplier_id IS NULL OR pv.primary_supplier_id = p.supplier_id)
  `);
  console.log("[startup] Variant supplier prices synced to product level");
}

// ── Weekly product issues refresh ─────────────────────────────────────────────
export async function refreshProductIssues(): Promise<void> {
  await db.execute(sql`
    UPDATE products SET
      issue_no_image = (
        image_url IS NULL OR TRIM(image_url) = '' OR image_url LIKE 'blob:%'
      ),
      issue_low_gp = (
        supplier_price IS NOT NULL
        AND unit_price IS NOT NULL
        AND CAST(unit_price AS float) > 0
        AND (CAST(unit_price AS float) - CAST(supplier_price AS float))
            / CAST(unit_price AS float) * 100 < 80
      ),
      issues_checked_at = NOW()
    WHERE is_archived = false
  `);
  console.log("[issues] Product issue flags refreshed");

  // Auto-complete any "ordered" POs where every line is already fully delivered.
  // This covers cases where quantities were booked in via the matrix but the
  // "Complete Delivery" step was never explicitly triggered (e.g. session ended
  // before the auto-complete useEffect fired in the browser).
  {
    const stuck = await db.execute(sql`
      SELECT po.id
      FROM purchase_orders po
      WHERE po.status = 'ordered'
        AND EXISTS (
          SELECT 1 FROM purchase_order_items poi WHERE poi.po_id = po.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          WHERE poi.po_id = po.id
            AND poi.quantity_delivered < poi.quantity_ordered
        )
    `);
    const stuckIds = (stuck.rows as Array<{ id: number }>).map(r => r.id);
    for (const poId of stuckIds) {
      await db.execute(sql`
        UPDATE purchase_orders SET status = 'delivered', updated_at = now() WHERE id = ${poId}
      `);
      await allocatePODelivery(poId);
      console.log(`[startup] Auto-completed fully-delivered PO id=${poId}`);
    }
    if (stuckIds.length > 0) {
      console.log(`[startup] Auto-completed ${stuckIds.length} fully-delivered PO(s) and ran allocation`);
    }
  }

  // Safety-net: promote any order item that is purchase_required=false but
  // still has stock_status=null (e.g. sourceOrderItemIds was empty so
  // allocatePODelivery couldn't find them, or the PO was delivered before
  // this logic existed).  Only promote items that have NO outstanding PO line
  // still awaiting delivery — so we don't surface items whose stock hasn't
  // physically arrived yet.
  {
    const { rowCount: promoted } = await db.execute(sql`
      UPDATE order_items oi
      SET stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
          stock_allocated_at = NOW()
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.purchase_required = false
        AND oi.stock_status IS NULL
        AND o.status NOT IN (
          'shipped','completed','delivered','invoiced',
          'cancelled','archived','draft','portal_draft','portal_pending'
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po2 ON po2.id = poi.po_id
          WHERE po2.status NOT IN ('cancelled', 'delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND (
              poi.order_item_id = oi.id
              OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
            )
        )
    `);
    if ((promoted ?? 0) > 0) {
      console.log(`[startup] Safety-net promoted ${promoted} item(s) to picking list (purchase_required=false, stock_status=null, no outstanding PO)`);
    }
  }

  // Corrective fix: an earlier version of the safety-net above unconditionally set
  // stock_status='allocated' without checking finish_id, so plain (undecorated) items
  // got stuck there permanently — invisible to Purchasing (purchase_required=false) but
  // never reaching Despatch, since only decorated items pass through the picking-list
  // workflow to become 'complete'. Reclassify any such stuck plain items now.
  // Safe to re-run: only touches finish_id IS NULL rows still at 'allocated'.
  {
    const { rowCount: reclassified } = await db.execute(sql`
      UPDATE order_items
      SET stock_status = 'complete'
      WHERE finish_id IS NULL
        AND stock_status = 'allocated'
        AND dispatched_at IS NULL
    `);
    if ((reclassified ?? 0) > 0) {
      console.log(`[startup] Reclassified ${reclassified} stuck plain item(s) from 'allocated' to 'complete' so they can reach Despatch`);
    }
  }

  // ── Bundles ──────────────────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bundles (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      sku         TEXT,
      description TEXT,
      price       NUMERIC(10,2) NOT NULL DEFAULT 0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      notes       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS bundle_components (
      id          SERIAL PRIMARY KEY,
      bundle_id   INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
      product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 1,
      finish_id   INTEGER,
      finish_name TEXT,
      notes       TEXT
    )
  `);

  await db.execute(sql`
    ALTER TABLE order_items
      ADD COLUMN IF NOT EXISTS bundle_ref      TEXT,
      ADD COLUMN IF NOT EXISTS is_bundle_header BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS bundle_def_id   INTEGER
  `);

  // Fix O103: service/charge line (Logo Conversion to Stitches) was not included
  // in dispatch because it had no size/colour/stockStatus — mark it dispatched
  // and restore the order to 'shipped'.
  const fixO103Flag = await db.execute(sql`
    SELECT 1 FROM _migration_flags WHERE name = 'fix_o103_service_line_dispatch'
  `);
  if (fixO103Flag.rows.length === 0) {
    await db.execute(sql`
      UPDATE order_items
        SET dispatched_at = (
          SELECT MIN(dispatched_at) FROM order_items
          WHERE order_id = (SELECT id FROM orders WHERE order_number = 'O103')
            AND dispatched_at IS NOT NULL
        )
      WHERE order_id = (SELECT id FROM orders WHERE order_number = 'O103')
        AND dispatched_at IS NULL;

      UPDATE orders
        SET status = 'shipped'
      WHERE order_number = 'O103'
        AND status = 'part_shipped';

      INSERT INTO _migration_flags (name) VALUES ('fix_o103_service_line_dispatch');
    `);
    console.log("[startup] Fixed O103: service line marked dispatched, order restored to shipped");
  }

  // P39: Crew T-Shirt Small items for Eniko Bajko and Junior Frater (IDs 339, 348)
  // were embroidered but never assigned to a worksheet, leaving stock_status NULL
  // and blocking dispatch. Mark them complete so they surface in the dispatch queue.
  const p39Fix = await db.execute(sql`
    SELECT 1 FROM _migration_flags WHERE name = 'fix_p39_missing_stock_status'
  `);
  if (p39Fix.rows.length === 0) {
    await db.execute(sql`
      UPDATE order_items
        SET stock_status = 'complete'
      WHERE id IN (339, 348)
        AND stock_status IS NULL;

      INSERT INTO _migration_flags (name) VALUES ('fix_p39_missing_stock_status');
    `);
    console.log("[startup] Fixed P39: items 339/348 stock_status set to complete");
  }

  // Clear purchase_required / stock_status flags on service product order items
  // — service products have no purchasing or stock requirement.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity  = NULL,
        stock_status       = NULL,
        stock_allocated_at = NULL
    FROM products p
    WHERE oi.product_id = p.id
      AND p.is_service IS TRUE
      AND (oi.purchase_required = true OR oi.stock_status IS NOT NULL)
  `);

  // Remove service product items from any existing draft / ordered POs.
  // They were added before this rule existed and will cause confusion.
  await db.execute(sql`
    DELETE FROM purchase_order_items poi
    USING order_items oi
    JOIN products p ON oi.product_id = p.id
    WHERE poi.order_item_id = oi.id
      AND p.is_service IS TRUE
      AND EXISTS (
        SELECT 1 FROM purchase_orders po
        WHERE po.id = poi.po_id
          AND po.status IN ('draft', 'ordered')
      )
  `);
  console.log("[startup] Cleared service product items from purchasing queue and draft POs");

  // Clear stock_status = 'allocated' on service product order items — service lines
  // (e.g. "Logo Conversion to Stitches") have no physical stock to pick so they should
  // never appear on the picking list.  Safe to re-run: becomes a no-op once cleared.
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status       = NULL,
        stock_allocated_at = NULL
    FROM products p
    WHERE oi.product_id   = p.id
      AND p.is_service    = true
      AND oi.stock_status = 'allocated'
      AND oi.dispatched_at IS NULL
  `);

  // Fix PO items where the supplier_code was incorrectly set from a variant belonging to a
  // DIFFERENT colour (the old "any variant with a supplier_code" COALESCE fallback).
  // Correct behaviour: if no variant exists for this exact colour with a supplier_code,
  // fall back to the product-level supplier_code, not another colour's variant code.
  // Safe to re-run: only touches rows where the stored code doesn't match the colour-specific
  // variant code AND doesn't match the product-level code but DOES match some other-colour variant.
  await db.execute(sql`
    UPDATE purchase_order_items poi
    SET supplier_code = p.supplier_code
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    WHERE poi.order_item_id = oi.id
      AND p.supplier_code IS NOT NULL
      AND poi.supplier_code IS NOT NULL
      AND poi.supplier_code <> p.supplier_code
      -- The stored code does NOT belong to this colour
      AND NOT EXISTS (
        SELECT 1 FROM product_variants pv
        WHERE pv.product_id = oi.product_id
          AND LOWER(TRIM(COALESCE(pv.colour, ''))) = LOWER(TRIM(COALESCE(oi.colour, '')))
          AND pv.supplier_code = poi.supplier_code
      )
      -- But that code DOES exist on a different-colour variant (confirms it came from the bad fallback)
      AND EXISTS (
        SELECT 1 FROM product_variants pv
        WHERE pv.product_id = oi.product_id
          AND pv.supplier_code = poi.supplier_code
      )
  `);
  console.log("[startup] Corrected PO item supplier codes that were inherited from wrong-colour variants");

  // Retroactive fix: order items that are still purchase_required=true even though
  // their PO has been delivered.  This happens when a PO line has an orderId but
  // no orderItemId / sourceOrderItemIds, so allocatePODelivery() never cleared the flag.
  // Match by orderId + productName + colour + size on fully-delivered PO lines.
  // Broadened: also catches POs where quantity_delivered >= quantity_ordered even if
  // po.status hasn't yet been flipped to 'delivered' (e.g. still 'ordered').
  // Plain items (no finish_id) go straight to 'complete'; decorated items → 'allocated'.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity  = NULL,
        stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.po_id
    JOIN orders o           ON o.id  = poi.order_id
    WHERE oi.order_id = poi.order_id
      AND (po.status = 'delivered' OR (poi.quantity_delivered >= poi.quantity_ordered AND poi.quantity_ordered > 0))
      AND poi.order_item_id IS NULL
      AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
      AND oi.purchase_required = true
      AND LOWER(TRIM(COALESCE(oi.product_name,''))) = LOWER(TRIM(COALESCE(poi.product_name,'')))
      AND LOWER(TRIM(COALESCE(oi.colour,'')))       = LOWER(TRIM(COALESCE(poi.colour,'')))
      AND LOWER(TRIM(COALESCE(oi.size,'')))         = LOWER(TRIM(COALESCE(poi.size,'')))
      AND o.status NOT IN ('shipped','completed','delivered','invoiced','cancelled','archived','draft','portal_draft','portal_pending')
  `);
  console.log("[startup] Retroactively cleared purchase_required on PO-delivered items with broken links");

  // Retroactive fix (direct-link): order items that were incorrectly re-queued (purchase_required=true,
  // stock_status=null) by the startup safety net because they were linked to a delivered PO whose
  // aggregate quantity_delivered < quantity_ordered (common for consolidated multi-order PO lines).
  // A delivered PO is an intentionally closed-out delivery — clear purchase_required and restore
  // stock_status for any item with a direct link (orderItemId or sourceOrderItemIds) to such a PO.
  // Guard: require poi.quantity_delivered > 0 — if the specific line delivered 0 units the item
  // hasn't actually arrived and must not be placed on the picking list.
  {
    const { rowCount: directLinkCount } = await db.execute(sql`
      UPDATE order_items oi
      SET purchase_required    = false,
          purchase_quantity    = NULL,
          stock_status         = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
          stock_allocated_at   = NOW()
      FROM purchase_order_items poi
      JOIN purchase_orders po  ON po.id = poi.po_id
      WHERE po.status = 'delivered'
        AND poi.quantity_delivered > 0
        AND oi.purchase_required = true
        AND oi.stock_status IS NULL
        AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = oi.order_id
            AND o.status NOT IN ('shipped','completed','delivered','invoiced','cancelled','archived','draft','portal_draft','portal_pending')
        )
        AND (
          poi.order_item_id = oi.id
          OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi2
          JOIN purchase_orders po2 ON po2.id = poi2.po_id
          WHERE po2.status NOT IN ('cancelled', 'delivered')
            AND poi2.quantity_delivered < poi2.quantity_ordered
            AND (
              poi2.order_item_id = oi.id
              OR COALESCE(poi2.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
            )
        )
    `);
    if ((directLinkCount ?? 0) > 0) {
      console.log(`[startup] Restored ${directLinkCount} item(s) incorrectly re-queued from delivered PO links`);
    }
  }

  // Reverse wrong allocations: un-allocate order items that ended up as 'allocated' but every
  // non-cancelled linked PO line has quantity_delivered = 0 (PO was marked delivered before stock
  // arrived, or a "Correct Book-in" zeroed the qty after allocation ran).
  // Resets to purchase_required=true so the items re-enter purchasing requirements.
  // Only fires when there is at least one non-cancelled PO line for the item, preventing this
  // from accidentally touching items allocated from pre-existing stock (no PO coverage).
  {
    const { rowCount: reverseCount } = await db.execute(sql`
      UPDATE order_items oi
      SET stock_status       = NULL,
          purchase_required  = true,
          purchase_quantity  = oi.quantity,
          stock_allocated_at = NULL
      WHERE oi.stock_status = 'allocated'
        AND oi.dispatched_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM worksheet_items wi WHERE wi.order_item_id = oi.id)
        AND EXISTS (
          SELECT 1 FROM orders o
          WHERE o.id = oi.order_id
            AND o.status NOT IN ('shipped','completed','delivered','invoiced','cancelled','archived','draft','portal_draft','portal_pending')
        )
        -- Item must have at least one non-cancelled linked PO line (not an existing-stock allocation)
        AND EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status != 'cancelled'
            AND (poi.order_item_id = oi.id
                 OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
        )
        -- But none of those non-cancelled lines has delivered anything
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po ON po.id = poi.po_id
          WHERE po.status != 'cancelled'
            AND (poi.order_item_id = oi.id
                 OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
            AND poi.quantity_delivered > 0
        )
    `);
    if ((reverseCount ?? 0) > 0) {
      console.log(`[startup] Reversed ${reverseCount} wrong allocation(s) where no stock was actually delivered`);
    }
  }

  // Safety Net C: items that already have stock_status IN ('in_production','complete','allocated')
  // should NEVER have purchase_required=true — that flag is stale and causes them to ghost into
  // the "Awaiting Stock" section even though they've already passed that stage.
  // This can happen when a PO is delivered after the item was already picked/worksheeted.
  await db.execute(sql`
    UPDATE order_items
    SET purchase_required = false,
        purchase_quantity  = NULL
    WHERE purchase_required = true
      AND stock_status IN ('in_production', 'complete', 'allocated')
  `);
  console.log("[startup] Safety Net C: cleared stale purchase_required=true on items already in/past production");

  // Safety Net D: order items still purchase_required=true where the linked PO line is fully
  // delivered (quantity_delivered >= quantity_ordered). This catches cases where the delivery
  // was recorded but allocatePODelivery() was never triggered (e.g. direct quantity edits,
  // or the item had a direct order_item_id link that the "broken links" migration skipped).
  // Covers both direct order_item_id links AND consolidated source_order_item_ids JSON arrays.
  // Plain items (no finish) go to 'complete'; decorated items go to 'allocated' for picking.
  await db.execute(sql`
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity  = NULL,
        stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    WHERE oi.purchase_required = true
      AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = oi.product_id AND p.is_service = true)
      AND EXISTS (
        SELECT 1 FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        WHERE po.status = 'delivered'
          AND poi.quantity_delivered >= poi.quantity_ordered
          AND poi.quantity_ordered > 0
          AND (poi.order_item_id = oi.id
               OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id))
      )
  `);
  console.log("[startup] Safety Net D: allocated items on fully-delivered PO lines");

  // Safety Net F — DISABLED (2026-07-08): this used to re-queue plain 'complete' items
  // for purchasing whenever current product stock was less than the item's quantity and
  // no PO covered it. That heuristic is unsound: a *legitimate* stock allocation that
  // fully consumes the last of a variant's stock leaves stock_quantity < item quantity
  // too (often exactly 0) — indistinguishable from the rare "phantom complete" case this
  // was meant to catch (a fuzzy-linked PO that was later deleted). Because this ran on
  // every server restart/deploy, it was silently reverting correctly stock-fulfilled
  // order items back into the purchasing queue every time the app redeployed (e.g. O207 /
  // order_item 910 — Travel Mug, plain item, allocated from stock, restart flipped it back
  // to purchase_required=true). Unlike /purchasing/rescan, this migration has no "credit
  // back this item's own allocation before judging available stock" logic, so it can never
  // safely distinguish the two cases from stock_quantity alone. Left disabled until a
  // reliable signal for genuine PO-deletion phantoms exists (e.g. an allocation ledger).
  console.log("[startup] Safety Net F: disabled (unsound heuristic — see comment)");

  // Safety Net E: purchase orders where every line is fully delivered but the PO status
  // is still 'ordered'. Mark them 'delivered' so the UI shows them correctly.
  await db.execute(sql`
    UPDATE purchase_orders po
    SET status = 'delivered'
    WHERE po.status = 'ordered'
      AND EXISTS (SELECT 1 FROM purchase_order_items WHERE po_id = po.id)
      AND NOT EXISTS (
        SELECT 1 FROM purchase_order_items poi
        WHERE poi.po_id = po.id
          AND poi.quantity_delivered < poi.quantity_ordered
      )
  `);
  console.log("[startup] Safety Net E: closed fully-delivered POs still in ordered status");

  // Feedback items table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS feedback_items (
      id           SERIAL PRIMARY KEY,
      type         TEXT NOT NULL CHECK (type IN ('critical','minor','feature')),
      title        TEXT NOT NULL,
      description  TEXT NOT NULL DEFAULT '',
      submitted_by TEXT NOT NULL DEFAULT '',
      source       TEXT NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','portal')),
      status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    ALTER TABLE feedback_items ADD COLUMN IF NOT EXISTS admin_note TEXT NOT NULL DEFAULT ''
  `);
  console.log("[startup] feedback_items table ensured");

  // Fix: invite_token must NOT be unique — a portal user can hold accounts under multiple
  // customers, and the magic-link login sets the same token on all rows for that email address.
  // The unique constraint causes a 500 for multi-customer users. Replace it with a plain index.
  await db.execute(sql`
    ALTER TABLE customer_portal_users
      DROP CONSTRAINT IF EXISTS customer_portal_users_invite_token_key
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_customer_portal_users_invite_token
      ON customer_portal_users (invite_token)
  `);
  console.log("[startup] invite_token unique constraint replaced with plain index");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS manual_purchase_requirements (
      id              SERIAL PRIMARY KEY,
      supplier_id     INTEGER REFERENCES suppliers(id),
      supplier_name   TEXT NOT NULL,
      supplier_email  TEXT,
      supplier_currency TEXT NOT NULL DEFAULT 'GBP',
      product_id      INTEGER REFERENCES products(id),
      product_name    TEXT NOT NULL,
      product_sku     TEXT,
      supplier_code   TEXT,
      colour          TEXT,
      size            TEXT,
      quantity        INTEGER NOT NULL DEFAULT 1,
      supplier_price  NUMERIC(10,2),
      notes           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      fulfilled_at    TIMESTAMPTZ
    )
  `);
  console.log("[startup] manual_purchase_requirements table ensured");

  // ── O144 trouser line final fix: item 561 is now properly dispatched ──────────
  // The startup migration that was undoing its dispatch has been removed.
  // This one-time correction restores item 561 to dispatched state (if it was left
  // stuck by the old migration) and marks order 112 as fully shipped.
  await db.execute(sql`
    UPDATE order_items
    SET dispatched_at      = NOW(),
        purchase_required  = false,
        purchase_quantity  = NULL,
        stock_status       = 'complete',
        stock_allocated_at = NOW()
    WHERE id = 561
      AND dispatched_at IS NULL
      AND purchase_required = true
  `);
  await db.execute(sql`
    UPDATE orders
    SET status = 'shipped'
    WHERE id = 112
      AND status = 'part_shipped'
      AND NOT EXISTS (
        SELECT 1 FROM order_items
        WHERE order_id = 112 AND dispatched_at IS NULL
      )
  `);
  console.log("[startup] O144 item 561 dispatch corrected");

  // Social posts table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS social_posts (
      id               SERIAL PRIMARY KEY,
      product_id       INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      facebook_content TEXT NOT NULL DEFAULT '',
      google_content   TEXT NOT NULL DEFAULT '',
      hashtags         TEXT NOT NULL DEFAULT '',
      platforms        TEXT[] NOT NULL DEFAULT ARRAY['facebook','google'],
      status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','scheduled','publishing','published','failed')),
      scheduled_at     TIMESTAMPTZ,
      published_at     TIMESTAMPTZ,
      auto_reschedule  BOOLEAN NOT NULL DEFAULT FALSE,
      error_message    TEXT,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS fb_post_id TEXT`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS gbp_post_name TEXT`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS product_image_url TEXT`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS fb_reactions INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS fb_comments INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS fb_shares INTEGER NOT NULL DEFAULT 0`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS fb_stats_at TIMESTAMPTZ`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS last_comments JSONB`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS new_activity BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS website_url TEXT`);
  await db.execute(sql`ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS season TEXT`);
  console.log("[startup] social_posts table ensured");

  // Snooze column for product issues
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS issue_snoozed_until TIMESTAMPTZ`);

  // Auto-promote confirmed service-only orders to 'shipped' so they appear on
  // the invoicing screen. Targets orders where every order item with a product
  // link is a service product (is_service = true) and no items need purchasing.
  const servicePromoResult = await db.execute(sql`
    UPDATE orders o
    SET status = 'shipped', updated_at = NOW()
    WHERE o.status = 'confirmed'
      AND EXISTS (
        SELECT 1 FROM order_items oi
        JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id AND p.is_service = true
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = o.id
          AND (p.id IS NULL OR p.is_service IS NOT TRUE)
      )
  `);
  const promoted = (servicePromoResult as any).rowCount ?? 0;
  if (promoted > 0) console.log("[startup] Promoted " + promoted + " service-only confirmed order(s) to shipped");

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_message_reads (
      id SERIAL PRIMARY KEY,
      message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      user_name TEXT NOT NULL,
      read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(message_id, user_name)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_message_reads_user_idx ON chat_message_reads(user_name)`);
  console.log("[startup] chat_message_reads table ensured");

  // Direct-message support: a stable, sorted, pipe-joined key of every participant's
  // name (including the creator) so that re-opening a DM with the same person/group
  // reuses the existing conversation instead of spawning a duplicate every time.
  await db.execute(sql`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS participants_key TEXT`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS chat_conversations_participants_key_idx ON chat_conversations(type, participants_key)`);
  console.log("[startup] chat_conversations.participants_key ensured (direct messages)");

  // Safety Net G: credit process_stock.stock_quantity for delivered PO lines where the
  // per-item receive path was used (which previously skipped the process stock credit).
  // For each process_stock item, compute the expected credit = SUM(quantity_delivered)
  // across all delivered PO lines that reference it. If current stock_quantity is less
  // than expected, top it up by the difference.
  await db.execute(sql`
    UPDATE process_stock ps
    SET stock_quantity = COALESCE(ps.stock_quantity, 0) + sub.missing,
        updated_at = NOW()
    FROM (
      SELECT poi.process_stock_id AS ps_id,
             SUM(poi.quantity_delivered) AS total_delivered,
             COALESCE(MAX(ps2.stock_quantity), 0) AS current_qty,
             GREATEST(0, SUM(poi.quantity_delivered) - COALESCE(MAX(ps2.stock_quantity), 0)) AS missing
      FROM purchase_order_items poi
      JOIN purchase_orders po ON po.id = poi.po_id
      JOIN process_stock ps2 ON ps2.id = poi.process_stock_id
      WHERE poi.process_stock_id IS NOT NULL
        AND po.status = 'delivered'
        AND poi.quantity_delivered > 0
      GROUP BY poi.process_stock_id
      HAVING GREATEST(0, SUM(poi.quantity_delivered) - COALESCE(MAX(ps2.stock_quantity), 0)) > 0
    ) sub
    WHERE ps.id = sub.ps_id
  `);
  console.log("[startup] Safety Net G: topped up process_stock quantities from delivered PO lines");

  // ── One-time fix: O240 FCC2333 Charcoal M/L/XL phantom stock allocation ────
  // These three items were stuck with stock_status='allocated' / purchase_required=false
  // despite the Charcoal variant having 0 stock.  The Charcoal colour is supplied by
  // Ralawise (not Uneek, the product-level default), so we also correct the variant's
  // primary_supplier_id and the order-item supplier assignment so they surface in the
  // Ralawise purchasing requirements section.
  {
    const fixFlag = await db.execute(sql`
      SELECT 1 FROM _migration_flags WHERE name = 'fix_o240_charcoal_phantom_allocation_v1'
    `);
    if (fixFlag.rows.length === 0) {
      // Clear phantom allocation and route to Ralawise purchasing
      await db.execute(sql`
        UPDATE order_items
        SET stock_status        = NULL,
            stock_allocated_at  = NULL,
            purchase_required   = true,
            purchase_quantity   = quantity,
            supplier_id         = 25,
            supplier_name       = 'Ralawise Ltd'
        WHERE id IN (1053, 1054, 1055)
          AND stock_status = 'allocated'
          AND purchase_required = false
      `);
      // Set Charcoal variant supplier so future orders route correctly
      await db.execute(sql`
        UPDATE product_variants
        SET primary_supplier_id = 25
        WHERE id = 144808
          AND primary_supplier_id IS NULL
      `);
      await db.execute(sql`
        INSERT INTO _migration_flags (name) VALUES ('fix_o240_charcoal_phantom_allocation_v1')
      `);
      console.log("[startup] O240 Charcoal items unblocked and routed to Ralawise");
    }
  }
}
