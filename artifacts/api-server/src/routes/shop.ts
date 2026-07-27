import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db, settingsTable } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { sendEmail } from "../services/email.js";
import { getUncachableStripeClient, getStripePublishableKey } from "../services/stripeClient.js";

const router: IRouter = Router();

// ── Internal-DB helpers (replaces WC external proxy) ─────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

// ── Shop: categories from internal DB ────────────────────────────────────────

router.get("/shop/wc/categories", async (_req, res): Promise<void> => {
  try {
    // Aggregate distinct categories with count and a representative image
    const rows = await db.execute(sql`
      SELECT
        category AS name,
        COUNT(*) AS count,
        MIN(image_url) AS image
      FROM products
      WHERE is_archived = false
        AND category IS NOT NULL
        AND category <> ''
      GROUP BY category
      HAVING COUNT(*) > 0
      ORDER BY category ASC
    `);

    let id = 1;
    const cats = (rows.rows as any[]).map((r) => ({
      id: id++,
      name: r.name,
      slug: toSlug(r.name),
      parent: 0,
      count: Number(r.count),
      image: r.image ?? null,
      display: "default",
    }));

    res.json(cats);
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/categories] error");
    res.status(500).json({ error: e.message });
  }
});

// ── Shop: product list from internal DB ──────────────────────────────────────

router.get("/shop/wc/products", async (req, res): Promise<void> => {
  try {
    const page    = Math.max(1, Number(req.query.page ?? 1));
    const perPage = Math.min(100, Math.max(1, Number(req.query.per_page ?? 24)));
    const offset  = (page - 1) * perPage;
    const search  = String(req.query.search ?? "").trim();
    const catSlug = String(req.query.category_slug ?? "").trim();

    // Build WHERE clause
    const conditions: string[] = ["p.is_archived = false", "p.is_service = false"];
    const binds: any[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${paramIdx} OR p.sku ILIKE $${paramIdx})`);
      binds.push(`%${search}%`);
      paramIdx++;
    }
    if (catSlug) {
      // Convert slug back to a name pattern (slug replaces spaces with hyphens)
      // Match category by slugified version
      conditions.push(`LOWER(REGEXP_REPLACE(p.category, '[^a-zA-Z0-9]+', '-', 'g')) = $${paramIdx}`);
      binds.push(catSlug.toLowerCase());
      paramIdx++;
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

    const queryText = `
      SELECT
        p.id, p.name, p.sku, p.category, p.image_url,
        p.unit_price, p.regular_price, p.on_sale, p.description, p.permalink,
        p.woo_commerce_id
      FROM products p
      ${where}
      ORDER BY p.name ASC
      LIMIT ${perPage} OFFSET ${offset}
    `;

    const result = await db.execute(sql.raw(
      binds.length
        ? queryText.replace(/\$(\d+)/g, (_, i) => `'${String(binds[Number(i) - 1]).replace(/'/g, "''")}'`)
        : queryText
    ));

    const products = (result.rows as any[]).map((p) => ({
      id: p.id,
      name: p.name,
      slug: toSlug(p.name),
      permalink: p.permalink ?? null,
      price: p.unit_price ? String(p.unit_price) : "0",
      regularPrice: p.regular_price ? String(p.regular_price) : null,
      salePrice: p.on_sale ? String(p.unit_price) : null,
      onSale: p.on_sale ?? false,
      sku: p.sku ?? null,
      shortDescription: (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      imageUrl: p.image_url ?? null,
      images: p.image_url ? [p.image_url] : [],
      categories: p.category
        ? [{ id: 0, name: p.category, slug: toSlug(p.category) }]
        : [],
      type: "simple",
    }));

    res.json(products);
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/products] error");
    res.status(500).json({ error: e.message });
  }
});

// ── Shop: single product + variants from internal DB ─────────────────────────

router.get("/shop/wc/products/:identifier", async (req, res): Promise<void> => {
  const raw = req.params.identifier;
  // Accept either a numeric ID or a WooCommerce-style slug (e.g. "olympic-polo")
  const numericId = /^\d+$/.test(raw) ? Number(raw) : null;

  try {
    // Lookup by numeric ID or by slug derived from name
    const productRows = await db.execute(
      numericId
        ? sql`
            SELECT id, name, sku, category, image_url, unit_price, regular_price,
                   on_sale, description, permalink, woo_commerce_id, stock_quantity,
                   gallery_images,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation
            FROM products
            WHERE id = ${numericId} AND is_archived = false
            LIMIT 1
          `
        : sql`
            SELECT id, name, sku, category, image_url, unit_price, regular_price,
                   on_sale, description, permalink, woo_commerce_id, stock_quantity,
                   gallery_images,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation
            FROM products
            WHERE LOWER(REGEXP_REPLACE(TRIM(BOTH '-' FROM REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')), '^-+|-+$', '', 'g')) = ${raw}
              AND is_archived = false
            LIMIT 1
          `
    );

    if (!productRows.rows.length) { res.status(404).json({ error: "Not found" }); return; }
    const p = (productRows.rows as any[])[0];

    const variantRows = await db.execute(sql`
      SELECT id, colour, size, sleeve, price, image_url, sku,
             stock_quantity, is_available, woo_variation_id
      FROM product_variants
      WHERE product_id = ${p.id}
      ORDER BY colour ASC, size ASC, sleeve ASC
    `);
    const variants = variantRows.rows as any[];

    // Derive distinct attribute options from variants
    const colours = [...new Set(variants.map((v) => v.colour).filter(Boolean))] as string[];
    const sizes   = [...new Set(variants.map((v) => v.size).filter(Boolean))] as string[];
    const sleeves = [...new Set(variants.map((v) => v.sleeve).filter(Boolean))] as string[];

    const attributes: any[] = [];
    if (colours.length) attributes.push({ id: 1, name: "Colour", options: colours, variation: true });
    if (sizes.length)   attributes.push({ id: 2, name: "Size",   options: sizes,   variation: true });
    if (sleeves.length) attributes.push({ id: 3, name: "Sleeve", options: sleeves, variation: true });

    // All variant images (deduplicated)
    const variantImages = [...new Set(
      variants.map((v) => v.image_url).filter(Boolean)
    )];
    const allImages = p.image_url
      ? [p.image_url, ...variantImages.filter((u) => u !== p.image_url)]
      : variantImages;

    const variations = variants.map((v) => {
      const attrs: any[] = [];
      if (v.colour) attrs.push({ name: "Colour", option: v.colour });
      if (v.size)   attrs.push({ name: "Size",   option: v.size });
      if (v.sleeve) attrs.push({ name: "Sleeve", option: v.sleeve });
      return {
        id: v.id,
        price: v.price ? String(v.price) : String(p.unit_price ?? 0),
        regularPrice: null,
        salePrice: null,
        stockStatus: (v.stock_quantity ?? 0) > 0 ? "instock" : "outofstock",
        sku: v.sku ?? p.sku,
        image: v.image_url ?? null,
        attributes: attrs,
      };
    });

    // Gallery images: product image + variant images (deduplicated)
    // Also include any synced WC gallery images
    const galleryImages: string[] = p.gallery_images
      ? (Array.isArray(p.gallery_images) ? p.gallery_images : JSON.parse(p.gallery_images)).filter(Boolean)
      : [];
    const fullGallery = [...new Set([...allImages, ...galleryImages])];

    // Parse guidance fields
    const parseMaybeJson = (v: any): any[] => {
      if (!v) return [];
      if (Array.isArray(v)) return v;
      try { const r = JSON.parse(String(v)); return Array.isArray(r) ? r : []; } catch { return []; }
    };

    res.json({
      id: p.id,
      name: p.name,
      slug: toSlug(p.name),
      permalink: p.permalink ?? null,
      price: p.unit_price ? String(p.unit_price) : "0",
      regularPrice: p.regular_price ? String(p.regular_price) : null,
      salePrice: p.on_sale ? String(p.unit_price) : null,
      onSale: p.on_sale ?? false,
      sku: p.sku ?? null,
      description: (p.description ?? "").trim(),
      shortDescription: (p.description ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      images: fullGallery,
      imageUrl: fullGallery[0] ?? null,
      categories: p.category
        ? [{ id: 0, name: p.category, slug: toSlug(p.category) }]
        : [],
      attributes,
      type: variants.length ? "variable" : "simple",
      stockStatus: (p.stock_quantity ?? 0) > 0 ? "instock" : "outofstock",
      stockQuantity: p.stock_quantity ?? 0,
      variations,
      // Guidance fields
      guidance: {
        valueRating:      p.guidance_value_rating      ? Number(p.guidance_value_rating)      : 0,
        durabilityRating: p.guidance_durability_rating ? Number(p.guidance_durability_rating) : 0,
        technicalRating:  p.guidance_smart_rating      ? Number(p.guidance_smart_rating)      : 0,
        badges:           parseMaybeJson(p.guidance_badges),
        tags:             parseMaybeJson(p.guidance_tags),
        bestFor:          p.guidance_best_for          ?? "",
        notIdealFor:      p.guidance_not_ideal_for     ?? "",
        staffRecommendation: p.guidance_staff_recommendation ?? "",
      },
    });
  } catch (e: any) {
    logger.error({ err: e }, "[shop/wc/products/:id] error");
    res.status(500).json({ error: e.message });
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
