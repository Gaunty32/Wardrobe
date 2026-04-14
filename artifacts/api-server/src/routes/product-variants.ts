import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db, productVariantsTable, productsTable } from "@workspace/db";

const router: IRouter = Router();

const productIdParam = z.object({ productId: z.coerce.number().int().positive() });
const subIdParam = z.object({ productId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });

const variantBody = z.object({
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  price: z.number().positive().optional().nullable(),
  stockQuantity: z.number().int().min(0).default(0),
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

// List variants for a product
router.get("/products/:productId/variants", async (req, res): Promise<void> => {
  const p = productIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getProduct(p.data.productId)) { res.status(404).json({ error: "Product not found" }); return; }
  const rows = await db.select().from(productVariantsTable)
    .where(eq(productVariantsTable.productId, p.data.productId))
    .orderBy(productVariantsTable.colour, productVariantsTable.size);
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
  res.status(201).json(row);
});

// Update a variant (stock, suppliers)
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
  res.json(row);
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
  res.sendStatus(204);
});

export default router;
