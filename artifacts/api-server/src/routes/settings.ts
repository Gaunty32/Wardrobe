import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable, syncLogsTable } from "@workspace/db";
import { runWooSync } from "../services/woo-sync";

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
  try {
    const result = await runWooSync({ full });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed" });
  }
});

export default router;
