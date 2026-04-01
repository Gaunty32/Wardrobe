import { schedule, type ScheduledTask } from "node-cron";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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
