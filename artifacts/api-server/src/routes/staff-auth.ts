import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production";
const DEFAULT_STAFF_PASSWORD = "sbs2024";

async function getPasswordHash(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "staff_password_hash"));
  return row?.value ?? null;
}

// ── Staff accounts ───────────────────────────────────────────────────────────

interface StaffAccount {
  name: string;
  email: string;
  is_superuser?: boolean;
  allowed_nav?: string[] | null; // null = all access, array = restricted
}

async function getStaffAccounts(): Promise<StaffAccount[]> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "staff_accounts"));
  if (!row?.value) return [];
  try { return JSON.parse(row.value); } catch { return []; }
}

async function saveStaffAccounts(accounts: StaffAccount[]): Promise<void> {
  await db.insert(settingsTable)
    .values({ key: "staff_accounts", value: JSON.stringify(accounts) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(accounts), updatedAt: new Date() } });
}

// Decode JWT from Authorization header and return payload (or null if invalid)
function decodeStaffJwt(req: import("express").Request): Record<string, unknown> | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as Record<string, unknown>;
    return payload.role === "staff" ? payload : null;
  } catch { return null; }
}

// Check if the requester is a superuser (password-login with no email = full access)
async function isSuperuser(req: import("express").Request): Promise<boolean> {
  const payload = decodeStaffJwt(req);
  if (!payload) return false;
  if (!payload.email) return true; // password login → full access
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email === (payload.email as string));
  return !!account?.is_superuser;
}

router.get("/auth/staff/accounts", async (_req, res): Promise<void> => {
  const accounts = await getStaffAccounts();
  res.json({ accounts });
});

router.post("/auth/staff/accounts", async (req, res): Promise<void> => {
  const { name, email } = req.body ?? {};
  if (!name || typeof name !== "string" || !email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Name and valid email required" });
    return;
  }
  const normEmail = email.trim().toLowerCase();
  const accounts = await getStaffAccounts();
  if (accounts.some(a => a.email === normEmail)) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }
  accounts.push({ name: name.trim(), email: normEmail, is_superuser: false, allowed_nav: null });
  await saveStaffAccounts(accounts);
  res.json({ ok: true, accounts });
});

router.patch("/auth/staff/accounts/:email", async (req, res): Promise<void> => {
  if (!await isSuperuser(req)) { res.status(403).json({ error: "Superuser access required" }); return; }
  const normEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
  const accounts = await getStaffAccounts();
  const idx = accounts.findIndex(a => a.email === normEmail);
  if (idx === -1) { res.status(404).json({ error: "Account not found" }); return; }
  const body = req.body ?? {};
  if (typeof body.name === "string" && body.name.trim()) accounts[idx].name = body.name.trim();
  if (typeof body.email === "string" && body.email.includes("@")) accounts[idx].email = body.email.trim().toLowerCase();
  if (typeof body.is_superuser === "boolean") accounts[idx].is_superuser = body.is_superuser;
  if ("allowed_nav" in body) accounts[idx].allowed_nav = Array.isArray(body.allowed_nav) ? body.allowed_nav : null;
  await saveStaffAccounts(accounts);
  res.json({ ok: true, account: accounts[idx] });
});

router.delete("/auth/staff/accounts/:email", async (req, res): Promise<void> => {
  const normEmail = decodeURIComponent(req.params.email).trim().toLowerCase();
  const accounts = await getStaffAccounts();
  await saveStaffAccounts(accounts.filter(a => a.email !== normEmail));
  res.json({ ok: true });
});

// ── /auth/staff/me — return current user's profile ───────────────────────────
router.get("/auth/staff/me", async (req, res): Promise<void> => {
  const payload = decodeStaffJwt(req);
  if (!payload) { res.status(401).json({ error: "Not authenticated" }); return; }
  // Password login — no specific identity, full access
  if (!payload.email) {
    res.json({ name: null, email: null, is_superuser: true, allowed_nav: null });
    return;
  }
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email === (payload.email as string));
  if (!account) {
    // Account deleted since login — still valid JWT, give read-only access
    res.json({ name: payload.name ?? null, email: payload.email, is_superuser: false, allowed_nav: [] });
    return;
  }
  res.json({
    name: account.name,
    email: account.email,
    is_superuser: !!account.is_superuser,
    allowed_nav: account.allowed_nav ?? null,
  });
});

// ── Email OTP login ──────────────────────────────────────────────────────────

router.post("/auth/staff/request-otp", async (req, res): Promise<void> => {
  const { email } = req.body ?? {};
  if (!email || typeof email !== "string") { res.status(400).json({ error: "Email required" }); return; }
  const normEmail = email.trim().toLowerCase();
  const accounts = await getStaffAccounts();

  if (!accounts.some(a => a.email === normEmail)) {
    res.json({ ok: true });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = crypto.createHash("sha256").update(code).digest("hex");
  const expiresAt = Date.now() + 10 * 60 * 1000;

  const otpKey = `staff_otp_${normEmail}`;
  await db.insert(settingsTable)
    .values({ key: otpKey, value: JSON.stringify({ codeHash, expiresAt }) })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify({ codeHash, expiresAt }), updatedAt: new Date() } });

  const firstName = accounts.find(a => a.email === normEmail)?.name.split(" ")[0] ?? "there";

  const emailResult = await sendEmail({
    to: normEmail,
    subject: "Your SBS login code",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">Select Branding Solutions</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Order Management System</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 16px;font-size:15px;color:#374151;">Hi ${firstName},</p>
          <p style="margin:0 0 24px;font-size:14px;color:#374151;line-height:1.6;">Here is your one-time login code for the SBS Order System:</p>
          <div style="text-align:center;margin:0 0 24px;">
            <span style="display:inline-block;background:#1e293b;color:#ffffff;font-size:32px;font-weight:700;letter-spacing:8px;padding:16px 28px;border-radius:8px;">${code}</span>
          </div>
          <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">This code expires in <strong>10 minutes</strong>.</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">If you didn't request this, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">Select Branding Solutions Ltd &middot; wardrobe.selectbranding.co.uk</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
    text: `Hi ${firstName},\n\nYour SBS Order System login code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
  });

  if (!emailResult.sent) {
    console.error(`[auth] OTP email failed for ${normEmail}: ${emailResult.error ?? "unknown error"}`);
    res.status(500).json({ error: "Failed to send login code email. Please contact your administrator." });
    return;
  }

  console.log(`[auth] OTP email sent to ${normEmail} via ${emailResult.provider ?? "unknown"}, messageId=${emailResult.messageId ?? "n/a"}`);
  res.json({ ok: true });
});

router.post("/auth/staff/verify-otp", async (req, res): Promise<void> => {
  const { email, code } = req.body ?? {};
  if (!email || !code || typeof email !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "Email and code required" }); return;
  }
  const normEmail = email.trim().toLowerCase();
  const otpKey = `staff_otp_${normEmail}`;
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, otpKey));

  if (!row?.value) { res.status(401).json({ error: "Invalid or expired code" }); return; }

  let otpData: { codeHash: string; expiresAt: number };
  try { otpData = JSON.parse(row.value); }
  catch { res.status(401).json({ error: "Invalid or expired code" }); return; }

  if (Date.now() > otpData.expiresAt) {
    await db.delete(settingsTable).where(eq(settingsTable.key, otpKey));
    res.status(401).json({ error: "Code has expired — please request a new one" }); return;
  }

  const inputHash = crypto.createHash("sha256").update(code.trim()).digest("hex");
  if (inputHash !== otpData.codeHash) {
    res.status(401).json({ error: "Incorrect code — please check and try again" }); return;
  }

  await db.delete(settingsTable).where(eq(settingsTable.key, otpKey));
  const accounts = await getStaffAccounts();
  const account = accounts.find(a => a.email === normEmail);
  const token = jwt.sign(
    { role: "staff", email: normEmail, name: account?.name ?? null },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
  res.json({ token });
});

// ── Password auth ────────────────────────────────────────────────────────────

router.post("/auth/staff/login", async (req, res): Promise<void> => {
  const { password } = req.body ?? {};
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Password required" }); return;
  }

  const hash = await getPasswordHash();
  let valid = false;
  if (hash) {
    valid = await bcrypt.compare(password, hash);
  } else {
    valid = password === DEFAULT_STAFF_PASSWORD;
  }

  if (!valid) { res.status(401).json({ error: "Incorrect password" }); return; }

  const token = jwt.sign({ role: "staff" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, usingDefault: !hash });
});

router.get("/auth/staff/status", async (_req, res): Promise<void> => {
  const hash = await getPasswordHash();
  res.json({ passwordConfigured: !!hash });
});

router.post("/auth/staff/setup", async (req, res): Promise<void> => {
  const hash = await getPasswordHash();
  if (hash) { res.status(409).json({ error: "Password already configured — use set-password instead" }); return; }
  const { newPassword } = req.body ?? {};
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" }); return;
  }
  const newHash = await bcrypt.hash(newPassword, 12);
  await db.insert(settingsTable)
    .values({ key: "staff_password_hash", value: newHash })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: newHash, updatedAt: new Date() } });
  const token = jwt.sign({ role: "staff" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ ok: true, token });
});

router.post("/auth/staff/recover", async (req, res): Promise<void> => {
  const { recoveryKey } = req.body ?? {};
  const expected = process.env.STAFF_RECOVERY_KEY;
  if (!expected || !recoveryKey || recoveryKey !== expected) {
    res.status(401).json({ error: "Invalid recovery key" }); return;
  }
  await db.delete(settingsTable).where(eq(settingsTable.key, "staff_password_hash"));
  res.json({ ok: true, message: "Password cleared — you can now create a new one" });
});

router.post("/auth/staff/set-password", async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" }); return;
  }
  const hash = await getPasswordHash();
  let valid = false;
  if (hash) {
    valid = await bcrypt.compare(currentPassword, hash);
  } else {
    valid = currentPassword === DEFAULT_STAFF_PASSWORD;
  }
  if (!valid) { res.status(401).json({ error: "Current password is incorrect" }); return; }
  const newHash = await bcrypt.hash(newPassword, 12);
  await db.insert(settingsTable)
    .values({ key: "staff_password_hash", value: newHash })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: newHash, updatedAt: new Date() } });
  res.json({ ok: true });
});

export default router;
