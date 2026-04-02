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

  console.log("[startup] Migrations complete");
}
