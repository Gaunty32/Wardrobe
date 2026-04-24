/**
 * Customer Portal API
 * Invite-based auth + order management for customers
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { z } from "zod";
import { generateInvoicePDF, buildAcknowledgementEmail, generateOrderAcknowledgementPdf, sendEmail, isEmailConfigured } from "../services/email.js";

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
    <img src="https://selectbranding.co.uk/wp-content/uploads/2024/01/SBS-Logo.png" alt="Select Branding Solutions" style="height:48px;margin-bottom:24px" />
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

// ─── helpers ────────────────────────────────────────────────────────────────

function signToken(userId: number, customerId: number, portalRole: string) {
  return jwt.sign({ sub: userId, customerId, portalRole }, JWT_SECRET, { expiresIn: "30d" });
}

function signPreviewToken(customerId: number) {
  return jwt.sign({ sub: 0, customerId, portalRole: "manager", isPreview: true }, JWT_SECRET, { expiresIn: "2h" });
}

export async function portalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { sub: number; customerId: number; portalRole: string; isPreview?: boolean };
    (req as any).portalUserId = payload.sub;
    (req as any).portalCustomerId = payload.customerId;
    (req as any).portalRole = payload.portalRole ?? "member";
    (req as any).portalIsPreview = payload.isPreview ?? false;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── admin: send invite ──────────────────────────────────────────────────────

router.post("/portal/admin/invite", async (req: Request, res: Response) => {
  const { customerId, email, portalRole } = z.object({
    customerId: z.number().int().positive(),
    email: z.string().email(),
    portalRole: z.enum(["manager", "dept_manager", "member"]).default("member"),
  }).parse(req.body);

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000);

  // upsert: update if email already exists for this customer
  await db.execute(sql`
    INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status, portal_role)
    VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'invited', ${portalRole})
    ON CONFLICT (email) DO UPDATE
      SET invite_token = ${token},
          invite_expires_at = ${expires.toISOString()},
          status = 'invited',
          portal_role = ${portalRole},
          updated_at = now()
  `);

  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;
  res.json({ inviteUrl, token, email, portalRole, expiresAt: expires });
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
    VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'invited', ${portalRole})
    ON CONFLICT (email) DO UPDATE
      SET invite_token = ${token},
          invite_expires_at = ${expires.toISOString()},
          status = 'invited',
          portal_role = ${portalRole},
          updated_at = now()
  `);

  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;
  res.status(201).json({ ok: true, email, portalRole, inviteUrl, token, expiresAt: expires });
});

// ─── admin: customer detail (employees for invite suggestions) ─────────────

router.get("/portal/admin/customer-detail/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const employees = await db.execute(sql`
    SELECT id, (first_name || COALESCE(' ' || last_name, '')) AS name, email FROM customer_employees
    WHERE customer_id = ${customerId} AND is_active = true
    ORDER BY first_name ASC
  `);
  res.json({ employees: employees.rows });
});

// ─── admin: list portal users for a customer ──────────────────────────────

router.get("/portal/admin/users/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const rows = await db.execute(sql`
    SELECT id, email, status, portal_role, last_login_at, created_at,
           invite_expires_at,
           CASE WHEN invite_token IS NOT NULL THEN true ELSE false END as has_pending_invite
    FROM customer_portal_users
    WHERE customer_id = ${customerId}
    ORDER BY created_at DESC
  `);
  res.json(rows.rows);
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

// ─── admin: revoke portal user ────────────────────────────────────────────

router.delete("/portal/admin/users/:userId", async (req: Request, res: Response) => {
  const userId = parseInt(req.params.userId, 10);
  await db.execute(sql`DELETE FROM customer_portal_users WHERE id = ${userId}`);
  res.json({ ok: true });
});

// ─── verify magic link / accept invite ───────────────────────────────────────
// Accepts either a user-requested magic link or an admin-generated invite link.
// No password required — the token is the credential.

router.post("/portal/auth/accept-invite", async (req: Request, res: Response) => {
  const { token } = z.object({ token: z.string().min(1) }).parse(req.body);

  const rows = await db.execute(sql`
    SELECT * FROM customer_portal_users
    WHERE invite_token = ${token}
      AND invite_expires_at > now()
  `);
  const user = rows.rows[0] as any;
  if (!user) {
    res.status(400).json({ error: "This link has expired or already been used. Please request a new one." });
    return;
  }

  await db.execute(sql`
    UPDATE customer_portal_users
    SET invite_token = NULL,
        invite_expires_at = NULL,
        status = 'active',
        last_login_at = now(),
        updated_at = now()
    WHERE id = ${user.id}
  `);

  const jwtToken = signToken(user.id, user.customer_id, user.portal_role ?? "member");
  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${user.customer_id}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "";
  res.json({ token: jwtToken, customerId: user.customer_id, customerName, email: user.email, portalRole: user.portal_role ?? "member" });
});

// ─── request magic link (login) ──────────────────────────────────────────────
// Takes an email address and sends (or returns in dev) a one-time sign-in link.

router.post("/portal/auth/login", async (req: Request, res: Response) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }
  const { email } = parsed.data;

  const rows = await db.execute(sql`
    SELECT * FROM customer_portal_users WHERE lower(email) = lower(${email})
  `);
  const user = rows.rows[0] as any;

  // Always respond generically so we don't reveal whether the email exists
  if (!user) {
    res.json({ ok: true, emailSent: false, noAccount: true });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + MAGIC_TTL_MINUTES * 60 * 1000);

  await db.execute(sql`
    UPDATE customer_portal_users
    SET invite_token = ${token}, invite_expires_at = ${expires.toISOString()}, updated_at = now()
    WHERE id = ${user.id}
  `);

  // Build absolute URL from proxy headers
  const proto = req.get("x-forwarded-proto") ?? req.protocol ?? "https";
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const magicUrl = `${proto}://${host}/customer-portal/accept-invite?token=${token}`;

  let emailSent = false;
  if (isEmailConfigured) {
    const { html, text } = buildMagicLinkEmail(email, magicUrl);
    await sendEmail({
      to: email,
      subject: "Your sign-in link – Select Branding Solutions Portal",
      html,
      text,
    }).catch(() => {});
    emailSent = true;
  }

  // In dev (no email configured) return the URL directly so staff can test
  res.json({ ok: true, emailSent, ...(!emailSent ? { magicUrl } : {}) });
});

// ─── me ──────────────────────────────────────────────────────────────────────

router.get("/portal/auth/me", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const userId = (req as any).portalUserId;
  const isPreview = (req as any).portalIsPreview;

  const custRows = await db.execute(sql`SELECT id, name, logo_url FROM customers WHERE id = ${customerId}`);
  const customer = custRows.rows[0];

  if (isPreview) {
    const contactRows = await db.execute(sql`SELECT contact_first_name FROM customers WHERE id = ${customerId}`);
    const raw = (contactRows.rows[0] as any)?.contact_first_name ?? "there";
    // Take only the first word in case the full name was stored in this field
    const firstName = raw.trim().split(/\s+/)[0];
    res.json({
      user: { id: 0, email: "staff-preview@sbs.internal", status: "active", portal_role: "manager" },
      customer,
      firstName,
      isPreview: true,
    });
    return;
  }

  const userRows = await db.execute(sql`
    SELECT id, email, status, portal_role, last_login_at FROM customer_portal_users WHERE id = ${userId}
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

  const token = signPreviewToken(customerId);
  const previewUrl = `/customer-portal/preview-login?token=${token}`;
  res.json({ previewUrl, token, expiresIn: "2h" });
});

// ─── portal: list orders ─────────────────────────────────────────────────────

router.get("/portal/orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const rows = await db.execute(sql`
    SELECT id, order_number, status, portal_status, total_amount, order_date, required_date,
           po_number,
           (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) as item_count
    FROM orders
    WHERE customer_id = ${customerId}
      AND source = 'portal'
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

// ─── portal: create order ────────────────────────────────────────────────────

router.post("/portal/orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;

  const body = z.object({
    notes: z.string().optional(),
    requiredDate: z.string().optional(),
    portalNotes: z.string().optional(),
    poNumber: z.string().max(100).optional(),
    shippingOption: z.string().optional(),
    shippingCost: z.number().nonnegative().optional(),
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
  }).parse(req.body);

  // Generate order number
  const countRow = await db.execute(sql`SELECT COUNT(*) as cnt FROM orders WHERE source = 'portal'`);
  const num = parseInt((countRow.rows[0] as any).cnt, 10) + 1;
  const orderNumber = `P${num}`;

  const itemsTotal = body.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
  const totalAmount = itemsTotal + (body.shippingCost ?? 0);

  // Get customer name and default delivery address
  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "";
  const defaultAddrRows = await db.execute(sql`
    SELECT id FROM customer_delivery_addresses
    WHERE customer_id = ${customerId} AND is_default = true
    LIMIT 1
  `);
  const defaultAddressId: number | null = (defaultAddrRows.rows[0] as any)?.id ?? null;

  // Resolve portal user's email and display name
  const portalUserId = (req as any).portalUserId;
  const userRows = await db.execute(sql`SELECT email FROM customer_portal_users WHERE id = ${portalUserId} LIMIT 1`);
  const submitterEmail: string | null = (userRows.rows[0] as any)?.email ?? null;
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

  // Managers submit directly; dept_managers/members save for manager review
  const portalRole = (req as any).portalRole ?? "member";
  const portalStatus = portalRole === "manager" ? "submitted" : "pending_review";
  const orderStatus = portalRole === "manager" ? "portal_pending" : "portal_draft";

  const orderResult = await db.execute(sql`
    INSERT INTO orders (order_number, customer_id, customer_name, status, source, portal_status, portal_notes, total_amount, notes, order_date, required_date, shipping_method, po_number, delivery_address_id, attention_of, portal_submitted_by_email, portal_submitted_by_name)
    VALUES (
      ${orderNumber},
      ${customerId},
      ${customerName},
      ${orderStatus},
      'portal',
      ${portalStatus},
      ${body.portalNotes ?? null},
      ${totalAmount.toFixed(2)},
      ${body.notes ?? null},
      now(),
      ${body.requiredDate ? new Date(body.requiredDate).toISOString() : null},
      ${body.shippingOption ?? null},
      ${body.poNumber ?? null},
      ${defaultAddressId},
      ${submitterName},
      ${submitterEmail},
      ${submitterName}
    )
    RETURNING id, order_number
  `);
  const order = orderResult.rows[0] as any;

  for (const item of body.items) {
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

  res.status(201).json({ id: order.id, orderNumber: order.order_number });
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

  // Get all wardrobe items — primary key is customer_id on the item itself;
  // LEFT JOIN to finishes so items with no finish still appear
  const finishes = await db.execute(sql`
    SELECT
      cf.id   AS finish_id,
      cf.name AS finish_name,
      cf.code AS finish_code,
      cfi.id,
      cfi.name,
      cfi.product_id,
      p.name        AS product_name,
      p.sku         AS product_sku,
      p.image_url   AS product_image_url,
      p.price_breaks,
      cfi.colour,
      cfi.size,
      cfi.unit_price,
      cfi.special_price,
      cfi.role_id,
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
    LEFT JOIN customer_roles     cr  ON cr.id = cfi.role_id
    WHERE cfi.customer_id = ${customerId}
    ORDER BY cf.name NULLS LAST, cfi.name
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

  // Fallback: for products with no variant-level sizes, check product_attributes (type='size')
  // These are synced from WooCommerce product-level size attributes (colour-only variable products)
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
      // Only use attribute sizes for products that have no variant-level sizes
      if (!sizesMap[pid] || Object.values(sizesMap[pid]).every(arr => arr.length === 0)) {
        if (!sizesMap[pid]) sizesMap[pid] = {};
        if (!sizesMap[pid]["__any__"]) sizesMap[pid]["__any__"] = [];
        sizesMap[pid]["__any__"].push(row.size);
      }
    }
  } catch {
    // product_attributes may not have size data — not fatal, sizesMap remains from variants
  }

  // Get employees for this customer
  const employees = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.job_title, cr.id as role_id, cr.name as role_name
    FROM customer_employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
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

  res.json({
    items: finishes.rows,
    processes: processes.rows,
    employees: employees.rows,
    lastSizes,
    sizesMap,
  });
});

// ─── portal: manager — list orders awaiting review ───────────────────────────

router.get("/portal/manager/pending-orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") {
    res.status(403).json({ error: "Manager access required" });
    return;
  }
  const rows = await db.execute(sql`
    SELECT id, order_number, status, portal_status, total_amount, order_date, required_date, notes, portal_notes,
           (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) as item_count
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

  await db.execute(sql`
    UPDATE orders SET portal_status = 'submitted', status = 'portal_pending', updated_at = now(),
      portal_approved_by_email = ${mgrEmail},
      portal_approved_by_name = ${mgrName}
    WHERE id = ${orderId} AND customer_id = ${customerId} AND source = 'portal' AND portal_status = 'pending_review'
  `);
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

// ─── admin: list portal-pending orders ───────────────────────────────────────

router.get("/portal/admin/pending-orders", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT o.id, o.order_number, o.customer_id, o.customer_name, o.status, o.portal_status,
           o.portal_notes, o.total_amount, o.order_date, o.required_date, o.notes,
           (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) as item_count
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
    SELECT id, order_number, customer_id, customer_name, order_date, required_date, notes, total_amount,
           delivery_address_id, portal_submitted_by_email, portal_submitted_by_name,
           portal_approved_by_email, portal_approved_by_name
    FROM orders WHERE id = ${orderId} AND source = 'portal'
  `);
  const ord = orderRows.rows[0] as any;
  if (!ord) { res.status(404).json({ error: "Order not found" }); return; }

  // If no delivery address set, auto-assign the customer's default
  let deliveryAddressId = ord.delivery_address_id;
  if (!deliveryAddressId && ord.customer_id) {
    const addrRows = await db.execute(sql`
      SELECT id FROM customer_delivery_addresses
      WHERE customer_id = ${ord.customer_id} AND is_default = true LIMIT 1
    `);
    if (addrRows.rows.length > 0) {
      deliveryAddressId = (addrRows.rows[0] as any).id;
    }
  }

  if (deliveryAddressId && !ord.delivery_address_id) {
    await db.execute(sql`
      UPDATE orders SET portal_status = 'confirmed', status = 'draft', updated_at = now(),
        delivery_address_id = ${deliveryAddressId}
      WHERE id = ${orderId} AND source = 'portal'
    `);
  } else {
    await db.execute(sql`
      UPDATE orders SET portal_status = 'confirmed', status = 'draft', updated_at = now()
      WHERE id = ${orderId} AND source = 'portal'
    `);
  }

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

    // Fetch customer address for PDF
    let customerAddress: string | null = null;
    let customerCity: string | null = null;
    let customerPostcode: string | null = null;
    if (ord.customer_id) {
      const custRows = await db.execute(sql`SELECT address, city, postcode FROM customers WHERE id = ${ord.customer_id} LIMIT 1`);
      const c = custRows.rows[0] as any;
      customerAddress = c?.address ?? null;
      customerCity = c?.city ?? null;
      customerPostcode = c?.postcode ?? null;
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

// ─── portal: list invoices ────────────────────────────────────────────────────

router.get("/portal/invoices", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const rows = await db.execute(sql`
    SELECT id, order_number, invoice_email_sent_at, total_amount,
           xero_invoice_id, xero_invoice_status, tracking_number, order_date,
           customer_name, status
    FROM orders
    WHERE customer_id = ${customerId}
      AND invoice_email_sent_at IS NOT NULL
    ORDER BY invoice_email_sent_at DESC
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

// ─── portal: team — employees (manager only) ─────────────────────────────────

router.get("/portal/team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const showInactive = req.query.showInactive === "true";

  const rows = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.email, e.phone, e.job_title,
           e.department, e.notes, e.is_active,
           cr.id as role_id, cr.name as role_name,
           e.delivery_address_id,
           da.label as delivery_address_label,
           da.line1 as delivery_address_line1,
           da.city  as delivery_address_city,
           da.postcode as delivery_address_postcode
    FROM customer_employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
    LEFT JOIN customer_delivery_addresses da ON da.id = e.delivery_address_id
    WHERE e.customer_id = ${customerId}
      ${showInactive ? sql`` : sql`AND e.is_active = true`}
    ORDER BY e.last_name, e.first_name
  `);
  res.json(rows.rows);
});

router.post("/portal/team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const body = z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    roleId: z.number().int().optional().nullable(),
    notes: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  const rows = await db.execute(sql`
    INSERT INTO customer_employees
      (customer_id, first_name, last_name, email, phone, job_title, department, role_id, notes, is_active)
    VALUES
      (${customerId}, ${d.firstName}, ${d.lastName}, ${d.email ?? null}, ${d.phone ?? null},
       ${d.jobTitle ?? null}, ${d.department ?? null}, ${d.roleId ?? null}, ${d.notes ?? null}, true)
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
    email: z.string().email().optional().nullable(),
    phone: z.string().optional().nullable(),
    jobTitle: z.string().optional().nullable(),
    department: z.string().optional().nullable(),
    roleId: z.number().int().optional().nullable(),
    notes: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
    deliveryAddressId: z.number().int().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const d = body.data;
  const sets: string[] = [];
  if (d.firstName !== undefined) sets.push(`first_name = '${d.firstName.replace(/'/g, "''")}'`);
  if (d.lastName !== undefined) sets.push(`last_name = '${d.lastName.replace(/'/g, "''")}'`);
  if (d.email !== undefined) sets.push(`email = ${d.email === null ? "NULL" : `'${d.email.replace(/'/g, "''")}'`}`);
  if (d.phone !== undefined) sets.push(`phone = ${d.phone === null ? "NULL" : `'${d.phone.replace(/'/g, "''")}'`}`);
  if (d.jobTitle !== undefined) sets.push(`job_title = ${d.jobTitle === null ? "NULL" : `'${d.jobTitle.replace(/'/g, "''")}'`}`);
  if (d.department !== undefined) sets.push(`department = ${d.department === null ? "NULL" : `'${d.department.replace(/'/g, "''")}'`}`);
  if (d.roleId !== undefined) sets.push(`role_id = ${d.roleId === null ? "NULL" : d.roleId}`);
  if (d.notes !== undefined) sets.push(`notes = ${d.notes === null ? "NULL" : `'${d.notes.replace(/'/g, "''")}'`}`);
  if (d.isActive !== undefined) sets.push(`is_active = ${d.isActive}`);
  if (d.deliveryAddressId !== undefined) sets.push(`delivery_address_id = ${d.deliveryAddressId === null ? "NULL" : d.deliveryAddressId}`);

  if (sets.length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

  const rows = await db.execute(sql`
    UPDATE customer_employees SET ${sql.raw(sets.join(", "))}, updated_at = now()
    WHERE id = ${id} AND customer_id = ${customerId}
    RETURNING *
  `);
  if (rows.rows.length === 0) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(rows.rows[0]);
});

// ─── portal: team — portal users (manager only) ──────────────────────────────

router.get("/portal/team/users", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const rows = await db.execute(sql`
    SELECT id, email, status, portal_role, last_login_at, created_at
    FROM customer_portal_users
    WHERE customer_id = ${customerId}
    ORDER BY created_at
  `);
  res.json(rows.rows);
});

router.post("/portal/team/users/invite", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const body = z.object({
    email: z.string().email(),
    portalRole: z.enum(["manager", "dept_manager", "member"]).default("member"),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { email, portalRole: role } = body.data;
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);

  try {
    await db.execute(sql`
      INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status, portal_role)
      VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'invited', ${role})
      ON CONFLICT (email) DO UPDATE SET
        invite_token = ${token},
        invite_expires_at = ${expires.toISOString()},
        status = 'invited',
        portal_role = ${role},
        updated_at = now()
    `);
  } catch {
    res.status(409).json({ error: "Email already registered" });
    return;
  }

  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;
  res.json({ inviteUrl, token, email, portalRole: role, expiresAt: expires });
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

export default router;
