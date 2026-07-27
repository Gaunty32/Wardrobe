import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// ─── POST /wc-enquiries  (webhook called by the WooCommerce plugin) ───────────
router.post("/wc-enquiries", async (req: Request, res: Response): Promise<void> => {
  // Optional shared-secret check
  const settingsRows = await db.execute(sql`
    SELECT value FROM settings WHERE key = 'wc_enquiry_webhook_secret'
  `);
  const storedSecret: string | null =
    (settingsRows.rows[0] as any)?.value ?? null;

  if (storedSecret && storedSecret.trim() !== "") {
    const provided =
      (req.headers["x-sbs-secret"] as string | undefined) ?? "";
    if (provided !== storedSecret.trim()) {
      res.status(401).json({ error: "Invalid webhook secret" });
      return;
    }
  }

  const {
    product_id,
    product_name,
    customer_name,
    email,
    phone,
    message,
  } = req.body as Record<string, string>;

  if (!customer_name || !email || !message) {
    res.status(400).json({ error: "Missing required fields: customer_name, email, message" });
    return;
  }

  // Try to link to an existing customer by email
  const custRows = await db.execute(sql`
    SELECT id FROM customers WHERE LOWER(email) = LOWER(${email ?? ""}) LIMIT 1
  `);
  const customerId: number | null = (custRows.rows[0] as any)?.id ?? null;

  await db.execute(sql`
    INSERT INTO wc_enquiries
      (product_id, product_name, customer_name, email, phone, message, customer_id)
    VALUES (
      ${product_id ? Number(product_id) : null},
      ${product_name ?? null},
      ${customer_name},
      ${email},
      ${phone ?? null},
      ${message},
      ${customerId}
    )
  `);

  res.json({ ok: true });
});

// ─── GET /wc-enquiries  (order system list view) ──────────────────────────────
router.get("/wc-enquiries", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      e.id,
      e.product_id,
      e.product_name,
      e.customer_name,
      e.email,
      e.phone,
      e.message,
      e.customer_id,
      e.created_at,
      c.name AS linked_customer_name
    FROM wc_enquiries e
    LEFT JOIN customers c ON c.id = e.customer_id
    ORDER BY e.created_at DESC
    LIMIT 500
  `);
  res.json(rows.rows);
});

export default router;
