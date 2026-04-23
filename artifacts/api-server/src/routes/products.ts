import { Router, type IRouter } from "express";
import { eq, ilike, or, sql } from "drizzle-orm";
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

const router: IRouter = Router();

function fmtProduct(p: any) {
  return {
    ...p,
    unitPrice: p.unitPrice != null ? parseFloat(p.unitPrice) : 0,
    supplierPrice: p.supplierPrice != null ? parseFloat(p.supplierPrice) : null,
    secondarySupplierPrice: p.secondarySupplierPrice != null ? parseFloat(p.secondarySupplierPrice) : null,
  };
}

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  const searchTerm = query.success && query.data.search ? `%${query.data.search}%` : null;

  const rows = await db.execute(sql`
    SELECT p.*,
           c.name AS customer_name
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
    customerId: p.customer_id ?? null,
    wooCommerceId: p.woo_commerce_id ?? null,
    imageUrl: p.image_url ?? null,
    supplierId: p.supplier_id ?? null,
    supplierCode: p.supplier_code ?? null,
    stockQuantity: p.stock_quantity ?? null,
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
  const [product] = await db
    .insert(productsTable)
    .values({ ...parsed.data, category, unitPrice: String(parsed.data.unitPrice), customerId, isBespoke })
    .returning();
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

router.get("/products/next-bsp-sku", async (_req, res): Promise<void> => {
  res.json({ sku: await nextBspSku() });
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
  res.status(201).json(fmtProduct(created));
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
  res.json({ ...product, unitPrice: parseFloat(product.unitPrice), supplierPrice: product.supplierPrice != null ? parseFloat(product.supplierPrice) : null, secondarySupplierPrice: product.secondarySupplierPrice != null ? parseFloat(product.secondarySupplierPrice) : null });
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
  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({ ...product, unitPrice: parseFloat(product.unitPrice), supplierPrice: product.supplierPrice != null ? parseFloat(product.supplierPrice) : null, secondarySupplierPrice: product.secondarySupplierPrice != null ? parseFloat(product.secondarySupplierPrice) : null });
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
