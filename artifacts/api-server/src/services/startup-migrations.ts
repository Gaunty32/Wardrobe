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

  console.log("[startup] Migrations complete");
}
