import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const DEFAULT_COVER_TEXT = `Hi there,

Thank you for your enquiry with Select Branding Solutions.

We've put together a quote based on our initial conversation, featuring the products and quantities we discussed.

Simply click the link below to view your items, adjust any quantities to suit your team's needs, and place your order when you're ready.

Please note: our garment pricing by default includes a left chest logo in print or embroidery. Should your logo require converting to stitches then a set-up cost of £35 will apply. Should you decide print is your preferred option then there is no set-up cost, as long as you are able to supply a hi-res file in EPS or PDF format.

Your branded workwear is a great opportunity to showcase your brand and we can enhance your workwear with additional logo applications. For example, a large rear logo up to A4 size can be applied for just £6 per garment.

Standard lead time is 7 days. All prices are subject to carriage and VAT.

If you have any questions or would like to make any changes before ordering, please don't hesitate to get in touch — we're always happy to help.

Kind regards,

The Select Branding Solutions Team
T: 0113 255 2694
E: info@selectbranding.co.uk
W: www.selectbranding.co.uk`;

// ─── camelCase helpers ────────────────────────────────────────────────────────
function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function rowToCamel(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [snakeToCamel(k), v]));
}
function quoteToCamel(row: any, items?: any[]) {
  const r = rowToCamel(row);
  if (items !== undefined) r.items = items.map(rowToCamel);
  return r;
}

// ─── List quotes ──────────────────────────────────────────────────────────────
router.get("/quotes", async (_req, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      q.id, q.quote_number, q.customer_id, q.customer_name, q.status,
      q.notes, q.expires_at, q.token, q.created_at, q.updated_at,
      COUNT(qi.id)::int AS item_count,
      COALESCE(SUM(qi.quantity * qi.unit_price), 0)::numeric AS total_ex_vat
    FROM quotes q
    LEFT JOIN quote_items qi ON qi.quote_id = q.id
    GROUP BY q.id
    ORDER BY q.created_at DESC
  `);
  res.json((rows.rows as any[]).map(rowToCamel));
});

// ─── Create quote ─────────────────────────────────────────────────────────────
const CreateSchema = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  enquiryId: z.number().int().positive().nullable().optional(),
  customerName: z.string().min(1),
  notes: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
});

router.post("/quotes", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { customerId, enquiryId, customerName, notes, expiresAt } = parsed.data;

  // Auto-fill logo from linked customer
  let customerLogoUrl: string | null = null;
  if (customerId) {
    const custRows = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${customerId}`);
    customerLogoUrl = (custRows.rows[0] as any)?.logo_url ?? null;
  }

  const seqRows = await db.execute(sql`SELECT nextval('quote_number_seq') AS n`);
  const n = Number((seqRows.rows[0] as any).n);
  const quoteNumber = `Q${String(n).padStart(3, "0")}`;

  const result = await db.execute(sql`
    INSERT INTO quotes (quote_number, customer_id, enquiry_id, customer_name, notes, cover_text, expires_at, customer_logo_url)
    VALUES (${quoteNumber}, ${customerId ?? null}, ${enquiryId ?? null}, ${customerName}, ${notes ?? null}, ${DEFAULT_COVER_TEXT}, ${expiresAt ? new Date(expiresAt) : null}, ${customerLogoUrl})
    RETURNING *
  `);
  res.status(201).json(quoteToCamel(result.rows[0] as any));
});

// ─── Get quote detail ─────────────────────────────────────────────────────────
router.get("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  const items = (await db.execute(sql`SELECT * FROM quote_items WHERE quote_id = ${id} ORDER BY sort_order, id`)).rows;
  res.json(quoteToCamel(quote, items as any[]));
});

// ─── Update quote ─────────────────────────────────────────────────────────────
const UpdateSchema = z.object({
  customerName: z.string().min(1).optional(),
  customerId: z.number().int().positive().nullable().optional(),
  status: z.enum(["draft", "sent", "viewed", "ordered", "expired"]).optional(),
  notes: z.string().nullable().optional(),
  coverText: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  customerLogoUrl: z.string().nullable().optional(),
});

router.patch("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = (await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`)).rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Quote not found" }); return; }

  const d = parsed.data;
  const result = await db.execute(sql`
    UPDATE quotes SET
      customer_name      = ${d.customerName ?? existing.customer_name},
      customer_id        = ${d.customerId !== undefined ? d.customerId : existing.customer_id},
      status             = ${d.status ?? existing.status},
      notes              = ${d.notes !== undefined ? d.notes : existing.notes},
      cover_text         = ${d.coverText !== undefined ? d.coverText : existing.cover_text},
      expires_at         = ${d.expiresAt !== undefined ? (d.expiresAt ? new Date(d.expiresAt) : null) : existing.expires_at},
      customer_logo_url  = ${d.customerLogoUrl !== undefined ? d.customerLogoUrl : existing.customer_logo_url},
      updated_at         = now()
    WHERE id = ${id}
    RETURNING *
  `);
  res.json(quoteToCamel(result.rows[0] as any));
});

// ─── Delete quote ─────────────────────────────────────────────────────────────
router.delete("/quotes/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.execute(sql`DELETE FROM quotes WHERE id = ${id}`);
  res.json({ ok: true });
});

// ─── Add item ─────────────────────────────────────────────────────────────────
const ItemSchema = z.object({
  productId: z.number().int().positive().nullable().optional(),
  productName: z.string().min(1),
  colour: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  finishId: z.number().int().positive().nullable().optional(),
  finishName: z.string().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().min(0).default(0),
  vatRate: z.number().min(0).max(1).default(0.20),
  notes: z.string().nullable().optional(),
  productUrl: z.string().nullable().optional(),
});

router.post("/quotes/:id/items", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  if (isNaN(quoteId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const parsed = ItemSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const result = await db.execute(sql`
    INSERT INTO quote_items (quote_id, product_id, product_name, colour, size, finish_id, finish_name, quantity, unit_price, vat_rate, notes, product_url)
    VALUES (${quoteId}, ${d.productId ?? null}, ${d.productName}, ${d.colour ?? null}, ${d.size ?? null},
            ${d.finishId ?? null}, ${d.finishName ?? null}, ${d.quantity}, ${d.unitPrice}, ${d.vatRate}, ${d.notes ?? null}, ${d.productUrl ?? null})
    RETURNING *
  `);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.status(201).json(rowToCamel(result.rows[0] as any));
});

// ─── Update item ──────────────────────────────────────────────────────────────
router.patch("/quotes/:id/items/:itemId", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  if (isNaN(quoteId) || isNaN(itemId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = ItemSchema.partial().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const existing = (await db.execute(sql`SELECT * FROM quote_items WHERE id = ${itemId} AND quote_id = ${quoteId}`)).rows[0] as any;
  if (!existing) { res.status(404).json({ error: "Item not found" }); return; }

  const d = parsed.data;
  const result = await db.execute(sql`
    UPDATE quote_items SET
      product_name = ${d.productName ?? existing.product_name},
      colour       = ${d.colour !== undefined ? d.colour : existing.colour},
      size         = ${d.size !== undefined ? d.size : existing.size},
      finish_name  = ${d.finishName !== undefined ? d.finishName : existing.finish_name},
      quantity     = ${d.quantity ?? existing.quantity},
      unit_price   = ${d.unitPrice ?? existing.unit_price},
      notes        = ${d.notes !== undefined ? d.notes : existing.notes}
    WHERE id = ${itemId} AND quote_id = ${quoteId}
    RETURNING *
  `);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.json(rowToCamel(result.rows[0] as any));
});

// ─── Delete item ──────────────────────────────────────────────────────────────
router.delete("/quotes/:id/items/:itemId", async (req: Request, res: Response): Promise<void> => {
  const quoteId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  if (isNaN(quoteId) || isNaN(itemId)) { res.status(400).json({ error: "Invalid ID" }); return; }
  await db.execute(sql`DELETE FROM quote_items WHERE id = ${itemId} AND quote_id = ${quoteId}`);
  await db.execute(sql`UPDATE quotes SET updated_at = now() WHERE id = ${quoteId}`);
  res.json({ ok: true });
});

export default router;
