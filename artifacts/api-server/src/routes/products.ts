import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
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

router.get("/products", async (req, res): Promise<void> => {
  const query = ListProductsQueryParams.safeParse(req.query);
  let products;
  if (query.success && query.data.search) {
    const term = `%${query.data.search}%`;
    products = await db
      .select()
      .from(productsTable)
      .where(or(ilike(productsTable.name, term), ilike(productsTable.sku, term), ilike(productsTable.description, term)))
      .orderBy(productsTable.name);
  } else {
    products = await db.select().from(productsTable).orderBy(productsTable.name);
  }
  res.json(
    products.map((p) => ({
      ...p,
      unitPrice: parseFloat(p.unitPrice),
      supplierPrice: p.supplierPrice != null ? parseFloat(p.supplierPrice) : null,
    }))
  );
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const category = typeof req.body.category === "string" ? req.body.category.trim() || null : null;
  const [product] = await db
    .insert(productsTable)
    .values({ ...parsed.data, category, unitPrice: String(parsed.data.unitPrice) })
    .returning();
  res.status(201).json({ ...product, unitPrice: parseFloat(product.unitPrice) });
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
  res.json({ ...product, unitPrice: parseFloat(product.unitPrice), supplierPrice: product.supplierPrice != null ? parseFloat(product.supplierPrice) : null });
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
  const [product] = await db
    .update(productsTable)
    .set(updateData)
    .where(eq(productsTable.id, params.data.id))
    .returning();
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({ ...product, unitPrice: parseFloat(product.unitPrice), supplierPrice: product.supplierPrice != null ? parseFloat(product.supplierPrice) : null });
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
