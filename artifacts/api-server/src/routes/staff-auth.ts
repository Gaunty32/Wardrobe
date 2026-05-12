import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production";
const DEFAULT_STAFF_PASSWORD = "sbs2024";

async function getPasswordHash(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "staff_password_hash"));
  return row?.value ?? null;
}

router.post("/auth/staff/login", async (req, res): Promise<void> => {
  const { password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password required" });
    return;
  }

  const hash = await getPasswordHash();
  let valid = false;

  if (hash) {
    valid = await bcrypt.compare(password, hash);
  } else {
    valid = password === DEFAULT_STAFF_PASSWORD;
  }

  if (!valid) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  const token = jwt.sign({ role: "staff" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, usingDefault: !hash });
});

router.post("/auth/staff/set-password", async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};

  if (!currentPassword || !newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const hash = await getPasswordHash();
  let valid = false;
  if (hash) {
    valid = await bcrypt.compare(currentPassword, hash);
  } else {
    valid = currentPassword === DEFAULT_STAFF_PASSWORD;
  }

  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await bcrypt.hash(newPassword, 12);
  await db.insert(settingsTable)
    .values({ key: "staff_password_hash", value: newHash })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: newHash, updatedAt: new Date() } });

  res.json({ ok: true });
});

export default router;
