import { Router, Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateQuotePdf, fetchLogoBuffer, fetchLogoDataUrl, buildQuoteEmail, sendEmail, isEmailConfigured, type QuotePdfItem } from "../services/email.js";

const router = Router();

const DEFAULT_COVER_TEXT = `Hi {firstName},

Thank you for the opportunity to quote for {businessName}.

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

  const quoteRows = await db.execute(sql`
    SELECT q.*,
      c.contact_first_name, c.contact_last_name, c.phone AS customer_phone, c.email AS customer_email,
      c.high_level_contact_id
    FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id
    WHERE q.id = ${id}
  `);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // If contact fields are missing but we have a High Level contact ID, fetch fresh from HL
  const needsHlFetch = quote.customer_id && quote.high_level_contact_id &&
    (!quote.contact_first_name && !quote.contact_last_name && !quote.customer_phone && !quote.customer_email);

  if (needsHlFetch) {
    try {
      const settingsRows = await db.execute(sql`
        SELECT key, value FROM settings WHERE key = 'high_level_api_key'
      `);
      const apiKey = (settingsRows.rows[0] as any)?.value as string | undefined;
      if (apiKey) {
        const hlRes = await fetch(
          `https://services.leadconnectorhq.com/contacts/${quote.high_level_contact_id}`,
          { headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" } }
        );
        if (hlRes.ok) {
          const hlData = await hlRes.json() as any;
          const c = hlData?.contact;
          if (c) {
            quote.contact_first_name = c.firstName ?? null;
            quote.contact_last_name  = c.lastName  ?? null;
            quote.customer_phone     = c.phone      ?? null;
            quote.customer_email     = c.email      ?? null;
            // Persist back so future loads are instant
            await db.execute(sql`
              UPDATE customers SET
                contact_first_name = ${c.firstName ?? null},
                contact_last_name  = ${c.lastName  ?? null},
                phone              = ${c.phone      ?? null},
                email              = COALESCE(email, ${c.email ?? null})
              WHERE id = ${quote.customer_id}
            `);
          }
        }
      }
    } catch (err: any) {
      console.error("[quotes/:id] HL contact fetch failed:", err.message);
    }
  }

  const itemRows = await db.execute(sql`
    SELECT qi.*, p.sku AS product_sku
    FROM quote_items qi
    LEFT JOIN products p ON p.id = qi.product_id
      OR (qi.product_id IS NULL AND p.sku IS NOT NULL AND qi.product_name LIKE (p.sku || ' %'))
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);
  const base = quoteToCamel(quote, itemRows.rows as any[]);
  res.json({
    ...base,
    contactFirstName: quote.contact_first_name ?? null,
    contactLastName:  quote.contact_last_name  ?? null,
    customerPhone:    quote.customer_phone      ?? null,
    customerEmail:    quote.customer_email      ?? null,
  });
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

// ─── Quote PDF ────────────────────────────────────────────────────────────────
router.get("/quotes/:id/pdf", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // Fetch items joined with products for image_url, description, sku.
  // LATERAL JOIN with LIMIT 1 ensures exactly one product per item row and
  // handles four naming conventions in priority order:
  //   0 – direct product_id match
  //   1 – quote item name starts with product SKU  ("UC122 Ladies Classic Polo")
  //   2 – product name = SKU + " " + quote item name ("UC122" + " " + "Ladies Classic Polo")
  //   3 – exact product name match
  const itemRows = await db.execute(sql`
    SELECT
      qi.id, qi.product_name, qi.product_url, qi.colour, qi.size, qi.finish_name,
      qi.quantity, qi.unit_price, qi.vat_rate, qi.notes,
      p.sku         AS product_sku,
      p.description AS product_description,
      p.image_url   AS product_image_url,
      p.permalink   AS product_permalink
    FROM quote_items qi
    LEFT JOIN LATERAL (
      SELECT p2.sku, p2.description, p2.image_url, p2.permalink,
             CASE
               WHEN p2.id = qi.product_id                                                              THEN 0
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND qi.product_name ILIKE (p2.sku || ' %')                                         THEN 1
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name)                      THEN 2
               WHEN qi.product_id IS NULL
                    AND LOWER(p2.name) = LOWER(qi.product_name)                                        THEN 3
               ELSE 99
             END AS match_rank
      FROM products p2
      WHERE p2.id = qi.product_id
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL AND qi.product_name ILIKE (p2.sku || ' %'))
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL
             AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name))
         OR (qi.product_id IS NULL AND LOWER(p2.name) = LOWER(qi.product_name))
      ORDER BY match_rank ASC
      LIMIT 1
    ) p ON true
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);
  const rows = itemRows.rows as any[];

  // Fetch all product images in parallel (deduplicated by URL)
  const uniqueUrls = [...new Set(rows.map((r) => r.product_image_url).filter(Boolean))] as string[];
  const imageMap = new Map<string, Buffer | null>();
  await Promise.all(uniqueUrls.map(async (url) => {
    imageMap.set(url, await fetchLogoBuffer(url));
  }));

  const items: QuotePdfItem[] = rows.map((r) => ({
    productName:  r.product_name,
    productUrl:   r.product_url ?? r.product_permalink ?? null,
    sku:          r.product_sku ?? null,
    description:  r.product_description ?? null,
    colour:       r.colour ?? null,
    size:         r.size ?? null,
    finishName:   r.finish_name ?? null,
    quantity:     Number(r.quantity),
    unitPrice:    Number(r.unit_price),
    vatRate:      Number(r.vat_rate ?? 0.20),
    imageBuffer:  r.product_image_url ? (imageMap.get(r.product_image_url) ?? null) : null,
  }));

  // Resolve logo: use what's stored on the quote, otherwise fall back to the
  // customer's current logo (handles quotes created before logo was set).
  let resolvedLogoUrl: string | null = quote.customer_logo_url ?? null;
  if (!resolvedLogoUrl && quote.customer_id) {
    const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
    resolvedLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
  }
  const customerLogoBuffer = await fetchLogoBuffer(resolvedLogoUrl);

  const pdf = await generateQuotePdf({
    quoteNumber:        quote.quote_number,
    customerName:       quote.customer_name,
    quoteDate:          quote.created_at,
    expiresAt:          quote.expires_at ?? null,
    notes:              quote.notes ?? null,
    items,
    customerLogoBuffer,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="Quote-${quote.quote_number}.pdf"`);
  res.send(pdf);
});

// ─── Send quote email ─────────────────────────────────────────────────────────
router.post("/quotes/:id/send", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const body = z.object({
    toEmail: z.string().optional(),
    previewOnly: z.boolean().optional(),
  }).safeParse(req.body);

  const quoteRows = await db.execute(sql`SELECT * FROM quotes WHERE id = ${id}`);
  const quote = quoteRows.rows[0] as any;
  if (!quote) { res.status(404).json({ error: "Quote not found" }); return; }

  // Fetch items joined with products (same LATERAL match strategy as PDF route)
  const itemRows = await db.execute(sql`
    SELECT qi.product_name, qi.colour, qi.size, qi.finish_name, qi.quantity, qi.unit_price, qi.vat_rate,
           p.sku AS product_sku
    FROM quote_items qi
    LEFT JOIN LATERAL (
      SELECT p2.sku,
             CASE
               WHEN p2.id = qi.product_id                                                              THEN 0
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND qi.product_name ILIKE (p2.sku || ' %')                                         THEN 1
               WHEN qi.product_id IS NULL AND p2.sku IS NOT NULL
                    AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name)                      THEN 2
               WHEN qi.product_id IS NULL
                    AND LOWER(p2.name) = LOWER(qi.product_name)                                        THEN 3
               ELSE 99
             END AS match_rank
      FROM products p2
      WHERE p2.id = qi.product_id
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL AND qi.product_name ILIKE (p2.sku || ' %'))
         OR (qi.product_id IS NULL AND p2.sku IS NOT NULL
             AND LOWER(p2.name) = LOWER(p2.sku || ' ' || qi.product_name))
         OR (qi.product_id IS NULL AND LOWER(p2.name) = LOWER(qi.product_name))
      ORDER BY match_rank ASC
      LIMIT 1
    ) p ON true
    WHERE qi.quote_id = ${id}
    ORDER BY qi.sort_order, qi.id
  `);
  const items = (itemRows.rows as any[]).map(r => ({
    productName: r.product_sku ? `${r.product_sku} ${r.product_name}` : r.product_name,
    colour: r.colour ?? null,
    size: r.size ?? null,
    finishName: r.finish_name ?? null,
    quantity: Number(r.quantity),
    unitPrice: Number(r.unit_price),
    vatRate: Number(r.vat_rate ?? 0.20),
  }));

  // Resolve customer email
  let toEmail: string | undefined = body.success ? body.data.toEmail : undefined;
  let contactFirstName: string | null = null;

  if (!toEmail && quote.customer_id) {
    // Prefer manager/dept_manager portal users
    const managerRows = await db.execute(sql`
      SELECT email FROM customer_portal_users
      WHERE customer_id = ${quote.customer_id}
        AND portal_role IN ('manager', 'dept_manager')
        AND email IS NOT NULL
      ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
    `);
    const managerEmails = (managerRows.rows as Array<{ email: string }>).map(r => r.email).filter(Boolean);
    if (managerEmails.length > 0) {
      toEmail = managerEmails.join(", ");
    } else {
      const custRows = await db.execute(sql`SELECT email, contact_first_name FROM customers WHERE id = ${quote.customer_id}`);
      const cust = custRows.rows[0] as any;
      toEmail = cust?.email ?? undefined;
      contactFirstName = cust?.contact_first_name ?? null;
    }
  }

  // Resolve contact first name if still unknown — match first email against customer_contacts
  if (!contactFirstName && quote.customer_id && toEmail) {
    const firstEmail = toEmail.split(",")[0].trim();
    const ccRows = await db.execute(sql`
      SELECT first_name FROM customer_contacts
      WHERE customer_id = ${quote.customer_id} AND LOWER(email) = LOWER(${firstEmail})
      LIMIT 1
    `);
    contactFirstName = (ccRows.rows[0] as any)?.first_name ?? null;
  }
  // Final fallback: customers.contact_first_name
  if (!contactFirstName && quote.customer_id) {
    const cfRows = await db.execute(sql`SELECT contact_first_name FROM customers WHERE id = ${quote.customer_id}`);
    contactFirstName = (cfRows.rows[0] as any)?.contact_first_name ?? null;
  }

  if (!toEmail && !body.data?.previewOnly) {
    res.status(400).json({ error: "No customer email address found — enter one manually." }); return;
  }

  // Build portal link
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "wardrobe.selectbranding.co.uk";
  const protocol = (req.get("x-forwarded-proto") ?? req.protocol ?? "https").split(",")[0].trim();
  const portalLink = `${protocol}://${host}/customer-portal/orders/new?quote=${quote.token}`;

  const coverText = (quote.cover_text as string | null) ?? DEFAULT_COVER_TEXT;

  // Resolve logo URL (quote's own field, else customer record fallback)
  let emailLogoUrl: string | null = quote.customer_logo_url ?? null;
  if (!emailLogoUrl && quote.customer_id) {
    const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
    emailLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
  }
  const customerLogoDataUrl = await fetchLogoDataUrl(emailLogoUrl);

  const { subject, html, text } = buildQuoteEmail({
    quoteNumber: quote.quote_number,
    customerName: quote.customer_name ?? null,
    contactFirstName,
    customerLogoDataUrl,
    quoteDate: quote.created_at,
    expiresAt: quote.expires_at ?? null,
    notes: null, // internal notes — not sent to customer
    coverText,
    portalLink,
    items,
  });

  // Generate PDF attachment
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  try {
    const pdfItems: QuotePdfItem[] = (itemRows.rows as any[]).map(r => ({
      productName: r.product_name,
      productUrl: null,
      sku: r.product_sku ?? null,
      description: null,
      colour: r.colour ?? null,
      size: r.size ?? null,
      finishName: r.finish_name ?? null,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      vatRate: Number(r.vat_rate ?? 0.20),
      imageBuffer: null,
    }));
    let sendLogoUrl: string | null = quote.customer_logo_url ?? null;
    if (!sendLogoUrl && quote.customer_id) {
      const custLogo = await db.execute(sql`SELECT logo_url FROM customers WHERE id = ${quote.customer_id}`);
      sendLogoUrl = (custLogo.rows[0] as any)?.logo_url ?? null;
    }
    const customerLogoBuffer = await fetchLogoBuffer(sendLogoUrl);
    const pdfBuffer = await generateQuotePdf({
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name ?? "",
      quoteDate: quote.created_at,
      expiresAt: quote.expires_at ?? null,
      notes: null,
      items: pdfItems,
      customerLogoBuffer,
    });
    attachments = [{ filename: `Quote-${quote.quote_number}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (_err) {
    // Non-fatal — email sends without attachment
  }

  const previewOnly = body.success ? (body.data.previewOnly ?? false) : false;
  const result = previewOnly
    ? { sent: false as const, error: null as string | null }
    : await sendEmail({ to: toEmail!, subject, html, text, attachments });

  // Update status to "sent" if still draft (and not preview)
  if (!previewOnly && result.sent && quote.status === "draft") {
    await db.execute(sql`UPDATE quotes SET status = 'sent', updated_at = now() WHERE id = ${id}`);
  }

  res.json({
    sent: result.sent,
    error: result.error,
    subject,
    html,
    text,
    to: toEmail ?? "",
    emailConfigured: isEmailConfigured,
    portalLink,
  });
});

export default router;
