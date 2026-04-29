import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const DEMO_TOKEN_TTL = "48h";

// ─── demo auth middleware ──────────────────────────────────────────────────────

function demoAuth(req: Request, res: Response, next: () => void) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any;
    if (!payload.isDemo) { res.status(403).json({ error: "Demo token required" }); return; }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired demo token" });
  }
}

// ─── email ────────────────────────────────────────────────────────────────────

async function sendDemoEmail(lead: { firstName: string; lastName: string; email: string; company: string }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpHost || !smtpUser || !smtpPass) return { sent: false, error: "SMTP not configured" };

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: parseInt(process.env.SMTP_PORT ?? "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: smtpUser, pass: smtpPass },
  });

  const from = process.env.SMTP_FROM ?? `"Select Branding Solutions" <${smtpUser}>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f8fafc;color:#1e293b;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">

    <div style="background:#1e3a5f;padding:28px 32px;">
      <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">Select Branding Solutions</p>
      <p style="margin:4px 0 0;font-size:13px;color:#93c5fd;">Effortless uniform management, from order to delivery</p>
    </div>

    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Hi ${lead.firstName},</p>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
        Thank you for taking the time to explore the Select Branding Solutions order management system. We hope the demo gives you a clear picture of how we can streamline your uniform ordering process.
      </p>

      <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#374151;">
        Our team will be in touch shortly to answer any questions and discuss how we can tailor the system to <strong>${lead.company}</strong>'s specific needs.
      </p>

      <div style="background:#f0f7ff;border-left:4px solid #1e3a5f;border-radius:4px;padding:16px 20px;margin:24px 0;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#1e3a5f;">What's included in our service:</p>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#374151;line-height:1.8;">
          <li>Branded wardrobe management & order tracking</li>
          <li>Staff-facing customer portal for self-service ordering</li>
          <li>Full production, dispatch, and invoicing workflow</li>
          <li>DPD integration for automated shipping labels</li>
          <li>Real-time reporting & order history</li>
        </ul>
      </div>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        In the meantime, feel free to explore the demo further. Your access link is valid for 48 hours.
      </p>

      <p style="margin:0;font-size:15px;line-height:1.6;color:#374151;">Warm regards,</p>
      <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#1e3a5f;">The Select Branding Solutions Team</p>
    </div>

    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
      <p style="margin:0;font-size:12px;color:#94a3b8;text-align:center;">
        Select Branding Solutions Ltd · <a href="https://selectbranding.co.uk" style="color:#1e3a5f;text-decoration:none;">selectbranding.co.uk</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  const text = `Hi ${lead.firstName},\n\nThank you for exploring the Select Branding Solutions order management system. Our team will be in touch shortly to discuss how we can support ${lead.company}.\n\nWarm regards,\nThe Select Branding Solutions Team`;

  try {
    await transporter.sendMail({
      from,
      to: lead.email,
      cc: ["chris@selectbranding.co.uk", "james@selectuniforms.co.uk"],
      subject: `Thanks for exploring Select Branding Solutions, ${lead.firstName}`,
      html,
      text,
    });
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

// ─── POST /api/demo/register ──────────────────────────────────────────────────

router.post("/api/demo/register", async (req: Request, res: Response) => {
  const body = z.object({
    firstName: z.string().min(1).max(80),
    lastName:  z.string().min(1).max(80),
    email:     z.string().email(),
    company:   z.string().min(1).max(120),
  }).safeParse(req.body);

  if (!body.success) {
    res.status(400).json({ error: "Please fill in all fields correctly." });
    return;
  }

  const { firstName, lastName, email, company } = body.data;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;

  await db.execute(sql`
    INSERT INTO demo_leads (first_name, last_name, email, company, ip)
    VALUES (${firstName}, ${lastName}, ${email}, ${company}, ${ip})
  `);

  // Fire-and-forget email (don't block the response on SMTP)
  sendDemoEmail({ firstName, lastName, email, company }).catch(() => {});

  const token = jwt.sign(
    { isDemo: true, firstName, company },
    JWT_SECRET,
    { expiresIn: DEMO_TOKEN_TTL }
  );

  res.json({ token, firstName, company });
});

// ─── GET /api/demo/stats ──────────────────────────────────────────────────────

router.get("/api/demo/stats", demoAuth, async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      COUNT(*)                                                              AS total_orders,
      COUNT(*) FILTER (WHERE status IN ('pending','in_progress'))          AS active_orders,
      COUNT(*) FILTER (WHERE status = 'dispatched')                        AS dispatched,
      COUNT(*) FILTER (WHERE status = 'portal_pending')                    AS portal_pending,
      COALESCE(SUM(total_amount::numeric) FILTER (
        WHERE order_date >= date_trunc('month', now())
      ), 0)                                                                 AS month_value,
      COALESCE(SUM(total_amount::numeric), 0)                              AS total_value
    FROM orders
    WHERE source != 'portal' OR status != 'portal_draft'
  `);
  const statusRows = await db.execute(sql`
    SELECT status, COUNT(*) AS cnt
    FROM orders
    WHERE source != 'portal' OR status != 'portal_draft'
    GROUP BY status
    ORDER BY cnt DESC
    LIMIT 10
  `);
  res.json({ summary: rows.rows[0], byStatus: statusRows.rows });
});

// ─── GET /api/demo/orders ─────────────────────────────────────────────────────

router.get("/api/demo/orders", demoAuth, async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1", 10));
  const limit = 30;
  const offset = (page - 1) * limit;

  const rows = await db.execute(sql`
    SELECT id, order_number, customer_name, status, total_amount, order_date, required_date, source, po_number
    FROM orders
    WHERE source != 'portal' OR status != 'portal_draft'
    ORDER BY order_date DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const countRow = await db.execute(sql`
    SELECT COUNT(*) AS total FROM orders WHERE source != 'portal' OR status != 'portal_draft'
  `);
  res.json({ orders: rows.rows, total: parseInt((countRow.rows[0] as any).total, 10) });
});

// ─── GET /api/demo/orders/:id ─────────────────────────────────────────────────

router.get("/api/demo/orders/:id", demoAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const orderRows = await db.execute(sql`
    SELECT id, order_number, customer_name, status, total_amount, order_date, required_date,
           source, po_number, notes, shipping_method, attention_of, portal_status
    FROM orders WHERE id = ${id} LIMIT 1
  `);
  if (orderRows.rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }

  const itemRows = await db.execute(sql`
    SELECT id, product_name, colour, size, quantity, unit_price, line_total,
           recipient_name, finish_name
    FROM order_items WHERE order_id = ${id} ORDER BY id
  `);

  res.json({ ...orderRows.rows[0], items: itemRows.rows });
});

export default router;
