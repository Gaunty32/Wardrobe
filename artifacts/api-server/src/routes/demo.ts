import { Router, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getSmtpConfig } from "../services/email";
import nodemailer from "nodemailer";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const PORTAL_JWT_SECRET = process.env.PORTAL_JWT_SECRET ?? "portal-secret-change-me";
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

// ─── seed data (returned when real orders table is empty) ─────────────────────

const SEED_SUMMARY = {
  total_orders: "38", active_orders: "11", dispatched: "22",
  portal_pending: "4", month_value: "7840.00", total_value: "48920.00",
};

const SEED_BY_STATUS = [
  { status: "dispatched",    cnt: "22" },
  { status: "in_progress",   cnt: "8"  },
  { status: "invoiced",      cnt: "5"  },
  { status: "pending",       cnt: "3"  },
];

function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString();
}
function daysAhead(n: number) {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString();
}

const SEED_ORDERS: any[] = [
  { id: 9001, order_number: "ORD-2026-10389", customer_name: "Apex Facilities Group",    status: "dispatched",  total_amount: "487.50",  order_date: daysAgo(28), required_date: daysAgo(14),  source: "manual", po_number: "PO-AF-1822" },
  { id: 9002, order_number: "ORD-2026-10390", customer_name: "Meridian Services Ltd",    status: "invoiced",    total_amount: "1240.00", order_date: daysAgo(26), required_date: daysAgo(10),  source: "portal", po_number: null          },
  { id: 9003, order_number: "ORD-2026-10391", customer_name: "Pinnacle Care Solutions",  status: "dispatched",  total_amount: "632.00",  order_date: daysAgo(24), required_date: daysAgo(8),   source: "manual", po_number: "PO-PC-0012" },
  { id: 9004, order_number: "ORD-2026-10392", customer_name: "Vanguard Security",        status: "dispatched",  total_amount: "218.75",  order_date: daysAgo(22), required_date: daysAgo(7),   source: "manual", po_number: null          },
  { id: 9005, order_number: "ORD-2026-10393", customer_name: "Sterling Maintenance Co",  status: "invoiced",    total_amount: "3480.00", order_date: daysAgo(20), required_date: daysAgo(5),   source: "portal", po_number: "PO-SM-4471" },
  { id: 9006, order_number: "ORD-2026-10394", customer_name: "Horizon Logistics Ltd",   status: "dispatched",  total_amount: "765.00",  order_date: daysAgo(18), required_date: daysAgo(3),   source: "manual", po_number: null          },
  { id: 9007, order_number: "ORD-2026-10395", customer_name: "Crestview Property Mgmt", status: "dispatched",  total_amount: "1125.50", order_date: daysAgo(17), required_date: daysAgo(2),   source: "portal", po_number: "PO-CP-8810" },
  { id: 9008, order_number: "ORD-2026-10396", customer_name: "Nexus Engineering",        status: "in_progress", total_amount: "540.00",  order_date: daysAgo(14), required_date: daysAhead(3),  source: "manual", po_number: null          },
  { id: 9009, order_number: "ORD-2026-10397", customer_name: "Beacon Healthcare",        status: "dispatched",  total_amount: "920.00",  order_date: daysAgo(13), required_date: daysAgo(1),   source: "manual", po_number: "PO-BH-2291" },
  { id: 9010, order_number: "ORD-2026-10398", customer_name: "Atlas Building Services",  status: "dispatched",  total_amount: "340.00",  order_date: daysAgo(12), required_date: daysAgo(1),   source: "portal", po_number: null          },
  { id: 9011, order_number: "ORD-2026-10399", customer_name: "Redwood Facilities",       status: "in_progress", total_amount: "1870.00", order_date: daysAgo(10), required_date: daysAhead(5),  source: "manual", po_number: "PO-RF-6672" },
  { id: 9012, order_number: "ORD-2026-10400", customer_name: "Summit Corporate Services",status: "dispatched",  total_amount: "487.50",  order_date: daysAgo(9),  required_date: daysAgo(1),   source: "portal", po_number: null          },
  { id: 9013, order_number: "ORD-2026-10401", customer_name: "Cascade Contract Mgmt",   status: "dispatched",  total_amount: "655.00",  order_date: daysAgo(8),  required_date: daysAhead(1),  source: "manual", po_number: "PO-CC-0091" },
  { id: 9014, order_number: "ORD-2026-10402", customer_name: "Prestige Cleaning Group",  status: "in_progress", total_amount: "2100.00", order_date: daysAgo(7),  required_date: daysAhead(7),  source: "portal", po_number: null          },
  { id: 9015, order_number: "ORD-2026-10403", customer_name: "Keystone Facilities Ltd",  status: "in_progress", total_amount: "980.00",  order_date: daysAgo(6),  required_date: daysAhead(8),  source: "manual", po_number: "PO-KF-3388" },
  { id: 9016, order_number: "ORD-2026-10404", customer_name: "Eclipse Security",         status: "pending",     total_amount: "430.00",  order_date: daysAgo(5),  required_date: daysAhead(9),  source: "portal", po_number: null          },
  { id: 9017, order_number: "ORD-2026-10405", customer_name: "Axiom Property Solutions", status: "in_progress", total_amount: "1560.00", order_date: daysAgo(4),  required_date: daysAhead(10), source: "manual", po_number: "PO-AP-7741" },
  { id: 9018, order_number: "ORD-2026-10406", customer_name: "Paragon Site Services",    status: "in_progress", total_amount: "720.00",  order_date: daysAgo(3),  required_date: daysAhead(11), source: "portal", po_number: null          },
  { id: 9019, order_number: "ORD-2026-10407", customer_name: "Oaktree Maintenance",      status: "pending",     total_amount: "895.00",  order_date: daysAgo(2),  required_date: daysAhead(12), source: "manual", po_number: "PO-OM-5500" },
  { id: 9020, order_number: "ORD-2026-10408", customer_name: "Latitude Logistics",       status: "pending",     total_amount: "312.50",  order_date: daysAgo(1),  required_date: daysAhead(14), source: "portal", po_number: null          },
  { id: 9021, order_number: "ORD-2026-10409", customer_name: "Zenith Corporate Wear",    status: "in_progress", total_amount: "2400.00", order_date: daysAgo(1),  required_date: daysAhead(14), source: "manual", po_number: "PO-ZC-1199" },
  { id: 9022, order_number: "ORD-2026-10410", customer_name: "Monarch Facilities",       status: "dispatched",  total_amount: "567.00",  order_date: daysAgo(30), required_date: daysAgo(16),  source: "manual", po_number: null          },
  { id: 9023, order_number: "ORD-2026-10411", customer_name: "Torchlight Security",      status: "dispatched",  total_amount: "388.00",  order_date: daysAgo(32), required_date: daysAgo(18),  source: "portal", po_number: "PO-TS-8823" },
  { id: 9024, order_number: "ORD-2026-10412", customer_name: "Apex Facilities Group",    status: "invoiced",    total_amount: "1900.00", order_date: daysAgo(35), required_date: daysAgo(21),  source: "manual", po_number: "PO-AF-1798" },
  { id: 9025, order_number: "ORD-2026-10413", customer_name: "Meridian Services Ltd",    status: "dispatched",  total_amount: "675.00",  order_date: daysAgo(38), required_date: daysAgo(24),  source: "portal", po_number: null          },
  { id: 9026, order_number: "ORD-2026-10414", customer_name: "Pinnacle Care Solutions",  status: "invoiced",    total_amount: "2250.00", order_date: daysAgo(42), required_date: daysAgo(28),  source: "manual", po_number: "PO-PC-0008" },
  { id: 9027, order_number: "ORD-2026-10415", customer_name: "Sterling Maintenance Co",  status: "dispatched",  total_amount: "834.00",  order_date: daysAgo(45), required_date: daysAgo(31),  source: "portal", po_number: "PO-SM-4455" },
  { id: 9028, order_number: "ORD-2026-10416", customer_name: "Horizon Logistics Ltd",   status: "dispatched",  total_amount: "1100.00", order_date: daysAgo(48), required_date: daysAgo(34),  source: "manual", po_number: null          },
  { id: 9029, order_number: "ORD-2026-10417", customer_name: "Vanguard Security",        status: "dispatched",  total_amount: "445.00",  order_date: daysAgo(50), required_date: daysAgo(36),  source: "manual", po_number: "PO-VS-2211" },
  { id: 9030, order_number: "ORD-2026-10418", customer_name: "Nexus Engineering",        status: "dispatched",  total_amount: "1680.00", order_date: daysAgo(55), required_date: daysAgo(41),  source: "portal", po_number: null          },
  { id: 9031, order_number: "ORD-2026-10419", customer_name: "Beacon Healthcare",        status: "invoiced",    total_amount: "3100.00", order_date: daysAgo(60), required_date: daysAgo(46),  source: "manual", po_number: "PO-BH-2255" },
  { id: 9032, order_number: "ORD-2026-10420", customer_name: "Crestview Property Mgmt", status: "dispatched",  total_amount: "560.00",  order_date: daysAgo(63), required_date: daysAgo(49),  source: "portal", po_number: null          },
  { id: 9033, order_number: "ORD-2026-10421", customer_name: "Atlas Building Services",  status: "dispatched",  total_amount: "990.00",  order_date: daysAgo(66), required_date: daysAgo(52),  source: "manual", po_number: "PO-AB-6610" },
  { id: 9034, order_number: "ORD-2026-10422", customer_name: "Eclipse Security",         status: "dispatched",  total_amount: "720.00",  order_date: daysAgo(70), required_date: daysAgo(56),  source: "portal", po_number: null          },
  { id: 9035, order_number: "ORD-2026-10423", customer_name: "Redwood Facilities",       status: "dispatched",  total_amount: "1450.00", order_date: daysAgo(74), required_date: daysAgo(60),  source: "manual", po_number: "PO-RF-6640" },
  { id: 9036, order_number: "ORD-2026-10424", customer_name: "Prestige Cleaning Group",  status: "dispatched",  total_amount: "830.00",  order_date: daysAgo(78), required_date: daysAgo(64),  source: "portal", po_number: null          },
  { id: 9037, order_number: "ORD-2026-10425", customer_name: "Keystone Facilities Ltd",  status: "dispatched",  total_amount: "2200.00", order_date: daysAgo(82), required_date: daysAgo(68),  source: "manual", po_number: "PO-KF-3355" },
  { id: 9038, order_number: "ORD-2026-10426", customer_name: "Summit Corporate Services",status: "dispatched",  total_amount: "495.00",  order_date: daysAgo(86), required_date: daysAgo(72),  source: "portal", po_number: null          },
];

// ─── email ────────────────────────────────────────────────────────────────────

async function sendDemoEmail(lead: { firstName: string; lastName: string; email: string; company: string }) {
  // Use DB-backed SMTP (configured in Settings → Email)
  const config = await getSmtpConfig();
  if (!config) return { sent: false, error: "SMTP not configured" };

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.pass },
    tls: { rejectUnauthorized: false },
  });

  const from = `"${config.fromName}" <${config.fromEmail}>`;

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
        Thank you for taking the time to explore the Select Branding Solutions order management system. Your 48-hour demo access is now active — you can return to it at any time using the link below.
      </p>

      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#374151;">
        The demo gives you a live view of the system including orders, the staff portal, and the customer-facing wardrobe portal that your teams use to place orders directly.
      </p>

      <div style="text-align:center;margin:24px 0;">
        <a href="https://wardrobe.selectbranding.co.uk/demo" style="display:inline-block;background:#1e3a5f;color:#ffffff;font-size:15px;font-weight:600;padding:14px 28px;border-radius:8px;text-decoration:none;">
          Return to the demo →
        </a>
      </div>

      <div style="background:#f0f7ff;border-left:4px solid #1e3a5f;border-radius:4px;padding:16px 20px;margin:24px 0;">
        <p style="margin:0;font-size:14px;font-weight:600;color:#1e3a5f;">What's included in our service:</p>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:#374151;line-height:1.8;">
          <li>Branded wardrobe management &amp; order tracking</li>
          <li>Staff-facing customer portal for self-service ordering</li>
          <li>Full production, dispatch, and invoicing workflow</li>
          <li>DPD integration for automated shipping labels</li>
          <li>Real-time reporting &amp; order history</li>
        </ul>
      </div>

      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#374151;">Our team will be in touch shortly to walk you through a tailored demo for <strong>${lead.company}</strong> and discuss pricing.</p>

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

  const text = `Hi ${lead.firstName},\n\nYour 48-hour demo access is now active.\n\nReturn to the demo: https://wardrobe.selectbranding.co.uk/demo\n\nOur team will be in touch shortly to discuss how we can support ${lead.company}.\n\nWarm regards,\nThe Select Branding Solutions Team`;

  try {
    await transporter.sendMail({
      from,
      to: lead.email,
      cc: ["chris@selectbranding.co.uk", "james@selectuniforms.co.uk"],
      subject: `Your demo access for Select Branding Solutions is ready, ${lead.firstName}`,
      html,
      text,
    });
    return { sent: true };
  } catch (err: any) {
    return { sent: false, error: err.message };
  }
}

// ─── POST /api/demo/register ──────────────────────────────────────────────────

router.post("/demo/register", async (req: Request, res: Response) => {
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

  sendDemoEmail({ firstName, lastName, email, company }).catch(() => {});

  const token = jwt.sign(
    { isDemo: true, firstName, company },
    JWT_SECRET,
    { expiresIn: DEMO_TOKEN_TTL }
  );

  res.json({ token, firstName, company });
});

// ─── GET /api/demo/stats ──────────────────────────────────────────────────────

router.get("/demo/stats", demoAuth, async (_req: Request, res: Response) => {
  const countRow = await db.execute(sql`SELECT COUNT(*) AS cnt FROM orders`);
  const realCount = parseInt((countRow.rows[0] as any).cnt, 10);

  if (realCount === 0) {
    res.json({ summary: SEED_SUMMARY, byStatus: SEED_BY_STATUS, seeded: true });
    return;
  }

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

router.get("/demo/orders", demoAuth, async (req: Request, res: Response) => {
  const countRow = await db.execute(sql`SELECT COUNT(*) AS cnt FROM orders`);
  const realCount = parseInt((countRow.rows[0] as any).cnt, 10);

  if (realCount === 0) {
    const page  = Math.max(1, parseInt((req.query.page  as string) ?? "1", 10));
    const limit = 30;
    const offset = (page - 1) * limit;
    const paged = SEED_ORDERS.slice(offset, offset + limit);
    res.json({ orders: paged, total: SEED_ORDERS.length, seeded: true });
    return;
  }

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
  const total = (await db.execute(sql`
    SELECT COUNT(*) AS total FROM orders WHERE source != 'portal' OR status != 'portal_draft'
  `)).rows[0] as any;
  res.json({ orders: rows.rows, total: parseInt(total.total, 10) });
});

// ─── GET /api/demo/orders/:id ─────────────────────────────────────────────────

router.get("/demo/orders/:id", demoAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  // Return seeded order if ID is a seed ID
  if (id >= 9001 && id <= 9999) {
    const seed = SEED_ORDERS.find(o => o.id === id);
    if (!seed) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ...seed, notes: null, shipping_method: "DPD Next Day", attention_of: null, portal_status: null, items: [] });
    return;
  }

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

// ─── GET /api/demo/products ───────────────────────────────────────────────────

router.get("/demo/products", demoAuth, async (req: Request, res: Response) => {
  const search = (req.query.search as string) ?? "";
  const limit = 50;
  const offset = Math.max(0, parseInt((req.query.offset as string) ?? "0", 10));

  const rows = await db.execute(sql`
    SELECT p.id, p.name AS product_name, p.sku AS product_sku, p.category,
           p.unit_price,
           pc.name AS category_name,
           p.image_url
    FROM products p
    LEFT JOIN product_categories pc ON pc.name = p.category
    WHERE (${search} = '' OR p.name ILIKE ${'%' + search + '%'})
    ORDER BY pc.name NULLS LAST, p.name
    LIMIT ${limit} OFFSET ${offset}
  `);
  const countRow = await db.execute(sql`
    SELECT COUNT(*) AS total FROM products
    WHERE (${search} = '' OR name ILIKE ${'%' + search + '%'})
  `);
  res.json({ products: rows.rows, total: parseInt((countRow.rows[0] as any).total, 10) });
});

// ─── GET /api/demo/customers ──────────────────────────────────────────────────

router.get("/demo/customers", demoAuth, async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT c.id,
           regexp_replace(c.name, '[a-z]', '*', 'gi') AS name_masked,
           c.city,
           COUNT(o.id) AS order_count
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.name, c.city
    ORDER BY COUNT(o.id) DESC, c.name
    LIMIT 100
  `);
  res.json({ customers: rows.rows });
});

// ─── GET /api/demo/portal-preview ────────────────────────────────────────────

router.get("/demo/portal-preview", demoAuth, async (_req: Request, res: Response) => {
  // Find first customer that has finished items (their portal wardrobe is set up)
  const rows = await db.execute(sql`
    SELECT DISTINCT c.id, c.name
    FROM customers c
    JOIN customer_finished_items cfi ON cfi.customer_id = c.id
    LIMIT 1
  `);

  if (rows.rows.length === 0) {
    // Fall back to any customer
    const fallback = await db.execute(sql`SELECT id, name FROM customers LIMIT 1`);
    if (fallback.rows.length === 0) {
      res.status(404).json({ error: "No customers available for portal preview" });
      return;
    }
    rows.rows.push(fallback.rows[0]);
  }

  const customer = rows.rows[0] as any;
  const token = jwt.sign(
    { sub: customer.id, isStaffPreview: true, customerName: customer.name },
    PORTAL_JWT_SECRET,
    { expiresIn: "2h" }
  );

  const previewUrl = `/customer-portal/preview-login?token=${token}`;
  res.json({ previewUrl, customerName: customer.name, expiresIn: "2h" });
});

export default router;
