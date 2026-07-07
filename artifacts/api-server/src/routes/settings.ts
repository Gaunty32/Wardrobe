import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable, syncLogsTable } from "@workspace/db";
import { runWooSync } from "../services/woo-sync";
import { testDpdConnection, isDpdConfigured } from "../services/dpd.js";


const router: IRouter = Router();

const SENSITIVE_KEYS = ["woo_consumer_key", "woo_consumer_secret"];

router.get("/settings", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string | null> = {};
  for (const row of rows) {
    result[row.key] = SENSITIVE_KEYS.includes(row.key) && row.value ? "••••••••" : row.value;
  }
  res.json(result);
});

router.get("/settings/raw", async (req, res): Promise<void> => {
  const rows = await db.select().from(settingsTable);
  const result: Record<string, string | null> = {};
  for (const row of rows) result[row.key] = row.value;
  res.json(result);
});

router.patch("/settings", async (req, res): Promise<void> => {
  const bodyKeys = Object.keys(req.body ?? {});
  const bodyPreview: Record<string, string> = {};
  for (const k of bodyKeys) bodyPreview[k] = typeof req.body[k] === "string" ? `[string len=${req.body[k].length}]` : String(req.body[k]);
  console.log("[PATCH /settings] body keys:", bodyKeys, "preview:", JSON.stringify(bodyPreview));

  const parsed = z.record(z.string(), z.string().nullable()).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db.insert(settingsTable)
      .values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }

  res.json({ ok: true });
});

router.get("/woo-sync/logs", async (req, res): Promise<void> => {
  const logs = await db.select().from(syncLogsTable).orderBy(desc(syncLogsTable.startedAt)).limit(20);
  res.json(logs);
});

router.post("/woo-sync/run", async (req, res): Promise<void> => {
  const full = req.query.full === "true";

  // Check whether a sync is already running
  const [running] = await db.select().from(syncLogsTable)
    .where(eq(syncLogsTable.status, "running"))
    .limit(1);
  if (running) {
    res.status(409).json({ error: "A sync is already in progress" });
    return;
  }

  // Respond immediately — the sync runs entirely in the background
  res.status(202).json({ message: "Sync started" });

  runWooSync({ full }).catch(async (err) => {
    console.error("[sync] Background sync failed:", err);
  });
});

router.get("/settings/dpd-test", async (_req, res): Promise<void> => {
  if (!isDpdConfigured()) {
    res.json({ ok: false, configured: false, message: "DPD credentials not set (DPD_USERNAME, DPD_PASSWORD, DPD_ACCOUNT_NUMBER environment variables required)" });
    return;
  }
  const result = await testDpdConnection();
  res.json({ ...result, configured: true });
});

export default router;
