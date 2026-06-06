/**
 * Customer Portal API
 * Invite-based auth + order management for customers
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  db, customersTable, orderItemsTable, productsTable, suppliersTable,
  worksheetsTable, worksheetItemsTable, customerProcessesTable, customerFinishProcessesTable,
  purchaseOrdersTable, purchaseOrderItemsTable, ordersTable, orderLogsTable, orderEmailLogsTable,
  orderMessagesTable, settingsTable,
} from "@workspace/db";
import { sql, eq, inArray, asc } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { z } from "zod";
import { generateInvoicePDF, buildAcknowledgementEmail, generateOrderAcknowledgementPdf, sendEmail, isEmailConfigured } from "../services/email.js";
import { SBS_LOGO_DATA_URL } from "../assets/logo-data.js";
import { getUncachableStripeClient, getStripePublishableKey } from "../services/stripeClient.js";
import { notifyCustomerManagers, notifyPortalUserByEmail, notifyAllPortalUsers, sendMobileInstructionsEmail } from "../services/notifications.js";

const router: IRouter = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production";
const INVITE_TTL_DAYS = 7;
const MAGIC_TTL_MINUTES = 30;

function buildMagicLinkEmail(_email: string, magicUrl: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px 0;margin:0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0">
    <img src="${SBS_LOGO_DATA_URL}" alt="Select Branding Solutions" style="height:48px;margin-bottom:24px" />
    <h2 style="font-size:20px;color:#0f172a;margin:0 0 8px">Your sign-in link</h2>
    <p style="color:#475569;font-size:15px;margin:0 0 24px">Click the button below to sign in to your Select Branding Solutions ordering portal. This link expires in ${MAGIC_TTL_MINUTES} minutes.</p>
    <a href="${magicUrl}" style="display:inline-block;background:#1e293b;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:24px">Sign in to Portal</a>
    <p style="color:#94a3b8;font-size:13px;margin:0">If you didn't request this, you can safely ignore this email. This link can only be used once.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
    <p style="color:#94a3b8;font-size:12px;margin:0">Select Branding Solutions &bull; <a href="${magicUrl}" style="color:#94a3b8;word-break:break-all">${magicUrl}</a></p>
  </div>
</body>
</html>`;
  const text = `Sign in to your Select Branding Solutions portal\n\nClick this link to sign in (expires in ${MAGIC_TTL_MINUTES} minutes):\n${magicUrl}\n\nIf you didn't request this, ignore this email.`;
  return { html, text };
}

function buildInviteEmail(email: string, inviteUrl: string, customerName: string): { html: string; text: string } {
  const html = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f8fafc;padding:32px 0;margin:0">
  <div style="max-width:500px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e2e8f0">
    <img src="${SBS_LOGO_DATA_URL}" alt="Select Branding Solutions" style="height:48px;margin-bottom:24px" />
    <h2 style="font-size:20px;color:#0f172a;margin:0 0 8px">Your ${customerName} account is ready</h2>
    <p style="color:#475569;font-size:15px;margin:0 0 8px">Hi,</p>
    <p style="color:#475569;font-size:15px;margin:0 0 24px">We've set up your account on the Select Branding Solutions wardrobe portal. Use the link below to sign in and get started — it expires in ${INVITE_TTL_DAYS} days.</p>
    <a href="${inviteUrl}" style="display:inline-block;background:#1e293b;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;margin-bottom:28px">Sign in to your account</a>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin-bottom:24px">
      <p style="color:#0f172a;font-size:13px;font-weight:600;margin:0 0 8px">From the portal you can:</p>
      <ul style="color:#475569;font-size:13px;margin:0;padding-left:20px;line-height:1.9">
        <li>Browse and place orders for branded workwear</li>
        <li>Track the status of your orders in real time</li>
        <li>Manage your sizing and wardrobe preferences</li>
      </ul>
    </div>
    <p style="color:#94a3b8;font-size:13px;margin:0">If you were not expecting this email, please contact us at info@selectbranding.co.uk.</p>
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
    <p style="color:#94a3b8;font-size:12px;margin:0">Select Branding Solutions &bull; info@selectbranding.co.uk</p>
  </div>
</body>
</html>`;
  const text = `Your ${customerName} account is ready\n\nHi,\n\nWe've set up your account on the Select Branding Solutions wardrobe portal.\n\nSign in here (link expires in ${INVITE_TTL_DAYS} days):\n${inviteUrl}\n\nFrom the portal you can:\n- Browse and place orders for branded workwear\n- Track the status of your orders in real time\n- Manage your sizing and wardrobe preferences\n\nIf you were not expecting this email, please contact us at info@selectbranding.co.uk.\n\nSelect Branding Solutions`;
  return { html, text };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function signToken(userId: number, customerId: number, portalRole: string) {
  return jwt.sign({ sub: userId, customerId, portalRole }, JWT_SECRET, { expiresIn: "30d" });
}

function signPreviewToken(customerId: number, role: "manager" | "dept_manager" | "member" = "manager", linkedEmployeeId?: number | null, portalUserId?: number | null) {
  return jwt.sign({ sub: portalUserId ?? 0, customerId, portalRole: role, isPreview: true, linkedEmployeeId: linkedEmployeeId ?? null, previewUserId: portalUserId ?? null }, JWT_SECRET, { expiresIn: "2h" });
}

export async function portalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { sub: number; customerId: number; portalRole: string; isPreview?: boolean; linkedEmployeeId?: number | null; previewUserId?: number | null };
    // For preview tokens, use the embedded portal user id (previewUserId / sub) so
    // dept_manager routes can look up the real user's team/email from the DB.
    (req as any).portalUserId = payload.previewUserId ?? payload.sub;
    (req as any).portalCustomerId = payload.customerId;
    (req as any).portalRole = payload.portalRole ?? "member";
    (req as any).portalIsPreview = payload.isPreview ?? false;
    (req as any).portalLinkedEmployeeId = payload.linkedEmployeeId ?? null;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── admin: send invite ──────────────────────────────────────────────────────

router.post("/portal/admin/invite", async (req: Request, res: Response) => {
  const { customerId, email, portalRole, skipEmail } = z.object({
    customerId: z.number().int().positive(),
    email: z.string().email(),
    portalRole: z.enum(["manager", "dept_manager", "member"]).default("member"),
    skipEmail: z.boolean().default(false),
  }).parse(req.body);

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000);

  // upsert: update if (email, customer_id) already exists
  // Only mark as 'invited' when an email is actually being sent; otherwise 'pending'
  const initialStatus = skipEmail ? 'pending' : 'invited';
  const defaultShowPricing = portalRole === 'manager';
  await db.execute(sql`
    INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status, portal_role, show_pricing)
    VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, ${initialStatus}, ${portalRole}, ${defaultShowPricing})
    ON CONFLICT (email, customer_id) DO UPDATE
      SET invite_token = ${token},
          invite_expires_at = ${expires.toISOString()},
          status = ${initialStatus},
          portal_role = ${portalRole},
          updated_at = now()
  `);

  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;

  let emailSent = false;
  let emailError: string | undefined;

  if (isEmailConfigured && !skipEmail) {
    const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
    const absoluteInviteUrl = `${proto}://${host}${inviteUrl}`;
    const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
    const customerName = (custRows.rows[0] as any)?.name ?? "your company";
    const { html, text } = buildInviteEmail(email, absoluteInviteUrl, customerName);
    const result = await sendEmail({
      to: email,
      cc: "info@selectbranding.co.uk",
      subject: `Your ${customerName} account is ready — Select Branding Solutions`,
      html,
      text,
    });
    emailSent = result.sent;
    emailError = result.error;
    if (!result.sent) {
      console.error(`[portal/admin/invite] SMTP failed for ${email}: ${result.error}`);
    }
  }

  res.json({ inviteUrl, token, email, portalRole, expiresAt: expires, emailSent, emailError });
});

// ─── admin: create user directly (generates a magic link, no password) ────────

router.post("/portal/admin/create-user", async (req: Request, res: Response) => {
  const { customerId, email, portalRole } = z.object({
    customerId: z.number().int().positive(),
    email: z.string().email(),
    portalRole: z.enum(["manager", "dept_manager", "member"]).default("member"),
  }).parse(req.body);

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000);

  await db.execute(sql`
    INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status, portal_role)
    VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'pending', ${portalRole})
    ON CONFLICT (email, customer_id) DO UPDATE
      SET invite_token = ${token},
          invite_expires_at = ${expires.toISOString()},
          portal_role = ${portalRole},
          updated_at = now()
  `);

  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;
  res.status(201).json({ ok: true, email, portalRole, inviteUrl, token, expiresAt: expires });
});

// ─── admin: customer detail (employees for invite suggestions) ─────────────

router.get("/portal/admin/customer-detail/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const [employees, custRow] = await Promise.all([
    db.execute(sql`
      SELECT e.id,
        TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))) AS name,
        e.first_name, e.last_name, e.email, e.job_title,
        r.name AS role_name,
        TRIM(CONCAT(m.first_name, ' ', COALESCE(m.last_name, ''))) AS manager_name
      FROM customer_employees e
      LEFT JOIN customer_roles r ON r.id = e.role_id
      LEFT JOIN customer_employees m ON m.id = e.manager_id
      WHERE e.customer_id = ${customerId} AND e.is_active = true
      ORDER BY COALESCE(e.last_name, e.first_name), e.first_name
    `),
    db.execute(sql`SELECT default_shipping_option FROM customers WHERE id = ${customerId} LIMIT 1`),
  ]);
  const defaultShippingOption = (custRow.rows[0] as any)?.default_shipping_option ?? null;
  res.json({ employees: employees.rows, defaultShippingOption });
});

// ─── admin: update customer default shipping option ────────────────────────────

router.patch("/portal/admin/customers/:customerId/settings", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const body = z.object({
    defaultShippingOption: z.string().nullable().optional(),
  }).parse(req.body);
  await db.execute(sql`
    UPDATE customers SET default_shipping_option = ${body.defaultShippingOption ?? null} WHERE id = ${customerId}
  `);
  res.json({ ok: true });
});

// ─── admin: list portal users for a customer ──────────────────────────────

router.get("/portal/admin/users/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const rows = await db.execute(sql`
    SELECT id, email, status, portal_role, show_pricing, last_login_at, created_at,
           invite_expires_at,
           CASE WHEN invite_token IS NOT NULL THEN true ELSE false END as has_pending_invite
    FROM customer_portal_users
    WHERE customer_id = ${customerId}
    ORDER BY created_at DESC
  `);
  res.json(rows.rows);
});

// ─── admin: update portal user email ─────────────────────────────────────────

router.patch("/portal/admin/users/:userId/email", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId, 10);
  const { email } = z.object({ email: z.string().email() }).parse(req.body);
  const normalised = email.toLowerCase().trim();
  const existing = await db.execute(sql`SELECT linked_employee_id FROM customer_portal_users WHERE id = ${userId}`);
  const portalUser = existing.rows[0] as any;
  if (!portalUser) { res.status(404).json({ error: "Portal user not found" }); return; }
  await db.execute(sql`UPDATE customer_portal_users SET email = ${normalised}, updated_at = now() WHERE id = ${userId}`);
  if (portalUser.linked_employee_id) {
    await db.execute(sql`UPDATE customer_employees SET email = ${normalised}, updated_at = now() WHERE id = ${portalUser.linked_employee_id}`);
  }
  res.json({ ok: true });
});

// ─── admin: update portal user role ──────────────────────────────────────────

router.patch("/portal/admin/users/:userId/role", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId, 10);
  const { portalRole } = z.object({
    portalRole: z.enum(["manager", "dept_manager", "member"]),
  }).parse(req.body);
  await db.execute(sql`UPDATE customer_portal_users SET portal_role = ${portalRole}, updated_at = now() WHERE id = ${userId}`);
  res.json({ ok: true });
});

// ─── admin: toggle pricing visibility for a portal user ───────────────────────

router.patch("/portal/admin/users/:userId/show-pricing", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId, 10);
  const { showPricing } = z.object({ showPricing: z.boolean() }).parse(req.body);
  await db.execute(sql`UPDATE customer_portal_users SET show_pricing = ${showPricing}, updated_at = now() WHERE id = ${userId}`);
  res.json({ ok: true });
});

// ─── admin: revoke portal user ────────────────────────────────────────────

router.delete("/portal/admin/users/:userId", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId, 10);
  await db.execute(sql`DELETE FROM customer_portal_users WHERE id = ${userId}`);
  res.json({ ok: true });
});

// ─── verify magic link / accept invite ───────────────────────────────────────
// Accepts either a user-requested magic link or an admin-generated invite link.
// No password required — the token is the credential.

const SELECTION_TTL_MINUTES = 10;

router.post("/portal/auth/accept-invite", async (req: Request, res: Response) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);

  // Find all portal users that share this invite token (could be multiple businesses)
  const rows = await db.execute(sql`
    SELECT u.*, c.name AS customer_name, c.logo_url AS customer_logo
    FROM customer_portal_users u
    JOIN customers c ON c.id = u.customer_id
    WHERE u.invite_token = ${token}
      AND u.invite_expires_at > now()
    ORDER BY c.name
  `);
  const users = rows.rows as any[];

  if (users.length === 0) {
    res.status(400).json({ error: "This link has expired or already been used. Please request a new one." });
    return;
  }

  // Clear the invite token from all rows for this email (token is now consumed)
  await db.execute(sql`
    UPDATE customer_portal_users
    SET invite_token = NULL,
        invite_expires_at = NULL,
        status = 'active',
        updated_at = now()
    WHERE lower(email) = lower(${users[0].email})
  `);

  // Single business — go straight in
  if (users.length === 1) {
    const user = users[0];
    await db.execute(sql`UPDATE customer_portal_users SET last_login_at = now(), updated_at = now() WHERE id = ${user.id}`);
    const jwtToken = signToken(user.id, user.customer_id, user.portal_role ?? "member");
    res.json({ token: jwtToken, customerId: user.customer_id, customerName: user.customer_name, email: user.email, portalRole: user.portal_role ?? "member", multipleBusinesses: false });
    return;
  }

  // Multiple businesses — issue a short-lived selection token and return business list
  const selToken = randomBytes(32).toString("hex");
  const selExpires = new Date(Date.now() + SELECTION_TTL_MINUTES * 60 * 1000);

  await db.execute(sql`
    UPDATE customer_portal_users
    SET selection_token = ${selToken}, selection_expires_at = ${selExpires.toISOString()}, updated_at = now()
    WHERE lower(email) = lower(${users[0].email})
  `);

  res.json({
    multipleBusinesses: true,
    selectionToken: selToken,
    email: users[0].email,
    businesses: users.map(u => ({
      portalUserId: u.id,
      customerId: u.customer_id,
      customerName: u.customer_name,
      logoUrl: u.customer_logo ?? null,
      portalRole: u.portal_role ?? "member",
    })),
  });
});

// ─── select business (multi-business picker) ─────────────────────────────────

router.post("/portal/auth/select-business", async (req: Request, res: Response) => {
  const parsed = z.object({
    selectionToken: z.string().min(1),
    portalUserId: z.number().int().positive(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const { selectionToken, portalUserId } = parsed.data;

  // Verify selection token is valid for this user
  const rows = await db.execute(sql`
    SELECT u.*, c.name AS customer_name
    FROM customer_portal_users u
    JOIN customers c ON c.id = u.customer_id
    WHERE u.id = ${portalUserId}
      AND u.selection_token = ${selectionToken}
      AND u.selection_expires_at > now()
  `);
  const user = rows.rows[0] as any;
  if (!user) { res.status(400).json({ error: "Selection expired. Please sign in again." }); return; }

  // Clear selection token for all users sharing this email
  await db.execute(sql`
    UPDATE customer_portal_users
    SET selection_token = NULL, selection_expires_at = NULL, last_login_at = now(), updated_at = now()
    WHERE lower(email) = lower(${user.email})
  `);

  const jwtToken = signToken(user.id, user.customer_id, user.portal_role ?? "member");
  res.json({ token: jwtToken, customerId: user.customer_id, customerName: user.customer_name, email: user.email, portalRole: user.portal_role ?? "member" });
});

// ─── switch business (authenticated) ─────────────────────────────────────────
// Called when a logged-in user with multiple businesses wants to switch.
// Looks up all businesses for their email and returns a new selection token.

router.post("/portal/auth/switch-business", portalAuth, async (req: Request, res: Response) => {
  const userId = (req as any).portalUserId;
  const userRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${userId}`);
  const email = (userRows.rows[0] as any)?.email;
  if (!email) { res.status(404).json({ error: "User not found" }); return; }

  const rows = await db.execute(sql`
    SELECT u.id, u.customer_id, u.portal_role, c.name AS customer_name, c.logo_url AS customer_logo
    FROM customer_portal_users u
    JOIN customers c ON c.id = u.customer_id
    WHERE lower(u.email) = lower(${email})
    ORDER BY c.name
  `);
  const users = rows.rows as any[];

  if (users.length <= 1) { res.status(400).json({ error: "Only one business linked to this email" }); return; }

  const selToken = randomBytes(32).toString("hex");
  const selExpires = new Date(Date.now() + SELECTION_TTL_MINUTES * 60 * 1000);

  await db.execute(sql`
    UPDATE customer_portal_users
    SET selection_token = ${selToken}, selection_expires_at = ${selExpires.toISOString()}, updated_at = now()
    WHERE lower(email) = lower(${email})
  `);

  res.json({
    selectionToken: selToken,
    email,
    businesses: users.map(u => ({
      portalUserId: u.id,
      customerId: u.customer_id,
      customerName: u.customer_name,
      logoUrl: u.customer_logo ?? null,
      portalRole: u.portal_role ?? "member",
    })),
  });
});

// ─── request magic link (login) ──────────────────────────────────────────────
// Takes an email address and sends (or returns in dev) a one-time sign-in link.

router.post("/portal/auth/login", async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email(), returnTo: z.string().optional() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }
  const { email, returnTo } = parsed.data;

  const rows = await db.execute(sql`
    SELECT u.*, c.name AS customer_name, c.logo_url AS customer_logo
    FROM customer_portal_users u
    JOIN customers c ON c.id = u.customer_id
    WHERE lower(u.email) = lower(${email})
    ORDER BY c.name
  `);
  const users = rows.rows as any[];

  if (users.length === 0) {
    res.json({ ok: true, emailSent: false, noAccount: true });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + MAGIC_TTL_MINUTES * 60 * 1000);

  // Write the magic token to ALL rows for this email (any will work for the link)
  await db.execute(sql`
    UPDATE customer_portal_users
    SET invite_token = ${token}, invite_expires_at = ${expires.toISOString()}, updated_at = now()
    WHERE lower(email) = lower(${email})
  `);

  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const returnToParam = returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : "";
  const magicUrl = `${proto}://${host}/customer-portal/accept-invite?token=${token}${returnToParam}`;

  let emailSent = false;
  let emailError: string | undefined;
  if (isEmailConfigured) {
    const { html, text } = buildMagicLinkEmail(email, magicUrl);
    const result = await sendEmail({
      to: email,
      cc: "info@selectbranding.co.uk",
      subject: "Your sign-in link – Select Branding Solutions Portal",
      html,
      text,
    });
    emailSent = result.sent;
    emailError = result.error;
    if (!result.sent) {
      console.error(`[portal/auth/login] SMTP failed for ${email}: ${result.error}`);
    }
  }

  res.json({ ok: true, emailSent, ...(!emailSent ? { magicUrl, emailError } : {}) });
});

// ─── me ──────────────────────────────────────────────────────────────────────

router.get("/portal/auth/me", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const userId = (req as any).portalUserId;
  const isPreview = (req as any).portalIsPreview;

  const custRows = await db.execute(sql`SELECT id, name, logo_url FROM customers WHERE id = ${customerId}`);
  const customer = custRows.rows[0];

  if (isPreview) {
    const previewRole = (req as any).portalRole ?? "manager";
    const linkedEmployeeId: number | null = (req as any).portalLinkedEmployeeId ?? null;
    let firstName = "there";
    let previewEmployeeName: string | null = null;
    let previewEmail = "staff-preview@sbs.internal";

    // If previewing as a specific portal user, look up their real email
    if (userId) {
      const puRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${userId} LIMIT 1`);
      const pu = puRows.rows[0] as any;
      if (pu?.email) previewEmail = pu.email;
    }

    if (linkedEmployeeId) {
      const empRows = await db.execute(sql`SELECT first_name, last_name FROM customer_employees WHERE id = ${linkedEmployeeId} LIMIT 1`);
      const emp = empRows.rows[0] as any;
      if (emp) {
        firstName = (emp.first_name ?? "there").trim().split(/\s+/)[0];
        previewEmployeeName = [emp.first_name, emp.last_name].filter(Boolean).join(" ");
      }
    } else if (userId && previewEmail !== "staff-preview@sbs.internal") {
      // Previewing as a specific portal user with no linked employee —
      // derive a first name from the email local part (e.g. "sona.kristofcakova" → "Sona")
      const localPart = previewEmail.split("@")[0] ?? "";
      const namePart = localPart.split(".")[0] ?? "";
      // Split CamelCase (e.g. "VasilicaAnaMaria" → ["Vasilica","Ana","Maria"]) and take first word.
      // Falls back to a simple capitalise if the string is all lowercase (e.g. "sona").
      const camelWords = namePart.split(/(?=[A-Z])/).filter(Boolean);
      const firstWord = camelWords.length > 1 ? camelWords[0] : (namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase());
      firstName = firstWord.length > 0 && firstWord.length <= 20 ? firstWord : "there";
      previewEmployeeName = previewEmail; // show email in banner so staff know who they're viewing as
    } else {
      const contactRows = await db.execute(sql`SELECT contact_first_name FROM customers WHERE id = ${customerId}`);
      const raw = (contactRows.rows[0] as any)?.contact_first_name ?? "there";
      firstName = raw.trim().split(/\s+/)[0];
    }
    res.json({
      user: { id: userId ?? 0, email: previewEmail, status: "active", portal_role: previewRole, show_pricing: previewRole === "manager" },
      customer,
      firstName,
      isPreview: true,
      previewEmployeeName,
      linkedEmployeeId,
    });
    return;
  }

  const userRows = await db.execute(sql`
    SELECT id, email, status, portal_role, show_pricing, last_login_at FROM customer_portal_users WHERE id = ${userId}
  `);
  const portalUser = userRows.rows[0] as any;

  // Try to find first name from matching employee record, otherwise parse from email
  let firstName = "there";
  if (portalUser?.email) {
    const empRows = await db.execute(sql`
      SELECT first_name FROM customer_employees
      WHERE customer_id = ${customerId} AND lower(email) = lower(${portalUser.email})
      LIMIT 1
    `);
    if (empRows.rows.length > 0 && (empRows.rows[0] as any).first_name) {
      // Take only the first word in case the full name is stored in this field
      const raw = (empRows.rows[0] as any).first_name as string;
      firstName = raw.trim().split(/\s+/)[0];
    } else {
      const emailPrefix = portalUser.email.split("@")[0].split(".")[0].split("_")[0];
      firstName = emailPrefix.charAt(0).toUpperCase() + emailPrefix.slice(1).toLowerCase();
    }
  }

  res.json({
    user: portalUser,
    customer,
    firstName,
  });
});

// ─── admin: generate staff preview token ─────────────────────────────────────

router.post("/portal/admin/preview/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  if (!customerId) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const custRows = await db.execute(sql`SELECT id, name, logo_url FROM customers WHERE id = ${customerId}`);
  if (!custRows.rows[0]) { res.status(404).json({ error: "Customer not found" }); return; }

  const roleParam = req.query.role as string;
  const role: "manager" | "dept_manager" | "member" = roleParam === "member" ? "member" : roleParam === "dept_manager" ? "dept_manager" : "manager";
  const body = z.object({
    employeeId: z.number().int().positive().optional().nullable(),
    portalUserId: z.number().int().positive().optional().nullable(),
  }).optional().safeParse(req.body);
  let linkedEmployeeId = body.success ? (body.data?.employeeId ?? null) : null;
  const reqPortalUserId = body.success ? (body.data?.portalUserId ?? null) : null;

  // If a specific portal user was requested but no explicit employeeId was supplied,
  // resolve their linked_employee_id from the DB so their wardrobe/team filtering works.
  if (reqPortalUserId && linkedEmployeeId === null) {
    const userRows = await db.execute(sql`
      SELECT linked_employee_id FROM customer_portal_users WHERE id = ${reqPortalUserId} LIMIT 1
    `);
    linkedEmployeeId = (userRows.rows[0] as any)?.linked_employee_id ?? null;
  }

  const token = signPreviewToken(customerId, role, linkedEmployeeId, reqPortalUserId);
  const previewUrl = `/customer-portal/preview-login?token=${token}`;
  res.json({ previewUrl, token, expiresIn: "2h", role, linkedEmployeeId, portalUserId: reqPortalUserId });
});

// ─── portal: list orders ─────────────────────────────────────────────────────

router.get("/portal/orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  const portalUserId = (req as any).portalUserId;
  const portalIsPreview = (req as any).portalIsPreview;
  const linkedEmployeeId = (req as any).portalLinkedEmployeeId;

  // Top-level manager sees all orders except pending_review (those live in the approval panel)
  if (portalRole === "manager") {
    const rows = await db.execute(sql`
      SELECT id, order_number, status, portal_status, total_amount, order_date, required_date,
             po_number,
             portal_submitted_by_name, portal_submitted_at,
             portal_approved_by_name, portal_approved_at,
             (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = orders.id) as item_count
      FROM orders
      WHERE customer_id = ${customerId}
        AND source = 'portal'
        AND portal_status IS DISTINCT FROM 'pending_review'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(rows.rows);
    return;
  }

  // Dept_manager sees all non-pending orders for the customer, plus their own pending_review orders.
  // They cannot see other dept_managers' pending orders — only a top-level manager approves.
  if (portalRole === "dept_manager") {
    // Resolve which employee this session belongs to (for filtering their orders).
    // For preview sessions: the linked employee ID is in the JWT.
    // For real logins: look up the portal user's linked_employee_id, with email as fallback.
    let deptEmployeeId: number | null = null;
    let deptEmail: string | null = null;

    if (portalIsPreview && linkedEmployeeId) {
      deptEmployeeId = linkedEmployeeId;
      // Also look up the employee's email so orders matched only by email are visible
      const empEmailRows = await db.execute(sql`
        SELECT email FROM customer_employees WHERE id = ${linkedEmployeeId} LIMIT 1
      `);
      deptEmail = (empEmailRows.rows[0] as any)?.email ?? null;
    } else if (portalUserId) {
      const userRows = await db.execute(sql`
        SELECT email, linked_employee_id FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1
      `);
      deptEmail = (userRows.rows[0] as any)?.email ?? null;
      deptEmployeeId = (userRows.rows[0] as any)?.linked_employee_id ?? null;
      // If we have a linked employee ID but no portal-user email, also check the employee record
      if (deptEmployeeId && !deptEmail) {
        const empEmailRows = await db.execute(sql`
          SELECT email FROM customer_employees WHERE id = ${deptEmployeeId} LIMIT 1
        `);
        deptEmail = (empEmailRows.rows[0] as any)?.email ?? null;
      }
    }

    // Build the ownership condition:
    //   - Primary:  match by stamped employee ID (works for all new orders)
    //   - Secondary: match by email (for orders placed before employee ID was stamped)
    //   - Fallback: if neither identifier is known, show all orders (test accounts / unlinked)
    let ownsOrder: string;
    if (deptEmployeeId !== null) {
      ownsOrder = `portal_submitted_by_employee_id = ${deptEmployeeId}` +
        (deptEmail ? ` OR lower(portal_submitted_by_email) = lower('${deptEmail.replace(/'/g, "''")}')` : "");
    } else if (deptEmail) {
      ownsOrder = `lower(portal_submitted_by_email) = lower('${deptEmail.replace(/'/g, "''")}')`;
    } else {
      ownsOrder = "true"; // no identifier — show all (testing only)
    }

    const rows = await db.execute(sql`
      SELECT id, order_number, status, portal_status, total_amount, order_date, required_date,
             po_number,
             portal_submitted_by_name, portal_submitted_at,
             portal_approved_by_name, portal_approved_at,
             (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = orders.id) as item_count
      FROM orders
      WHERE customer_id = ${customerId}
        AND source = 'portal'
        AND (
          portal_status IS DISTINCT FROM 'pending_review'
          OR (${sql.raw(ownsOrder)})
        )
      ORDER BY created_at DESC
      LIMIT 100
    `);
    res.json(rows.rows);
    return;
  }

  // For member: resolve the submitter's email
  let submitterEmail: string | null = null;
  if (portalIsPreview && linkedEmployeeId) {
    // Preview token — look up the linked employee's email
    const empRows = await db.execute(sql`
      SELECT email FROM customer_employees WHERE id = ${linkedEmployeeId} LIMIT 1
    `);
    submitterEmail = (empRows.rows[0] as any)?.email ?? null;
  } else if (portalUserId) {
    const userRows = await db.execute(sql`
      SELECT email FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1
    `);
    submitterEmail = (userRows.rows[0] as any)?.email ?? null;
  }

  if (!submitterEmail) {
    res.json([]);
    return;
  }

  const rows = await db.execute(sql`
    SELECT id, order_number, status, portal_status, total_amount, order_date, required_date,
           po_number,
           portal_submitted_by_name, portal_submitted_at,
           portal_approved_by_name, portal_approved_at,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = orders.id) as item_count
    FROM orders
    WHERE customer_id = ${customerId}
      AND source = 'portal'
      AND lower(portal_submitted_by_email) = lower(${submitterEmail})
    ORDER BY created_at DESC
    LIMIT 100
  `);
  res.json(rows.rows);
});

// ─── portal: get single order ────────────────────────────────────────────────

router.get("/portal/orders/:id", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const orderId = parseInt(req.params.id, 10);

  const orderRows = await db.execute(sql`
    SELECT * FROM orders WHERE id = ${orderId} AND customer_id = ${customerId} AND source = 'portal'
  `);
  const order = orderRows.rows[0];
  if (!order) { res.status(404).json({ error: "Not found" }); return; }

  const itemRows = await db.execute(sql`
    SELECT * FROM order_items WHERE order_id = ${orderId} ORDER BY id
  `);
  res.json({ ...order, items: itemRows.rows });
});

// ─── portal: update PO number on an order ────────────────────────────────────

router.patch("/portal/orders/:id/po", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const orderId = parseInt(req.params.id, 10);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({ poNumber: z.string().max(100) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const rows = await db.execute(sql`
    UPDATE orders SET po_number = ${body.data.poNumber || null}, updated_at = now()
    WHERE id = ${orderId} AND customer_id = ${customerId} AND source = 'portal'
    RETURNING id, po_number
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  res.json(rows.rows[0]);
});

// ─── portal: manager — bulk assign PO number to multiple orders ──────────────

router.patch("/portal/manager/bulk-po", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }

  const parsed = z.object({
    orderIds: z.array(z.number().int().positive()).min(1).max(100),
    poNumber: z.string().max(100),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const { orderIds, poNumber } = parsed.data;
  const idList = orderIds.map(id => parseInt(String(id), 10)).join(",");
  await db.execute(sql`
    UPDATE orders
    SET po_number = ${poNumber.trim() || null}, updated_at = now()
    WHERE id IN (${sql.raw(idList)})
      AND customer_id = ${customerId}
      AND source = 'portal'
  `);
  res.json({ ok: true, updated: orderIds.length });
});

// ─── portal: basket (save / restore / clear) ─────────────────────────────────

router.get("/portal/basket", portalAuth, async (req: Request, res: Response) => {
  const userId = (req as any).portalUserId;
  if (!userId) { res.json({ items: [], mode: null, step: 0 }); return; }
  const rows = await db.execute(sql`SELECT * FROM portal_baskets WHERE portal_user_id = ${userId}`);
  const b = rows.rows[0] as any;
  if (!b) { res.json({ items: [], mode: null, step: 0 }); return; }
  res.json({ items: b.items ?? [], mode: b.mode ?? null, step: b.step ?? 1, updatedAt: b.updated_at, estimatedTotal: parseFloat(b.estimated_total ?? "0"), itemCount: b.item_count ?? 0 });
});

router.put("/portal/basket", portalAuth, async (req: Request, res: Response) => {
  const userId = (req as any).portalUserId;
  const customerId = (req as any).portalCustomerId;
  const isPreview = (req as any).portalIsPreview;
  if (!userId || isPreview) { res.json({ ok: false }); return; }

  const parsed = z.object({
    items: z.array(z.any()).default([]),
    mode: z.string().nullable().optional(),
    step: z.number().int().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { items, mode, step } = parsed.data;
  const itemCount = items.length;
  const estimatedTotal = items.reduce((s: number, i: any) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);

  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
  const customerName = (custRows.rows[0] as any)?.name ?? null;
  const userRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${userId}`);
  const userEmail = (userRows.rows[0] as any)?.email ?? null;

  await db.execute(sql`
    INSERT INTO portal_baskets (portal_user_id, customer_id, customer_name, user_email, items, item_count, estimated_total, mode, step)
    VALUES (${userId}, ${customerId}, ${customerName}, ${userEmail}, ${JSON.stringify(items)}::jsonb, ${itemCount}, ${estimatedTotal.toFixed(2)}, ${mode ?? null}, ${step ?? 1})
    ON CONFLICT (portal_user_id) DO UPDATE
      SET items = ${JSON.stringify(items)}::jsonb,
          item_count = ${itemCount},
          estimated_total = ${estimatedTotal.toFixed(2)},
          mode = ${mode ?? null},
          step = ${step ?? 1},
          updated_at = now()
  `);
  res.json({ ok: true });
});

router.delete("/portal/basket", portalAuth, async (req: Request, res: Response) => {
  const userId = (req as any).portalUserId;
  if (userId) await db.execute(sql`DELETE FROM portal_baskets WHERE portal_user_id = ${userId}`);
  res.json({ ok: true });
});

// ─── portal: Stripe helpers ───────────────────────────────────────────────────

async function ensurePortalStripeCustomer(customerId: number) {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) throw new Error("Customer not found");
  const stripe = await getUncachableStripeClient();
  if (customer.stripeCustomerId) {
    try {
      const sc = await stripe.customers.retrieve(customer.stripeCustomerId);
      if (!("deleted" in sc)) return sc;
    } catch {}
  }
  const sc = await stripe.customers.create({
    name: customer.name,
    email: customer.email || undefined,
    metadata: { sbs_customer_id: String(customerId) },
  });
  await db.update(customersTable).set({ stripeCustomerId: sc.id }).where(eq(customersTable.id, customerId));
  return sc;
}

// ─── portal: Stripe: publishable key ─────────────────────────────────────────

router.get("/portal/stripe/publishable-key", portalAuth, async (_req: Request, res: Response) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── portal: Stripe: list saved cards ────────────────────────────────────────

router.get("/portal/stripe/payment-methods", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  try {
    const sc = await ensurePortalStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const methods = await stripe.paymentMethods.list({ customer: sc.id, type: "card" });
    res.json({ paymentMethods: methods.data });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── portal: Stripe: create setup intent ─────────────────────────────────────

router.post("/portal/stripe/setup-intent", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  try {
    const sc = await ensurePortalStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.setupIntents.create({
      customer: sc.id,
      payment_method_types: ["card"],
    });
    res.json({ clientSecret: intent.client_secret });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── portal: Stripe: remove saved card ───────────────────────────────────────

router.delete("/portal/stripe/payment-methods/:pmId", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const pmId = req.params.pmId;
  try {
    const sc = await ensurePortalStripeCustomer(customerId);
    const stripe = await getUncachableStripeClient();
    const pm = await stripe.paymentMethods.retrieve(pmId);
    if (pm.customer !== sc.id) {
      res.status(403).json({ error: "Payment method does not belong to this customer" });
      return;
    }
    await stripe.paymentMethods.detach(pmId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── portal: create order ────────────────────────────────────────────────────

router.post("/portal/orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;

  const parsed = z.object({
    notes: z.string().optional(),
    requiredDate: z.string().optional(),
    portalNotes: z.string().optional(),
    poNumber: z.string().max(100).optional(),
    shippingOption: z.string().optional(),
    shippingCost: z.number().nonnegative().optional(),
    paymentMethodId: z.string().nullable().optional(),
    claimSelectExtra: z.boolean().optional(),
    addToStores: z.boolean().optional(),
    quoteToken: z.string().optional(),
    attachments: z.array(z.object({ name: z.string(), objectPath: z.string() })).optional(),
    items: z.array(z.object({
      productId: z.number().nullable().optional(),
      productName: z.string().min(1),
      colour: z.string().optional(),
      size: z.string().optional(),
      finishId: z.number().nullable().optional(),
      finishName: z.string().nullable().optional(),
      recipientType: z.enum(["stock", "person"]).default("stock"),
      recipientName: z.string().optional(),
      recipientEmployeeId: z.number().nullable().optional(),
      quantity: z.number().int().positive(),
      unitPrice: z.number().nonnegative(),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join("; ") });
    return;
  }
  const body = parsed.data;

  // ── SECURITY: if a quoteToken is supplied, the quote's customer MUST match ──
  // This is a hard server-side guard — it cannot be bypassed by the client.
  if (body.quoteToken) {
    const quoteRows = await db.execute(sql`
      SELECT customer_id FROM quotes WHERE token = ${body.quoteToken} LIMIT 1
    `);
    if (!quoteRows.rows.length) {
      res.status(400).json({ error: "Quote not found." });
      return;
    }
    const quoteCustomerId = Number((quoteRows.rows[0] as any).customer_id);
    if (quoteCustomerId !== customerId) {
      console.warn(`[SECURITY] Order blocked: quote customer ${quoteCustomerId} ≠ portal customer ${customerId}`);
      res.status(403).json({ error: "This quote does not belong to your account. Order not created." });
      return;
    }
  }

  try {

  // ── Stock check: for managers, allocate from customer stock before going to SBS ──
  const portalRole = (req as any).portalRole ?? "member";
  let pickingNoteRef: string | null = null;
  const pickingNoteItems: Array<{
    stockItemId: number; itemName: string; colour: string | null; size: string | null;
    quantity: number; recipientName: string | null; location: string | null;
  }> = [];
  let sbsItems = body.items;

  if (portalRole === "manager") {
    sbsItems = [];
    for (const item of body.items) {
      let allocatedFromStock = 0;
      if (item.productId) {
        const stockRows = await db.execute(sql`
          SELECT id, name, stock_quantity, location
          FROM customer_finished_items
          WHERE customer_id = ${customerId}
            AND product_id = ${item.productId}
            AND stock_quantity > 0
            AND (size IS NULL OR lower(size) = lower(${item.size ?? ""}))
            AND (colour IS NULL OR lower(colour) = lower(${item.colour ?? ""}))
          ORDER BY stock_quantity DESC
          LIMIT 1
        `);
        if (stockRows.rows.length > 0) {
          const si = stockRows.rows[0] as any;
          allocatedFromStock = Math.min(Number(si.stock_quantity), item.quantity);
          if (allocatedFromStock > 0) {
            await db.execute(sql`
              UPDATE customer_finished_items
              SET stock_quantity = stock_quantity - ${allocatedFromStock}, updated_at = now()
              WHERE id = ${si.id}
            `);
            pickingNoteItems.push({
              stockItemId: si.id, itemName: item.productName, colour: item.colour ?? null,
              size: item.size ?? null, quantity: allocatedFromStock,
              recipientName: item.recipientName ?? null, location: si.location ?? null,
            });
          }
        }
      }
      const remainingQty = item.quantity - allocatedFromStock;
      if (remainingQty > 0) sbsItems.push({ ...item, quantity: remainingQty });
    }
    if (pickingNoteItems.length > 0) pickingNoteRef = `PN-${Date.now()}`;
  }

  // If all items were fulfilled from stock, skip creating an SBS order
  if (sbsItems.length === 0 && pickingNoteRef) {
    // Record movements against the picking note reference
    const portalUserId = (req as any).portalUserId;
    const userRowsPN = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
    const mgrEmailPN: string | null = (userRowsPN.rows[0] as any)?.email ?? null;
    const mgrNamePN: string = mgrEmailPN ? mgrEmailPN.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "Manager";
    for (const pi of pickingNoteItems) {
      await db.execute(sql`
        INSERT INTO customer_stock_movements (customer_id, stock_item_id, movement_type, quantity, reference, recipient_name, notes, created_by_name, created_at)
        VALUES (${customerId}, ${pi.stockItemId}, 'issue', ${-pi.quantity}, ${pickingNoteRef}, ${pi.recipientName}, 'Issued via order', ${mgrNamePN}, now())
      `);
    }
    res.status(201).json({ allFromStock: true, pickingNote: { ref: pickingNoteRef, items: pickingNoteItems } });
    return;
  }

  const itemsTotal = sbsItems.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  // Carriage is derived server-side from the shipping option so it can't be zero'd by the client.
  const SHIPPING_CARRIAGE: Record<string, number> = { dpd_next_day: 8.50 };
  const carriageAmount = SHIPPING_CARRIAGE[body.shippingOption ?? ""] ?? (body.shippingCost ?? 0);
  const totalAmount = itemsTotal; // total_amount stores items subtotal; carriage_amount is separate

  // Get customer name and default delivery address
  const custRows = await db.execute(sql`SELECT name, address, city, postcode FROM customers WHERE id = ${customerId}`);
  const custRow = custRows.rows[0] as any;
  const customerName = custRow?.name ?? "";
  const defaultAddrRows = await db.execute(sql`
    SELECT id FROM customer_delivery_addresses
    WHERE customer_id = ${customerId} AND is_default = true
    LIMIT 1
  `);
  let customerDefaultAddressId: number | null = (defaultAddrRows.rows[0] as any)?.id ?? null;

  // If no delivery address record exists, auto-create one from the customer's main address
  if (!customerDefaultAddressId && custRow?.address) {
    const newAddrRows = await db.execute(sql`
      INSERT INTO customer_delivery_addresses (customer_id, label, line1, city, postcode, is_default, created_at, updated_at)
      VALUES (${customerId}, 'Main Address', ${custRow.address}, ${custRow.city ?? null}, ${custRow.postcode ?? null}, true, now(), now())
      RETURNING id
    `);
    customerDefaultAddressId = (newAddrRows.rows[0] as any)?.id ?? null;
  }

  // Resolve portal user's email, display name, and employee ID
  const portalUserId = (req as any).portalUserId;
  const userRows = await db.execute(sql`SELECT email, linked_employee_id FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
  const submitterEmail: string | null = (userRows.rows[0] as any)?.email ?? null;
  // Employee ID: for preview sessions use the linked employee from the JWT;
  // for real logins use the portal user's linked_employee_id if set.
  const previewEmployeeId: number | null = (req as any).portalLinkedEmployeeId ?? null;
  const submitterEmployeeId: number | null =
    previewEmployeeId ?? ((userRows.rows[0] as any)?.linked_employee_id ?? null);

  // If the submitting employee has their own delivery address, prefer it over the customer default
  let defaultAddressId: number | null = customerDefaultAddressId;
  if (submitterEmail) {
    const empAddrRows = await db.execute(sql`
      SELECT delivery_address_id FROM customer_employees
      WHERE customer_id = ${customerId} AND lower(email) = lower(${submitterEmail})
        AND delivery_address_id IS NOT NULL
      LIMIT 1
    `);
    const empAddrId: number | null = (empAddrRows.rows[0] as any)?.delivery_address_id ?? null;
    if (empAddrId) defaultAddressId = empAddrId;
  } else if (submitterEmployeeId) {
    // Preview sessions have no email — look up by employee ID instead
    const empAddrRows = await db.execute(sql`
      SELECT delivery_address_id FROM customer_employees
      WHERE id = ${submitterEmployeeId} AND delivery_address_id IS NOT NULL
      LIMIT 1
    `);
    const empAddrId: number | null = (empAddrRows.rows[0] as any)?.delivery_address_id ?? null;
    if (empAddrId) defaultAddressId = empAddrId;
  }
  let submitterName: string | null = null;
  if (submitterEmail) {
    const empRows = await db.execute(sql`
      SELECT first_name, last_name FROM customer_employees
      WHERE customer_id = ${customerId} AND lower(email) = lower(${submitterEmail}) LIMIT 1
    `);
    if (empRows.rows.length > 0) {
      const e = empRows.rows[0] as any;
      submitterName = [e.first_name, e.last_name].filter(Boolean).join(" ") || submitterEmail;
    } else {
      const prefix = submitterEmail.split("@")[0].replace(/[._]/g, " ");
      submitterName = prefix.replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  }
  // For preview sessions there is no email; resolve the name from the employee record directly
  if (!submitterName && submitterEmployeeId) {
    const empNameRows = await db.execute(sql`
      SELECT first_name, last_name FROM customer_employees WHERE id = ${submitterEmployeeId} LIMIT 1
    `);
    if (empNameRows.rows.length > 0) {
      const e = empNameRows.rows[0] as any;
      submitterName = [e.first_name, e.last_name].filter(Boolean).join(" ") || null;
    }
  }

  // Resolve attention_of: prefer the submitter's team manager, fall back to submitter's own name
  let attentionOfName: string | null = null;
  if (submitterEmployeeId) {
    const mgrRows = await db.execute(sql`
      SELECT m.first_name, m.last_name
      FROM customer_employees e
      LEFT JOIN customer_employees m ON m.id = e.manager_id
      WHERE e.id = ${submitterEmployeeId} AND m.id IS NOT NULL
      LIMIT 1
    `);
    const mgr = mgrRows.rows[0] as any;
    if (mgr?.first_name) {
      attentionOfName = [mgr.first_name, mgr.last_name].filter(Boolean).join(" ");
    }
  }
  if (!attentionOfName) attentionOfName = submitterName;

  // Managers submit directly; dept_managers/members save for manager review
  const portalStatus = portalRole === "manager" ? "submitted" : "pending_review";
  const orderStatus = portalRole === "manager" ? "portal_pending" : "portal_draft";

  // Insert with a unique temp order number; update to P{id} after getting auto-generated id
  const orderResult = await db.execute(sql`
    INSERT INTO orders (order_number, customer_id, customer_name, status, source, portal_status, portal_notes, total_amount, carriage_amount, notes, order_date, required_date, shipping_method, po_number, delivery_address_id, attention_of, portal_submitted_by_email, portal_submitted_by_name, portal_submitted_by_employee_id, portal_submitted_at, attachments, add_to_stores)
    VALUES (
      'P-' || gen_random_uuid()::text,
      ${customerId},
      ${customerName},
      ${orderStatus},
      'portal',
      ${portalStatus},
      ${body.portalNotes ?? null},
      ${totalAmount.toFixed(2)},
      ${carriageAmount.toFixed(2)},
      ${body.notes ?? null},
      now(),
      ${body.requiredDate ? new Date(body.requiredDate).toISOString() : null},
      ${body.shippingOption ?? null},
      ${body.poNumber ?? null},
      ${defaultAddressId},
      ${attentionOfName},
      ${submitterEmail},
      ${submitterName},
      ${submitterEmployeeId},
      now(),
      ${body.attachments?.length ? JSON.stringify(body.attachments) : null},
      ${body.addToStores ?? false}
    )
    RETURNING id
  `);
  const orderId = (orderResult.rows[0] as any).id as number;
  const orderNumber = `P${orderId}`;
  await db.execute(sql`UPDATE orders SET order_number = ${orderNumber} WHERE id = ${orderId}`);
  const order = { id: orderId, order_number: orderNumber };

  for (const item of sbsItems) {
    const lineTotal = item.quantity * item.unitPrice;
    await db.execute(sql`
      INSERT INTO order_items (order_id, product_id, product_name, colour, size, finish_id, finish_name, recipient_type, recipient_name, recipient_employee_id, quantity, unit_price, line_total)
      VALUES (
        ${order.id},
        ${item.productId ?? null},
        ${item.productName},
        ${item.colour ?? null},
        ${item.size ?? null},
        ${item.finishId ?? null},
        ${item.finishName ?? null},
        ${item.recipientType},
        ${item.recipientName ?? null},
        ${item.recipientEmployeeId ?? null},
        ${item.quantity},
        ${item.unitPrice.toFixed(2)},
        ${lineTotal.toFixed(2)}
      )
    `);
  }

  // ── Stripe charge if customer chose to pay by card ──────────────────────────
  let stripeCharge: { success: boolean; last4?: string; brand?: string; amount?: number; error?: string } | null = null;
  if (body.paymentMethodId && totalAmount > 0) {
    try {
      const sc = await ensurePortalStripeCustomer(customerId);
      const stripe = await getUncachableStripeClient();
      const pm = await stripe.paymentMethods.retrieve(body.paymentMethodId);
      if (pm.customer !== sc.id) throw new Error("Payment method does not belong to this customer");
      const intent = await stripe.paymentIntents.create({
        amount: Math.round(totalAmount * 100),
        currency: "gbp",
        customer: sc.id,
        payment_method: body.paymentMethodId,
        confirm: true,
        off_session: true,
        description: `Order ${order.order_number} — Select Branding Solutions`,
      });
      if (intent.status === "succeeded") {
        stripeCharge = {
          success: true,
          last4: pm.card?.last4,
          brand: pm.card?.brand,
          amount: totalAmount,
        };
        await db.execute(sql`
          INSERT INTO order_activity_log (order_id, action, actor_type, actor_name, meta)
          VALUES (${orderId}, 'payment_taken', 'portal', 'Customer', ${JSON.stringify({ amount: totalAmount, last4: pm.card?.last4, brand: pm.card?.brand })}::jsonb)
        `);
      }
    } catch (chargeErr: any) {
      console.error("Portal order card charge failed:", chargeErr.message);
      stripeCharge = { success: false, error: chargeErr.message };
      await db.execute(sql`
        INSERT INTO order_activity_log (order_id, action, actor_type, actor_name, meta)
        VALUES (${orderId}, 'payment_failed', 'portal', 'Customer', ${JSON.stringify({ error: chargeErr.message })}::jsonb)
      `);
    }
  }

  // ── Notifications ──────────────────────────────────────────────────────────
  if (portalStatus === "pending_review") {
    // Employee/dept-manager submitted → notify all managers this order needs approval
    notifyCustomerManagers({
      customerId,
      title: `Order ${orderNumber} awaiting your approval`,
      body: `${submitterName} has submitted an order that requires your review.`,
      link: "/orders",
      type: "needs_approval",
    }).catch(() => {});
  } else if (portalStatus === "submitted") {
    // Manager submitted directly to SBS → no approval step needed, no extra notification
  }

  // ── Record stock movements for picking note items (mixed order) ──────────────
  if (pickingNoteRef && pickingNoteItems.length > 0) {
    for (const pi of pickingNoteItems) {
      await db.execute(sql`
        INSERT INTO customer_stock_movements (customer_id, stock_item_id, movement_type, quantity, reference, recipient_name, notes, created_by_name, created_at)
        VALUES (${customerId}, ${pi.stockItemId}, 'issue', ${-pi.quantity}, ${pickingNoteRef}, ${pi.recipientName}, ${"Issued via order " + order.order_number}, ${submitterName}, now())
      `);
    }
  }

  // ── Select Extra: record claim if customer opted in ──────────────────────────
  let selectExtraClaimed = false;
  if (body.claimSelectExtra) {
    try {
      const seNow = new Date();
      const seYear = seNow.getFullYear();
      const seMonth = seNow.getMonth() + 1;
      const offerRows = await db.execute(sql`
        SELECT id, min_spend FROM select_extra_offers
        WHERE year = ${seYear} AND month = ${seMonth} AND is_active = true
        LIMIT 1
      `);
      if (offerRows.rows.length > 0) {
        const offer = offerRows.rows[0] as any;
        const minSpend = parseFloat(offer.min_spend);
        const itemsTotalExVat = sbsItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
        if (itemsTotalExVat >= minSpend) {
          await db.execute(sql`
            INSERT INTO select_extra_claims (offer_id, customer_id, order_id, order_number, customer_name)
            VALUES (${offer.id}, ${customerId}, ${order.id}, ${order.order_number}, ${customerName})
            ON CONFLICT (offer_id, customer_id) DO NOTHING
          `);
          selectExtraClaimed = true;
        }
      }
    } catch (seErr: any) {
      console.error("Select Extra claim error:", seErr);
    }
  }

  res.status(201).json({
    id: order.id,
    orderNumber: order.order_number,
    stripeCharge,
    selectExtraClaimed,
    pickingNote: pickingNoteRef ? { ref: pickingNoteRef, items: pickingNoteItems } : null,
  });
  } catch (err: any) {
    console.error("Order create error:", err);
    res.status(500).json({ error: err?.message ?? "Failed to create order" });
  }
});

// ─── portal: submit inspiration enquiry ──────────────────────────────────────

router.post("/portal/enquiries", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalUserId = (req as any).portalUserId ?? null;

  const body = z.object({
    notes: z.string().optional(),
    items: z.array(z.object({
      productId: z.number().nullable().optional(),
      productName: z.string().min(1),
      imageUrl: z.string().optional(),
      colour: z.string().optional(),
      desiredProcesses: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })).min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Generate an enquiry ref after insert using the row id
  const enqRow = await db.execute(sql`
    INSERT INTO customer_enquiries (customer_id, portal_user_id, enquiry_ref, notes)
    VALUES (${customerId}, ${portalUserId}, 'ENQ-PENDING', ${body.data.notes ?? null})
    RETURNING id
  `);
  const enquiryId = (enqRow.rows[0] as any).id as number;
  const enquiryRef = `ENQ-${String(enquiryId).padStart(5, "0")}`;
  await db.execute(sql`
    UPDATE customer_enquiries SET enquiry_ref = ${enquiryRef} WHERE id = ${enquiryId}
  `);

  for (const item of body.data.items) {
    await db.execute(sql`
      INSERT INTO customer_enquiry_items
        (enquiry_id, product_id, product_name, image_url, colour, desired_processes, item_notes)
      VALUES (
        ${enquiryId},
        ${item.productId ?? null},
        ${item.productName},
        ${item.imageUrl ?? null},
        ${item.colour ?? null},
        ${item.desiredProcesses?.join(", ") ?? null},
        ${item.notes ?? null}
      )
    `);
  }

  res.json({ id: enquiryId, enquiryRef });
});

// ─── portal: browse products ─────────────────────────────────────────────────

router.get("/portal/products", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const rows = await db.execute(sql`
    SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.category, p.description,
           p.is_bespoke,
           (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id) as variant_count,
           (SELECT json_agg(DISTINCT pv.colour ORDER BY pv.colour) FILTER (WHERE pv.colour IS NOT NULL)
              FROM product_variants pv WHERE pv.product_id = p.id) as colours
    FROM products p
    WHERE p.customer_id IS NULL OR p.customer_id = ${customerId}
    ORDER BY p.is_bespoke ASC, p.category NULLS LAST, p.name
  `);
  res.json(rows.rows);
});

// ─── portal: product variants (no supplier data) ─────────────────────────────

router.get("/portal/products/:id/variants", portalAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid product id" }); return; }
  const rows = await db.execute(sql`
    SELECT id, colour, size, price, image_url
    FROM product_variants
    WHERE product_id = ${id}
    ORDER BY colour NULLS LAST, size
  `);
  res.json(rows.rows);
});

// ─── portal: wardrobe (customer finished items with employees) ───────────────

router.get("/portal/wardrobe", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalUserId = (req as any).portalUserId ?? null;
  const portalRole = (req as any).portalRole ?? "member";
  const isPreviewWardrobe = (req as any).portalIsPreview ?? false;

  // Resolve linked employee + their role BEFORE the items query so we can filter server-side.
  // Managers and dept_managers see all items (they order for any employee).
  // Members are locked to their own role — only their role's items are returned.
  let myEmployeeId: number | null = null;
  let memberRoleId: number | null = null;

  if (isPreviewWardrobe && (req as any).portalLinkedEmployeeId) {
    myEmployeeId = (req as any).portalLinkedEmployeeId;
  }
  if (portalUserId && !myEmployeeId) {
    const linkRows = await db.execute(sql`
      SELECT cpu.linked_employee_id, ce.role_id
      FROM customer_portal_users cpu
      LEFT JOIN customer_employees ce ON ce.id = cpu.linked_employee_id
      WHERE cpu.id = ${portalUserId}
      LIMIT 1
    `);
    myEmployeeId = (linkRows.rows[0] as any)?.linked_employee_id ?? null;
    memberRoleId = (linkRows.rows[0] as any)?.role_id ?? null;
  } else if (myEmployeeId) {
    // Preview path — look up the role from the employee record
    const roleRow = await db.execute(sql`
      SELECT role_id FROM customer_employees WHERE id = ${myEmployeeId} LIMIT 1
    `);
    memberRoleId = (roleRow.rows[0] as any)?.role_id ?? null;
  }

  // Members with a known role get server-side filtering — only their role's items (or
  // unassigned items) are returned. Managers / dept_managers receive everything so they
  // can do per-employee client-side filtering when ordering on behalf of someone.
  // Effective role = item-level role_id overrides finish-level role_id.
  // If member has a known role, only show items whose effective role matches or is unset.
  const memberRoleFilter = (portalRole === "member" && memberRoleId != null)
    ? sql`AND (COALESCE(cfi.role_id, cf.role_id) IS NULL OR COALESCE(cfi.role_id, cf.role_id) = ${memberRoleId})`
    : sql``;

  // Get wardrobe items — deduplicate by (finish, product, colour, role) so each
  // combination shows as one card in the portal; sizes are served via sizesMap.
  const finishes = await db.execute(sql`
    SELECT DISTINCT ON (COALESCE(cf.id, 0), COALESCE(cfi.product_id, 0), COALESCE(lower(cfi.colour), ''), COALESCE(cfi.role_id, cf.role_id, 0))
      cf.id   AS finish_id,
      cf.name AS finish_name,
      cf.code AS finish_code,
      cfi.id,
      cfi.name,
      cfi.product_id,
      p.name        AS product_name,
      p.sku         AS product_sku,
      p.image_url   AS product_image_url,
      p.unit_price    AS woo_price,
      p.regular_price AS woo_regular_price,
      p.on_sale       AS woo_on_sale,
      p.price_breaks,
      cfi.colour,
      cfi.unit_price,
      cfi.special_price,
      cfi.role_id,
      cf.role_id  AS finish_role_id,
      COALESCE(cfi.role_id, cf.role_id) AS effective_role_id,
      cr.name AS role_name,
      (SELECT pv.image_url
         FROM product_variants pv
        WHERE pv.product_id = cfi.product_id
          AND lower(pv.colour) = lower(cfi.colour)
          AND pv.image_url IS NOT NULL
        LIMIT 1
      ) AS variant_image_url
    FROM customer_finished_items cfi
    LEFT JOIN customer_finishes  cf  ON cf.id = cfi.finish_id
    LEFT JOIN products           p   ON p.id = cfi.product_id
    LEFT JOIN customer_roles     cr  ON cr.id = COALESCE(cfi.role_id, cf.role_id)
    WHERE cfi.customer_id = ${customerId}
    ${memberRoleFilter}
    ORDER BY COALESCE(cf.id, 0), COALESCE(cfi.product_id, 0), COALESCE(lower(cfi.colour), ''), COALESCE(cfi.role_id, cf.role_id, 0), cfi.id, cf.name NULLS LAST, cfi.name
  `);

  // Get decoration processes linked to each finish
  const processes = await db.execute(sql`
    SELECT
      cfp.finish_id,
      cp.id           AS process_id,
      cp.name         AS item_finish_name,
      cp.type         AS process_type,
      cp.placement,
      cp.price,
      cp.code,
      cp.image_url    AS process_image_url
    FROM customer_finish_processes cfp
    JOIN customer_processes     cp  ON cp.id = cfp.process_id
    JOIN customer_finishes      cf  ON cf.id = cfp.finish_id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cp.name
  `);

  // Get available sizes per product+colour from product_variants
  const variantRows = await db.execute(sql`
    SELECT DISTINCT pv.product_id, pv.colour, pv.size
    FROM product_variants pv
    WHERE pv.product_id IN (
      SELECT DISTINCT cfi.product_id
      FROM customer_finished_items cfi
      WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
    )
    AND pv.size IS NOT NULL AND pv.size != ''
    ORDER BY pv.product_id, pv.colour, pv.size
  `);
  // Build sizesMap: { [productId]: { [colour]: string[] } }
  const sizesMap: Record<string, Record<string, string[]>> = {};
  for (const row of variantRows.rows as any[]) {
    const pid = String(row.product_id);
    if (!sizesMap[pid]) sizesMap[pid] = {};
    const col = row.colour ?? "__any__";
    if (!sizesMap[pid][col]) sizesMap[pid][col] = [];
    sizesMap[pid][col].push(row.size);
  }

  // Always merge product_attributes (type='size') into sizesMap under the "__any__" key.
  // This covers colour-only variable products whose WooCommerce variations don't carry a
  // size attribute (sizes live only at the product level), AND guards against the sync
  // inadvertently writing a single dummy size (e.g. "2XL") into product_variants for
  // what is really a colour-only product — without this merge the fallback would never
  // fire and only that one size would be presented.  The frontend deduplicates with
  // Set so adding sizes that are already present from product_variants is harmless.
  try {
    const attrSizeRows = await db.execute(sql`
      SELECT DISTINCT pa.product_id, pa.value AS size
      FROM product_attributes pa
      WHERE pa.type = 'size'
        AND pa.value IS NOT NULL AND pa.value != ''
        AND pa.product_id IN (
          SELECT DISTINCT cfi.product_id
          FROM customer_finished_items cfi
          WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
        )
      ORDER BY pa.product_id, pa.value
    `);
    for (const row of attrSizeRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sizesMap[pid]) sizesMap[pid] = {};
      if (!sizesMap[pid]["__any__"]) sizesMap[pid]["__any__"] = [];
      sizesMap[pid]["__any__"].push(row.size);
    }
  } catch {
    // product_attributes may not have size data — not fatal, sizesMap remains from variants
  }

  // Sort sizes in sizesMap using the saved size_order setting (unknown sizes go at end alphabetically)
  try {
    const [sizeOrderRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "size_order"));
    if (sizeOrderRow?.value) {
      const sizeOrder: string[] = JSON.parse(sizeOrderRow.value);
      const sortFn = (a: string, b: string) => {
        const ai = sizeOrder.indexOf(a);
        const bi = sizeOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      };
      for (const pid of Object.keys(sizesMap)) {
        for (const col of Object.keys(sizesMap[pid])) {
          sizesMap[pid][col] = [...new Set(sizesMap[pid][col])].sort(sortFn);
        }
      }
    }
  } catch {
    // size ordering is best-effort
  }

  // Get employees for this customer
  const employees = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.job_title,
           e.manager_id,
           TRIM(CONCAT(m.first_name, ' ', COALESCE(m.last_name, ''))) AS manager_name,
           cr.id as role_id, cr.name as role_name
    FROM customer_employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
    LEFT JOIN customer_employees m ON m.id = e.manager_id
    WHERE e.customer_id = ${customerId} AND e.is_active = true
    ORDER BY e.last_name, e.first_name
  `);

  // Get last ordered size per employee+product from order history
  const lastSizesRows = await db.execute(sql`
    SELECT DISTINCT ON (oi.recipient_employee_id, COALESCE(oi.product_id::text, oi.product_name))
      oi.recipient_employee_id as employee_id,
      oi.product_id,
      oi.product_name,
      oi.colour,
      oi.size
    FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE o.customer_id = ${customerId}
      AND oi.recipient_employee_id IS NOT NULL
      AND o.status NOT IN ('cancelled', 'void')
      AND oi.size IS NOT NULL AND oi.size != ''
    ORDER BY oi.recipient_employee_id, COALESCE(oi.product_id::text, oi.product_name), o.created_at DESC
  `);

  // Build nested map: { [employeeId]: { [productId]: {size,colour}, [productName]: {size,colour} } }
  const lastSizes: Record<string, Record<string, { size: string; colour: string | null }>> = {};
  for (const row of lastSizesRows.rows as any[]) {
    const eid = String(row.employee_id);
    if (!lastSizes[eid]) lastSizes[eid] = {};
    if (row.product_id) lastSizes[eid][String(row.product_id)] = { size: row.size, colour: row.colour ?? null };
    if (row.product_name) lastSizes[eid][row.product_name] = { size: row.size, colour: row.colour ?? null };
  }

  // Get manually saved sizes per employee (profile sizes set by manager)
  const savedSizesRows = await db.execute(sql`
    SELECT s.employee_id, s.label, s.size
    FROM customer_employee_sizes s
    JOIN customer_employees e ON e.id = s.employee_id
    WHERE e.customer_id = ${customerId}
    ORDER BY s.employee_id, s.id
  `);
  const savedSizes: Record<string, Array<{ label: string; size: string }>> = {};
  for (const row of savedSizesRows.rows as any[]) {
    const eid = String(row.employee_id);
    if (!savedSizes[eid]) savedSizes[eid] = [];
    savedSizes[eid].push({ label: row.label, size: row.size });
  }

  // Build sleevesMap: { [productId]: string[] } from product_attributes type='sleeve'
  // Used by the portal to show a second "Fit / Length" selector for trousers etc.
  const sleevesMap: Record<string, string[]> = {};
  try {
    const sleeveAttrRows = await db.execute(sql`
      SELECT DISTINCT pa.product_id, pa.value AS sleeve
      FROM product_attributes pa
      WHERE pa.type = 'sleeve'
        AND pa.value IS NOT NULL AND pa.value != ''
        AND pa.product_id IN (
          SELECT DISTINCT cfi.product_id
          FROM customer_finished_items cfi
          WHERE cfi.customer_id = ${customerId} AND cfi.product_id IS NOT NULL
        )
      ORDER BY pa.product_id, pa.value
    `);
    for (const row of sleeveAttrRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sleevesMap[pid]) sleevesMap[pid] = [];
      sleevesMap[pid].push(row.sleeve as string);
    }
    // Sort: numeric values ascending, then non-numeric alphabetically at end
    for (const pid of Object.keys(sleevesMap)) {
      sleevesMap[pid] = [...new Set(sleevesMap[pid])].sort((a, b) => {
        const an = parseInt(a, 10), bn = parseInt(b, 10);
        if (!isNaN(an) && !isNaN(bn)) return an - bn;
        if (!isNaN(an)) return -1;
        if (!isNaN(bn)) return 1;
        return a.localeCompare(b);
      });
    }
  } catch {
    // sleeve data is best-effort
  }

  // Fetch customer's default shipping option
  const custSettingsRow = await db.execute(sql`SELECT default_shipping_option FROM customers WHERE id = ${customerId} LIMIT 1`);
  const defaultShippingOption = (custSettingsRow.rows[0] as any)?.default_shipping_option ?? null;

  res.json({
    items: finishes.rows,
    processes: processes.rows,
    employees: employees.rows,
    lastSizes,
    savedSizes,
    sizesMap,
    sleevesMap,
    myEmployeeId,
    defaultShippingOption,
  });
});

// ─── portal: manager — list orders awaiting review ───────────────────────────

router.get("/portal/manager/pending-orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  const portalUserId = (req as any).portalUserId;
  const portalIsPreview = (req as any).portalIsPreview;
  const linkedEmployeeId = (req as any).portalLinkedEmployeeId;

  if (portalRole !== "manager") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }

  // Top-level managers see ALL pending_review orders across every team.
  // Dept managers (team managers) only see orders from their own team,
  // resolved via their linked employee record.
  const submittedByNameExpr = sql`COALESCE(
               portal_submitted_by_name,
               CASE WHEN portal_submitted_by_employee_id IS NOT NULL THEN (
                 SELECT TRIM(first_name || ' ' || COALESCE(last_name, ''))
                 FROM customer_employees WHERE id = portal_submitted_by_employee_id
               ) END,
               SPLIT_PART(portal_submitted_by_email, '@', 1)
             )`;

  if (portalRole === "manager") {
    const rows = await db.execute(sql`
      SELECT id, order_number, status, portal_status, total_amount, order_date, required_date, notes, portal_notes,
             po_number, portal_submitted_by_email, portal_submitted_at,
             ${submittedByNameExpr} AS portal_submitted_by_name,
             (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = orders.id) as item_count
      FROM orders
      WHERE customer_id = ${customerId} AND source = 'portal' AND portal_status = 'pending_review'
      ORDER BY created_at DESC
    `);
    res.json(rows.rows);
    return;
  }

  // dept_manager: show all pending_review orders for the customer.
  // The manager_id team relationship is informational; we don't restrict by it
  // so orders are never silently hidden when team links haven't been configured.
  const rows = await db.execute(sql`
    SELECT id, order_number, status, portal_status, total_amount, order_date, required_date, notes, portal_notes,
           po_number, portal_submitted_by_email, portal_submitted_at,
           ${submittedByNameExpr} AS portal_submitted_by_name,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = orders.id) as item_count
    FROM orders
    WHERE customer_id = ${customerId} AND source = 'portal' AND portal_status = 'pending_review'
    ORDER BY created_at DESC
  `);
  res.json(rows.rows);
});

// ─── portal: manager — submit a pending order to SBS ─────────────────────────

router.post("/portal/manager/orders/:id/submit", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  const orderId = parseInt(req.params.id, 10);
  const managerUserId = (req as any).portalUserId;

  const parsed = z.object({
    poNumber: z.string().max(100).optional().nullable(),
  }).safeParse(req.body);
  const poNumber: string | null = parsed.success ? (parsed.data.poNumber ?? null) : null;

  // Resolve manager email and name
  const mgrUserRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${managerUserId} LIMIT 1`);
  const mgrEmail: string | null = (mgrUserRows.rows[0] as any)?.email ?? null;
  let mgrName: string | null = null;
  if (mgrEmail) {
    const empRows = await db.execute(sql`
      SELECT first_name, last_name FROM customer_employees
      WHERE customer_id = ${customerId} AND lower(email) = lower(${mgrEmail}) LIMIT 1
    `);
    if (empRows.rows.length > 0) {
      const e = empRows.rows[0] as any;
      mgrName = [e.first_name, e.last_name].filter(Boolean).join(" ") || mgrEmail;
    } else {
      const prefix = mgrEmail.split("@")[0].replace(/[._]/g, " ");
      mgrName = prefix.replace(/\b\w/g, (c: string) => c.toUpperCase());
    }
  }

  const approveResult = await db.execute(sql`
    UPDATE orders SET portal_status = 'submitted', status = 'portal_pending', updated_at = now(),
      portal_approved_by_email = ${mgrEmail},
      portal_approved_by_name = ${mgrName},
      portal_approved_at = now(),
      po_number = COALESCE(${poNumber}, po_number)
    WHERE id = ${orderId} AND customer_id = ${customerId} AND source = 'portal' AND portal_status = 'pending_review'
    RETURNING order_number, portal_submitted_by_email, portal_submitted_by_name
  `);
  const approvedOrder = approveResult.rows[0] as any;
  // Notify the person who originally submitted the order
  if (approvedOrder?.portal_submitted_by_email) {
    notifyPortalUserByEmail({
      customerId,
      email: approvedOrder.portal_submitted_by_email,
      title: `Order ${approvedOrder.order_number} has been approved`,
      body: `Your order has been approved by ${mgrName} and submitted to Select Branding Solutions.`,
      link: "/orders",
      type: "approved",
    }).catch(() => {});
  }
  res.json({ ok: true });
});

// ─── portal: manager — reject a pending order ─────────────────────────────────

router.post("/portal/manager/orders/:id/reject", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  const orderId = parseInt(req.params.id, 10);
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  await db.execute(sql`
    UPDATE orders SET portal_status = 'rejected', status = 'portal_draft',
      portal_notes = COALESCE(portal_notes || E'\n', '') || ${'Rejected by manager: ' + (reason ?? 'No reason given')},
      updated_at = now()
    WHERE id = ${orderId} AND customer_id = ${customerId} AND source = 'portal'
  `);
  res.json({ ok: true });
});

// ─── admin: merge orders with the same customer + PO# ────────────────────────

router.post("/portal/admin/orders/merge", async (req: Request, res: Response) => {
  const body = z.object({ orderIds: z.array(z.number().int().positive()).min(2) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { orderIds } = body.data;

  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId,
      status: ordersTable.status,
      source: ordersTable.source,
      totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
    })
    .from(ordersTable)
    .where(inArray(ordersTable.id, orderIds))
    .orderBy(asc(ordersTable.id));

  if (orders.length !== orderIds.length) {
    res.status(404).json({ error: "One or more orders not found" }); return;
  }

  // Safety: must all be portal_pending or confirmed — not shipped/cancelled/etc.
  const invalidStatus = orders.filter(o => !["portal_pending", "confirmed"].includes(o.status));
  if (invalidStatus.length > 0) {
    res.status(400).json({ error: `Orders ${invalidStatus.map(o => o.orderNumber).join(", ")} cannot be merged (must be portal_pending or confirmed, not shipped or invoiced)` }); return;
  }

  // Safety: none already despatched
  const dispatched = orders.filter(o => o.dispatchedAt);
  if (dispatched.length > 0) {
    res.status(400).json({ error: `Cannot merge: ${dispatched.map(o => o.orderNumber).join(", ")} already dispatched` }); return;
  }

  // Safety: none already invoiced in Xero
  const invoiced = orders.filter(o => o.xeroInvoiceId || o.invoiceEmailSentAt);
  if (invoiced.length > 0) {
    res.status(400).json({ error: `Cannot merge: ${invoiced.map(o => o.orderNumber).join(", ")} already invoiced` }); return;
  }

  // Safety: same customer
  const customerIds = [...new Set(orders.map(o => o.customerId))];
  if (customerIds.length > 1) {
    res.status(400).json({ error: "Cannot merge orders from different customers" }); return;
  }

  // Safety: same non-blank PO number
  const poNumbers = [...new Set(orders.map(o => (o.poNumber ?? "").trim()))];
  if (poNumbers.length > 1) {
    res.status(400).json({ error: "Cannot merge orders with different PO numbers" }); return;
  }
  if (!poNumbers[0]) {
    res.status(400).json({ error: "Cannot merge orders with a blank PO number" }); return;
  }

  // Primary = lowest id (earliest order); the rest are absorbed into it
  const [primary, ...secondary] = orders;
  const secondaryIds = secondary.map(o => o.id);
  const secondaryNumbers = secondary.map(o => o.orderNumber);

  // Collect any previously absorbed numbers from secondary orders (handles re-merges)
  const existingAbsorbed = await db.execute(sql`
    SELECT absorbed_order_numbers FROM orders WHERE id = ANY(${sql`ARRAY[${sql.join(secondaryIds.map(id => sql`${id}`), sql`, `)}]::int[]`})
  `);
  const previouslyAbsorbed: string[] = existingAbsorbed.rows
    .flatMap((r: any) => r.absorbed_order_numbers ?? []);

  // Combined set of all absorbed order numbers for the primary
  const allAbsorbed = [...new Set([
    ...((await db.execute(sql`SELECT absorbed_order_numbers FROM orders WHERE id = ${primary.id}`)).rows[0] as any)?.absorbed_order_numbers ?? [],
    ...secondaryNumbers,
    ...previouslyAbsorbed,
  ])];

  // Move all items from secondary orders to primary
  await db.update(orderItemsTable)
    .set({ orderId: primary.id })
    .where(inArray(orderItemsTable.orderId, secondaryIds));

  // Move worksheets from secondary orders to primary
  await db.update(worksheetsTable)
    .set({ orderId: primary.id, orderNumber: primary.orderNumber })
    .where(inArray(worksheetsTable.orderId, secondaryIds));

  // Move purchase order line references to primary (prevents order_id going NULL on delete)
  await db.update(purchaseOrderItemsTable)
    .set({ orderId: primary.id, orderNumber: primary.orderNumber })
    .where(inArray(purchaseOrderItemsTable.orderId, secondaryIds));

  // Move logs from secondary orders to primary
  await db.update(orderLogsTable)
    .set({ orderId: primary.id })
    .where(inArray(orderLogsTable.orderId, secondaryIds));
  await db.update(orderEmailLogsTable)
    .set({ orderId: primary.id })
    .where(inArray(orderEmailLogsTable.orderId, secondaryIds));

  // Move messages from secondary orders to primary (previously these were cascade-deleted!)
  await db.update(orderMessagesTable)
    .set({ orderId: primary.id, orderNumber: primary.orderNumber })
    .where(inArray(orderMessagesTable.orderId, secondaryIds));

  // Recalculate primary order total and store absorbed order numbers
  await db.execute(sql`
    UPDATE orders
    SET total_amount = (
      SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = ${primary.id}
    ),
    absorbed_order_numbers = ${sql`ARRAY[${sql.join(allAbsorbed.map(n => sql`${n}`), sql`, `)}]::text[]`},
    updated_at = now()
    WHERE id = ${primary.id}
  `);

  // Delete secondary orders (cascade deletes any remaining fk-linked rows)
  await db.delete(ordersTable).where(inArray(ordersTable.id, secondaryIds));

  // Log the merge on the primary
  await db.insert(orderLogsTable).values({
    orderId: primary.id,
    action: "Orders merged",
    actor: "System",
    details: `Absorbed ${secondaryNumbers.join(", ")} into ${primary.orderNumber}. Combined order now contains all items.`,
  });

  const updatedRows = await db.execute(sql`SELECT * FROM orders WHERE id = ${primary.id}`);
  res.json({ ok: true, primary: updatedRows.rows[0] });
});

// ─── admin: list portal-pending orders ───────────────────────────────────────

router.get("/portal/admin/pending-orders", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT o.id, o.order_number, o.customer_id, o.customer_name, o.status, o.portal_status,
           o.portal_notes, o.total_amount, o.order_date, o.required_date, o.notes, o.po_number,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id) as item_count
    FROM orders o
    WHERE o.status = 'portal_pending'
    ORDER BY o.created_at DESC
  `);
  res.json(rows.rows);
});

// ─── admin: confirm portal order ─────────────────────────────────────────────

router.post("/portal/admin/orders/:id/confirm", async (req: Request, res: Response) => {
  const orderId = parseInt(req.params.id, 10);

  // Load order to get submitter/approver emails and check delivery address
  const orderRows = await db.execute(sql`
    SELECT id, order_number, customer_id, customer_name, order_date, required_date, notes, total_amount, carriage_amount,
           delivery_address_id, attention_of,
           portal_submitted_by_email, portal_submitted_by_name, portal_submitted_by_employee_id,
           portal_approved_by_email, portal_approved_by_name, add_to_stores
    FROM orders WHERE id = ${orderId} AND source = 'portal'
  `);
  const ord = orderRows.rows[0] as any;
  if (!ord) { res.status(404).json({ error: "Order not found" }); return; }

  // If no delivery address set, auto-assign the customer's default (or create from main address)
  let deliveryAddressId = ord.delivery_address_id;
  if (!deliveryAddressId && ord.customer_id) {
    const addrRows = await db.execute(sql`
      SELECT id FROM customer_delivery_addresses
      WHERE customer_id = ${ord.customer_id} AND is_default = true LIMIT 1
    `);
    if (addrRows.rows.length > 0) {
      deliveryAddressId = (addrRows.rows[0] as any).id;
    } else {
      // Fall back to customer's main address — auto-create a delivery address record
      const custAddrRows = await db.execute(sql`SELECT address, city, postcode FROM customers WHERE id = ${ord.customer_id} LIMIT 1`);
      const ca = custAddrRows.rows[0] as any;
      if (ca?.address) {
        const newAddrRows = await db.execute(sql`
          INSERT INTO customer_delivery_addresses (customer_id, label, line1, city, postcode, is_default, created_at, updated_at)
          VALUES (${ord.customer_id}, 'Main Address', ${ca.address}, ${ca.city ?? null}, ${ca.postcode ?? null}, true, now(), now())
          RETURNING id
        `);
        deliveryAddressId = (newAddrRows.rows[0] as any)?.id ?? null;
      }
    }
  }

  // Resolve attention_of: submitter's team manager → approver → submitter's own name
  let attentionOf: string | null = ord.attention_of || null;
  if (!attentionOf && ord.portal_submitted_by_employee_id) {
    const mgrRows = await db.execute(sql`
      SELECT m.first_name, m.last_name
      FROM customer_employees e
      LEFT JOIN customer_employees m ON m.id = e.manager_id
      WHERE e.id = ${ord.portal_submitted_by_employee_id} AND m.id IS NOT NULL
      LIMIT 1
    `);
    const mgr = mgrRows.rows[0] as any;
    if (mgr?.first_name) {
      attentionOf = [mgr.first_name, mgr.last_name].filter(Boolean).join(" ");
    }
  }
  if (!attentionOf) attentionOf = ord.portal_approved_by_name || ord.portal_submitted_by_name || null;

  await db.execute(sql`
    UPDATE orders SET portal_status = 'confirmed', status = 'confirmed', updated_at = now(),
      delivery_address_id = COALESCE(${deliveryAddressId}, delivery_address_id),
      attention_of = COALESCE(attention_of, ${attentionOf})
    WHERE id = ${orderId} AND source = 'portal'
  `);

  // ── Stock allocation on portal confirmation ───────────────────────────────
  {
    const allItems = await db
      .select({
        id: orderItemsTable.id,
        productId: orderItemsTable.productId,
        productName: orderItemsTable.productName,
        colour: orderItemsTable.colour,
        size: orderItemsTable.size,
        quantity: orderItemsTable.quantity,
        finishId: orderItemsTable.finishId,
        finishName: orderItemsTable.finishName,
        recipientType: orderItemsTable.recipientType,
        recipientName: orderItemsTable.recipientName,
      })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, orderId));

    const productIds = [...new Set(allItems.map(i => i.productId).filter(Boolean))] as number[];
    const allocatedItemIds: number[] = [];

    // Items with no product link go straight to production
    for (const item of allItems) {
      if (!item.productId) allocatedItemIds.push(item.id);
    }

    if (productIds.length > 0) {
      // Fetch supplier info keyed by product id
      const productInfoRows = await db
        .select({
          id: productsTable.id,
          supplierId: productsTable.supplierId,
          supplierName: suppliersTable.name,
        })
        .from(productsTable)
        .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
        .where(inArray(productsTable.id, productIds));
      const supplierMap = new Map(productInfoRows.map(p => [p.id, p]));

      // Fetch variant-level stock for all relevant products.
      // For plain products (no variants), fall back to product.stock_quantity.
      // Note: productIds are integer PKs from the DB — safe to inline.
      const pidArrayLiteral = sql.raw(`ARRAY[${productIds.join(",")}]::int[]`);
      const variantStockRows = await db.execute(sql`
        SELECT pv.product_id, pv.colour, pv.size, pv.stock_quantity
        FROM product_variants pv
        WHERE pv.product_id = ANY(${pidArrayLiteral})
      `);
      const plainStockRows = await db.execute(sql`
        SELECT p.id AS product_id, NULL::text AS colour, NULL::text AS size, p.stock_quantity
        FROM products p
        WHERE p.id = ANY(${pidArrayLiteral})
          AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
      `);

      // Build mutable stock pool keyed by "productId|colour|size"
      const vKey = (pid: number, c: string | null, s: string | null) => `${pid}|${c ?? ""}|${s ?? ""}`;
      const remainingStock = new Map<string, number>();
      for (const r of [...variantStockRows.rows, ...plainStockRows.rows] as Array<{ product_id: number; colour: string | null; size: string | null; stock_quantity: number | null }>) {
        const k = vKey(r.product_id, r.colour, r.size);
        remainingStock.set(k, Number(r.stock_quantity) || 0);
      }

      for (const item of allItems) {
        if (!item.productId) continue;
        const sup = supplierMap.get(item.productId);

        // Look up stock for this exact colour+size variant first; fall back to plain product key
        const k = vKey(item.productId, item.colour ?? null, item.size ?? null);
        const plainK = vKey(item.productId, null, null);
        const available = remainingStock.has(k) ? (remainingStock.get(k) ?? 0)
                        : (remainingStock.get(plainK) ?? 0);
        const activeKey = remainingStock.has(k) ? k : plainK;

        const qty = item.quantity ?? 0;
        const allocatedQty = Math.min(available, qty);
        const shortfall = qty - allocatedQty;
        remainingStock.set(activeKey, available - allocatedQty);

        await db.update(orderItemsTable).set({
          purchaseRequired: shortfall > 0,
          purchaseQuantity: shortfall > 0 ? shortfall : null,
          supplierId: shortfall > 0 ? (sup?.supplierId ?? null) : null,
          supplierName: shortfall > 0 ? (sup?.supplierName ?? null) : null,
        }).where(eq(orderItemsTable.id, item.id));

        if (shortfall === 0) allocatedItemIds.push(item.id);
      }

      // Persist deductions: update variant stock (+ rollup) or plain product stock
      for (const [key, remaining] of remainingStock.entries()) {
        const [pidStr, colour, size] = key.split("|");
        const productId = parseInt(pidStr, 10);
        const colourVal = colour || null;
        const sizeVal = size || null;

        if (colourVal !== null || sizeVal !== null) {
          // Variant row — update directly then roll up to product
          await db.execute(sql`
            UPDATE product_variants
            SET stock_quantity = ${remaining}
            WHERE product_id = ${productId}
              AND (colour IS NOT DISTINCT FROM ${colourVal})
              AND (size   IS NOT DISTINCT FROM ${sizeVal})
          `);
          await db.execute(sql`
            UPDATE products
            SET stock_quantity = (
              SELECT COALESCE(SUM(stock_quantity), 0)
              FROM product_variants WHERE product_id = ${productId}
            )
            WHERE id = ${productId}
          `);
        } else {
          // Plain product
          await db.execute(sql`
            UPDATE products SET stock_quantity = ${remaining} WHERE id = ${productId}
          `);
        }
      }
    }

    // Auto-create production worksheet for items ready to go
    if (allocatedItemIds.length > 0) {
      const existingWs = await db
        .select({ id: worksheetsTable.id })
        .from(worksheetsTable)
        .where(eq(worksheetsTable.orderId, orderId))
        .limit(1);

      if (existingWs.length === 0) {
        const wsRows = await db.execute(sql`
          SELECT worksheet_number FROM worksheets
          WHERE worksheet_number ~ '^F[0-9]+$'
          ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC
          LIMIT 1
        `);
        const lastWsNum = (wsRows.rows[0] as any)?.worksheet_number as string | undefined;
        const worksheetNumber = `F${(lastWsNum ? parseInt(lastWsNum.slice(1), 10) : 99) + 1}`;

        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber,
            status: "pre_wip",
            orderId,
            orderNumber: ord.order_number,
            customerId: ord.customer_id ?? null,
            customerName: ord.customer_name ?? null,
          })
          .returning();

        const wsOrderItems = await db
          .select()
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.id, allocatedItemIds));

        await Promise.all(
          wsOrderItems.map(async (oi) => {
            let processesSnapshot: string | null = null;
            if (oi.finishId && ord.customer_id) {
              const finishProcessLinks = await db
                .select()
                .from(customerFinishProcessesTable)
                .where(eq(customerFinishProcessesTable.finishId, oi.finishId));
              const processIds = finishProcessLinks.map((fp) => fp.processId);
              if (processIds.length > 0) {
                const processes = await db
                  .select()
                  .from(customerProcessesTable)
                  .where(inArray(customerProcessesTable.id, processIds));
                processesSnapshot = JSON.stringify(
                  processes.map((p) => ({ id: p.id, name: p.name, type: p.type, placement: p.placement, price: p.price ? parseFloat(p.price as any) : null, notes: p.notes }))
                );
              }
            }
            return db.insert(worksheetItemsTable).values({
              worksheetId: ws.id,
              orderItemId: oi.id,
              productName: oi.productName,
              colour: oi.colour ?? null,
              size: oi.size ?? null,
              quantity: oi.quantity ?? 1,
              recipientType: oi.recipientType ?? "stock",
              recipientName: oi.recipientName ?? null,
              finishId: oi.finishId ?? null,
              finishName: oi.finishName ?? null,
              processesSnapshot,
            });
          })
        );
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // Send order acknowledgement emails
  if (isEmailConfigured) {
    // Fetch items for the email
    const itemRows = await db.execute(sql`
      SELECT oi.product_name, p.name as catalogue_name, oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.recipient_name
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id = ${orderId}
    `);
    const items = (itemRows.rows as any[]).map(r => ({
      productName: r.catalogue_name ?? r.product_name,
      colour: r.colour ?? null,
      size: r.size ?? null,
      quantity: Number(r.quantity ?? 1),
      unitPrice: parseFloat(r.unit_price ?? "0"),
      lineTotal: parseFloat(r.line_total ?? "0"),
      recipientName: r.recipient_name ?? null,
    }));

    // Fetch customer address + zero-VAT flag for PDF
    let customerAddress: string | null = null;
    let customerCity: string | null = null;
    let customerPostcode: string | null = null;
    let portalAckZeroVat = false;
    if (ord.customer_id) {
      const custRows = await db.execute(sql`SELECT address, city, postcode, zero_vat FROM customers WHERE id = ${ord.customer_id} LIMIT 1`);
      const c = custRows.rows[0] as any;
      customerAddress = c?.address ?? null;
      customerCity = c?.city ?? null;
      customerPostcode = c?.postcode ?? null;
      portalAckZeroVat = c?.zero_vat === true || c?.zero_vat === "true";
    }

    // Fetch delivery address text
    let deliveryAddressText: string | null = null;
    if (deliveryAddressId) {
      const daRows = await db.execute(sql`SELECT line1, line2, city, postcode FROM customer_delivery_addresses WHERE id = ${deliveryAddressId} LIMIT 1`);
      const da = daRows.rows[0] as any;
      if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
    }

    const pdfItems = itemRows.rows ? (itemRows.rows as any[]).map(r => ({
      productName: r.catalogue_name ?? r.product_name,
      sku: null,
      colour: r.colour ?? null,
      size: r.size ?? null,
      quantity: Number(r.quantity ?? 1),
      unitPrice: parseFloat(r.unit_price ?? "0"),
      lineTotal: parseFloat(r.line_total ?? "0"),
    })) : items.map(i => ({ ...i, sku: null }));

    // Generate acknowledgement PDF (non-fatal if fails)
    let ackPdfBuffer: Buffer | null = null;
    try {
      ackPdfBuffer = await generateOrderAcknowledgementPdf({
        orderNumber: ord.order_number,
        orderDate: ord.order_date ? new Date(ord.order_date) : null,
        requiredDate: ord.required_date ? new Date(ord.required_date) : null,
        customerName: ord.customer_name ?? null,
        customerAddress,
        customerCity,
        customerPostcode,
        deliveryAddress: deliveryAddressText,
        totalAmount: parseFloat(ord.total_amount ?? "0"),
        shippingAmount: parseFloat(ord.carriage_amount ?? "0") || undefined,
        zeroVat: portalAckZeroVat,
        items: pdfItems,
      });
    } catch (_e) {}

    const emailData = {
      orderNumber: ord.order_number,
      customerName: ord.customer_name ?? null,
      orderDate: ord.order_date ? new Date(ord.order_date) : null,
      requiredDate: ord.required_date ? new Date(ord.required_date) : null,
      notes: ord.notes ?? null,
      totalAmount: parseFloat(ord.total_amount ?? "0"),
      items,
    };

    const recipients: Array<{ email: string; name: string | null }> = [];
    if (ord.portal_submitted_by_email) {
      recipients.push({ email: ord.portal_submitted_by_email, name: ord.portal_submitted_by_name ?? null });
    }
    if (ord.portal_approved_by_email && ord.portal_approved_by_email !== ord.portal_submitted_by_email) {
      recipients.push({ email: ord.portal_approved_by_email, name: ord.portal_approved_by_name ?? null });
    }

    const pdfAttachments = ackPdfBuffer
      ? [{ filename: `Order-Acknowledgement-${ord.order_number}.pdf`, content: ackPdfBuffer, contentType: "application/pdf" }]
      : [];

    for (const recipient of recipients) {
      const { subject, html, text } = buildAcknowledgementEmail({
        ...emailData,
        contactFirstName: recipient.name,
      });
      await sendEmail({ to: recipient.email, subject, html, text, attachments: pdfAttachments }).catch(() => {});
    }
  }

  res.json({ ok: true });
});

// ─── admin: reject portal order ──────────────────────────────────────────────

router.post("/portal/admin/orders/:id/reject", async (req: Request, res: Response) => {
  const orderId = parseInt(req.params.id, 10);
  const { reason } = z.object({ reason: z.string().optional() }).parse(req.body);
  await db.execute(sql`
    UPDATE orders SET portal_status = 'rejected', status = 'cancelled',
      notes = COALESCE(notes || E'\n', '') || ${'Rejected: ' + (reason ?? 'No reason given')},
      updated_at = now()
    WHERE id = ${orderId} AND source = 'portal'
  `);
  res.json({ ok: true });
});

// ─── admin: unconfirm portal order (revert to portal_pending) ────────────────

router.post("/portal/admin/orders/:id/unconfirm", async (req: Request, res: Response) => {
  const orderId = parseInt(req.params.id, 10);

  const orderRows = await db.execute(sql`
    SELECT id, status FROM orders WHERE id = ${orderId} AND source = 'portal'
  `);
  const ord = orderRows.rows[0] as any;
  if (!ord) { res.status(404).json({ error: "Order not found" }); return; }
  if (ord.status !== "confirmed") { res.status(400).json({ error: "Order is not in confirmed status" }); return; }

  // ── Restore stock allocations ─────────────────────────────────────────────
  const itemRows = await db.execute(sql`
    SELECT id, product_id, quantity, purchase_required, purchase_quantity
    FROM order_items WHERE order_id = ${orderId} AND product_id IS NOT NULL
  `);
  const items = itemRows.rows as any[];

  // Calculate how much stock was decremented per product during confirmation
  const stockRestore = new Map<number, number>();
  for (const item of items) {
    if (!item.product_id) continue;
    const qty = Number(item.quantity ?? 0);
    const purchaseQty = Number(item.purchase_quantity ?? 0);
    // Stock decremented = quantity - purchase_quantity (items fulfilled from stock)
    const allocated = item.purchase_required ? qty - purchaseQty : qty;
    if (allocated > 0) {
      stockRestore.set(item.product_id, (stockRestore.get(item.product_id) ?? 0) + allocated);
    }
  }

  for (const [productId, restoreQty] of stockRestore.entries()) {
    await db.execute(sql`
      UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${restoreQty}
      WHERE id = ${productId}
    `);
  }

  // ── Reset purchase requirement flags on all items ─────────────────────────
  await db.execute(sql`
    UPDATE order_items
    SET purchase_required = NULL, purchase_quantity = NULL,
        supplier_id = NULL, supplier_name = NULL
    WHERE order_id = ${orderId}
  `);

  // ── Delete auto-created worksheet if not yet started ─────────────────────
  await db.execute(sql`
    DELETE FROM worksheet_items
    WHERE worksheet_id IN (
      SELECT id FROM worksheets WHERE order_id = ${orderId} AND status = 'pre_wip'
    )
  `);
  await db.execute(sql`
    DELETE FROM worksheets WHERE order_id = ${orderId} AND status = 'pre_wip'
  `);

  // ── Revert order status to portal_pending ─────────────────────────────────
  await db.execute(sql`
    UPDATE orders SET status = 'portal_pending', portal_status = 'pending',
      updated_at = now()
    WHERE id = ${orderId}
  `);

  res.json({ ok: true });
});

// ─── portal: list invoices ────────────────────────────────────────────────────

router.get("/portal/invoices", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const rows = await db.execute(sql`
    SELECT id, order_number, invoice_email_sent_at, total_amount,
           xero_invoice_id, xero_invoice_status, tracking_number, order_date,
           invoice_date, po_number, customer_name, status
    FROM orders
    WHERE customer_id = ${customerId}
      AND invoice_email_sent_at IS NOT NULL
    ORDER BY COALESCE(invoice_date, invoice_email_sent_at) DESC
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ─── portal: download invoice PDF ────────────────────────────────────────────

router.get("/portal/invoices/:orderId/pdf", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const orderId = parseInt(req.params.orderId, 10);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const orderRows = await db.execute(sql`
    SELECT o.*, c.email as customer_email_addr, c.name as customer_name_resolved
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId} AND o.customer_id = ${customerId}
  `);
  const order = orderRows.rows[0] as any;
  if (!order) { res.status(404).json({ error: "Invoice not found" }); return; }

  const itemRows = await db.execute(sql`
    SELECT product_name, colour, size, finish_name, quantity, unit_price, line_total
    FROM order_items WHERE order_id = ${orderId} ORDER BY id
  `);

  const pdfBuffer = await generateInvoicePDF({
    orderNumber: order.order_number ?? `ORD-${orderId}`,
    customerName: order.customer_name ?? order.customer_name_resolved ?? "Customer",
    customerEmail: order.customer_email_addr,
    trackingNumber: order.tracking_number,
    items: (itemRows.rows as any[]).map((i) => ({
      productName: i.product_name,
      colour: i.colour,
      size: i.size,
      finishName: i.finish_name,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      lineTotal: i.line_total,
    })),
    totalAmount: order.total_amount,
    notes: order.notes,
  });

  const filename = `Invoice-${order.order_number ?? orderId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", pdfBuffer.length);
  res.send(pdfBuffer);
});

// ─── portal: delivery addresses (read-only list) ─────────────────────────────

router.get("/portal/addresses", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const rows = await db.execute(sql`
    SELECT id, label, line1, line2, city, postcode, country, is_default
    FROM customer_delivery_addresses
    WHERE customer_id = ${customerId}
    ORDER BY is_default DESC, label
  `);
  res.json(rows.rows);
});

// ─── portal: my-team — employees (dept_manager: their direct reports) ─────────

async function getDeptManagerLinkedEmployeeId(req: Request): Promise<number | null> {
  const portalUserId = (req as any).portalUserId;
  const portalIsPreview = (req as any).portalIsPreview;
  const linkedEmployeeId = (req as any).portalLinkedEmployeeId;
  if (portalIsPreview) return linkedEmployeeId ?? null;
  if (!portalUserId) return null;
  const rows = await db.execute(sql`SELECT linked_employee_id FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
  return (rows.rows[0] as any)?.linked_employee_id ?? null;
}

router.get("/portal/my-team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "dept_manager") { res.status(403).json({ error: "Team Manager access required" }); return; }

  const myEmpId = await getDeptManagerLinkedEmployeeId(req);
  if (!myEmpId) { res.json([]); return; }

  const showInactive = req.query.showInactive === "true";

  const rows = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.employee_number, e.email, e.phone, e.job_title,
           e.department, e.notes, e.is_active, e.allowance,
           COALESCE(e.allowance_topup, 0) AS allowance_topup,
           cr.id as role_id, cr.name as role_name,
           cr.annual_allowance as role_allowance,
           COALESCE(e.allowance, cr.annual_allowance) AS effective_allowance,
           e.manager_id,
           e.delivery_address_id,
           da.label as delivery_address_label,
           da.line1 as delivery_address_line1,
           da.city  as delivery_address_city,
           COALESCE(spend.total, 0) AS spend_12m
    FROM customer_employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
    LEFT JOIN customer_delivery_addresses da ON da.id = e.delivery_address_id
    LEFT JOIN (
      SELECT oi.recipient_employee_id, SUM(oi.line_total)::numeric AS total
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status NOT IN ('portal_draft', 'cancelled')
        AND o.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY oi.recipient_employee_id
    ) spend ON spend.recipient_employee_id = e.id
    WHERE e.customer_id = ${customerId}
      AND e.manager_id = ${myEmpId}
      ${showInactive ? sql`` : sql`AND e.is_active = true`}
    ORDER BY e.last_name, e.first_name
  `);
  res.json(rows.rows);
});

router.post("/portal/my-team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "dept_manager") { res.status(403).json({ error: "Team Manager access required" }); return; }

  const myEmpId = await getDeptManagerLinkedEmployeeId(req);
  if (!myEmpId) { res.status(400).json({ error: "No linked employee found for your account" }); return; }

  const body = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    employeeNumber: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  const rows = await db.execute(sql`
    INSERT INTO customer_employees
      (customer_id, first_name, last_name, employee_number, email, phone, job_title, department, notes, manager_id, is_active)
    VALUES
      (${customerId}, ${d.firstName}, ${d.lastName}, ${d.employeeNumber ?? null}, ${d.email ?? null},
       ${d.phone ?? null}, ${d.jobTitle ?? null}, ${d.department ?? null}, ${d.notes ?? null}, ${myEmpId}, true)
    RETURNING *
  `);
  res.status(201).json(rows.rows[0]);
});

// ─── portal: team manager adopts an employee from another team ────────────────

router.post("/portal/my-team/employees/:id/adopt", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "dept_manager") { res.status(403).json({ error: "Team Manager access required" }); return; }

  const myEmpId = await getDeptManagerLinkedEmployeeId(req);
  if (!myEmpId) { res.status(400).json({ error: "No linked employee found for your account" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const rows = await db.execute(sql`
    UPDATE customer_employees
    SET manager_id = ${myEmpId}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
    RETURNING id, first_name, last_name, manager_id
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json({ ok: true, employee: rows.rows[0] });
});

router.patch("/portal/my-team/employees/:id", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "dept_manager") { res.status(403).json({ error: "Team Manager access required" }); return; }

  const myEmpId = await getDeptManagerLinkedEmployeeId(req);
  if (!myEmpId) { res.status(400).json({ error: "No linked employee found" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  // Verify this employee is actually in their team
  const check = await db.execute(sql`
    SELECT id FROM customer_employees WHERE id = ${id} AND customer_id = ${customerId} AND manager_id = ${myEmpId}
  `);
  if (check.rows.length === 0) { res.status(403).json({ error: "Employee not in your team" }); return; }

  const body = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    employeeNumber: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  await db.execute(sql`
    UPDATE customer_employees SET
      first_name = COALESCE(${d.firstName ?? null}, first_name),
      last_name = COALESCE(${d.lastName ?? null}, last_name),
      employee_number = COALESCE(${d.employeeNumber !== undefined ? d.employeeNumber : null}, employee_number),
      email = COALESCE(${d.email !== undefined ? d.email : null}, email),
      phone = COALESCE(${d.phone !== undefined ? d.phone : null}, phone),
      job_title = COALESCE(${d.jobTitle !== undefined ? d.jobTitle : null}, job_title),
      department = COALESCE(${d.department !== undefined ? d.department : null}, department),
      notes = COALESCE(${d.notes !== undefined ? d.notes : null}, notes),
      is_active = COALESCE(${d.isActive !== undefined ? d.isActive : null}, is_active),
      updated_at = now()
    WHERE id = ${id}
  `);

  const updated = await db.execute(sql`SELECT * FROM customer_employees WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ─── portal: team — employees (manager only) ─────────────────────────────────

router.get("/portal/team/roles", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const rows = await db.execute(sql`SELECT id, name FROM customer_roles WHERE customer_id = ${customerId} ORDER BY name`);
  res.json(rows.rows);
});

router.get("/portal/team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const showInactive = req.query.showInactive === "true";

  try {
    const rows = await db.execute(sql`
      SELECT e.id, e.first_name, e.last_name, e.employee_number, e.email, e.phone, e.job_title,
             e.department, e.notes, e.is_active, e.allowance,
             COALESCE(e.allowance_topup, 0) AS allowance_topup,
             cr.id as role_id, cr.name as role_name,
             cr.annual_allowance as role_allowance,
             COALESCE(e.allowance, cr.annual_allowance) AS effective_allowance,
             e.manager_id,
             TRIM(CONCAT(m.first_name, ' ', COALESCE(m.last_name, ''))) as manager_name,
             e.delivery_address_id,
             da.label as delivery_address_label,
             da.line1 as delivery_address_line1,
             da.city  as delivery_address_city,
             da.postcode as delivery_address_postcode,
             COALESCE(
               (SELECT json_agg(json_build_object('label', s.label, 'size', s.size) ORDER BY s.id)
                FROM customer_employee_sizes s WHERE s.employee_id = e.id),
               '[]'::json
             ) as sizes,
             COALESCE(spend.total, 0) AS spend_12m
      FROM customer_employees e
      LEFT JOIN customer_roles cr ON cr.id = e.role_id
      LEFT JOIN customer_employees m ON m.id = e.manager_id
      LEFT JOIN customer_delivery_addresses da ON da.id = e.delivery_address_id
      LEFT JOIN (
        SELECT oi.recipient_employee_id, SUM(oi.line_total)::numeric AS total
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.status NOT IN ('portal_draft', 'cancelled')
          AND o.created_at >= NOW() - INTERVAL '12 months'
        GROUP BY oi.recipient_employee_id
      ) spend ON spend.recipient_employee_id = e.id
      WHERE e.customer_id = ${customerId}
        ${showInactive ? sql`` : sql`AND e.is_active = true`}
      ORDER BY e.last_name, e.first_name
    `);
    res.json(rows.rows);
  } catch (err: any) {
    console.error("[portal/team/employees] DB error:", err?.message, err?.cause?.message, err?.code);
    res.status(500).json({ error: "Failed to load employees" });
  }
});

router.post("/portal/team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const body = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    employeeNumber: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    roleId: z.number().int().optional().nullable(),
    managerId: z.number().int().optional().nullable(),
    notes: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  const rows = await db.execute(sql`
    INSERT INTO customer_employees
      (customer_id, first_name, last_name, employee_number, email, phone, job_title, department, role_id, manager_id, notes, is_active)
    VALUES
      (${customerId}, ${d.firstName}, ${d.lastName}, ${d.employeeNumber ?? null}, ${d.email ?? null}, ${d.phone ?? null},
       ${d.jobTitle ?? null}, ${d.department ?? null}, ${d.roleId ?? null}, ${d.managerId ?? null}, ${d.notes ?? null}, true)
    RETURNING *
  `);
  res.status(201).json(rows.rows[0]);
});

router.patch("/portal/team/employees/:id", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({
    firstName: z.string().min(1).optional(),
    lastName: z.string().min(1).optional(),
    employeeNumber: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    roleId: z.number().int().optional().nullable(),
    managerId: z.number().int().optional().nullable(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    deliveryAddressId: z.number().int().optional().nullable(),
    allowance: z.number().min(0).optional().nullable(),
    allowanceTopup: z.number().min(0).optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  const sets: string[] = [];
  if (d.firstName !== undefined) sets.push(`first_name = '${d.firstName.replace(/'/g, "''")}'`);
  if (d.lastName !== undefined) sets.push(`last_name = '${d.lastName.replace(/'/g, "''")}'`);
  if (d.employeeNumber !== undefined) sets.push(`employee_number = ${d.employeeNumber === null ? "NULL" : `'${d.employeeNumber.replace(/'/g, "''")}'`}`);
  if (d.email !== undefined) sets.push(`email = ${d.email === null ? "NULL" : `'${d.email.replace(/'/g, "''")}'`}`);
  if (d.phone !== undefined) sets.push(`phone = ${d.phone === null ? "NULL" : `'${d.phone.replace(/'/g, "''")}'`}`);
  if (d.jobTitle !== undefined) sets.push(`job_title = ${d.jobTitle === null ? "NULL" : `'${d.jobTitle.replace(/'/g, "''")}'`}`);
  if (d.department !== undefined) sets.push(`department = ${d.department === null ? "NULL" : `'${d.department.replace(/'/g, "''")}'`}`);
  if (d.roleId !== undefined) sets.push(`role_id = ${d.roleId === null ? "NULL" : d.roleId}`);
  if (d.managerId !== undefined) sets.push(`manager_id = ${d.managerId === null ? "NULL" : d.managerId}`);
  if (d.notes !== undefined) sets.push(`notes = ${d.notes === null ? "NULL" : `'${d.notes.replace(/'/g, "''")}'`}`);
  if (d.isActive !== undefined) sets.push(`is_active = ${d.isActive}`);
  if (d.deliveryAddressId !== undefined) sets.push(`delivery_address_id = ${d.deliveryAddressId === null ? "NULL" : d.deliveryAddressId}`);
  if (d.allowance !== undefined) sets.push(`allowance = ${d.allowance === null ? "NULL" : d.allowance}`);
  if (d.allowanceTopup !== undefined) sets.push(`allowance_topup = ${d.allowanceTopup === null ? "0" : d.allowanceTopup}`);

  if (sets.length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const rows = await db.execute(sql`
    UPDATE customer_employees SET ${sql.raw(sets.join(", "))}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
    RETURNING *
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(rows.rows[0]);
});

// ─── portal: team — manager top-up credits for an employee ───────────────────

router.patch("/portal/team/employees/:id/topup", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const body = z.object({ topup: z.number().min(0) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const rows = await db.execute(sql`
    UPDATE customer_employees
    SET allowance_topup = ${body.data.topup}, updated_at = now()
    WHERE id = ${empId} AND customer_id = ${customerId}
    RETURNING id, allowance, allowance_topup,
              (SELECT annual_allowance FROM customer_roles WHERE id = customer_employees.role_id) AS role_allowance,
              COALESCE(allowance, (SELECT annual_allowance FROM customer_roles WHERE id = customer_employees.role_id)) AS effective_allowance
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(rows.rows[0]);
});

// ─── portal: team — employee sizes (manager only) ────────────────────────────

router.get("/portal/team/employees/:id/sizes", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const rows = await db.execute(sql`
    SELECT s.id, s.label, s.size
    FROM customer_employee_sizes s
    JOIN customer_employees e ON e.id = s.employee_id
    WHERE s.employee_id = ${empId} AND e.customer_id = ${customerId}
    ORDER BY s.id
  `);
  res.json(rows.rows);
});

router.put("/portal/team/employees/:id/sizes", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const empId = parseInt(req.params.id, 10);
  if (isNaN(empId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  // Validate employee belongs to this customer
  const empCheck = await db.execute(sql`SELECT id FROM customer_employees WHERE id = ${empId} AND customer_id = ${customerId}`);
  if (empCheck.rows.length === 0) { res.status(404).json({ error: "Employee not found" }); return; }

  const parsed = z.array(z.object({ label: z.string().min(1), size: z.string().min(1) })).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Expected array of {label, size}" }); return; }

  // Replace all sizes for this employee
  await db.execute(sql`DELETE FROM customer_employee_sizes WHERE employee_id = ${empId}`);
  for (const s of parsed.data) {
    await db.execute(sql`INSERT INTO customer_employee_sizes (employee_id, label, size) VALUES (${empId}, ${s.label}, ${s.size})`);
  }

  const rows = await db.execute(sql`SELECT id, label, size FROM customer_employee_sizes WHERE employee_id = ${empId} ORDER BY id`);
  res.json(rows.rows);
});

// ─── portal: team — portal users (manager only) ──────────────────────────────

router.get("/portal/team/users", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const rows = await db.execute(sql`
    SELECT u.id, u.email, u.status, u.portal_role, u.show_pricing, u.last_login_at, u.created_at,
           u.linked_employee_id,
           e.first_name AS linked_first_name, e.last_name AS linked_last_name
    FROM customer_portal_users u
    LEFT JOIN customer_employees e ON e.id = u.linked_employee_id
    WHERE u.customer_id = ${customerId}
    ORDER BY u.created_at
  `);
  res.json(rows.rows);
});

router.patch("/portal/team/users/:id/link-employee", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({ employeeId: z.number().int().positive().nullable() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Verify employee belongs to this customer if not null
  if (body.data.employeeId !== null) {
    const empCheck = await db.execute(sql`
      SELECT id FROM customer_employees WHERE id = ${body.data.employeeId} AND customer_id = ${customerId} LIMIT 1
    `);
    if (empCheck.rows.length === 0) { res.status(400).json({ error: "Employee not found" }); return; }
  }

  await db.execute(sql`
    UPDATE customer_portal_users SET linked_employee_id = ${body.data.employeeId}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

router.post("/portal/team/users/invite", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const body = z.object({
    email: z.string().email(),
    portalRole: z.enum(["manager", "dept_manager", "member"]).default("member"),
    sendNow: z.boolean().optional().default(false),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { email, portalRole: role, sendNow } = body.data;
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

  const showPricingDefault = role === 'manager';
  try {
    await db.execute(sql`
      INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status, portal_role, show_pricing)
      VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'pending', ${role}, ${showPricingDefault})
      ON CONFLICT (email, customer_id) DO UPDATE SET
        invite_token = ${token},
        invite_expires_at = ${expires.toISOString()},
        portal_role = ${role},
        updated_at = now()
    `);
  } catch {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const inviteUrl = `${proto}://${host}/customer-portal/accept-invite?token=${token}`;
  const relativeUrl = `/customer-portal/accept-invite?token=${token}`;

  let emailSent = false;
  let emailError: string | undefined;

  if (sendNow && isEmailConfigured) {
    const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
    const customerName = (custRows.rows[0] as any)?.name ?? "your company";
    const { html, text } = buildInviteEmail(email, inviteUrl, customerName);
    const result = await sendEmail({
      to: email,
      cc: "info@selectbranding.co.uk",
      subject: `Your ${customerName} account is ready — Select Branding Solutions`,
      html,
      text,
    });
    emailSent = result.sent;
    emailError = result.error;
    if (emailSent) {
      await db.execute(sql`
        UPDATE customer_portal_users SET status = 'invited', updated_at = now()
        WHERE customer_id = ${customerId} AND email = ${email}
      `);
    }
  }

  res.json({ inviteUrl: relativeUrl, token, email, portalRole: role, expiresAt: expires, emailSent, emailError });
});

// ─── Send invite email to an existing pending portal user ────────────────────

router.post("/portal/team/users/:id/send-invite", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  if (!isEmailConfigured) {
    res.status(400).json({ error: "Email is not configured on this server" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

  const rows = await db.execute(sql`
    UPDATE customer_portal_users
    SET invite_token = ${token}, invite_expires_at = ${expires.toISOString()}, status = 'invited', updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
    RETURNING email, portal_role
  `);

  const user = rows.rows[0] as any;
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "your company";

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const inviteUrl = `${proto}://${host}/customer-portal/accept-invite?token=${token}`;

  const { html, text } = buildInviteEmail(user.email, inviteUrl, customerName);
  const result = await sendEmail({
    to: user.email,
    cc: "info@selectbranding.co.uk",
    subject: `You're invited to the ${customerName} ordering portal`,
    html,
    text,
  });

  res.json({ ok: true, emailSent: result.sent, emailError: result.error, sentTo: user.email });
});

// ─── Email configuration status (so UI can adapt) ─────────────────────────

router.get("/portal/team/email-status", portalAuth, async (_req: Request, res: Response) => {
  res.json({ configured: isEmailConfigured });
});

router.patch("/portal/team/users/:id/role", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({ role: z.enum(["manager", "dept_manager", "member"]) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await db.execute(sql`
    UPDATE customer_portal_users SET portal_role = ${body.data.role}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

router.patch("/portal/team/users/:id/show-pricing", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({ showPricing: z.boolean() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await db.execute(sql`
    UPDATE customer_portal_users SET show_pricing = ${body.data.showPricing}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

router.patch("/portal/team/users/:id/status", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({ status: z.enum(["active", "inactive"]) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  await db.execute(sql`
    UPDATE customer_portal_users SET status = ${body.data.status}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

// ─── Portal notifications ─────────────────────────────────────────────────────

router.get("/portal/notifications", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalUserId = (req as any).portalUserId;
  const isPreview = (req as any).portalIsPreview;
  if (isPreview) { res.json([]); return; }

  // Return notifications for this specific user OR broadcast notifications (portal_user_id IS NULL)
  const rows = await db.execute(sql`
    SELECT id, title, body, link, type, is_read, created_at
    FROM portal_notifications
    WHERE customer_id = ${customerId}
      AND (portal_user_id = ${portalUserId} OR portal_user_id IS NULL)
    ORDER BY created_at DESC
    LIMIT 50
  `);
  res.json(rows.rows);
});

router.patch("/portal/notifications/:id/read", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.execute(sql`
    UPDATE portal_notifications SET is_read = true
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

router.patch("/portal/notifications/read-all", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalUserId = (req as any).portalUserId;
  await db.execute(sql`
    UPDATE portal_notifications SET is_read = true
    WHERE customer_id = ${customerId}
      AND (portal_user_id = ${portalUserId} OR portal_user_id IS NULL)
  `);
  res.json({ ok: true });
});

// ─── Send "Save to Home Screen" instructions email ───────────────────────────

router.post("/portal/admin/send-mobile-instructions/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  if (!customerId) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const body = z.object({ email: z.string().email(), name: z.string().optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const custRows = await db.execute(sql`SELECT id, name FROM customers WHERE id = ${customerId}`);
  if (!custRows.rows[0]) { res.status(404).json({ error: "Customer not found" }); return; }
  const customerName = (custRows.rows[0] as any).name as string;

  if (!isEmailConfigured) {
    res.status(400).json({ error: "Email is not configured. Please set up SMTP in Settings first." });
    return;
  }

  const portalUrl = `${req.headers.origin ?? "https://selectuniforms.co.uk"}/customer-portal/`;
  const toEmail = body.data.email;
  const toName = body.data.name ?? toEmail.split("@")[0];

  await sendMobileInstructionsEmail({ toEmail, toName, portalUrl, customerName });
  res.json({ ok: true, sentTo: toEmail });
});

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER STOCK MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /portal/stock ────────────────────────────────────────────────────────
router.get("/portal/stock", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const rows = await db.execute(sql`
    SELECT fi.id, fi.name, fi.product_id, p.name AS product_name, p.sku AS product_sku,
           p.image_url AS product_image_url,
           (SELECT pv.image_url
              FROM product_variants pv
             WHERE pv.product_id = fi.product_id
               AND lower(pv.colour) = lower(fi.colour)
               AND pv.image_url IS NOT NULL
             LIMIT 1
           ) AS variant_image_url,
           fi.colour, fi.size, fi.unit_price, fi.special_price, fi.stock_quantity, fi.min_quantity, fi.reorder_quantity,
           fi.location, fi.notes, fi.finish_id, cf.name AS finish_name, fi.updated_at,
           (SELECT COUNT(*) FROM customer_stock_movements WHERE stock_item_id = fi.id) AS movement_count,
           (SELECT created_at FROM customer_stock_movements WHERE stock_item_id = fi.id ORDER BY created_at DESC LIMIT 1) AS last_movement_at
    FROM customer_finished_items fi
    LEFT JOIN products p ON p.id = fi.product_id
    LEFT JOIN customer_finishes cf ON cf.id = fi.finish_id
    WHERE fi.customer_id = ${customerId}
    ORDER BY fi.name ASC, fi.colour ASC, fi.size ASC
  `);

  const processes = await db.execute(sql`
    SELECT cfp.finish_id, cp.id AS process_id, cp.name AS item_finish_name,
           cp.type AS process_type, cp.placement, cp.price
    FROM customer_finish_processes cfp
    JOIN customer_processes cp ON cp.id = cfp.process_id
    JOIN customer_finishes  cf ON cf.id = cfp.finish_id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cp.name
  `);

  // Build sizesMap: { [productId]: { [colour]: string[] } } — same as wardrobe endpoint
  const variantRows = await db.execute(sql`
    SELECT DISTINCT pv.product_id, pv.colour, pv.size
    FROM product_variants pv
    WHERE pv.product_id IN (
      SELECT DISTINCT fi2.product_id FROM customer_finished_items fi2
      WHERE fi2.customer_id = ${customerId} AND fi2.product_id IS NOT NULL
    )
    AND pv.size IS NOT NULL AND pv.size != ''
    ORDER BY pv.product_id, pv.colour, pv.size
  `);
  const sizesMap: Record<string, Record<string, string[]>> = {};
  for (const row of variantRows.rows as any[]) {
    const pid = String(row.product_id);
    if (!sizesMap[pid]) sizesMap[pid] = {};
    const col = row.colour ?? "__any__";
    if (!sizesMap[pid][col]) sizesMap[pid][col] = [];
    sizesMap[pid][col].push(row.size);
  }
  try {
    const attrRows = await db.execute(sql`
      SELECT DISTINCT pa.product_id, pa.value AS size
      FROM product_attributes pa
      WHERE pa.type = 'size' AND pa.value IS NOT NULL AND pa.value != ''
        AND pa.product_id IN (
          SELECT DISTINCT fi2.product_id FROM customer_finished_items fi2
          WHERE fi2.customer_id = ${customerId} AND fi2.product_id IS NOT NULL
        )
      ORDER BY pa.product_id, pa.value
    `);
    for (const row of attrRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sizesMap[pid]) sizesMap[pid] = {};
      if (!sizesMap[pid]["__any__"]) sizesMap[pid]["__any__"] = [];
      sizesMap[pid]["__any__"].push(row.size);
    }
  } catch { /* not fatal */ }
  try {
    const [sizeOrderRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "size_order"));
    if (sizeOrderRow?.value) {
      const sizeOrder: string[] = JSON.parse(sizeOrderRow.value);
      const sortFn = (a: string, b: string) => {
        const ai = sizeOrder.indexOf(a), bi = sizeOrder.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        const na = parseFloat(a), nb = parseFloat(b);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return a.localeCompare(b);
      };
      for (const pid of Object.keys(sizesMap))
        for (const col of Object.keys(sizesMap[pid]))
          sizesMap[pid][col] = [...new Set(sizesMap[pid][col])].sort(sortFn);
    }
  } catch { /* size ordering is best-effort */ }

  res.json({ items: rows.rows, processes: processes.rows, sizesMap });
});

// ─── POST /portal/stock ───────────────────────────────────────────────────────
router.post("/portal/stock", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  const portalUserId = (req as any).portalUserId;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const body = z.object({
    name: z.string().min(1).max(200),
    productId: z.number().int().positive().nullable().optional(),
    colour: z.string().max(100).nullable().optional(),
    size: z.string().max(50).nullable().optional(),
    unitPrice: z.number().nonnegative().optional().default(0),
    initialQuantity: z.number().int().min(0).default(0),
    minQuantity: z.number().int().min(0).default(0),
    reorderQuantity: z.number().int().min(0).default(0),
    location: z.string().max(200).nullable().optional(),
    notes: z.string().nullable().optional(),
  }).parse(req.body);

  // Resolve manager name
  const userRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
  const mgrEmail = (userRows.rows[0] as any)?.email ?? null;
  const mgrName: string = mgrEmail ? mgrEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "Manager";

  const result = await db.execute(sql`
    INSERT INTO customer_finished_items (customer_id, name, product_id, colour, size, unit_price, stock_quantity, min_quantity, reorder_quantity, location, notes, created_at, updated_at)
    VALUES (${customerId}, ${body.name}, ${body.productId ?? null}, ${body.colour ?? null}, ${body.size ?? null},
            ${body.unitPrice.toFixed(2)}, ${body.initialQuantity}, ${body.minQuantity}, ${body.reorderQuantity}, ${body.location ?? null}, ${body.notes ?? null}, now(), now())
    RETURNING id
  `);
  const newId = (result.rows[0] as any).id as number;

  if (body.initialQuantity > 0) {
    await db.execute(sql`
      INSERT INTO customer_stock_movements (customer_id, stock_item_id, movement_type, quantity, notes, created_by_name, created_at)
      VALUES (${customerId}, ${newId}, 'in', ${body.initialQuantity}, 'Initial stock', ${mgrName}, now())
    `);
  }

  res.status(201).json({ id: newId });
});

// ─── PATCH /portal/stock/:id ──────────────────────────────────────────────────
router.patch("/portal/stock/:id", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const id = parseInt(req.params.id, 10);

  const body = z.object({
    name: z.string().min(1).max(200).optional(),
    colour: z.string().max(100).nullable().optional(),
    size: z.string().max(50).nullable().optional(),
    unitPrice: z.number().nonnegative().optional(),
    minQuantity: z.number().int().min(0).optional(),
    reorderQuantity: z.number().int().min(0).optional(),
    location: z.string().max(200).nullable().optional(),
    notes: z.string().nullable().optional(),
  }).parse(req.body);

  await db.execute(sql`
    UPDATE customer_finished_items
    SET name             = COALESCE(${body.name ?? null}, name),
        colour           = COALESCE(${body.colour !== undefined ? body.colour : null}, colour),
        size             = COALESCE(${body.size !== undefined ? body.size : null}, size),
        unit_price       = COALESCE(${body.unitPrice != null ? body.unitPrice.toFixed(2) : null}, unit_price),
        min_quantity     = COALESCE(${body.minQuantity ?? null}, min_quantity),
        reorder_quantity = COALESCE(${body.reorderQuantity ?? null}, reorder_quantity),
        location         = ${body.location !== undefined ? (body.location ?? null) : sql`location`},
        notes            = ${body.notes !== undefined ? (body.notes ?? null) : sql`notes`},
        updated_at       = now()
    WHERE id = ${id} AND customer_id = ${customerId}
  `);
  res.json({ ok: true });
});

// ─── DELETE /portal/stock/:id ─────────────────────────────────────────────────
router.delete("/portal/stock/:id", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const id = parseInt(req.params.id, 10);
  await db.execute(sql`DELETE FROM customer_finished_items WHERE id = ${id} AND customer_id = ${customerId}`);
  res.json({ ok: true });
});

// ─── POST /portal/stock/:id/adjust ───────────────────────────────────────────
router.post("/portal/stock/:id/adjust", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  const portalUserId = (req as any).portalUserId;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const id = parseInt(req.params.id, 10);

  const body = z.object({
    type: z.enum(["in", "out", "adjustment"]),
    quantity: z.number().int().positive(),
    notes: z.string().nullable().optional(),
    recipientName: z.string().nullable().optional(),
  }).parse(req.body);

  // Resolve manager name
  const userRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
  const mgrEmail = (userRows.rows[0] as any)?.email ?? null;
  const mgrName: string = mgrEmail ? mgrEmail.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()) : "Manager";

  // Determine delta
  const delta = body.type === "out" ? -body.quantity : body.quantity;

  // Check we won't go negative for "out"
  if (body.type === "out") {
    const checkRows = await db.execute(sql`SELECT stock_quantity FROM customer_finished_items WHERE id = ${id} AND customer_id = ${customerId}`);
    const current = (checkRows.rows[0] as any)?.stock_quantity ?? 0;
    if (current + delta < 0) {
      res.status(400).json({ error: `Insufficient stock. Current quantity: ${current}` });
      return;
    }
  }

  const updated = await db.execute(sql`
    UPDATE customer_finished_items
    SET stock_quantity = stock_quantity + ${delta}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
    RETURNING stock_quantity
  `);
  if (!updated.rows.length) { res.status(404).json({ error: "Stock item not found" }); return; }

  await db.execute(sql`
    INSERT INTO customer_stock_movements (customer_id, stock_item_id, movement_type, quantity, recipient_name, notes, created_by_name, created_at)
    VALUES (${customerId}, ${id}, ${body.type}, ${delta}, ${body.recipientName ?? null}, ${body.notes ?? null}, ${mgrName}, now())
  `);

  res.json({ ok: true, newQuantity: (updated.rows[0] as any).stock_quantity });
});

// ─── GET /portal/stock/:id/movements ─────────────────────────────────────────
router.get("/portal/stock/:id/movements", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const id = parseInt(req.params.id, 10);

  const rows = await db.execute(sql`
    SELECT id, movement_type, quantity, reference, recipient_name, notes, created_by_name, created_at
    FROM customer_stock_movements
    WHERE stock_item_id = ${id} AND customer_id = ${customerId}
    ORDER BY created_at DESC
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ─── Portal: get quote by token (pre-fills the ordering form) ────────────────
// Public endpoint — the quote token in the URL IS the credential; no JWT needed.
router.get("/portal/quote/:token", async (req: Request, res: Response) => {
  const { token } = req.params;

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE token = ${token}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  if (quote.expires_at && new Date(quote.expires_at) < new Date()) {
    res.status(410).json({ error: "This quote has expired." }); return;
  }

  const itemRows = await db.execute(sql`
    SELECT * FROM quote_items WHERE quote_id = ${quote.id} ORDER BY sort_order, id
  `);

  // Separate parent rows (no parent_item_id) from child decoration rows, then
  // combine all decoration finishNames onto the parent as a newline-joined string.
  const allRawItems = itemRows.rows as any[];
  const childrenByParent = new Map<number, string[]>();
  for (const row of allRawItems) {
    if (row.parent_item_id != null && row.finish_name) {
      if (!childrenByParent.has(row.parent_item_id)) childrenByParent.set(row.parent_item_id, []);
      childrenByParent.get(row.parent_item_id)!.push(row.finish_name);
    }
  }

  const items = allRawItems
    .filter((row) => row.parent_item_id == null)
    .map((item) => {
      const childFinishes = childrenByParent.get(item.id) ?? [];
      const allFinishes = [item.finish_name, ...childFinishes].filter(Boolean);
      return {
        productId: item.product_id ?? null,
        productName: item.product_name,
        sku: null,
        colour: item.colour ?? "",
        size: item.size ?? "",
        finishId: item.finish_id ?? null,
        finishName: allFinishes.join("\n"),
        recipientType: "stock" as const,
        recipientName: "",
        recipientEmployeeId: null,
        quantity: item.quantity,
        garmentBasePrice: parseFloat(String(item.unit_price ?? 0)),
        processLines: [],
        unitPrice: parseFloat(String(item.unit_price ?? 0)),
      };
    });

  // Resolve productId by product name for quote items that have no product_id linked.
  // This allows sizesMap to include variant data for manually-entered quote lines.
  const missingIdItems = items.filter(i => !i.productId && i.productName);
  if (missingIdItems.length > 0) {
    try {
      const nameRows = await db.select({ id: productsTable.id, name: productsTable.name })
        .from(productsTable);
      const nameToId = new Map((nameRows as { id: number; name: string }[]).map(r => [r.name.toLowerCase(), r.id]));
      for (const item of items) {
        if (!item.productId && item.productName) {
          const resolved = nameToId.get(item.productName.toLowerCase());
          if (resolved) item.productId = resolved;
        }
      }
    } catch { /* non-fatal */ }
  }

  // Build sizesMap so the customer can pick colour/size when converting a quote to an order
  const sizesMap: Record<string, Record<string, string[]>> = {};
  const variantImagesMap: Record<string, Record<string, string | null>> = {};
  const productIds = [...new Set(items.map(i => i.productId).filter(Boolean) as number[])];

  if (productIds.length > 0) {
    const idsStr = productIds.map(id => parseInt(String(id), 10)).filter(n => !isNaN(n)).join(",");

    // product_variants: colour-keyed sizes
    const variantRows = await db.execute(sql.raw(`
      SELECT DISTINCT pv.product_id, pv.colour, pv.size
      FROM product_variants pv
      WHERE pv.product_id IN (${idsStr})
        AND pv.size IS NOT NULL AND pv.size != ''
      ORDER BY pv.product_id, pv.colour, pv.size
    `));
    for (const row of variantRows.rows as any[]) {
      const pid = String(row.product_id);
      if (!sizesMap[pid]) sizesMap[pid] = {};
      const col = row.colour ?? "__any__";
      if (!sizesMap[pid][col]) sizesMap[pid][col] = [];
      sizesMap[pid][col].push(row.size);
    }

    // product_attributes: fallback size list under __any__
    try {
      const attrRows = await db.execute(sql.raw(`
        SELECT DISTINCT pa.product_id, pa.value AS size
        FROM product_attributes pa
        WHERE pa.type = 'size' AND pa.value IS NOT NULL AND pa.value != ''
          AND pa.product_id IN (${idsStr})
        ORDER BY pa.product_id, pa.value
      `));
      for (const row of attrRows.rows as any[]) {
        const pid = String(row.product_id);
        if (!sizesMap[pid]) sizesMap[pid] = {};
        if (!sizesMap[pid]["__any__"]) sizesMap[pid]["__any__"] = [];
        sizesMap[pid]["__any__"].push(row.size);
      }
    } catch { /* non-fatal */ }

    // product_attributes: colour list — ensures colour keys exist in sizesMap
    // even when product_variants has no size entries for a colour.
    try {
      const colAttrRows = await db.execute(sql.raw(`
        SELECT DISTINCT pa.product_id, pa.value AS colour
        FROM product_attributes pa
        WHERE pa.type = 'colour' AND pa.value IS NOT NULL AND pa.value != ''
          AND pa.product_id IN (${idsStr})
        ORDER BY pa.product_id, pa.value
      `));
      for (const row of colAttrRows.rows as any[]) {
        const pid = String(row.product_id);
        if (!sizesMap[pid]) sizesMap[pid] = {};
        if (!sizesMap[pid][row.colour]) sizesMap[pid][row.colour] = [];
      }
    } catch { /* non-fatal */ }

    // Sort sizes using the saved size_order setting
    try {
      const [sizeOrderRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "size_order"));
      if (sizeOrderRow?.value) {
        const sizeOrder: string[] = JSON.parse(sizeOrderRow.value);
        const sortFn = (a: string, b: string) => {
          const ai = sizeOrder.indexOf(a);
          const bi = sizeOrder.indexOf(b);
          if (ai !== -1 && bi !== -1) return ai - bi;
          if (ai !== -1) return -1;
          if (bi !== -1) return 1;
          const na = parseFloat(a), nb = parseFloat(b);
          if (!isNaN(na) && !isNaN(nb)) return na - nb;
          return a.localeCompare(b);
        };
        for (const pid of Object.keys(sizesMap)) {
          for (const col of Object.keys(sizesMap[pid])) {
            sizesMap[pid][col] = [...new Set(sizesMap[pid][col])].sort(sortFn);
          }
        }
      }
    } catch { /* non-fatal */ }

    // Also build available colours per product (all non-__any__ keys from product_variants)
    try {
      const colourRows = await db.execute(sql.raw(`
        SELECT DISTINCT pv.product_id, pv.colour
        FROM product_variants pv
        WHERE pv.product_id IN (${idsStr})
          AND pv.colour IS NOT NULL AND pv.colour != ''
        ORDER BY pv.product_id, pv.colour
      `));
      for (const row of colourRows.rows as any[]) {
        const pid = String(row.product_id);
        if (!sizesMap[pid]) sizesMap[pid] = {};
        // Ensure the colour key exists even if no size variants found
        if (!sizesMap[pid][row.colour]) sizesMap[pid][row.colour] = [];
      }
    } catch { /* non-fatal */ }

    // Product default images
    try {
      const imgRows = await db.execute(sql.raw(`
        SELECT id, image_url FROM products WHERE id IN (${idsStr})
      `));
      const productImgMap = new Map<number, string | null>(
        (imgRows.rows as any[]).map(r => [r.id, r.image_url ?? null])
      );
      for (const item of items) {
        if (item.productId) {
          (item as any).imageUrl = productImgMap.get(item.productId) ?? null;
        }
      }
    } catch { /* non-fatal */ }

    // Variant images: productId -> colour -> imageUrl
    try {
      const varImgRows = await db.execute(sql.raw(`
        SELECT DISTINCT product_id, colour, image_url
        FROM product_variants
        WHERE product_id IN (${idsStr})
          AND colour IS NOT NULL AND colour != ''
          AND image_url IS NOT NULL AND image_url != ''
      `));
      for (const row of varImgRows.rows as any[]) {
        const pid = String(row.product_id);
        if (!variantImagesMap[pid]) variantImagesMap[pid] = {};
        variantImagesMap[pid][row.colour] = row.image_url;
      }
    } catch { /* non-fatal */ }
  }

  if (quote.status === "sent") {
    await db.execute(sql`UPDATE quotes SET status = 'viewed', updated_at = now() WHERE id = ${quote.id}`);
  }

  res.json({
    id: quote.id,
    quoteNumber: quote.quote_number,
    customerId: quote.customer_id ?? null,
    customerName: quote.customer_name,
    notes: quote.notes,
    expiresAt: quote.expires_at,
    customerLogoUrl: quote.customer_logo_url ?? null,
    items,
    sizesMap,
    variantImagesMap,
  });
});

// ─── GET /portal/stock/picking-note/:ref ─────────────────────────────────────
router.get("/portal/stock/picking-note/:ref", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }
  const ref = req.params.ref;

  const rows = await db.execute(sql`
    SELECT m.id, m.quantity, m.recipient_name, m.notes, m.created_at, m.created_by_name,
           fi.name AS item_name, fi.colour, fi.size, fi.location
    FROM customer_stock_movements m
    JOIN customer_finished_items fi ON fi.id = m.stock_item_id
    WHERE m.reference = ${ref} AND m.customer_id = ${customerId}
    ORDER BY fi.name ASC, fi.size ASC
  `);
  res.json({ ref, items: rows.rows });
});

export default router;
