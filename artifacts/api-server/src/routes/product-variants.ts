import { Router, type IRouter } from "express";
import { eq, and, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, productVariantsTable, productsTable, productAttributesTable } from "@workspace/db";

const router: IRouter = Router();

const productIdParam = z.object({ productId: z.coerce.number().int().positive() });
const subIdParam = z.object({ productId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

const variantBody = z.object({
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  sleeve: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  price: z.number().positive().optional().nullable(),
  stockQuantity: z.number().int().min(0).default(0),
  imageUrl: z.string().optional().nullable(),
  primarySupplierId: z.number().int().positive().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  supplierPrice: z.number().optional().nullable(),
  secondarySupplierId: z.number().int().positive().optional().nullable(),
  secondarySupplierCode: z.string().optional().nullable(),
  secondarySupplierPrice: z.number().optional().nullable(),
});

async function getProduct(id: number) {
  const [p] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  return p;
}

/** Roll up the sum of all variant stock quantities to the parent product's stock_quantity. */
async function rollupProductStock(productId: number) {
  await db.execute(sql`
    UPDATE products
    SET stock_quantity = (
      SELECT COALESCE(SUM(stock_quantity), 0)
      FROM product_variants
      WHERE product_id = ${productId}
    )
    WHERE id = ${productId}
  `);
}

// List variants for a product
router.get("/products/:productId/variants", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const rows = await db.select().from(productVariantsTable)
    .where(eq(productVariantsTable.productId, p.data.productId))
    .orderBy(productVariantsTable.colour, productVariantsTable.sleeve, productVariantsTable.size);
  res.json(rows.map(r => ({
    ...r,
    price: r.price != null ? parseFloat(r.price) : null,
    supplierPrice: r.supplierPrice != null ? parseFloat(r.supplierPrice) : null,
    secondarySupplierPrice: r.secondarySupplierPrice != null ? parseFloat(r.secondarySupplierPrice) : null,
  })));
});

// Create a variant
router.post("/products/:productId/variants", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const body = variantBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(productVariantsTable)
    .values({ ...body.data, productId: p.data.productId })
    .returning();
  await rollupProductStock(p.data.productId);
  res.status(201).json(row);
});

// Bulk-update supplier + price + code across multiple variants of the same product
// IMPORTANT: this must be registered BEFORE the /:id route so Express doesn't match "bulk" as an id param
router.patch("/products/:productId/variants/bulk", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const bodySchema = z.object({
    ids: z.array(z.number().int().positive()).min(1),
    primarySupplierId: z.number().int().positive().optional().nullable(),
    supplierPrice: z.number().optional().nullable(),
    supplierCode: z.string().optional().nullable(),
  });
  const body = bodySchema.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if ("primarySupplierId" in req.body) updates.primarySupplierId = body.data.primarySupplierId ?? null;
  if ("supplierPrice" in req.body) updates.supplierPrice = body.data.supplierPrice != null ? body.data.supplierPrice : null;
  if ("supplierCode" in req.body) updates.supplierCode = body.data.supplierCode ?? null;

  await db.update(productVariantsTable)
    .set(updates)
    .where(and(
      eq(productVariantsTable.productId, p.data.productId),
      inArray(productVariantsTable.id, body.data.ids),
    ));

  res.json({ updated: body.data.ids.length });
});

// Update a single variant (stock, suppliers)
router.patch("/products/:productId/variants/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = variantBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(productVariantsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(
      eq(productVariantsTable.id, p.data.id),
      eq(productVariantsTable.productId, p.data.productId),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }
  await rollupProductStock(p.data.productId);
  res.json(row);
});

// POST /products/:productId/variants/generate-matrix
// Creates all colour × size combinations from product attributes.
// Existing colour-only (size=null) variants with 0 stock are removed after expansion.
router.post("/products/:productId/variants/generate-matrix", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const productId = p.data.productId;
  const product = await getProduct(productId);
  if (!product) { res.status(404).json({ error: "Product not found" }); return; }
  const productSku = product.sku ?? null;

  // 1. Load attributes
  const attrs = await db.select().from(productAttributesTable)
    .where(eq(productAttributesTable.productId, productId));
  const colourAttrs = attrs.filter(a => a.type === "colour");
  const sizeAttrs = attrs.filter(a => a.type === "size");
  const sleeveAttrs = attrs.filter(a => a.type === "sleeve");

  if (colourAttrs.length === 0 || sizeAttrs.length === 0) {
    res.status(400).json({ error: "Product must have both colours and sizes defined as attributes" });
    return;
  }

  // 2. Load existing variants
  const existing = await db.select().from(productVariantsTable)
    .where(eq(productVariantsTable.productId, productId));

  // 3. Build colour → properties map from existing colour-only (size=null, sleeve=null) variants
  type ColourProps = {
    imageUrl: string | null;
    primarySupplierId: number | null;
    secondarySupplierId: number | null;
    supplierCode: string | null;
    supplierPrice: string | null;
    secondarySupplierCode: string | null;
    secondarySupplierPrice: string | null;
    sku: string | null;
  };
  const colourProps = new Map<string, ColourProps>();
  for (const v of existing) {
    if (v.size === null && v.colour !== null && !colourProps.has(v.colour)) {
      colourProps.set(v.colour, {
        imageUrl: v.imageUrl,
        primarySupplierId: v.primarySupplierId,
        secondarySupplierId: v.secondarySupplierId,
        supplierCode: v.supplierCode,
        supplierPrice: v.supplierPrice,
        secondarySupplierCode: v.secondarySupplierCode,
        secondarySupplierPrice: v.secondarySupplierPrice,
        sku: v.sku,
      });
    }
  }

  // 4. Create colour × size (× sleeve) variants that don't already exist
  const hasSleeve = sleeveAttrs.length > 0;
  // When sleeve is active, treat colour×size without a sleeve as expandable (like old colour-only logic)
  let created = 0;
  for (const colAttr of colourAttrs) {
    const colour = colAttr.value;
    const props = colourProps.get(colour) ?? {
      imageUrl: colAttr.imageUrl,
      primarySupplierId: null,
      secondarySupplierId: null,
      supplierCode: null,
      supplierPrice: null,
      secondarySupplierCode: null,
      secondarySupplierPrice: null,
      sku: productSku,
    };
    if (!props.sku) props.sku = productSku;
    if (!props.primarySupplierId) props.primarySupplierId = product.supplierId ?? null;
    if (!props.secondarySupplierId) props.secondarySupplierId = product.secondarySupplierId ?? null;

    for (const sizeAttr of sizeAttrs) {
      const size = sizeAttr.value;

      if (!hasSleeve) {
        // Original colour × size logic
        const alreadyExists = existing.some(v => v.colour === colour && v.size === size);
        if (!alreadyExists) {
          await db.insert(productVariantsTable).values({
            productId, colour, size,
            imageUrl: props.imageUrl,
            primarySupplierId: props.primarySupplierId,
            secondarySupplierId: props.secondarySupplierId,
            supplierCode: props.supplierCode,
            supplierPrice: props.supplierPrice,
            secondarySupplierCode: props.secondarySupplierCode,
            secondarySupplierPrice: props.secondarySupplierPrice,
            stockQuantity: 0,
          });
          created++;
        }
      } else {
        // Three-way: colour × size × sleeve
        for (const sleeveAttr of sleeveAttrs) {
          const sleeve = sleeveAttr.value;
          const alreadyExists = existing.some(v => v.colour === colour && v.size === size && v.sleeve === sleeve);
          if (!alreadyExists) {
            await db.insert(productVariantsTable).values({
              productId, colour, size, sleeve,
              imageUrl: props.imageUrl,
              primarySupplierId: props.primarySupplierId,
              secondarySupplierId: props.secondarySupplierId,
              supplierCode: props.supplierCode,
              supplierPrice: props.supplierPrice,
              secondarySupplierCode: props.secondarySupplierCode,
              secondarySupplierPrice: props.secondarySupplierPrice,
              stockQuantity: 0,
            });
            created++;
          }
        }
      }
    }
  }

  // 5. Delete old colour-only (size=null) variants that have 0 stock
  const toDeleteIds: number[] = [];
  existing.forEach(v => {
    if (v.size === null && (v.stockQuantity ?? 0) === 0) toDeleteIds.push(v.id);
    // When sleeve is now active, also clean up old sleeve-less colour×size variants with 0 stock
    if (hasSleeve && v.sleeve === null && v.size !== null && (v.stockQuantity ?? 0) === 0) toDeleteIds.push(v.id);
  });
  let deleted = 0;
  if (toDeleteIds.length > 0) {
    await db.delete(productVariantsTable)
      .where(and(
        eq(productVariantsTable.productId, productId),
        inArray(productVariantsTable.id, toDeleteIds),
      ));
    deleted = toDeleteIds.length;
  }

  await rollupProductStock(productId);
  res.json({ created, deleted, skipped: existing.filter(v => hasSleeve ? v.sleeve !== null : v.size !== null).length });
});

// Delete a variant
router.delete("/products/:productId/variants/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(productVariantsTable)
    .where(and(
      eq(productVariantsTable.id, p.data.id),
      eq(productVariantsTable.productId, p.data.productId),
    ))
    .returning();
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }
  await rollupProductStock(p.data.productId);
  res.sendStatus(204);
});

export default router;
