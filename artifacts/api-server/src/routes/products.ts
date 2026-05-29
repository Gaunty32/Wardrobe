import { Router, type IRouter } from "express";
import { eq, ilike, or, sql, and } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable } from "@workspace/db";
import { z } from "zod";
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
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const searchTerm = query.success && query.data.search ? `%${query.data.search}%` : null;

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
    ${searchTerm
      ? sql`WHERE (p.name ILIKE ${searchTerm} OR p.sku ILIKE ${searchTerm} OR p.description ILIKE ${searchTerm})`
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
