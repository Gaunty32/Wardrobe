import { Router, type IRouter } from "express";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable } from "@workspace/db";
import { z } from "zod";
import { getWooSettings } from "./woo.js";
import {
  CreateProductBody,
  UpdateProductBody,
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
  ListProductsQueryParams,
} from "@workspace/api-zod";

const BESPOKE_TIES_CATEGORY = "Bespoke Ties";

const BESPOKE_TIE_SIZES: { label: string; suffix: string; sortOrder: number }[] = [
  { label: "Full Length Tie", suffix: "FLT", sortOrder: 0 },
  { label: "Clip-On Tie",     suffix: "COT", sortOrder: 1 },
  { label: "Clip-on Cravat",  suffix: "COC", sortOrder: 2 },
];

// Renames applied when old short names are found in the DB
const BESPOKE_TIE_RENAMES: Record<string, string> = {
  "Full Length": "Full Length Tie",
  "Clip-On":     "Clip-On Tie",
};

type ProductSupplierInfo = {
  supplierId?: number | null;
  supplierCode?: string | null;
  supplierPrice?: string | number | null;
};

async function ensureBespokeTieSizes(
  productId: number,
  productSku?: string | null,
  supplierInfo?: ProductSupplierInfo,
): Promise<void> {
  // Rename any legacy short values first
  for (const [oldVal, newVal] of Object.entries(BESPOKE_TIE_RENAMES)) {
    await db.execute(sql`
      UPDATE product_attributes
      SET value = ${newVal}
      WHERE product_id = ${productId} AND type = 'size' AND value = ${oldVal}
    `);
  }

  // Ensure all three size attributes exist
  const existing = await db.select().from(productAttributesTable)
    .where(and(
      eq(productAttributesTable.productId, productId),
      eq(productAttributesTable.type, "size"),
    ));
  const existingValues = new Set(existing.map((a) => a.value));
  for (const s of BESPOKE_TIE_SIZES) {
    if (!existingValues.has(s.label)) {
      await db.insert(productAttributesTable).values(
        { productId, type: "size", value: s.label, sortOrder: s.sortOrder }
      );
    }
  }

  // Auto-create size-only variant rows with SKUs (if product has a SKU)
  if (productSku) {
    const existingVariants = await db.select().from(productVariantsTable)
      .where(eq(productVariantsTable.productId, productId));
    const existingSizes = new Set(existingVariants.map((v) => v.size).filter(Boolean));

    const primarySupplierId = supplierInfo?.supplierId ?? null;
    const supplierCode = supplierInfo?.supplierCode ?? null;
    const supplierPrice = supplierInfo?.supplierPrice != null
      ? String(supplierInfo.supplierPrice) : null;

    // Insert each missing variant individually so one failure doesn't block the others
    for (const s of BESPOKE_TIE_SIZES) {
      if (!existingSizes.has(s.label)) {
        await db.insert(productVariantsTable).values({
          productId,
          size: s.label,
          sku: `${productSku}-${s.suffix}`,
          stockQuantity: 0,
          primarySupplierId,
          supplierCode,
          supplierPrice,
        });
      }
    }

    // Back-fill supplier info on any existing variants that are missing it
    if (primarySupplierId) {
      for (const v of existingVariants) {
        if (!v.primarySupplierId) {
          await db.update(productVariantsTable)
            .set({ primarySupplierId, supplierCode, supplierPrice })
            .where(eq(productVariantsTable.id, v.id));
        }
      }
    }
  }
}

const router: IRouter = Router();

function fmtProduct(p: any) {
  return {
    ...p,
    unitPrice: p.unitPrice != null ? parseFloat(p.unitPrice) : 0,
    supplierPrice: p.supplierPrice != null ? parseFloat(p.supplierPrice) : null,
    secondarySupplierPrice: p.secondarySupplierPrice != null ? parseFloat(p.secondarySupplierPrice) : null,
    supplierCurrency: p.supplierCurrency ?? "GBP",
    minOrderQty: p.minOrderQty ?? null,
    priceBreaks: p.priceBreaks ?? null,
    isService: p.isService ?? false,
    isArchived: p.isArchived ?? p.is_archived ?? false,
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const searchTerm = query.success && query.data.search ? `%${query.data.search}%` : null;
  const includeArchived = req.query.include_archived === "true" || req.query.include_archived === "1";

  const rows = await db.execute(sql`
    SELECT p.*,
           c.name AS customer_name,
           CASE
             WHEN EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
             THEN (SELECT COALESCE(SUM(pv.stock_quantity), 0) FROM product_variants pv WHERE pv.product_id = p.id)
             ELSE COALESCE(p.stock_quantity, 0)
           END AS computed_stock
    FROM products p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE (${includeArchived} OR COALESCE(p.is_archived, false) = false)
      ${searchTerm
        ? sql`AND (p.name ILIKE ${searchTerm} OR p.sku ILIKE ${searchTerm} OR p.description ILIKE ${searchTerm} OR p.supplier_code ILIKE ${searchTerm})`
        : sql``}
    ORDER BY p.name
  `);

  res.json(rows.rows.map((p: any) => ({
    ...p,
    unitPrice: p.unit_price != null ? parseFloat(p.unit_price) : 0,
    supplierPrice: p.supplier_price != null ? parseFloat(p.supplier_price) : null,
    secondarySupplierPrice: p.secondary_supplier_price != null ? parseFloat(p.secondary_supplier_price) : null,
    customerName: p.customer_name ?? null,
    isBespoke: p.is_bespoke ?? false,
    isService: p.is_service ?? false,
    isArchived: p.is_archived ?? false,
    customerId: p.customer_id ?? null,
    wooCommerceId: p.woo_commerce_id ?? null,
    imageUrl: p.image_url ?? null,
    permalink: p.permalink ?? null,
    supplierId: p.supplier_id ?? null,
    supplierCode: p.supplier_code ?? null,
    stockQuantity: p.computed_stock != null ? Number(p.computed_stock) : (p.stock_quantity ?? null),
    vatRate: p.vat_rate != null ? parseFloat(String(p.vat_rate)) : 0.20,
    taxClass: p.tax_class ?? null,
  })));
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const category = typeof req.body.category === "string" ? req.body.category.trim() || null : null;
  const customerId = req.body.customerId != null ? Number(req.body.customerId) || null : null;
  const isBespoke = customerId != null ? true : (req.body.isBespoke === true);
  const isService = req.body.isService === true;
  const [product] = await db
    .insert(productsTable)
    .values({ ...parsed.data, category, unitPrice: String(parsed.data.unitPrice), customerId, isBespoke, isService })
    .returning();
  if (category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(product.id, product.sku, product);
  res.status(201).json(fmtProduct(product));
});

async function nextBspSku(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM 4) AS INTEGER)), 0) AS max_num
    FROM products WHERE sku ~ '^BSP[0-9]+$'
  `);
  const maxNum = (result.rows[0] as any)?.max_num ?? 0;
  return `BSP${String(Number(maxNum) + 1).padStart(3, "0")}`;
}

async function nextFccSku(): Promise<string> {
  const result = await db.execute(sql`
    SELECT COALESCE(MAX(CAST(SUBSTRING(sku FROM 4) AS INTEGER)), 0) AS max_num
    FROM products WHERE sku ~ '^FCC[0-9]+$'
  `);
  const maxNum = (result.rows[0] as any)?.max_num ?? 0;
  // Never suggest below FCC5151 — FCC5150 is the last known assigned number
  const next = Math.max(Number(maxNum) + 1, 5151);
  return `FCC${String(next).padStart(4, "0")}`;
}

router.get("/products/next-bsp-sku", async (_req, res): Promise<void> => {
  res.json({ sku: await nextBspSku() });
});

router.get("/products/next-fcc-sku", async (_req, res): Promise<void> => {
  res.json({ sku: await nextFccSku() });
});

router.get("/products/category-names", async (_req, res): Promise<void> => {
  const result = await db.execute(sql`
    SELECT DISTINCT TRIM(category) AS name
    FROM products
    WHERE category IS NOT NULL AND TRIM(category) <> ''
    ORDER BY name
  `);
  res.json((result.rows as any[]).map((r) => r.name as string));
});

router.post("/products/:id/duplicate", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [original] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!original) { res.status(404).json({ error: "Product not found" }); return; }

  const isBespoke = original.isBespoke ?? false;
  let newSku: string;
  if (isBespoke) {
    newSku = await nextBspSku();
  } else {
    const base = original.sku ? original.sku.replace(/-COPY\d*$/, "") : "";
    newSku = base ? `${base}-COPY` : "";
  }

  const { id: _id, createdAt: _ca, updatedAt: _ua, wooCommerceId: _woo, ...fields } = original;
  const [created] = await db.insert(productsTable).values({
    ...fields,
    sku: newSku,
    name: `${original.name} (Copy)`,
    stockQuantity: 0,
  }).returning();
  if (created.category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(created.id, created.sku, created);
  res.status(201).json(fmtProduct(created));
});

router.get("/products/issues", async (req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      p.id, p.name, p.sku, p.image_url, p.woo_commerce_id,
      p.unit_price, p.supplier_price,
      p.issue_no_image, p.issue_low_gp, p.issues_checked_at,
      s.name AS supplier_name,
      CASE
        WHEN p.supplier_price IS NOT NULL
          AND p.unit_price IS NOT NULL
          AND CAST(p.unit_price AS float) > 0
        THEN ROUND(
          ((CAST(p.unit_price AS float) - CAST(p.supplier_price AS float))
           / CAST(p.unit_price AS float) * 100)::numeric, 1)
        ELSE NULL
      END AS gp_pct,
      -- Minimum whole-pound price that achieves ≥80% GP: ceil(cost / 0.20)
      CASE
        WHEN p.issue_low_gp = true AND p.supplier_price IS NOT NULL
        THEN CEIL(CAST(p.supplier_price AS float) / 0.20)
        ELSE NULL
      END AS suggested_price
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE (p.issue_no_image = true OR p.issue_low_gp = true)
      AND p.is_archived = false
    ORDER BY p.issue_no_image DESC, gp_pct ASC NULLS LAST, p.name
  `);
  const products = ((rows.rows ?? rows) as any[]).map(r => ({
    id: r.id,
    name: r.name,
    sku: r.sku,
    imageUrl: r.image_url ?? null,
    supplierName: r.supplier_name ?? null,
    unitPrice: r.unit_price != null ? parseFloat(r.unit_price) : null,
    supplierPrice: r.supplier_price != null ? parseFloat(r.supplier_price) : null,
    gpPct: r.gp_pct != null ? parseFloat(r.gp_pct) : null,
    suggestedPrice: r.suggested_price != null ? parseFloat(r.suggested_price) : null,
    issueNoImage: r.issue_no_image,
    issueLowGp: r.issue_low_gp,
    wooCommerceId: r.woo_commerce_id ?? null,
    lastChecked: r.issues_checked_at ?? null,
  }));
  res.json({ products, total: products.length, lastChecked: products[0]?.lastChecked ?? null });
});

// ── Push a new sell price to the SBS DB + WooCommerce ─────────────────────────
router.post("/products/:id/push-woo-price", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = z.object({ newPrice: z.number().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { id } = parsed.data;
  const { newPrice } = body.data;

  // Update sell price in local DB
  await db.execute(sql`
    UPDATE products SET unit_price = ${newPrice.toFixed(2)} WHERE id = ${id}
  `);

  // Refresh issue flags for this product
  await db.execute(sql`
    UPDATE products SET
      issue_low_gp = (
        supplier_price IS NOT NULL AND unit_price IS NOT NULL
        AND CAST(unit_price AS float) > 0
        AND (CAST(unit_price AS float) - CAST(supplier_price AS float))
            / CAST(unit_price AS float) * 100 < 80
      ),
      issues_checked_at = NOW()
    WHERE id = ${id}
  `);

  // Push to WooCommerce if configured
  const [product] = await db.execute(sql`SELECT woo_commerce_id FROM products WHERE id = ${id}`).then(r => (r.rows ?? r) as any[]);
  if (!product?.woo_commerce_id) {
    res.json({ ok: true, wooPushed: false, message: "Price updated locally (no WooCommerce ID)" });
    return;
  }

  const settings = await getWooSettings();
  if (!settings) {
    res.json({ ok: true, wooPushed: false, message: "Price updated locally (WooCommerce not configured)" });
    return;
  }

  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const wooRes = await fetch(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ regular_price: newPrice.toFixed(2) }),
  });

  if (!wooRes.ok) {
    const text = await wooRes.text().catch(() => wooRes.status.toString());
    res.status(502).json({ error: `Price updated locally but WooCommerce returned ${wooRes.status}: ${text}` });
    return;
  }

  res.json({ ok: true, wooPushed: true, newPrice });
});

router.get("/products/analytics", async (req, res): Promise<void> => {
  const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };

  const rows = await db.execute(sql`
    SELECT
      p.id,
      p.sku,
      p.name,
      p.unit_price,
      p.supplier_price,
      p.supplier_currency,
      s.name AS supplier_name,
      COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS qty_sold,
      COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.line_total::numeric ELSE 0 END), 0) AS revenue
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN order_items oi ON oi.product_id = p.id
    LEFT JOIN orders o ON o.id = oi.order_id
      AND o.status NOT IN ('cancelled', 'portal_draft', 'draft')
      ${dateFrom ? sql`AND o.order_date >= ${dateFrom}::date` : sql``}
      ${dateTo ? sql`AND o.order_date < ${dateTo}::date + interval '1 day'` : sql``}
    GROUP BY p.id, p.sku, p.name, p.unit_price, p.supplier_price, p.supplier_currency, s.name
    ORDER BY p.name
  `);

  res.json((rows.rows as any[]).map((r) => {
    const price = r.unit_price != null ? parseFloat(r.unit_price) : 0;
    const cost = r.supplier_price != null ? parseFloat(r.supplier_price) : null;
    const gp = cost != null && price > 0 ? ((price - cost) / price) * 100 : null;
    return {
      id: r.id,
      sku: r.sku ?? "",
      name: r.name,
      supplierName: r.supplier_name ?? null,
      price,
      supplierCost: cost,
      supplierCurrency: r.supplier_currency ?? "GBP",
      grossProfitPct: gp != null ? Math.round(gp * 10) / 10 : null,
      qtySold: Number(r.qty_sold),
      revenue: parseFloat(r.revenue ?? "0"),
    };
  }));
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, params.data.id));
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json(fmtProduct(product));
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.unitPrice !== undefined) {
    updateData.unitPrice = String(parsed.data.unitPrice);
  }
  if ("category" in req.body) {
    updateData.category = typeof req.body.category === "string" ? req.body.category.trim() || null : null;
  }
  if ("customerId" in req.body) {
    const cid = req.body.customerId != null ? Number(req.body.customerId) || null : null;
    updateData.customerId = cid;
    if (cid != null) updateData.isBespoke = true;
  }
  if ("isBespoke" in req.body) {
    updateData.isBespoke = req.body.isBespoke === true;
    if (req.body.isBespoke === false) updateData.customerId = null;
  }
  if ("isService" in req.body) {
    updateData.isService = req.body.isService === true;
  }
  if ("isArchived" in req.body) {
    updateData.isArchived = req.body.isArchived === true;
  }
  if ("supplierCurrency" in req.body) {
    updateData.supplierCurrency = typeof req.body.supplierCurrency === "string" ? req.body.supplierCurrency : "GBP";
  }
  if ("minOrderQty" in req.body) {
    updateData.minOrderQty = req.body.minOrderQty != null ? Number(req.body.minOrderQty) || null : null;
  }
  if ("priceBreaks" in req.body) {
    updateData.priceBreaks = Array.isArray(req.body.priceBreaks) ? req.body.priceBreaks : null;
  }
  if ("supplierPrice" in req.body) {
    updateData.supplierPrice = req.body.supplierPrice != null && req.body.supplierPrice !== "" ? String(req.body.supplierPrice) : null;
  }
  if ("secondarySupplierPrice" in req.body) {
    updateData.secondarySupplierPrice = req.body.secondarySupplierPrice != null && req.body.secondarySupplierPrice !== "" ? String(req.body.secondarySupplierPrice) : null;
  }
  if ("supplierCode" in req.body) {
    updateData.supplierCode = req.body.supplierCode || null;
  }
  if ("secondarySupplierCode" in req.body) {
    updateData.secondarySupplierCode = req.body.secondarySupplierCode || null;
  }
  if ("guidanceTags" in req.body) {
    updateData.guidanceTags = Array.isArray(req.body.guidanceTags) ? req.body.guidanceTags : null;
  }
  if ("guidanceBadges" in req.body) {
    updateData.guidanceBadges = Array.isArray(req.body.guidanceBadges) ? req.body.guidanceBadges : null;
  }
  if ("guidanceStaffQuotes" in req.body) {
    updateData.guidanceStaffQuotes = Array.isArray(req.body.guidanceStaffQuotes) ? req.body.guidanceStaffQuotes : null;
  }
  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  if (product.category === BESPOKE_TIES_CATEGORY) await ensureBespokeTieSizes(product.id, product.sku, product);
  res.json(fmtProduct(product));
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [product] = await db.delete(productsTable).where(eq(productsTable.id, params.data.id)).returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.sendStatus(204);
});

// ── Push guidance data to WooCommerce as product meta ─────────────────────────
router.post("/products/:id/push-woo-guidance", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Resolve a public base URL so relative /api/storage/... image paths become
  // absolute URLs that WooCommerce can fetch from outside our server.
  const publicBase = (() => {
    const domains = process.env.REPLIT_DOMAINS ?? "";
    const first = domains.split(",")[0]?.trim();
    if (first) return `https://${first}`;
    const fwdHost = req.headers["x-forwarded-host"] as string | undefined;
    const host = fwdHost ?? req.headers.host ?? "";
    return host ? `${req.protocol}://${host}` : "";
  })();
  const toAbsolute = (url: string | null | undefined): string | null => {
    if (!url) return null;
    return url.startsWith("/") ? `${publicBase}${url}` : url;
  };

  const rows = await db.execute(sql`
    SELECT woo_commerce_id,
           guidance_value_rating, guidance_durability_rating, guidance_smart_rating,
           guidance_badges, guidance_tags, guidance_best_for, guidance_not_ideal_for,
           guidance_staff_quotes
    FROM products WHERE id = ${parsed.data.id}
  `);
  const product = (rows.rows ?? rows)[0] as any;
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  if (!product.woo_commerce_id) { res.status(400).json({ error: "This product has no WooCommerce ID — it cannot be synced." }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured. Check Settings → WooCommerce." }); return; }

  // Convert a numeric rating (1–5) to a unicode star string e.g. "★★★★☆"
  function toStars(rating: any, max = 5): string {
    const n = Math.min(Math.max(parseInt(String(rating ?? 0), 10) || 0, 0), max);
    return "★".repeat(n) + "☆".repeat(max - n);
  }

  const valRating  = parseInt(String(product.guidance_value_rating       ?? 0), 10) || 0;
  const durRating  = parseInt(String(product.guidance_durability_rating   ?? 0), 10) || 0;
  const techRating = parseInt(String(product.guidance_smart_rating        ?? 0), 10) || 0;

  // ── Ratings — card grid with large amber stars ─────────────────────────────
  const ratingItems = [
    { label: "Value for Money",    n: valRating  },
    { label: "Durability",         n: durRating  },
    { label: "Technical Features", n: techRating },
  ].filter(r => r.n > 0);

  const ratingsHtml = ratingItems.length === 0 ? "" :
    `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:16px 20px;background:linear-gradient(135deg,#1e3a5f 0%,#2d5491 100%);border-radius:14px;margin-bottom:20px">` +
    ratingItems.map(r =>
      `<div style="flex:1;min-width:110px;text-align:center">` +
        `<div style="font-size:0.65em;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:6px">${r.label}</div>` +
        `<div style="color:#fbbf24;font-size:1.7em;letter-spacing:2px;line-height:1">${"★".repeat(r.n)}${"☆".repeat(5 - r.n)}</div>` +
        `<div style="font-size:0.7em;color:#bfdbfe;margin-top:4px;font-weight:600">${r.n} / 5</div>` +
      `</div>`
    ).join("") +
    `</div>`;

  // ── Badge pills — bold coloured with shadow ───────────────────────────────
  const BADGE_STYLES: Record<string, { icon: string; bg: string; color: string; shadow: string }> = {
    "Most Popular":      { icon: "🏆", bg: "linear-gradient(135deg,#1e3a5f,#2d5491)", color: "#ffffff", shadow: "rgba(30,58,95,0.4)"  },
    "Best Value":        { icon: "💰", bg: "linear-gradient(135deg,#15803d,#16a34a)", color: "#ffffff", shadow: "rgba(21,128,61,0.4)"  },
    "Premium Choice":    { icon: "💎", bg: "linear-gradient(135deg,#6d28d9,#7c3aed)", color: "#ffffff", shadow: "rgba(109,40,217,0.4)" },
    "Staff Pick":        { icon: "⭐", bg: "linear-gradient(135deg,#92400e,#b45309)", color: "#ffffff", shadow: "rgba(146,64,14,0.4)"  },
    "Bulk Buy Discount": { icon: "📦", bg: "linear-gradient(135deg,#075985,#0369a1)", color: "#ffffff", shadow: "rgba(7,89,133,0.4)"   },
  };

  const TAG_STYLES: Record<string, { icon: string; bg: string; color: string; border: string }> = {
    "Everyday Workwear": { icon: "👕", bg: "#eff6ff", color: "#1d4ed8", border: "#3b82f6" },
    "Smart Uniform":     { icon: "👔", bg: "#fdf4ff", color: "#7e22ce", border: "#a855f7" },
    "Heavy Duty":        { icon: "💪", bg: "#fff7ed", color: "#c2410c", border: "#f97316" },
    "Budget Friendly":   { icon: "💲", bg: "#f0fdf4", color: "#15803d", border: "#22c55e" },
    "Premium":           { icon: "💎", bg: "#f5f3ff", color: "#6d28d9", border: "#8b5cf6" },
  };

  const badges: string[] = Array.isArray(product.guidance_badges) ? product.guidance_badges : [];
  const tags: string[]   = Array.isArray(product.guidance_tags)   ? product.guidance_tags   : [];

  const badgesHtml = badges.length === 0 ? "" :
    `<div style="margin-bottom:16px">` +
    badges.map(b => {
      const s = BADGE_STYLES[b] ?? { icon: "✔", bg: "linear-gradient(135deg,#1e3a5f,#2d5491)", color: "#ffffff", shadow: "rgba(30,58,95,0.4)" };
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:7px 16px;border-radius:999px;font-size:0.88em;font-weight:700;margin:4px;line-height:1.3;white-space:nowrap;background:${s.bg};color:${s.color};box-shadow:0 3px 10px ${s.shadow}">${s.icon} ${b}</span>`;
    }).join("") +
    `</div>`;

  const tagsHtml = tags.length === 0 ? "" :
    `<div style="margin-bottom:16px">` +
    tags.map(t => {
      const s = TAG_STYLES[t] ?? { icon: "🏷", bg: "#f1f5f9", color: "#334155", border: "#94a3b8" };
      return `<span style="display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:999px;font-size:0.85em;font-weight:600;margin:4px;line-height:1.3;white-space:nowrap;background:${s.bg};color:${s.color};border:2px solid ${s.border}">${s.icon} ${t}</span>`;
    }).join("") +
    `</div>`;

  // ── Best For / Not Ideal For ───────────────────────────────────────────────
  function sectionHtml(
    icon: string, label: string, headerBg: string, headerColor: string, accentColor: string, text: string
  ): string {
    if (!text?.trim()) return "";
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    const listItems = lines.map(l =>
      `<li style="margin-bottom:6px;padding-left:4px">${l}</li>`
    ).join("");
    return `<div style="margin-bottom:18px;border-radius:12px;overflow:hidden;border:1.5px solid ${accentColor}20">` +
      `<div style="background:${headerBg};color:${headerColor};padding:8px 14px;font-weight:700;font-size:0.88em;display:flex;align-items:center;gap:6px">${icon} ${label}</div>` +
      `<div style="padding:12px 16px;background:#fff"><ul style="margin:0;padding-left:18px;color:#374151;font-size:0.92em;line-height:1.7">${listItems}</ul></div>` +
      `</div>`;
  }

  const bestForHtml     = sectionHtml("✅", "Best For",      "#15803d", "#ffffff", "#16a34a", product.guidance_best_for      ?? "");
  const notIdealForHtml = sectionHtml("⚠️",  "Not Ideal For", "#c2410c", "#ffffff", "#f97316", product.guidance_not_ideal_for ?? "");

  // ── Staff quotes ───────────────────────────────────────────────────────────
  // Fetch current profile photos so they're always up to date regardless of when the quote was saved
  const staffRows = await db.execute(sql`SELECT id, profile_image_url FROM staff_members`);
  const staffPhotoMap: Record<number, string | null> = {};
  for (const row of ((staffRows.rows ?? staffRows) as any[])) {
    staffPhotoMap[row.id] = row.profile_image_url ?? null;
  }

  const rawQuotes: any[] = Array.isArray(product.guidance_staff_quotes) ? product.guidance_staff_quotes : [];
  const staffQuotesClean = rawQuotes.map((q: any) => {
    const name     = q.staffName   ?? q.name      ?? "";
    const role     = q.staffRole   ?? q.role      ?? "";
    // Always prefer the live DB photo over the cached JSONB value, then make absolute
    const imageUrl = toAbsolute((q.staffId ? staffPhotoMap[q.staffId] : null) ?? q.staffImageUrl ?? q.imageUrl ?? null);
    const quote    = q.rewritten   ?? q.draft     ?? "";
    return {
      name,
      role, title: role, job_title: role, position: role,
      imageUrl, image_url: imageUrl, image: imageUrl, avatar: imageUrl, photo: imageUrl,
      quote, text: quote,
      aiPolished: !!(q.rewritten),
    };
  });

  const staffQuotesHtml = staffQuotesClean.length === 0 ? "" :
    `<div style="margin-bottom:8px">` +
    `<div style="font-size:0.7em;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px">&#128172; Staff Recommendations</div>` +
    staffQuotesClean.map(q => {
      const initial = (q.name || "?")[0].toUpperCase();
      const avatar = q.imageUrl
        ? `<img src="${q.imageUrl}" alt="${q.name}" style="width:56px;height:56px;border-radius:50%;object-fit:cover;flex-shrink:0;border:3px solid #1e3a5f;box-shadow:0 2px 8px rgba(30,58,95,0.25)" />`
        : `<div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#1e3a5f,#2d5491);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.4em;font-weight:700;flex-shrink:0;box-shadow:0 2px 8px rgba(30,58,95,0.3)">${initial}</div>`;
      return `<div style="border:1.5px solid #e2e8f0;border-radius:14px;padding:18px 20px;margin-bottom:14px;background:linear-gradient(135deg,#f8fafc,#fff);box-shadow:0 2px 12px rgba(0,0,0,0.06)">` +
        `<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">` +
          avatar +
          `<div>` +
            `<div style="font-weight:700;color:#1e3a5f;font-size:1.05em;line-height:1.2">${q.name}</div>` +
            `${q.role ? `<div style="color:#64748b;font-size:0.82em;margin-top:3px;font-weight:500">${q.role}</div>` : ""}` +
          `</div>` +
        `</div>` +
        `<p style="margin:0;font-style:italic;color:#374151;font-size:0.95em;line-height:1.7;border-left:4px solid #1e3a5f;padding-left:12px;background:#f0f4ff;padding:10px 14px 10px 14px;border-radius:0 8px 8px 0">&ldquo;${q.quote}&rdquo;</p>` +
      `</div>`;
    }).join("") +
    `</div>`;

  const meta_data = [
    // Numeric values (for plugin logic)
    { key: "_sbs_value_rating",           value: String(valRating)  },
    { key: "_sbs_durability_rating",       value: String(durRating)  },
    { key: "_sbs_technical_rating",        value: String(techRating) },
    // Unicode star strings (one per rating, for simple display)
    { key: "_sbs_value_stars",             value: toStars(valRating)  },
    { key: "_sbs_durability_stars",        value: toStars(durRating)  },
    { key: "_sbs_technical_stars",         value: toStars(techRating) },
    // Combined HTML block (all three ratings in one field)
    { key: "_sbs_ratings_html",            value: ratingsHtml },
    // Badges — plain comma-separated string (theme wraps each in its own pill);
    //          JSON array and pre-built HTML pills available as alternate keys
    { key: "_sbs_badges",                  value: badges.join(",") },
    { key: "_sbs_badges_json",             value: JSON.stringify(badges) },
    { key: "_sbs_badges_html",             value: badgesHtml },
    // Guidance tags — plain comma-separated string; JSON and HTML as alternate keys
    { key: "_sbs_tags",                    value: tags.join(",") },
    { key: "_sbs_tags_json",               value: JSON.stringify(tags) },
    { key: "_sbs_tags_html",               value: tagsHtml },
    // Best For — plain text for theme rendering; pre-built HTML section as _html variant
    { key: "_sbs_best_for",                value: product.guidance_best_for               ?? "" },
    { key: "_sbs_best_for_html",           value: bestForHtml },
    // Not Ideal For — plain text for theme rendering; pre-built HTML section as _html variant
    { key: "_sbs_not_ideal_for",           value: product.guidance_not_ideal_for          ?? "" },
    { key: "_sbs_not_ideal_for_html",      value: notIdealForHtml },
    // Staff quotes — clean JSON for theme rendering; pre-built HTML cards as _html variant
    { key: "_sbs_staff_quotes",            value: JSON.stringify(staffQuotesClean) },
    { key: "_sbs_staff_quotes_html",       value: staffQuotesHtml },
  ];

  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/products/${product.woo_commerce_id}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);

  const wooRes = await fetch(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ meta_data }),
  });

  if (!wooRes.ok) {
    const text = await wooRes.text().catch(() => wooRes.status.toString());
    res.status(502).json({ error: `WooCommerce returned ${wooRes.status}: ${text}` });
    return;
  }

  res.json({ ok: true, pushed: meta_data.length });
});

router.get("/products/:id/attributes", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const attributes = await db
    .select()
    .from(productAttributesTable)
    .where(eq(productAttributesTable.productId, parsed.data.id))
    .orderBy(productAttributesTable.type, productAttributesTable.value);
  res.json(attributes);
});

router.get("/products/:id/variants", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const variants = await db
    .select()
    .from(productVariantsTable)
    .where(eq(productVariantsTable.productId, parsed.data.id));
  res.json(variants.map(v => ({ ...v, price: v.price ? parseFloat(v.price) : null })));
});

export default router;
