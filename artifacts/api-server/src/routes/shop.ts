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
      AND woo_commerce_id IS NOT NULL
      AND category IS NOT NULL
      AND TRIM(category) <> ''
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

// ── GET /shop/images ──────────────────────────────────────────────────────────
// Returns all product images from the local DB, ready for use on any page.
// Response shape:
//   byCategory: Record<category, { url, productName, productId, permalink }[]>
//   featured:   { url, productName, productId, category, permalink }[]
//   all:        { url, productName, productId, category, type, permalink }[]

router.get("/shop/images", async (_req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      id,
      name,
      category,
      image_url,
      gallery_images,
      permalink
    FROM products
    WHERE (image_url IS NOT NULL AND image_url <> '')
      OR (gallery_images IS NOT NULL AND jsonb_array_length(gallery_images) > 0)
    ORDER BY
      CASE WHEN gallery_images IS NOT NULL AND jsonb_array_length(gallery_images) > 1 THEN 0 ELSE 1 END,
      updated_at DESC NULLS LAST
    LIMIT 500
  `);

  type ImageEntry = {
    url: string;
    productName: string;
    productId: number;
    category: string | null;
    permalink: string | null;
    type: "primary" | "gallery";
  };

  const all: ImageEntry[] = [];
  const byCategory: Record<string, Omit<ImageEntry, "type">[]> = {};

  for (const row of rows.rows as any[]) {
    const cat: string = row.category ?? "Uncategorised";
    if (!byCategory[cat]) byCategory[cat] = [];

    const base = {
      productId:   row.id as number,
      productName: row.name as string,
      category:    row.category as string | null,
      permalink:   row.permalink as string | null,
    };

    // Primary image
    if (row.image_url) {
      all.push({ ...base, url: row.image_url, type: "primary" });
      byCategory[cat].push({ ...base, url: row.image_url });
    }

    // Gallery images (skip if duplicate of primary)
    const gallery: string[] = row.gallery_images
      ? (Array.isArray(row.gallery_images) ? row.gallery_images : JSON.parse(row.gallery_images)).filter(Boolean)
      : [];
    for (const url of gallery) {
      if (url !== row.image_url) {
        all.push({ ...base, url, type: "gallery" });
        byCategory[cat].push({ ...base, url });
      }
    }
  }

  // Featured: products with the most images (rich gallery content first)
  const featured = all.filter((i) => i.type === "primary").slice(0, 50);

  res.json({ byCategory, featured, all });
});

// ── POST /shop/product-enquiry ────────────────────────────────────────────────
// Customer-facing product enquiry & chat — saves to wc_enquiries + emails staff

const ProductEnquirySchema = z.object({
  productId:   z.number().optional().nullable(),
  productName: z.string().optional().nullable(),
  productUrl:  z.string().optional().nullable(),
  name:        z.string().min(1),
  email:       z.string().email(),
  phone:       z.string().optional().nullable(),
  message:     z.string().min(1),
  source:      z.enum(["product_page", "chat"]).default("product_page"),
});

router.post("/shop/product-enquiry", async (req, res): Promise<void> => {
  const parsed = ProductEnquirySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;

  const refNum = `ENQ-${Date.now().toString(36).toUpperCase()}`;

  // Link to existing customer if email matches
  let customerId: number | null = null;
  try {
    const cr = await db.execute(sql`SELECT id FROM customers WHERE LOWER(email) = LOWER(${d.email}) LIMIT 1`);
    customerId = (cr.rows[0] as any)?.id ?? null;
  } catch {}

  // Save to wc_enquiries (visible in order-system Enquiries page)
  try {
    await db.execute(sql`
      INSERT INTO wc_enquiries (product_id, product_name, customer_name, email, phone, message, customer_id, source)
      VALUES (
        ${d.productId ?? null},
        ${d.productName ?? null},
        ${d.name},
        ${d.email},
        ${d.phone ?? null},
        ${d.message},
        ${customerId},
        ${d.source}
      )
    `);
  } catch (e) {
    // source column may not exist yet — retry without it
    try {
      await db.execute(sql`
        INSERT INTO wc_enquiries (product_id, product_name, customer_name, email, phone, message, customer_id)
        VALUES (${d.productId ?? null}, ${d.productName ?? null}, ${d.name}, ${d.email}, ${d.phone ?? null}, ${d.message}, ${customerId})
      `);
    } catch (e2) {
      logger.warn({ err: e2 }, "[shop/product-enquiry] Could not insert into wc_enquiries");
    }
  }

  const settings = await getAllSettings();
  const notifyEmail = settings["enquiry_email"] ?? settings["contact_email"] ?? settings["email"];
  const businessName = settings["business_name"] ?? "Select Branding Solutions";
  const tag = d.source === "chat" ? "Chat Message" : "Product Enquiry";

  // Notify staff
  if (notifyEmail) {
    try {
      await sendEmail({
        to: notifyEmail,
        subject: `New ${tag} from ${d.name}${d.productName ? ` — ${d.productName}` : ""} — ${refNum}`,
        text: [
          `Reference: ${refNum}`,
          `Source: ${tag}`,
          d.productName ? `Product: ${d.productName}` : null,
          d.productUrl  ? `URL: ${d.productUrl}` : null,
          `Name: ${d.name}`,
          `Email: ${d.email}`,
          d.phone ? `Phone: ${d.phone}` : null,
          `\nMessage:\n${d.message}`,
        ].filter(Boolean).join("\n"),
        html: `
          <p><strong>Reference:</strong> ${refNum}</p>
          <p><strong>Source:</strong> ${tag}</p>
          ${d.productName ? `<p><strong>Product:</strong> ${d.productUrl ? `<a href="${d.productUrl}">${d.productName}</a>` : d.productName}</p>` : ""}
          <p><strong>Name:</strong> ${d.name}</p>
          <p><strong>Email:</strong> <a href="mailto:${d.email}">${d.email}</a></p>
          ${d.phone ? `<p><strong>Phone:</strong> ${d.phone}</p>` : ""}
          <p><strong>Message:</strong></p><p style="white-space:pre-wrap">${d.message}</p>
        `,
      });
    } catch (e) { logger.warn({ err: e }, "[shop/product-enquiry] Failed to send notification email"); }
  }

  // Confirm to customer
  try {
    await sendEmail({
      to: d.email,
      subject: `Thanks for getting in touch — ${refNum}`,
      text: `Hi ${d.name},\n\nThanks for your message — we'll get back to you shortly.\n\nYour reference number is ${refNum}.\n\n${businessName}`,
      html: `<p>Hi ${d.name},</p><p>Thanks for your message — we'll get back to you shortly.</p><p>Your reference number is <strong>${refNum}</strong>.</p><p>${businessName}</p>`,
    });
  } catch (e) { logger.warn({ err: e }, "[shop/product-enquiry] Failed to send confirmation email"); }

  res.json({ success: true, referenceNumber: refNum });
});

// ── Shop: categories from internal DB ────────────────────────────────────────

router.get("/shop/wc/categories", async (_req, res): Promise<void> => {
  try {
    // Use the product_categories table which is synced from WooCommerce and
    // carries the real WC category images (not a product image stand-in).
    const rows = await db.execute(sql`
      SELECT
        woo_id   AS id,
        name,
        slug,
        COALESCE(parent_woo_id, 0) AS parent,
        product_count AS count,
        image_url AS image
      FROM product_categories
      WHERE product_count > 0
      ORDER BY display_order ASC, name ASC
    `);

    const cats = (rows.rows as any[]).map((r) => ({
      id: Number(r.id),
      name: r.name as string,
      slug: r.slug as string,
      parent: Number(r.parent),
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
    const perPage = Math.min(1000, Math.max(1, Number(req.query.per_page ?? 24)));
    const offset  = (page - 1) * perPage;
    const search  = String(req.query.search ?? "").trim();
    const catSlug = String(req.query.category_slug ?? "").trim();

    // Build WHERE clause
    const conditions: string[] = ["p.is_archived = false", "p.is_service = false", "p.woo_commerce_id IS NOT NULL"];
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
                   gallery_images, size_guide_html, price_breaks,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation, branding_positions_override
            FROM products
            WHERE id = ${numericId} AND is_archived = false
            LIMIT 1
          `
        : sql`
            SELECT id, name, sku, category, image_url, unit_price, regular_price,
                   on_sale, description, permalink, woo_commerce_id, stock_quantity,
                   gallery_images, size_guide_html, price_breaks,
                   guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
                   guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
                   guidance_staff_recommendation, branding_positions_override
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
    const allVariantRows = variantRows.rows as any[];

    // ── Deduplicate by (colour, size, sleeve) — keep the row with highest stock ──
    // Some WC syncs produce multiple rows for the same attribute combination.
    const variantMap = new Map<string, any>();
    for (const v of allVariantRows) {
      const key = `${(v.colour ?? "").trim()}|${(v.size ?? "").trim()}|${(v.sleeve ?? "").trim()}`;
      const existing = variantMap.get(key);
      if (!existing || (v.stock_quantity ?? 0) > (existing.stock_quantity ?? 0)) {
        variantMap.set(key, v);
      }
    }
    const variants = [...variantMap.values()];

    // ── Natural size sort ──────────────────────────────────────────────────────
    // Clothing sizes in display order (case-insensitive match)
    const CLOTHING_ORDER = [
      "xxs", "xs", "extra small", "s", "small", "s/m",
      "m", "medium", "m/l", "l", "large",
      "xl", "extra large", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl", "6xl",
    ];
    function naturalSizeSort(a: string, b: string): number {
      const na = parseFloat(a);
      const nb = parseFloat(b);
      // Both purely numeric → numeric sort (handles shoe/children's sizes)
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      // Both in known clothing order → use that order
      const ia = CLOTHING_ORDER.indexOf(a.toLowerCase());
      const ib = CLOTHING_ORDER.indexOf(b.toLowerCase());
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return  1;
      // Fallback: natural locale sort
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    }

    // Derive distinct attribute options from deduplicated variants
    const colours = [...new Set(variants.map((v) => (v.colour ?? "").trim()).filter(Boolean))];
    let sizes   = [...new Set(variants.map((v) => (v.size   ?? "").trim()).filter(Boolean))].sort(naturalSizeSort);
    let sleeves = [...new Set(variants.map((v) => (v.sleeve ?? "").trim()).filter(Boolean))].sort(naturalSizeSort);

    // Fallback: if variants carry no size/sleeve (common when WC syncs colour-only variants
    // but sizes are stored as product attributes), read from product_attributes instead.
    if (!sizes.length || !sleeves.length) {
      const attrRows = await db.execute(sql`
        SELECT type, value, COALESCE(sort_order, 999) AS sort_order
        FROM product_attributes
        WHERE product_id = ${p.id} AND type IN ('size', 'sleeve')
        ORDER BY type, sort_order, value
      `);
      const attrList = attrRows.rows as any[];
      if (!sizes.length) {
        sizes = attrList
          .filter((r) => r.type === "size")
          .map((r) => (r.value as string).trim())
          .filter(Boolean)
          .sort(naturalSizeSort);
      }
      if (!sleeves.length) {
        sleeves = attrList
          .filter((r) => r.type === "sleeve")
          .map((r) => (r.value as string).trim())
          .filter(Boolean)
          .sort(naturalSizeSort);
      }
    }

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
      const colour = (v.colour ?? "").trim();
      const size   = (v.size   ?? "").trim();
      const sleeve = (v.sleeve ?? "").trim();
      if (colour) attrs.push({ name: "Colour", option: colour });
      if (size)   attrs.push({ name: "Size",   option: size });
      if (sleeve) attrs.push({ name: "Sleeve", option: sleeve });
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
      sizeGuideHtml: p.size_guide_html ?? null,
      priceBreaks: (() => {
        const raw = p.price_breaks;
        if (!raw) return [];
        const parsed: { qty: number; price: number }[] =
          Array.isArray(raw) ? raw : (() => { try { return JSON.parse(String(raw)); } catch { return []; } })();
        const unitPrice = p.unit_price ? parseFloat(String(p.unit_price)) : 0;
        return parsed
          .filter((t) => t.qty > 0 && t.price > 0 && t.price < unitPrice)
          .sort((a, b) => a.qty - b.qty);
      })(),
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
      // Per-product branding override: null = use global defaults, [] = no branding, [...] = custom positions
      brandingPositionsOverride: (() => {
        const raw = p.branding_positions_override;
        if (!raw) return null;
        try { return Array.isArray(raw) ? raw : JSON.parse(String(raw)); } catch { return null; }
      })(),
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

// ── Branding options (positions + surcharges) ────────────────────────────────

const DEFAULT_BRANDING_POSITIONS = [
  { id: "left-chest",   name: "Left Chest",    surcharge: 0,    description: "Standard position — included in base price" },
  { id: "right-chest",  name: "Right Chest",   surcharge: 4.00, description: "" },
  { id: "back-large",   name: "Back Large",    surcharge: 6.00, description: "Full-width back logo" },
  { id: "back-small",   name: "Back Small",    surcharge: 4.00, description: "" },
  { id: "left-sleeve",  name: "Left Sleeve",   surcharge: 4.00, description: "" },
  { id: "right-sleeve", name: "Right Sleeve",  surcharge: 4.00, description: "" },
  { id: "other",        name: "Other",         surcharge: 0,    description: "Describe the position required — pricing confirmed separately", notes_field: true },
];

router.get("/shop/branding-options", async (_req, res): Promise<void> => {
  const settings = await getAllSettings();
  const raw = settings["shop_branding_positions"];
  if (raw) {
    try { res.json(JSON.parse(raw)); return; } catch {}
  }
  res.json(DEFAULT_BRANDING_POSITIONS);
});

router.post("/shop/branding-options", async (req, res): Promise<void> => {
  const positions = req.body;
  if (!Array.isArray(positions)) { res.status(400).json({ error: "Expected array" }); return; }
  await db.execute(sql`
    INSERT INTO settings (key, value) VALUES ('shop_branding_positions', ${JSON.stringify(positions)})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  res.json({ ok: true });
});

// ── WordPress page content by slug ───────────────────────────────────────────
const wpPageCache: Record<string, { data: any; ts: number }> = {};
const WP_PAGE_TTL = 60 * 60 * 1000; // 1 hour

router.get("/shop/wp-page/:slug", async (req: Request, res: Response) => {
  const { slug } = req.params;
  const now = Date.now();
  const cached = wpPageCache[slug];
  if (cached && now - cached.ts < WP_PAGE_TTL) {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(cached.data);
    return;
  }
  try {
    const url = `https://www.selectuniforms.co.uk/wp-json/wp/v2/pages?slug=${encodeURIComponent(slug)}&_fields=id,slug,title,content,excerpt,featured_media,_embedded&_embed=wp:featuredmedia`;
    const wpRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!wpRes.ok) { res.status(wpRes.status).json({ error: "WordPress API error" }); return; }
    const pages: any[] = await wpRes.json();
    if (!pages.length) { res.status(404).json({ error: "Page not found" }); return; }
    const p = pages[0];
    const featuredImageUrl =
      p._embedded?.["wp:featuredmedia"]?.[0]?.source_url ??
      (p.featured_media > 0
        ? await fetch(`https://www.selectuniforms.co.uk/wp-json/wp/v2/media/${p.featured_media}`, { signal: AbortSignal.timeout(5000) })
            .then(r => r.ok ? r.json() : null)
            .then(m => m?.source_url ?? null)
            .catch(() => null)
        : null);
    const result = {
      id: p.id,
      slug: p.slug,
      title: p.title?.rendered ?? slug,
      content: p.content?.rendered ?? "",
      excerpt: p.excerpt?.rendered ?? "",
      featuredImageUrl,
    };
    wpPageCache[slug] = { data: result, ts: now };
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(result);
  } catch (e: any) {
    logger.error({ err: e?.message, slug }, "[shop/wp-page] fetch error");
    res.status(500).json({ error: "Failed to fetch page" });
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
    brandingPositions: z.array(z.object({
      id: z.string(),
      name: z.string(),
      surcharge: z.number(),
      notes: z.string().optional().nullable(),
    })).optional().nullable(),
    wearerName: z.string().optional().nullable(),
  })),
  subtotal: z.number(),
  carriage: z.number().default(8.5),
  total: z.number(),
  shopCustomerId: z.number().int().optional().nullable(),
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
        source, notes, order_date, shop_customer_id, created_at, updated_at
      ) VALUES (
        ${orderNumber},
        ${d.customerName},
        'processing',
        ${String(d.total)},
        ${String(d.carriage)},
        'shop',
        ${`Online order — ${d.customerEmail}${d.company ? ` (${d.company})` : ""}. Payment: ${d.paymentIntentId}`},
        NOW(), ${d.shopCustomerId ?? null}, NOW(), NOW()
      ) RETURNING id
    `);
    const orderId = (orderResult.rows[0] as any)?.id;

    // Insert order items
    for (const item of d.cartItems) {
      await db.execute(sql`
        INSERT INTO order_items (order_id, product_name, quantity, unit_price, line_total, colour, size, notes, recipient_name)
        VALUES (
          ${orderId},
          ${item.name},
          ${item.quantity},
          ${String(item.price)},
          ${String(item.price * item.quantity)},
          ${item.colour ?? null},
          ${item.size ?? null},
          ${[
            item.sku ? `SKU: ${item.sku}` : null,
            item.brandingPositions?.length
              ? `Branding: ${item.brandingPositions.map((p) => p.name + (p.surcharge > 0 ? ` (+£${p.surcharge.toFixed(2)})` : '')).join(', ')}`
              : null,
          ].filter(Boolean).join(' | ') || null},
          ${item.wearerName?.trim() || null}
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

// ─── GET /shop/blog-posts ─────────────────────────────────────────────────────
// Proxies the WordPress REST API so the shop avoids CORS issues and can cache.
// Strategy: _embed alone doesn't populate _embedded unless _embedded is listed
// in _fields too. We try that first; fall back to a separate batch media fetch.
router.get("/shop/blog-posts", async (_req: Request, res: Response) => {
  try {
    // Include _embedded in _fields so WordPress doesn't strip it out
    const postsUrl =
      "https://www.selectuniforms.co.uk/wp-json/wp/v2/posts" +
      "?per_page=9&_fields=id,title,excerpt,date,link,slug,featured_media,_embedded&_embed=wp:featuredmedia";
    const wpRes = await fetch(postsUrl, { signal: AbortSignal.timeout(10000) });
    if (!wpRes.ok) {
      res.status(wpRes.status).json({ error: "WordPress API error" });
      return;
    }
    const posts: any[] = await wpRes.json();

    // Try to pull image URLs from _embedded first
    const mediaMap: Record<number, string> = {};
    for (const p of posts) {
      const src = p._embedded?.["wp:featuredmedia"]?.[0]?.source_url;
      if (src && p.featured_media) mediaMap[p.featured_media] = src;
    }

    // If _embedded didn't work, batch-fetch media separately
    const missingIds = posts
      .map((p: any) => p.featured_media)
      .filter((id: any) => id && Number(id) > 0 && !mediaMap[id]);

    if (missingIds.length > 0) {
      try {
        const mediaUrl =
          "https://www.selectuniforms.co.uk/wp-json/wp/v2/media" +
          `?include=${missingIds.join(",")}&per_page=${missingIds.length}`;
        const mediaRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(10000) });
        if (mediaRes.ok) {
          const mediaItems: any[] = await mediaRes.json();
          logger.info({ count: mediaItems.length, missingIds }, "[shop/blog-posts] batch media response");
          for (const m of mediaItems) {
            if (m.id && m.source_url) mediaMap[m.id] = m.source_url;
          }
        } else {
          logger.warn({ status: mediaRes.status }, "[shop/blog-posts] batch media fetch failed");
        }
      } catch (e: any) {
        logger.warn({ err: e?.message }, "[shop/blog-posts] batch media fetch threw");
      }
    }

    const cleaned = posts.map((p: any) => {
      const rawExcerpt: string = p.excerpt?.rendered ?? "";
      const excerpt = rawExcerpt
        .replace(/<[^>]+>/g, "")
        .replace(/\[&hellip;\]/g, "…")
        .replace(/&#8230;/g, "…")
        .trim();
      const title: string = (p.title?.rendered ?? "")
        .replace(/&#8217;/g, "'")
        .replace(/&#8211;/g, "–")
        .replace(/&amp;/g, "&")
        .trim();
      const featuredImageUrl: string | null =
        (p.featured_media && mediaMap[p.featured_media]) ? mediaMap[p.featured_media] : null;
      return {
        id: p.id,
        title,
        excerpt,
        date: p.date,
        link: p.link,
        slug: p.slug,
        featuredImageUrl,
      };
    });

    logger.info(
      { total: cleaned.length, withImage: cleaned.filter(p => p.featuredImageUrl).length },
      "[shop/blog-posts] response"
    );

    // Cache for 15 minutes
    res.setHeader("Cache-Control", "public, max-age=900");
    res.json(cleaned);
  } catch (e: any) {
    logger.warn({ err: e }, "[shop/blog-posts] Failed to fetch WordPress posts");
    res.status(502).json({ error: "Could not fetch blog posts" });
  }
});

// ─── GET /shop/team-members ───────────────────────────────────────────────────
router.get("/shop/team-members", async (_req: Request, res: Response) => {
  try {
    const s = await getAllSettings();
    const raw = s["shop_team_members"];
    const members = raw ? JSON.parse(raw) : [];
    res.json(members);
  } catch {
    res.json([]);
  }
});

// ─── PATCH /shop/team-members ─────────────────────────────────────────────────
router.patch("/shop/team-members", async (req: Request, res: Response) => {
  try {
    const members = req.body; // array of { name, role, photoUrl }
    if (!Array.isArray(members)) {
      res.status(400).json({ error: "Body must be an array" });
      return;
    }
    const value = JSON.stringify(members);
    await db.execute(sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES ('shop_team_members', ${value}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
    `);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /shop/live-chat/session ─────────────────────────────────────────────
router.post("/shop/live-chat/session", async (req: Request, res: Response) => {
  const parsed = z.object({
    contactName: z.string().max(200).optional(),
    contactEmail: z.string().email().max(200).optional(),
    pageUrl: z.string().max(500).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const { contactName, contactEmail, pageUrl } = parsed.data;
  const result = await db.execute(sql`
    INSERT INTO live_chat_sessions (contact_name, contact_email, page_url, started_at)
    VALUES (${contactName ?? null}, ${contactEmail ?? null}, ${pageUrl ?? null}, NOW())
    RETURNING id
  `);
  const id = (result.rows[0] as any).id;
  res.json({ id });
});

// ─── PATCH /shop/live-chat/session/:id ────────────────────────────────────────
router.patch("/shop/live-chat/session/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    messages: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })).optional(),
    ended: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  const { messages, ended } = parsed.data;
  await db.execute(sql`
    UPDATE live_chat_sessions
    SET
      messages = COALESCE(${messages ? JSON.stringify(messages) : null}::jsonb, messages),
      message_count = COALESCE(${messages ? messages.length : null}, message_count),
      last_message_at = CASE WHEN ${messages != null} THEN NOW() ELSE last_message_at END,
      ended_at = CASE WHEN ${ended === true} THEN NOW() ELSE ended_at END
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// ─── GET /shop/live-chat/sessions ─────────────────────────────────────────────
router.get("/shop/live-chat/sessions", async (req: Request, res: Response) => {
  const flagged = req.query.flagged === "true";
  const rows = await db.execute(sql`
    SELECT id, contact_name, contact_email, message_count, messages,
           started_at, last_message_at, ended_at, page_url,
           flagged_for_training, training_notes
    FROM live_chat_sessions
    ${flagged ? sql`WHERE flagged_for_training = TRUE` : sql``}
    ORDER BY started_at DESC
    LIMIT 200
  `);
  res.json({ sessions: rows.rows });
});

// ─── PATCH /shop/live-chat/sessions/:id/flag ──────────────────────────────────
router.patch("/shop/live-chat/sessions/:id/flag", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = z.object({
    flagged: z.boolean(),
    notes: z.string().max(2000).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await db.execute(sql`
    UPDATE live_chat_sessions
    SET flagged_for_training = ${parsed.data.flagged},
        training_notes = COALESCE(${parsed.data.notes ?? null}, training_notes)
    WHERE id = ${id}
  `);
  res.json({ ok: true });
});

// ─── GET /shop/live-chat/system-prompt ────────────────────────────────────────
router.get("/shop/live-chat/system-prompt", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`SELECT value FROM settings WHERE key = 'live_chat_system_prompt' LIMIT 1`);
  const custom = (rows.rows[0] as any)?.value ?? null;
  res.json({ systemPrompt: custom });
});

// ─── PATCH /shop/live-chat/system-prompt ──────────────────────────────────────
router.patch("/shop/live-chat/system-prompt", async (req: Request, res: Response) => {
  const parsed = z.object({ systemPrompt: z.string().min(10).max(5000) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }
  await db.execute(sql`
    INSERT INTO settings (key, value) VALUES ('live_chat_system_prompt', ${parsed.data.systemPrompt})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);
  res.json({ ok: true });
});

// ─── POST /shop/live-chat ─────────────────────────────────────────────────────
router.post("/shop/live-chat", async (req: Request, res: Response) => {
  const parsed = z.object({
    messages: z.array(z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().max(2000),
    })).min(1).max(20),
    userName: z.string().max(100).optional(),
    userEmail: z.string().email().max(200).optional(),
  }).safeParse(req.body);

  if (!parsed.success) { res.status(400).json({ error: "Invalid request" }); return; }

  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  if (!apiKey || !baseUrl) { res.status(503).json({ error: "Chat service not configured" }); return; }

  const { userName, userEmail } = parsed.data;
  const userContext = userName ? `\nYou are speaking with ${userName}${userEmail ? ` (${userEmail})` : ""}. Address them by first name when natural.` : "";

  // Use custom system prompt from settings if set, otherwise fall back to default
  const promptRow = await db.execute(sql`SELECT value FROM settings WHERE key = 'live_chat_system_prompt' LIMIT 1`);
  const basePrompt = (promptRow.rows[0] as any)?.value ?? `You are a friendly, knowledgeable assistant for Select Branding Solutions — a UK workwear and branded uniform supplier based in Leeds.

Key facts:
- We supply workwear, uniforms, and branded clothing to businesses across the UK
- Services: in-house embroidery, heat-seal printing, on-site measuring, bespoke uniform management portals, free logo digitisation
- Online corporate ordering portal: wardrobe.selectbranding.co.uk
- UK delivery: £8.50 per order, next-day available
- Phone: 0113 255 2694
- Ethical sourcing: SA8000 and ISO14000 certified factories

Guidelines:
- Be concise, warm, and helpful — this is a live chat widget
- Never invent specific product prices; say "prices vary by quantity and product — call us or send a message for a quote"
- For complex orders or bespoke quotes, suggest: call 0113 255 2694, WhatsApp, or click "Send a message"
- Keep replies short (2-4 sentences max unless a list is clearer)`;

  const system = `${basePrompt}${userContext}`;

  try {
    const aiRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        messages: [{ role: "system", content: system }, ...parsed.data.messages],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!aiRes.ok) throw new Error(`AI API ${aiRes.status}`);
    const data: any = await aiRes.json();
    const reply: string = data.choices?.[0]?.message?.content?.trim()
      ?? "Sorry, I couldn't process that right now. Please try again or contact us directly.";
    res.json({ reply });
  } catch (err) {
    logger.error({ err }, "[live-chat] error");
    res.status(500).json({ error: "Chat temporarily unavailable — please use WhatsApp or send us a message." });
  }
});

export default router;
