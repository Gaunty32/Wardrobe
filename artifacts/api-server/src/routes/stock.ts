import { Router } from "express";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  customerFinishedItemsTable,
  productVariantsTable,
  productsTable,
  customersTable,
} from "@workspace/db";

const router = Router();

// ─── GET /stock/plain — all product variants with stock ───────────────────────

router.get("/stock/plain", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      variantId: productVariantsTable.id,
      productId: productsTable.id,
      productName: productsTable.name,
      productSku: productsTable.sku,
      colour: productVariantsTable.colour,
      size: productVariantsTable.size,
      sku: productVariantsTable.sku,
      stockQuantity: productVariantsTable.stockQuantity,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .orderBy(asc(productsTable.name), asc(productVariantsTable.colour), asc(productVariantsTable.size));
  res.json(rows);
});

// ─── PATCH /stock/plain/:id — update a variant's stock quantity ───────────────

router.patch("/stock/plain/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { stockQuantity } = z.object({ stockQuantity: z.number().int().min(0) }).parse(req.body);
  const [row] = await db
    .update(productVariantsTable)
    .set({ stockQuantity, updatedAt: new Date() })
    .where(eq(productVariantsTable.id, id))
    .returning({ id: productVariantsTable.id, stockQuantity: productVariantsTable.stockQuantity });
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }
  res.json(row);
});

// ─── GET /stock/finished — all finished items across all customers ────────────

router.get("/stock/finished", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: customerFinishedItemsTable.id,
      customerId: customerFinishedItemsTable.customerId,
      customerName: customersTable.name,
      name: customerFinishedItemsTable.name,
      productName: productsTable.name,
      colour: customerFinishedItemsTable.colour,
      size: customerFinishedItemsTable.size,
      unitPrice: customerFinishedItemsTable.unitPrice,
      stockQuantity: customerFinishedItemsTable.stockQuantity,
      notes: customerFinishedItemsTable.notes,
    })
    .from(customerFinishedItemsTable)
    .innerJoin(customersTable, eq(customerFinishedItemsTable.customerId, customersTable.id))
    .leftJoin(productsTable, eq(customerFinishedItemsTable.productId, productsTable.id))
    .orderBy(asc(customersTable.name), asc(customerFinishedItemsTable.name));
  res.json(rows.map(r => ({ ...r, unitPrice: r.unitPrice != null ? parseFloat(r.unitPrice) : 0 })));
});

// ─── PATCH /stock/finished/:id — update a finished item's stock quantity ──────

router.patch("/stock/finished/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { stockQuantity } = z.object({ stockQuantity: z.number().int().min(0) }).parse(req.body);
  const [row] = await db
    .update(customerFinishedItemsTable)
    .set({ stockQuantity, updatedAt: new Date() })
    .where(eq(customerFinishedItemsTable.id, id))
    .returning({ id: customerFinishedItemsTable.id, stockQuantity: customerFinishedItemsTable.stockQuantity });
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

export default router;
