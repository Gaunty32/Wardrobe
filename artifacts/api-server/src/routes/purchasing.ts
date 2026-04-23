import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  db, orderItemsTable, ordersTable, productsTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
} from "@workspace/db";
import { sendEmail, generatePOPdf, buildPOEmail, isEmailConfigured } from "../services/email.js";
import { allocatePODelivery } from "../services/allocation.js";

const router: IRouter = Router();

// ─── Requirements ────────────────────────────────────────────────────────────

router.get("/purchasing/requirements", async (req, res): Promise<void> => {
  const itemSupplier = alias(suppliersTable, "item_supplier");
  const productSupplier = alias(suppliersTable, "product_supplier");

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
      supplierId: sql<number | null>`COALESCE(${orderItemsTable.supplierId}, ${productsTable.supplierId})`,
      supplierName: orderItemsTable.supplierName,
      resolvedSupplierName: sql<string | null>`COALESCE(${itemSupplier.name}, ${productSupplier.name})`,
      supplierEmail: sql<string | null>`COALESCE(${itemSupplier.email}, ${productSupplier.email})`,
      supplierCode: productsTable.supplierCode,
      productSku: productsTable.sku,
      canonicalProductName: productsTable.name,
      supplierCurrency: sql<string | null>`COALESCE(${itemSupplier.currency}, ${productSupplier.currency})`,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .leftJoin(itemSupplier, eq(orderItemsTable.supplierId, itemSupplier.id))
    .leftJoin(productSupplier, eq(productsTable.supplierId, productSupplier.id))
    .where(and(
      eq(orderItemsTable.purchaseRequired, true),
      sql`${orderItemsTable.id} NOT IN (
        SELECT poi.order_item_id
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.po_id = po.id
        WHERE po.status IN ('draft', 'ordered')
        AND poi.order_item_id IS NOT NULL
      )`,
    ))
    .orderBy(
      sql`COALESCE(${itemSupplier.name}, ${productSupplier.name}, ${orderItemsTable.supplierName})`,
      orderItemsTable.productName,
    );

  const grouped: Record<string, {
    supplierId: number | null;
    supplierName: string;
    supplierEmail: string | null;
    supplierCurrency: string;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.resolvedSupplierName ?? row.supplierName ?? "Unknown Supplier";
    if (!grouped[key]) {
      grouped[key] = { supplierId: row.supplierId, supplierName: key, supplierEmail: row.supplierEmail ?? null, supplierCurrency: row.supplierCurrency ?? "GBP", items: [] };
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

function parsePOItem(item: Record<string, unknown>) {
  return {
    ...item,
    supplierPrice: item.supplierPrice != null ? parseFloat(item.supplierPrice as string) : null,
  };
}

async function getPoWithItems(poId: number) {
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) return null;
  const rows = await db
    .select({
      item: purchaseOrderItemsTable,
      productSku: productsTable.sku,
      canonicalProductName: productsTable.name,
    })
    .from(purchaseOrderItemsTable)
    .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(purchaseOrderItemsTable.poId, poId));
  return {
    ...po,
    items: rows.map((r) => ({
      ...parsePOItem(r.item as Record<string, unknown>),
      productSku: r.productSku ?? null,
      canonicalProductName: r.canonicalProductName ?? null,
    })),
  };
}

async function buildPoItems(orderItemIds: number[], poId: number) {
  const orderItems = await db
    .select({
      item: orderItemsTable,
      orderNumber: ordersTable.orderNumber,
      supplierCode: productsTable.supplierCode,
      supplierPrice: productsTable.supplierPrice,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.id, orderItemIds));

  return orderItems.map((row) => ({
    poId,
    orderItemId: row.item.id,
    orderId: row.item.orderId,
    orderNumber: row.orderNumber ?? null,
    productName: row.item.productName,
    colour: row.item.colour ?? null,
    size: row.item.size ?? null,
    supplierCode: row.supplierCode ?? null,
    supplierPrice: row.supplierPrice ?? null,
    quantityOrdered: row.item.purchaseQuantity ?? 1,
    quantityDelivered: 0,
  }));
}

router.get("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const poAlias = alias(suppliersTable, "po_supplier");
  const posRaw = await db
    .select({ po: purchaseOrdersTable, supplierCurrency: poAlias.currency })
    .from(purchaseOrdersTable)
    .leftJoin(poAlias, eq(purchaseOrdersTable.supplierId, poAlias.id))
    .orderBy(desc(purchaseOrdersTable.createdAt));
  const poIds = posRaw.map((p) => p.po.id);
  const allRows = poIds.length > 0
    ? await db
        .select({
          item: purchaseOrderItemsTable,
          productSku: productsTable.sku,
          canonicalProductName: productsTable.name,
        })
        .from(purchaseOrderItemsTable)
        .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
        .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(inArray(purchaseOrderItemsTable.poId, poIds))
    : [];
  const result = posRaw.map(({ po, supplierCurrency }) => ({
    ...po,
    supplierCurrency: supplierCurrency ?? "GBP",
    items: allRows
      .filter((r) => r.item.poId === po.id)
      .map((r) => ({
        ...parsePOItem(r.item as Record<string, unknown>),
        productSku: r.productSku ?? null,
        canonicalProductName: r.canonicalProductName ?? null,
      })),
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
    const poItems = await buildPoItems(parsed.data.itemIds, po.id);
    await db.insert(purchaseOrderItemsTable).values(poItems);
    // Remove items from requirements now that they are on a PO
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(inArray(orderItemsTable.id, parsed.data.itemIds));
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
    estimatedDeliveryDate: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.supplierEmail !== undefined) updateData.supplierEmail = parsed.data.supplierEmail;
  if (parsed.data.estimatedDeliveryDate !== undefined) {
    updateData.estimatedDeliveryDate = parsed.data.estimatedDeliveryDate ? new Date(parsed.data.estimatedDeliveryDate) : null;
  }
  if (parsed.data.status === "ordered") updateData.sentAt = new Date();

  const [po] = await db.update(purchaseOrdersTable).set(updateData).where(eq(purchaseOrdersTable.id, params.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  // When a PO is marked delivered, mark all linked order items as fulfilled and run allocation
  if (parsed.data.status === "delivered") {
    const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, po.id));
    const linkedOrderItemIds = poItems.map((i) => i.orderItemId).filter((id): id is number => id != null);
    if (linkedOrderItemIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null })
        .where(inArray(orderItemsTable.id, linkedOrderItemIds));
    }
    const allocation = await allocatePODelivery(po.id);
    const result = await getPoWithItems(po.id);
    res.json({ ...result, allocation });
    return;
  }

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

  const poItems = await buildPoItems(parsed.data.itemIds, po.id);
  await db.insert(purchaseOrderItemsTable).values(poItems);

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

  // Fetch existing PO item to detect over-delivery
  const [existing] = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)));
  if (!existing) { res.status(404).json({ error: "PO line not found" }); return; }

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

  // Over-delivery: if more received than ordered, add the surplus to product stock
  if (parsed.data.quantityDelivered !== undefined && parsed.data.quantityDelivered > existing.quantityOrdered) {
    const surplus = parsed.data.quantityDelivered - existing.quantityOrdered;
    if (existing.orderItemId) {
      const [oi] = await db.select({ productId: orderItemsTable.productId }).from(orderItemsTable).where(eq(orderItemsTable.id, existing.orderItemId));
      if (oi?.productId) {
        await db.execute(sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${surplus} WHERE id = ${oi.productId}`);
      }
    }
  }

  res.json(poItem);
});

router.get("/purchasing/purchase-orders/:id/pdf", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const po = await getPoWithItems(parsed.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  const poData = {
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    supplierEmail: po.supplierEmail,
    createdAt: po.createdAt,
    notes: po.notes,
    items: po.items.map((i) => ({
      supplierCode: i.supplierCode,
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      supplierPrice: i.supplierPrice,
      quantityOrdered: i.quantityOrdered,
    })),
  };

  try {
    const pdf = await generatePOPdf(poData);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${po.poNumber}.pdf"`);
    res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` });
  }
});

router.post("/purchasing/purchase-orders/:id/send-email", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const body = z.object({ notes: z.string().optional().default(""), recipientEmail: z.string().email().optional() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const po = await getPoWithItems(params.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  const toEmail = body.data.recipientEmail ?? po.supplierEmail;
  if (!toEmail) { res.status(400).json({ error: "No supplier email address on record. Please enter one." }); return; }

  const poData = {
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    supplierEmail: po.supplierEmail,
    createdAt: po.createdAt,
    notes: po.notes,
    items: po.items.map((i) => ({
      supplierCode: i.supplierCode,
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      supplierPrice: i.supplierPrice,
      quantityOrdered: i.quantityOrdered,
    })),
  };

  const { subject, html, text } = buildPOEmail(poData, body.data.notes);
  let pdfBuffer: Buffer | undefined;
  try { pdfBuffer = await generatePOPdf(poData); } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` }); return;
  }

  const result = await sendEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments: pdfBuffer ? [{ filename: `${po.poNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }] : [],
  });

  if (!result.sent) {
    res.status(500).json({ error: result.error ?? "Failed to send email" }); return;
  }

  // Mark the PO as ordered if it was still draft
  if (po.status === "draft") {
    await db.update(purchaseOrdersTable).set({ status: "ordered", sentAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
  }

  res.json({ ok: true, to: toEmail });
});

router.post("/purchasing/purchase-orders/:id/receive-all", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const poId = parsed.data.id;
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status !== "ordered") { res.status(400).json({ error: "Only ordered POs can be received" }); return; }

  const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, poId));

  // Mark every line as fully delivered
  for (const item of poItems) {
    await db.update(purchaseOrderItemsTable)
      .set({ quantityDelivered: item.quantityOrdered, updatedAt: new Date() })
      .where(eq(purchaseOrderItemsTable.id, item.id));
  }

  // Mark the PO as delivered
  await db.update(purchaseOrdersTable)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, poId));

  // Clear purchaseRequired on linked order items
  const linkedOrderItemIds = poItems.map((i) => i.orderItemId).filter((id): id is number => id != null);
  if (linkedOrderItemIds.length > 0) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(inArray(orderItemsTable.id, linkedOrderItemIds));
  }

  // Run smart stock allocation
  const allocation = await allocatePODelivery(poId);

  const result = await getPoWithItems(poId);
  res.json({ ...result, allocation });
});

// ── Backorders: PO lines with pending qty and an expected delivery date ────────
router.get("/purchasing/backorders", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: purchaseOrderItemsTable.id,
      poId: purchaseOrderItemsTable.poId,
      poNumber: purchaseOrdersTable.poNumber,
      supplierName: purchaseOrdersTable.supplierName,
      productName: purchaseOrderItemsTable.productName,
      colour: purchaseOrderItemsTable.colour,
      size: purchaseOrderItemsTable.size,
      supplierCode: purchaseOrderItemsTable.supplierCode,
      quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
      quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      requiredDate: ordersTable.requiredDate,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(
      lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
    ))
    .orderBy(purchaseOrderItemsTable.estimatedDueDate);

  res.json(rows.map((r) => ({
    ...r,
    remaining: r.quantityOrdered - r.quantityDelivered,
  })));
});

router.delete("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Restore purchaseRequired on any linked order items before deleting
  const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, parsed.data.id));
  const linkedOrderItemIds = poItems.map((i) => i.orderItemId).filter((id): id is number => id != null);
  if (linkedOrderItemIds.length > 0) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: true })
      .where(inArray(orderItemsTable.id, linkedOrderItemIds));
  }

  const [po] = await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, parsed.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.sendStatus(204);
});

export default router;
