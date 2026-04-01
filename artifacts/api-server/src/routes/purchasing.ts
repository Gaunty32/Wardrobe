import { Router, type IRouter } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { db, orderItemsTable, ordersTable, productsTable, suppliersTable, purchaseOrdersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/purchasing/requirements", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      itemId: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      productId: orderItemsTable.productId,
      productName: orderItemsTable.productName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      purchaseQuantity: orderItemsTable.purchaseQuantity,
      supplierId: orderItemsTable.supplierId,
      supplierName: orderItemsTable.supplierName,
      supplierEmail: suppliersTable.email,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(suppliersTable, eq(orderItemsTable.supplierId, suppliersTable.id))
    .where(eq(orderItemsTable.purchaseRequired, true))
    .orderBy(orderItemsTable.supplierName, orderItemsTable.productName);

  const grouped: Record<string, {
    supplierId: number | null;
    supplierName: string;
    supplierEmail: string | null;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.supplierName ?? "Unknown Supplier";
    if (!grouped[key]) {
      grouped[key] = {
        supplierId: row.supplierId,
        supplierName: key,
        supplierEmail: row.supplierEmail ?? null,
        items: [],
      };
    }
    grouped[key].items.push(row);
  }

  res.json(Object.values(grouped));
});

router.post("/purchasing/mark-fulfilled", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  for (const itemId of parsed.data.itemIds) {
    await db
      .update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(eq(orderItemsTable.id, itemId));
  }
  res.json({ ok: true });
});

router.get("/purchasing/stock-check", async (req, res): Promise<void> => {
  const parsed = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  }).safeParse(req.query);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [product] = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      stockQuantity: productsTable.stockQuantity,
      supplierId: productsTable.supplierId,
      supplierCode: productsTable.supplierCode,
      supplierName: suppliersTable.name,
      supplierEmail: suppliersTable.email,
    })
    .from(productsTable)
    .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(eq(productsTable.id, parsed.data.productId));

  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const stock = product.stockQuantity ?? 0;
  const requested = parsed.data.quantity;
  const available = Math.min(stock, requested);
  const shortfall = Math.max(0, requested - stock);

  res.json({
    productId: product.id,
    productName: product.name,
    stockQuantity: stock,
    requested,
    available,
    shortfall,
    purchaseRequired: shortfall > 0,
    supplierId: product.supplierId,
    supplierName: product.supplierName,
    supplierEmail: product.supplierEmail,
    supplierCode: product.supplierCode,
  });
});

router.post("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const parsed = z.object({
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string(),
    supplierEmail: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    itemIds: z.array(z.number().int().positive()),
  }).safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;

  const [po] = await db
    .insert(purchaseOrdersTable)
    .values({
      poNumber,
      supplierId: parsed.data.supplierId ?? null,
      supplierName: parsed.data.supplierName,
      supplierEmail: parsed.data.supplierEmail ?? null,
      status: "draft",
      notes: parsed.data.notes ?? null,
    })
    .returning();

  res.status(201).json(po);
});

router.get("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const orders = await db.select().from(purchaseOrdersTable).orderBy(desc(purchaseOrdersTable.createdAt));
  res.json(orders);
});

export default router;
