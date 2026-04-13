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

const router: IRouter = Router();

const JWT_SECRET = process.env.PORTAL_JWT_SECRET || "sbs-portal-secret-change-in-production";
const INVITE_TTL_DAYS = 7;

// ─── helpers ────────────────────────────────────────────────────────────────

function signToken(userId: number, customerId: number) {
  return jwt.sign({ sub: userId, customerId }, JWT_SECRET, { expiresIn: "30d" });
}

export async function portalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(authHeader.slice(7), JWT_SECRET) as { sub: number; customerId: number };
    (req as any).portalUserId = payload.sub;
    (req as any).portalCustomerId = payload.customerId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── admin: send invite ──────────────────────────────────────────────────────

router.post("/portal/admin/invite", async (req: Request, res: Response) => {
  const { customerId, email } = z.object({
    customerId: z.number().int().positive(),
    email: z.string().email(),
  }).parse(req.body);

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000);

  // upsert: update if email already exists for this customer
  await db.execute(sql`
    INSERT INTO customer_portal_users (customer_id, email, invite_token, invite_expires_at, status)
    VALUES (${customerId}, ${email}, ${token}, ${expires.toISOString()}, 'invited')
    ON CONFLICT (email) DO UPDATE
      SET invite_token = ${token},
          invite_expires_at = ${expires.toISOString()},
          status = 'invited',
          updated_at = now()
  `);

  // Return the token so the admin can copy/send the link
  const inviteUrl = `/customer-portal/accept-invite?token=${token}`;
  res.json({ inviteUrl, token, email, expiresAt: expires });
});

// ─── admin: list portal users for a customer ──────────────────────────────

router.get("/portal/admin/users/:customerId", async (req: Request, res: Response) => {
  const customerId = parseInt(req.params.customerId, 10);
  const rows = await db.execute(sql`
    SELECT id, email, status, last_login_at, created_at,
           invite_expires_at,
           CASE WHEN invite_token IS NOT NULL THEN true ELSE false END as has_pending_invite
    FROM customer_portal_users
    WHERE customer_id = ${customerId}
    ORDER BY created_at DESC
  `);
  res.json(rows.rows);
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

  const jwtToken = signToken(user.id, user.customer_id);
  res.json({ token: jwtToken, customerId: user.customer_id });
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

  const token = signToken(user.id, user.customer_id);

  // Get customer name
  const custRows = await db.execute(sql`SELECT name FROM customers WHERE id = ${user.customer_id}`);
  const customerName = (custRows.rows[0] as any)?.name ?? "";

  res.json({ token, customerId: user.customer_id, customerName, email: user.email });
});

// ─── me ──────────────────────────────────────────────────────────────────────

router.get("/portal/auth/me", portalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const userId = (req as any).portalUserId;

  const userRows = await db.execute(sql`
    SELECT id, email, status, last_login_at FROM customer_portal_users WHERE id = ${userId}
  `);
  const custRows = await db.execute(sql`SELECT id, name FROM customers WHERE id = ${customerId}`);

  res.json({
    user: userRows.rows[0],
    customer: custRows.rows[0],
  });
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

  const orderResult = await db.execute(sql`
    INSERT INTO orders (order_number, customer_id, customer_name, status, source, portal_status, portal_notes, total_amount, notes, order_date, required_date)
    VALUES (
      ${orderNumber},
      ${customerId},
      ${customerName},
      'portal_pending',
      'portal',
      'pending',
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

  // Get all wardrobe items grouped by finish (garment package)
  const finishes = await db.execute(sql`
    SELECT
      cf.id as finish_id, cf.name as finish_name, cf.code as finish_code,
      cfi.id, cfi.name, cfi.product_id, cfi.product_name, cfi.product_sku,
      cfi.colour, cfi.size, cfi.unit_price, cfi.special_price,
      cfi.finish_id as item_finish_id, cfi.finish_name as item_finish_name,
      cfi.role_id, cfi.role_name
    FROM customer_finishes cf
    JOIN customer_finished_items cfi ON cfi.finish_id = cf.id
    WHERE cf.customer_id = ${customerId}
    ORDER BY cf.name, cfi.name
  `);

  // Get employees for this customer
  const employees = await db.execute(sql`
    SELECT e.id, e.first_name, e.last_name, e.job_title, cr.id as role_id, cr.name as role_name
    FROM employees e
    LEFT JOIN customer_roles cr ON cr.id = e.role_id
    WHERE e.customer_id = ${customerId} AND e.status = 'active'
    ORDER BY e.last_name, e.first_name
  `);

  res.json({
    items: finishes.rows,
    employees: employees.rows,
  });
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

export default router;
