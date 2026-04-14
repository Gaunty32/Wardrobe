import { Router, type IRouter } from "express";
import { eq, and, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  db, orderItemsTable, ordersTable, productsTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
} from "@workspace/db";

const router: IRouter = Router();

// ─── Requirements ────────────────────────────────────────────────────────────

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
      resolvedSupplierName: suppliersTable.name,
      supplierEmail: suppliersTable.email,
      supplierCode: productsTable.supplierCode,
      productSku: productsTable.sku,
      canonicalProductName: productsTable.name,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(suppliersTable, eq(orderItemsTable.supplierId, suppliersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.purchaseRequired, true))
    .orderBy(orderItemsTable.supplierName, orderItemsTable.productName);

  const grouped: Record<string, {
    supplierId: number | null;
    supplierName: string;
    supplierEmail: string | null;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.resolvedSupplierName ?? row.supplierName ?? "Unknown Supplier";
    if (!grouped[key]) {
      grouped[key] = { supplierId: row.supplierId, supplierName: key, supplierEmail: row.supplierEmail ?? null, items: [] };
    }
    grouped[key].items.push(row);
  }

  res.json(Object.values(grouped));
});

router.post("/purchasing/mark-fulfilled", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const itemId of parsed.data.itemIds) {
    await db.update(orderItemsTable).set({ purchaseRequired: false, purchaseQuantity: null }).where(eq(orderItemsTable.id, itemId));
  }
  res.json({ ok: true });
});

router.get("/purchasing/stock-check", async (req, res): Promise<void> => {
  const parsed = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [product] = await db
    .select({ id: productsTable.id, name: productsTable.name, stockQuantity: productsTable.stockQuantity, supplierId: productsTable.supplierId, supplierCode: productsTable.supplierCode, supplierName: suppliersTable.name, supplierEmail: suppliersTable.email })
    .from(productsTable)
    .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(eq(productsTable.id, parsed.data.productId));

  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const stock = product.stockQuantity ?? 0;
  const requested = parsed.data.quantity;
  const available = Math.min(stock, requested);
  const shortfall = Math.max(0, requested - stock);

  res.json({ productId: product.id, productName: product.name, stockQuantity: stock, requested, available, shortfall, purchaseRequired: shortfall > 0, supplierId: product.supplierId, supplierName: product.supplierName, supplierEmail: product.supplierEmail, supplierCode: product.supplierCode });
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

async function getPoWithItems(poId: number) {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) return null;
  const items = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, poId));
  return { ...po, items };
}

router.get("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const pos = await db.select().from(purchaseOrdersTable).orderBy(desc(purchaseOrdersTable.createdAt));
  const poIds = pos.map((p) => p.id);
  const allItems = poIds.length > 0
    ? await db.select().from(purchaseOrderItemsTable).where(inArray(purchaseOrderItemsTable.poId, poIds))
    : [];
  const result = pos.map((po) => ({
    ...po,
    items: allItems.filter((i) => i.poId === po.id),
  }));
  res.json(result);
});

router.get("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const po = await getPoWithItems(parsed.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.json(po);
});

router.post("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const parsed = z.object({
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string(),
    supplierEmail: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    itemIds: z.array(z.number().int().positive()),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const now = new Date();
  const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;

  const [po] = await db.insert(purchaseOrdersTable).values({
    poNumber,
    supplierId: parsed.data.supplierId ?? null,
    supplierName: parsed.data.supplierName,
    supplierEmail: parsed.data.supplierEmail ?? null,
    status: "draft",
    notes: parsed.data.notes ?? null,
  }).returning();

  if (parsed.data.itemIds.length > 0) {
    const orderItems = await db.select().from(orderItemsTable)
      .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(inArray(orderItemsTable.id, parsed.data.itemIds));

    await db.insert(purchaseOrderItemsTable).values(
      orderItems.map((row) => ({
        poId: po.id,
        orderItemId: row.order_items.id,
        orderId: row.order_items.orderId,
        orderNumber: row.orders?.orderNumber ?? null,
        productName: row.order_items.productName,
        colour: row.order_items.colour ?? null,
        size: row.order_items.size ?? null,
        quantityOrdered: row.order_items.purchaseQuantity ?? 1,
        quantityDelivered: 0,
      }))
    );
  }

  const result = await getPoWithItems(po.id);
  res.status(201).json(result);
});

router.patch("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    status: z.enum(["draft", "ordered", "delivered"]).optional(),
    notes: z.string().optional().nullable(),
    supplierEmail: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "ordered") updateData.sentAt = new Date();

  const [po] = await db.update(purchaseOrdersTable).set(updateData).where(eq(purchaseOrdersTable.id, params.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  const result = await getPoWithItems(po.id);
  res.json(result);
});

router.post("/purchasing/purchase-orders/:id/items", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status !== "draft") { res.status(400).json({ error: "Can only add items to a draft PO" }); return; }

  const orderItems = await db.select().from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  await db.insert(purchaseOrderItemsTable).values(
    orderItems.map((row) => ({
      poId: po.id,
      orderItemId: row.order_items.id,
      orderId: row.order_items.orderId,
      orderNumber: row.orders?.orderNumber ?? null,
      productName: row.order_items.productName,
      colour: row.order_items.colour ?? null,
      size: row.order_items.size ?? null,
      quantityOrdered: row.order_items.purchaseQuantity ?? 1,
      quantityDelivered: 0,
    }))
  );

  const result = await getPoWithItems(po.id);
  res.json(result);
});

router.patch("/purchasing/purchase-orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    quantityDelivered: z.number().int().min(0).optional(),
    estimatedDueDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.quantityDelivered !== undefined) updateData.quantityDelivered = parsed.data.quantityDelivered;
  if (parsed.data.estimatedDueDate !== undefined) updateData.estimatedDueDate = parsed.data.estimatedDueDate ? new Date(parsed.data.estimatedDueDate) : null;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [poItem] = await db
    .update(purchaseOrderItemsTable)
    .set(updateData)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)))
    .returning();

  if (!poItem) { res.status(404).json({ error: "PO line not found" }); return; }

  if (poItem.orderItemId && poItem.quantityDelivered >= poItem.quantityOrdered) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(eq(orderItemsTable.id, poItem.orderItemId));
  }

  res.json(poItem);
});

router.delete("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [po] = await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, parsed.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.sendStatus(204);
});

export default router;
