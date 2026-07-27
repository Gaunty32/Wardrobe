import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../services/email.js";
import { getUncachableStripeClient, getStripePublishableKey } from "../services/stripeClient.js";

const router: IRouter = Router();

// ── WooCommerce proxy helpers ─────────────────────────────────────────────────

interface WcCreds { url: string; ck: string; cs: string; }
let _wcCredsCache: WcCreds | null = null;

async function getWcCreds(): Promise<WcCreds> {
  if (_wcCredsCache) return _wcCredsCache;
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) if (r.value) map[r.key] = r.value;
  _wcCredsCache = {
    url: (map["woo_url"] ?? "").replace(/\/$/, ""),
    ck: map["woo_consumer_key"] ?? "",
    cs: map["woo_consumer_secret"] ?? "",
  };
  return _wcCredsCache;
}

async function wcFetch(path: string, params: Record<string, string> = {}): Promise<any> {
  const { url, ck, cs } = await getWcCreds();
  const u = new URL(`${url}/wp-json/wc/v3${path}`);
  u.searchParams.set("consumer_key", ck);
  u.searchParams.set("consumer_secret", cs);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") u.searchParams.set(k, v);
  const res = await fetch(u.toString());
  if (!res.ok) throw new Error(`WC API ${path} returned ${res.status}`);
  return res.json();
}

// Simple 5-minute in-memory cache for WC responses
const wcCache = new Map<string, { data: any; expiresAt: number }>();
async function wcFetchCached(path: string, params: Record<string, string> = {}, ttlMs = 300_000): Promise<any> {
  const key = path + JSON.stringify(params);
  const cached = wcCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = await wcFetch(path, params);
  wcCache.set(key, { data, expiresAt: Date.now() + ttlMs });
  return data;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  return map[key] ?? null;
}

async function getAllSettings(): Promise<Record<string, string | null>> {
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string | null> = {};
  for (const r of rows) map[r.key] = r.value;
  return map;
}

function parseJsonArray(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  try { const parsed = JSON.parse(String(val)); return Array.isArray(parsed) ? parsed.map(String) : []; }
  catch { return []; }
}

function fmtShopProduct(p: any): object {
  const imageUrl = p.image_url ?? null;
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    description: p.description ?? null,
    unitPrice: p.unit_price != null ? parseFloat(String(p.unit_price)) : 0,
    category: p.category ?? null,
    imageUrl,
    imageUrls: imageUrl ? [imageUrl] : [],
    colours: Array.isArray(p.colours) ? p.colours.filter(Boolean) : parseJsonArray(p.colours),
    guidanceBestFor: p.guidance_best_for ?? null,
    guidanceTags: parseJsonArray(p.guidance_tags),
    guidanceBadges: parseJsonArray(p.guidance_badges),
    permalink: p.permalink ?? null,
  };
}

// ── GET /shop/settings ────────────────────────────────────────────────────────

router.get("/shop/settings", async (_req, res): Promise<void> => {
  const s = await getAllSettings();
  res.json({
    businessName: s["business_name"] ?? "Select Branding Solutions",
    tagline: s["shop_tagline"] ?? s["business_tagline"] ?? "Custom Workwear & Branded Uniforms",
    logoUrl: s["logo_url"] ?? s["shop_logo_url"] ?? null,
    contactEmail: s["contact_email"] ?? s["email"] ?? null,
    contactPhone: s["contact_phone"] ?? s["phone"] ?? null,
    address: s["address"] ?? s["contact_address"] ?? null,
    heroText: s["shop_hero_text"] ?? "Premium Workwear & Corporate Clothing",
    heroSubtext: s["shop_hero_subtext"] ?? "Bespoke branding and embroidery on quality garments — fast turnaround, UK-based.",
    portalUrl: s["portal_url"] ?? s["shop_portal_url"] ?? "/customer-portal/",
  });
});

// ── GET /shop/categories ──────────────────────────────────────────────────────

router.get("/shop/categories", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      TRIM(category) AS name,
      COUNT(*) AS count
    FROM products
    WHERE
      COALESCE(is_archived, false) = false
      AND COALESCE(is_service, false) = false
      AND category IS NOT NULL
      AND TRIM(category) <> ''
      AND COALESCE(woo_status, 'publish') = 'publish'
    GROUP BY TRIM(category)
    ORDER BY count DESC, name
  `);
  res.json(
    (rows.rows as any[]).map((r) => ({
      name: r.name as string,
      count: Number(r.count),
    }))
  );
});

// ── GET /shop/products ────────────────────────────────────────────────────────

router.get("/shop/products", async (req, res): Promise<void> => {
  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const categoryRaw = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const featuredOnly = req.query.featured === "true";

  const searchWords = searchRaw.split(/\s+/).filter(Boolean);

  const wordClauses = searchWords.map((w) => {
    const term = `%${w}%`;
    return sql`AND (p.name ILIKE ${term} OR p.description ILIKE ${term} OR p.sku ILIKE ${term} OR p.category ILIKE ${term})`;
  });

  const categoryClause = categoryRaw
    ? sql`AND TRIM(p.category) = ${categoryRaw}`
    : sql``;

  // featured = has an image_url and is published. If featuredOnly, also limit to products
  // that have the most recently updated images.
  const featuredClause = featuredOnly
    ? sql`AND p.image_url IS NOT NULL AND p.image_url <> ''`
    : sql``;

  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_tags, p.guidance_badges,
      p.updated_at,
      (SELECT ARRAY_AGG(DISTINCT pa.value ORDER BY pa.value)
       FROM product_attributes pa
       WHERE pa.product_id = p.id AND pa.type = 'colour') AS colours
    FROM products p
    WHERE
      COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
      AND COALESCE(p.woo_status, 'publish') = 'publish'
      ${categoryClause}
      ${featuredClause}
      ${sql.join(wordClauses, sql` `)}
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND p.image_url <> '' THEN 0 ELSE 1 END,
      p.name
    LIMIT 200
  `);

  res.json((rows.rows as any[]).map(fmtShopProduct));
});

// ── GET /shop/products/:id ────────────────────────────────────────────────────

router.get("/shop/products/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid product id" });
    return;
  }

  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_not_ideal_for,
      p.guidance_tags, p.guidance_badges
    FROM products p
    WHERE p.id = ${id}
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
    LIMIT 1
  `);

  const product = (rows.rows as any[])[0];
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Colours with images
  const colourRows = await db.execute(sql`
    SELECT DISTINCT ON (pa.value)
      pa.value AS colour,
      pv.image_url
    FROM product_attributes pa
    LEFT JOIN product_variants pv
      ON pv.product_id = pa.product_id
      AND pv.colour = pa.value
      AND pv.image_url IS NOT NULL
    WHERE pa.product_id = ${id} AND pa.type = 'colour'
    ORDER BY pa.value, pv.image_url NULLS LAST
  `);

  // Sizes
  const sizeRows = await db.execute(sql`
    SELECT DISTINCT pa.value AS size, COALESCE(pa.sort_order, 999) AS sort_order
    FROM product_attributes pa
    WHERE pa.product_id = ${id} AND pa.type = 'size'
    ORDER BY sort_order, size
  `);

  // Variants with price
  const variantRows = await db.execute(sql`
    SELECT colour, size, price
    FROM product_variants
    WHERE product_id = ${id}
    ORDER BY colour, size
  `);

  // Related products (same category, different id, limit 4)
  const relatedRows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.description, p.unit_price,
      p.category, p.image_url, p.permalink,
      p.guidance_best_for, p.guidance_tags, p.guidance_badges,
      (SELECT ARRAY_AGG(DISTINCT pa.value ORDER BY pa.value)
       FROM product_attributes pa
       WHERE pa.product_id = p.id AND pa.type = 'colour') AS colours
    FROM products p
    WHERE
      p.id <> ${id}
      AND TRIM(p.category) = ${String(product.category ?? "").trim()}
      AND COALESCE(p.is_archived, false) = false
      AND COALESCE(p.is_service, false) = false
    ORDER BY
      CASE WHEN p.image_url IS NOT NULL AND p.image_url <> '' THEN 0 ELSE 1 END,
      p.name
    LIMIT 4
  `);

  res.json({
    ...fmtShopProduct(product),
    guidanceNotIdealFor: product.guidance_not_ideal_for ?? null,
    colours: (colourRows.rows as any[]).map((r) => ({
      colour: r.colour as string,
      imageUrl: r.image_url ?? null,
    })),
    sizes: (sizeRows.rows as any[]).map((r) => r.size as string),
    variants: (variantRows.rows as any[]).map((r) => ({
      colour: r.colour ?? null,
      size: r.size ?? null,
      price: r.price != null ? parseFloat(String(r.price)) : null,
    })),
    relatedProducts: (relatedRows.rows as any[]).map(fmtShopProduct),
  });
});

// ── POST /shop/enquiry ────────────────────────────────────────────────────────

const EnquiryInputSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  message: z.string().min(1),
  productsOfInterest: z.array(z.string()).optional().default([]),
});

router.post("/shop/enquiry", async (req, res): Promise<void> => {
  const parsed = EnquiryInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, company, phone, message, productsOfInterest } = parsed.data;
  const refNum = `ENQ-${Date.now().toString(36).toUpperCase()}`;

  // Try to store enquiry in the enquiries table if it exists
  try {
    await db.execute(sql`
      INSERT INTO enquiries (name, email, company, phone, message, products_of_interest, reference_number, source, created_at)
      VALUES (
        ${name}, ${email}, ${company ?? null}, ${phone ?? null},
        ${message},
        ${JSON.stringify(productsOfInterest)}::jsonb,
        ${refNum}, 'shop', NOW()
      )
    `);
  } catch (e) {
    // Table may not exist yet — log and continue; email is the fallback
    logger.warn({ err: e }, "[shop/enquiry] Could not insert into enquiries table");
  }

  // Send notification email to the business
  const settings = await getAllSettings();
  const notifyEmail = settings["enquiry_email"] ?? settings["contact_email"] ?? settings["email"];
  const businessName = settings["business_name"] ?? "Select Branding Solutions";

  if (notifyEmail) {
    try {
      const productsList = productsOfInterest.length > 0
        ? `\n\nProducts of interest:\n${productsOfInterest.map((p) => `  • ${p}`).join("\n")}`
        : "";

      await sendEmail({
        to: notifyEmail,
        subject: `New Shop Enquiry from ${name}${company ? ` (${company})` : ""} — ${refNum}`,
        text: [
          `Reference: ${refNum}`,
          `Name: ${name}`,
          `Email: ${email}`,
          company ? `Company: ${company}` : null,
          phone ? `Phone: ${phone}` : null,
          `\nMessage:\n${message}`,
          productsList,
        ].filter(Boolean).join("\n"),
        html: `
          <p><strong>Reference:</strong> ${refNum}</p>
          <p><strong>Name:</strong> ${name}</p>
          <p><strong>Email:</strong> <a href="mailto:${email}">${email}</a></p>
          ${company ? `<p><strong>Company:</strong> ${company}</p>` : ""}
          ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ""}
          <p><strong>Message:</strong></p>
          <p style="white-space:pre-wrap">${message}</p>
          ${productsOfInterest.length > 0 ? `<p><strong>Products of interest:</strong></p><ul>${productsOfInterest.map((p) => `<li>${p}</li>`).join("")}</ul>` : ""}
        `,
      });
    } catch (e) {
      logger.warn({ err: e }, "[shop/enquiry] Failed to send notification email");
    }
  }

  // Send confirmation email to enquirer
  try {
    await sendEmail({
      to: email,
      subject: `Thanks for your enquiry — ${refNum}`,
      text: `Hi ${name},\n\nThank you for your enquiry. We'll be in touch shortly.\n\nYour reference number is ${refNum}.\n\n${businessName}`,
      html: `
        <p>Hi ${name},</p>
        <p>Thank you for your enquiry. We'll be in touch shortly.</p>
        <p>Your reference number is <strong>${refNum}</strong>.</p>
        <p>${businessName}</p>
      `,
    });
  } catch (e) {
    logger.warn({ err: e }, "[shop/enquiry] Failed to send confirmation email to enquirer");
  }

  res.json({ success: true, referenceNumber: refNum });
});

// ── WooCommerce proxy: categories ─────────────────────────────────────────────

router.get("/shop/wc/categories", async (_req, res): Promise<void> => {
  try {
    const data = await wcFetchCached("/products/categories", { per_page: "100", orderby: "menu_order", order: "asc" });
    const cats = (data as any[]).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parent: c.parent,
      count: c.count,
      image: c.image?.src ?? null,
      display: c.display ?? "default",
    })).filter((c) => c.count > 0);
    res.json(cats);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// ── WooCommerce proxy: product list ───────────────────────────────────────────

router.get("/shop/wc/products", async (req, res): Promise<void> => {
  try {
    const page = String(req.query.page ?? "1");
    const per_page = String(req.query.per_page ?? "24");
    const search = String(req.query.search ?? "");
    const category = String(req.query.category ?? "");   // WC category ID
    const slug = String(req.query.category_slug ?? "");  // alternative: resolve slug → id first

    const params: Record<string, string> = { page, per_page, orderby: "popularity", order: "desc" };
    if (search) params.search = search;
    if (category) params.category = category;
    if (slug && !category) {
      // Resolve slug to WC category id
      const cats = await wcFetchCached("/products/categories", { per_page: "100" });
      const cat = (cats as any[]).find((c) => c.slug === slug);
      if (cat) params.category = String(cat.id);
    }

    const data = await wcFetchCached("/products", params, 120_000);
    const products = (data as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      price: p.price,
      regularPrice: p.regular_price,
      salePrice: p.sale_price,
      onSale: p.on_sale,
      sku: p.sku,
      shortDescription: p.short_description?.replace(/<[^>]+>/g, " ").trim() ?? "",
      imageUrl: p.images?.[0]?.src ?? null,
      images: (p.images ?? []).map((img: any) => img.src),
      categories: (p.categories ?? []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
      type: p.type,
    }));
    res.json(products);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// ── WooCommerce proxy: single product ─────────────────────────────────────────

router.get("/shop/wc/products/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [product, variationsRaw] = await Promise.all([
      wcFetchCached(`/products/${id}`, {}, 120_000),
      wcFetchCached(`/products/${id}/variations`, { per_page: "100" }, 120_000).catch(() => []),
    ]);
    const p = product as any;
    res.json({
      id: p.id,
      name: p.name,
      slug: p.slug,
      permalink: p.permalink,
      price: p.price,
      regularPrice: p.regular_price,
      salePrice: p.sale_price,
      onSale: p.on_sale,
      sku: p.sku,
      description: p.description?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ?? "",
      shortDescription: p.short_description?.replace(/<[^>]+>/g, " ").trim() ?? "",
      images: (p.images ?? []).map((img: any) => img.src),
      imageUrl: p.images?.[0]?.src ?? null,
      categories: (p.categories ?? []).map((c: any) => ({ id: c.id, name: c.name, slug: c.slug })),
      attributes: (p.attributes ?? []).map((a: any) => ({
        id: a.id,
        name: a.name,
        options: a.options ?? [],
        variation: a.variation ?? false,
      })),
      type: p.type,
      stockStatus: p.stock_status,
      stockQuantity: p.stock_quantity,
      variations: (variationsRaw as any[]).map((v: any) => ({
        id: v.id,
        price: v.price,
        regularPrice: v.regular_price,
        salePrice: v.sale_price,
        stockStatus: v.stock_status,
        sku: v.sku,
        image: v.image?.src ?? null,
        attributes: (v.attributes ?? []).map((a: any) => ({ name: a.name, option: a.option })),
      })),
    });
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

// ── Stripe: create payment intent for shop checkout ───────────────────────────

router.post("/shop/stripe/payment-intent", async (req, res): Promise<void> => {
  const { amount, currency = "gbp", cartItems } = req.body;
  if (!amount || typeof amount !== "number" || amount <= 0) {
    res.status(400).json({ error: "amount (positive number in £) is required" });
    return;
  }
  try {
    const stripe = await getUncachableStripeClient();
    const amountPence = Math.round(amount * 100);
    const description = `SBS Shop — ${Array.isArray(cartItems) ? cartItems.map((i: any) => `${i.name} ×${i.quantity}`).join(", ") : "order"}`;
    const intent = await stripe.paymentIntents.create({
      amount: amountPence,
      currency,
      description,
      metadata: { source: "shop", items: JSON.stringify(cartItems ?? []).slice(0, 500) },
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: intent.client_secret, paymentIntentId: intent.id });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Shop order creation (called after Stripe payment confirms) ────────────────

const ShopOrderSchema = z.object({
  paymentIntentId: z.string(),
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
  deliveryAddress: z.object({
    line1: z.string(),
    line2: z.string().optional().nullable(),
    city: z.string(),
    postcode: z.string(),
    country: z.string().default("GB"),
  }),
  cartItems: z.array(z.object({
    wcProductId: z.number(),
    variationId: z.number().optional().nullable(),
    name: z.string(),
    sku: z.string().optional().nullable(),
    price: z.number(),
    quantity: z.number().int().positive(),
    colour: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    image: z.string().optional().nullable(),
  })),
  subtotal: z.number(),
  carriage: z.number().default(8.5),
  total: z.number(),
});

router.post("/shop/orders", async (req, res): Promise<void> => {
  const parsed = ShopOrderSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  try {
    // Verify payment intent succeeded
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(d.paymentIntentId);
    if (intent.status !== "succeeded") {
      res.status(400).json({ error: `Payment not confirmed (status: ${intent.status})` });
      return;
    }

    // Generate order number
    const numResult = await db.execute(sql`
      SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(order_number, '[^0-9]', '', 'g') AS INTEGER)), 0) + 1 AS next_num
      FROM orders WHERE order_number ~ '^[A-Z]+-[0-9]+-[0-9]+$'
    `);
    const nextNum = (numResult.rows[0] as any)?.next_num ?? 1;
    const year = new Date().getFullYear();
    const orderNumber = `ORD-${year}-${String(nextNum).padStart(5, "0")}`;

    // Insert order
    const orderResult = await db.execute(sql`
      INSERT INTO orders (
        order_number, customer_name, status, total_amount, carriage_amount,
        source, notes, order_date, created_at, updated_at
      ) VALUES (
        ${orderNumber},
        ${d.customerName},
        'processing',
        ${String(d.total)},
        ${String(d.carriage)},
        'shop',
        ${`Online order — ${d.customerEmail}${d.company ? ` (${d.company})` : ""}. Payment: ${d.paymentIntentId}`},
        NOW(), NOW(), NOW()
      ) RETURNING id
    `);
    const orderId = (orderResult.rows[0] as any)?.id;

    // Insert order items
    for (const item of d.cartItems) {
      await db.execute(sql`
        INSERT INTO order_items (order_id, product_name, quantity, unit_price, line_total, colour, size, notes)
        VALUES (
          ${orderId},
          ${item.name},
          ${item.quantity},
          ${String(item.price)},
          ${String(item.price * item.quantity)},
          ${item.colour ?? null},
          ${item.size ?? null},
          ${item.sku ? `SKU: ${item.sku}` : null}
        )
      `);
    }

    // Send confirmation email
    const settings = await getAllSettings();
    const businessName = settings["business_name"] ?? "Select Branding Solutions";
    try {
      await sendEmail({
        to: d.customerEmail,
        subject: `Order Confirmed — ${orderNumber}`,
        text: `Hi ${d.customerName},\n\nThank you for your order! Your order reference is ${orderNumber}.\n\nWe will be in touch to confirm delivery details.\n\n${businessName}`,
        html: `<p>Hi ${d.customerName},</p><p>Thank you for your order! Your order reference is <strong>${orderNumber}</strong>.</p><p>We will be in touch to confirm delivery details.</p><p>${businessName}</p>`,
      });
    } catch (e) {
      logger.warn({ err: e }, "[shop/orders] Failed to send confirmation email");
    }

    // Notify business
    const notifyEmail = settings["contact_email"] ?? settings["email"];
    if (notifyEmail) {
      try {
        await sendEmail({
          to: notifyEmail,
          subject: `New Shop Order — ${orderNumber} — ${d.customerName}`,
          text: `New order received.\n\nRef: ${orderNumber}\nCustomer: ${d.customerName} (${d.customerEmail})\n${d.company ? `Company: ${d.company}\n` : ""}Total: £${d.total.toFixed(2)}\n\nItems:\n${d.cartItems.map((i) => `  ${i.name} ×${i.quantity} = £${(i.price * i.quantity).toFixed(2)}`).join("\n")}`,
          html: `<p><strong>Ref:</strong> ${orderNumber}</p><p><strong>Customer:</strong> ${d.customerName} (${d.customerEmail})</p>${d.company ? `<p><strong>Company:</strong> ${d.company}</p>` : ""}<p><strong>Total:</strong> £${d.total.toFixed(2)}</p><ul>${d.cartItems.map((i) => `<li>${i.name} ×${i.quantity} @ £${i.price.toFixed(2)} = £${(i.price * i.quantity).toFixed(2)}</li>`).join("")}</ul>`,
        });
      } catch (e) {
        logger.warn({ err: e }, "[shop/orders] Failed to send business notification email");
      }
    }

    res.json({ success: true, orderNumber, orderId });
  } catch (e: any) {
    logger.error({ err: e }, "[shop/orders] Failed to create order");
    res.status(500).json({ error: e.message });
  }
});

export default router;
