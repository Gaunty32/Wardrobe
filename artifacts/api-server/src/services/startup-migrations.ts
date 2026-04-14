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

  console.log("[startup] Migrations complete");
}
