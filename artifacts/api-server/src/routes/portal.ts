/**
 * Customer Portal API
 * Invite-based auth + order management for customers
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes } from "crypto";
import { z } from "zod";
import { generateInvoicePDF } from "../services/email.js";

const router: IRouter = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production";
const INVITE_TTL_DAYS = 7;

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

// ─── accept invite ───────────────────────────────────────────────────────────

router.post("/portal/auth/accept-invite", async (req: Request, res: Response) => {
  const { token, password } = z.object({
    token: z.string().min(1),
    password: z.string().min(8),
  }).parse(req.body);

  const rows = await db.execute(sql`
    SELECT * FROM customer_portal_users
    WHERE invite_token = ${token}
      AND invite_expires_at > now()
  `);
  const user = rows.rows[0] as any;
  if (!user) {
    res.status(400).json({ error: "Invalid or expired invite link" });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  await db.execute(sql`
    UPDATE customer_portal_users
    SET password_hash = ${hash},
        invite_token = NULL,
        invite_expires_at = NULL,
        status = 'active',
        updated_at = now()
    WHERE id = ${user.id}
  `);

  const jwtToken = signToken(user.id, user.customer_id, user.portal_role ?? "member");
  res.json({ token: jwtToken, customerId: user.customer_id, portalRole: user.portal_role ?? "member" });
});

// ─── login ───────────────────────────────────────────────────────────────────

router.post("/portal/auth/login", async (req: Request, res: Response) => {
  const { email, password } = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }).parse(req.body);

  const rows = await db.execute(sql`
    SELECT * FROM customer_portal_users WHERE email = ${email} AND status = 'active'
  `);
  const user = rows.rows[0] as any;
  if (!user || !user.password_hash) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  await db.execute(sql`
    UPDATE customer_portal_users SET last_login_at = now(), updated_at = now() WHERE id = ${user.id}
  `);

  const token = signToken(user.id, user.customer_id, user.portal_role ?? "member");

  // Get customer name
  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${user.customer_id}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "";

  res.json({ token, customerId: user.customer_id, customerName, email: user.email, portalRole: user.portal_role ?? "member" });
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
    const firstName = (contactRows.rows[0] as any)?.contact_first_name ?? "there";
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
      firstName = (empRows.rows[0] as any).first_name;
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

// ─── portal: create order ────────────────────────────────────────────────────

router.post("/portal/orders", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;

  const body = z.object({
    notes: z.string().optional(),
    requiredDate: z.string().optional(),
    portalNotes: z.string().optional(),
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
  const orderNumber = `P${String(num).padStart(5, "0")}`;

  const totalAmount = body.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

  // Get customer name
  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${customerId}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "";

  // Managers submit directly; dept_managers/members save for manager review
  const portalRole = (req as any).portalRole ?? "member";
  const portalStatus = portalRole === "manager" ? "submitted" : "pending_review";
  const orderStatus = portalRole === "manager" ? "portal_pending" : "portal_draft";

  const orderResult = await db.execute(sql`
    INSERT INTO orders (order_number, customer_id, customer_name, status, source, portal_status, portal_notes, total_amount, notes, order_date, required_date)
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
      ${body.requiredDate ? new Date(body.requiredDate).toISOString() : null}
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

// ─── portal: browse products ─────────────────────────────────────────────────

router.get("/portal/products", portalAuth, async (req: Request, res: Response) => {
  const search = (req.query.search as string) || "";
  const rows = await db.execute(sql`
    SELECT p.id, p.name, p.sku, p.unit_price, p.image_url, p.category,
           (SELECT COUNT(*) FROM product_variants pv WHERE pv.product_id = p.id) as variant_count
    FROM products p
    WHERE p.status = 'active'
      AND (${search} = '' OR p.name ILIKE ${'%' + search + '%'})
    ORDER BY p.name
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ─── portal: wardrobe (customer finished items with employees) ───────────────

router.get("/portal/wardrobe", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;

  // Get all wardrobe items — JOIN to products and customer_roles for denormalised fields
  const finishes = await db.execute(sql`
    SELECT
      cf.id   AS finish_id,
      cf.name AS finish_name,
      cf.code AS finish_code,
      cfi.id,
      cfi.name,
      cfi.product_id,
      p.name  AS product_name,
      p.sku   AS product_sku,
      cfi.colour,
      cfi.size,
      cfi.unit_price,
      cfi.special_price,
      cfi.role_id,
      cr.name AS role_name
    FROM customer_finishes cf
    JOIN customer_finished_items cfi ON cfi.finish_id = cf.id
    LEFT JOIN products           p   ON p.id = cfi.product_id
    LEFT JOIN customer_roles     cr  ON cr.id = cfi.role_id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cf.name, cfi.name
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
      cp.code
    FROM customer_finish_processes cfp
    JOIN customer_processes     cp  ON cp.id = cfp.process_id
    JOIN customer_finishes      cf  ON cf.id = cfp.finish_id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cp.name
  `);

  // Get employees for this customer
  const employees = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.job_title, cr.id as role_id, cr.name as role_name
    FROM employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
    WHERE e.customer_id = ${customerId} AND e.status = 'active'
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
  await db.execute(sql`
    UPDATE orders SET portal_status = 'submitted', status = 'portal_pending', updated_at = now()
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
    WHERE o.source = 'portal' AND o.portal_status = 'pending'
    ORDER BY o.created_at DESC
  `);
  res.json(rows.rows);
});

// ─── admin: confirm portal order ─────────────────────────────────────────────

router.post("/portal/admin/orders/:id/confirm", async (req: Request, res: Response) => {
  const orderId = parseInt(req.params.id, 10);
  await db.execute(sql`
    UPDATE orders SET portal_status = 'confirmed', status = 'draft', updated_at = now()
    WHERE id = ${orderId} AND source = 'portal'
  `);
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

// ─── portal: team — employees (manager only) ─────────────────────────────────

router.get("/portal/team/employees", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const portalRole = (req as any).portalRole;
  if (portalRole !== "manager") { res.status(403).json({ error: "Manager access required" }); return; }

  const showInactive = req.query.showInactive === "true";

  const rows = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.email, e.phone, e.job_title,
           e.department, e.notes, e.is_active,
           cr.id as role_id, cr.name as role_name
    FROM customer_employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
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
