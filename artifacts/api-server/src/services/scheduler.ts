import { schedule, type ScheduledTask } from "node-cron";
import { db, settingsTable, customersTable, ordersTable, tasksTable } from "@workspace/db";
import { eq, sql, and, or, isNull, lt } from "drizzle-orm";
import { runWooSync } from "./woo-sync";

let currentTask: ScheduledTask | null = null;

const SCHEDULES: Record<string, string> = {
  hourly: "0 * * * *",
  every6hours: "0 */6 * * *",
  daily: "0 2 * * *",
};

async function getSyncSchedule(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_sync_schedule"));
  return row?.value ?? null;
}

async function hasCredentials(): Promise<boolean> {
  const [urlRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_url"));
  const [ckRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_key"));
  const [csRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_secret"));
  return !!(urlRow?.value && ckRow?.value && csRow?.value);
}

export async function initScheduler(): Promise<void> {
  if (currentTask) { currentTask.stop(); currentTask = null; }

  const scheduleKey = await getSyncSchedule();
  if (!scheduleKey || !SCHEDULES[scheduleKey]) return;

  const credentialsOk = await hasCredentials();
  if (!credentialsOk) return;

  const cronExpr = SCHEDULES[scheduleKey];
  currentTask = schedule(cronExpr, async () => {
    console.log(`[scheduler] Running WooCommerce sync (${scheduleKey})`);
    try {
      const result = await runWooSync();
      console.log(`[scheduler] Sync complete: +${result.created} created, ~${result.updated} updated, ${result.errors.length} errors`);
    } catch (err) {
      console.error("[scheduler] Sync failed:", err);
    }
  });

  console.log(`[scheduler] WooCommerce sync scheduled: ${scheduleKey} (${cronExpr})`);
}

export async function reschedule(): Promise<void> {
  await initScheduler();
}

// ─── Customer check-in reminders ──────────────────────────────────────────────

/**
 * For every customer whose most recent order is older than 90 days (or who has
 * never placed an order), create a high-priority task — unless an open or
 * in-progress check-in task already exists for them.
 */
export async function createCheckInReminders(): Promise<{ created: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Find customers with no recent orders using raw SQL for the aggregation
  const staleCustomers = await db.execute<{ id: number; name: string; last_order: Date | null }>(sql`
    SELECT c.id, c.name, MAX(o.order_date) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.name
    HAVING MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL
  `);

  let created = 0;
  for (const customer of staleCustomers.rows) {
    // Skip if there's already an open/in_progress check-in task for this customer
    const existing = await db.select({ id: tasksTable.id }).from(tasksTable).where(
      and(
        eq(tasksTable.customerId, customer.id),
        or(eq(tasksTable.status, "open"), eq(tasksTable.status, "in_progress")),
        sql`${tasksTable.title} LIKE ${"Check in with%"}`
      )
    );

    if (existing.length > 0) continue;

    const daysSince = customer.last_order
      ? Math.floor((Date.now() - new Date(customer.last_order).getTime()) / 86_400_000)
      : null;

    const description = daysSince != null
      ? `No order placed in the last ${daysSince} days. Consider reaching out to maintain the relationship.`
      : "This customer has never placed an order. Consider making initial contact.";

    await db.insert(tasksTable).values({
      title: `Check in with ${customer.name}`,
      description,
      priority: "high",
      status: "open",
      customerId: customer.id,
      customerName: customer.name,
    });
    created++;
  }

  console.log(`[reminders] Created ${created} customer check-in task(s)`);
  return { created };
}

// ─── Customer data normalisation ──────────────────────────────────────────────

/**
 * Converts all-caps customer text fields to proper title case / lowercase
 * using PostgreSQL's built-in initcap() and lower() functions.
 * Only touches fields that are detectably all-uppercase (have letters and
 * equal their own upper() value).
 */
export async function normalizeCustomerCasing(): Promise<{ updated: number }> {
  const result = await db.execute<{ count: string }>(sql`
    WITH updated AS (
      UPDATE customers SET
        name             = CASE WHEN name ~ '[A-Za-z]' AND name = upper(name)
                                THEN initcap(name) ELSE name END,
        contact_first_name = CASE WHEN contact_first_name IS NOT NULL
                                       AND contact_first_name ~ '[A-Za-z]'
                                       AND contact_first_name = upper(contact_first_name)
                                  THEN initcap(contact_first_name) ELSE contact_first_name END,
        contact_last_name  = CASE WHEN contact_last_name IS NOT NULL
                                       AND contact_last_name ~ '[A-Za-z]'
                                       AND contact_last_name = upper(contact_last_name)
                                  THEN initcap(contact_last_name) ELSE contact_last_name END,
        email            = CASE WHEN email IS NOT NULL THEN lower(email) ELSE email END,
        address          = CASE WHEN address IS NOT NULL
                                     AND address ~ '[A-Za-z]'
                                     AND address = upper(address)
                                THEN initcap(address) ELSE address END,
        city             = CASE WHEN city IS NOT NULL
                                     AND city ~ '[A-Za-z]'
                                     AND city = upper(city)
                                THEN initcap(city) ELSE city END,
        state            = CASE WHEN state IS NOT NULL
                                     AND state ~ '[A-Za-z]'
                                     AND state = upper(state)
                                THEN initcap(state) ELSE state END
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM updated
  `);
  const updated = parseInt(result.rows[0]?.count ?? "0", 10);
  console.log(`[normalise] Updated ${updated} customer record(s)`);
  return { updated };
}

// Run customer casing normalisation every Sunday at 3am
schedule("0 3 * * 0", async () => {
  console.log("[normalise] Running weekly customer casing normalisation");
  try {
    await normalizeCustomerCasing();
  } catch (err) {
    console.error("[normalise] Normalisation job failed:", err);
  }
});

// Run check-in reminders every day at 9am
schedule("0 9 * * *", async () => {
  console.log("[reminders] Running daily customer check-in check");
  try {
    await createCheckInReminders();
  } catch (err) {
    console.error("[reminders] Check-in reminder job failed:", err);
  }
});
