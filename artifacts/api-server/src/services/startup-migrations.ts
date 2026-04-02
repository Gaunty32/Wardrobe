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

  // Clear any sync logs that are stuck in "running" state from a previous crashed run
  await db.execute(sql`
    UPDATE sync_logs
    SET status = 'failed',
        message = 'Interrupted — server was restarted during sync',
        completed_at = NOW()
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '10 minutes'
  `);

  console.log("[startup] Migrations complete");
}
