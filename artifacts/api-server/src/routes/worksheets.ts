import { Router, type IRouter } from "express";
import { eq, desc, inArray, and, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  worksheetsTable,
  worksheetItemsTable,
  orderItemsTable,
  ordersTable,
  productsTable,
  customerProcessesTable,
  customerFinishesTable,
  customerFinishProcessesTable,
} from "@workspace/db";

const router: IRouter = Router();

function generateWorksheetNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `WS-${year}-${seq}`;
}

// ── Picking list: items allocated from stock, ready to be picked ──────────────
router.get("/picking-list", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      itemId: orderItemsTable.id,
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      requiredDate: ordersTable.requiredDate,
      productName: orderItemsTable.productName,
      productId: orderItemsTable.productId,
      productSku: productsTable.sku,
      supplierCode: productsTable.supplierCode,
      supplierName: orderItemsTable.supplierName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      quantity: orderItemsTable.quantity,
      recipientType: orderItemsTable.recipientType,
      recipientName: orderItemsTable.recipientName,
      finishId: orderItemsTable.finishId,
      finishName: orderItemsTable.finishName,
      stockStatus: orderItemsTable.stockStatus,
      stockAllocatedAt: orderItemsTable.stockAllocatedAt,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.stockStatus, "allocated"))
    .orderBy(ordersTable.requiredDate, ordersTable.id);

  const orderMap = new Map<number, {
    orderId: number; orderNumber: string; customerName: string | null;
    customerId: number | null; requiredDate: Date | null;
    items: typeof rows;
  }>();
  for (const row of rows) {
    if (!orderMap.has(row.orderId)) {
      orderMap.set(row.orderId, {
        orderId: row.orderId, orderNumber: row.orderNumber,
        customerName: row.customerName, customerId: row.customerId,
        requiredDate: row.requiredDate, items: [],
      });
    }
    orderMap.get(row.orderId)!.items.push(row);
  }
  res.json(Array.from(orderMap.values()));
});

// Mark picking list items as picked.
// Plain items (no finish) → stockStatus = 'complete'
// Items with a finish → create/update production worksheet → stockStatus = 'in_production'
router.post("/picking-list/pick", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const items = await db
    .select({
      id: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      productName: orderItemsTable.productName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      quantity: orderItemsTable.quantity,
      recipientType: orderItemsTable.recipientType,
      recipientName: orderItemsTable.recipientName,
      finishId: orderItemsTable.finishId,
      finishName: orderItemsTable.finishName,
      orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId,
      customerName: ordersTable.customerName,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  const plainItems = items.filter((i) => i.finishId == null);
  const finishItems = items.filter((i) => i.finishId != null);

  // Plain items → complete (ready for dispatch, no decoration needed)
  if (plainItems.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: "complete" })
      .where(inArray(orderItemsTable.id, plainItems.map((i) => i.id)));
  }

  // Finish items → create/append production worksheet per order
  if (finishItems.length > 0) {
    const byOrder = new Map<number, typeof finishItems>();
    for (const item of finishItems) {
      if (!byOrder.has(item.orderId)) byOrder.set(item.orderId, []);
      byOrder.get(item.orderId)!.push(item);
    }

    for (const [orderId, orderItems] of byOrder) {
      const firstItem = orderItems[0];

      // Find existing open worksheet for this order
      const [existingWs] = await db
        .select()
        .from(worksheetsTable)
        .where(and(eq(worksheetsTable.orderId, orderId), eq(worksheetsTable.status, "pre_wip")));

      let worksheetId: number;
      if (existingWs) {
        worksheetId = existingWs.id;
      } else {
        const wsNum = generateWorksheetNumber();
        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber: wsNum,
            status: "pre_wip",
            orderId,
            orderNumber: firstItem.orderNumber,
            customerId: firstItem.customerId ?? null,
            customerName: firstItem.customerName ?? null,
          })
          .returning();
        worksheetId = ws.id;
      }

      for (const item of orderItems) {
        // Avoid duplicates
        const [existing] = await db
          .select()
          .from(worksheetItemsTable)
          .where(and(eq(worksheetItemsTable.worksheetId, worksheetId), eq(worksheetItemsTable.orderItemId, item.id)));
        if (existing) continue;

        // Build processes snapshot from customer finish config
        let processesSnapshot: string | null = null;
        if (item.finishId && item.customerId) {
          const links = await db
            .select()
            .from(customerFinishProcessesTable)
            .where(eq(customerFinishProcessesTable.finishId, item.finishId));
          if (links.length > 0) {
            const processes = await db
              .select()
              .from(customerProcessesTable)
              .where(inArray(customerProcessesTable.id, links.map((l) => l.processId)));
            processesSnapshot = JSON.stringify(
              processes.map((p) => ({
                id: p.id, name: p.name, type: p.type,
                placement: p.placement,
                price: p.price ? parseFloat(p.price) : null,
                notes: p.notes,
              }))
            );
          }
        }

        await db.insert(worksheetItemsTable).values({
          worksheetId,
          orderItemId: item.id,
          productName: item.productName,
          colour: item.colour ?? null,
          size: item.size ?? null,
          quantity: item.quantity,
          recipientType: item.recipientType,
          recipientName: item.recipientName ?? null,
          finishId: item.finishId ?? null,
          finishName: item.finishName ?? null,
          processesSnapshot,
        });

        await db
          .update(orderItemsTable)
          .set({ stockStatus: "in_production" })
          .where(eq(orderItemsTable.id, item.id));
      }
    }
  }

  res.json({ ok: true, plainPicked: plainItems.length, worksheetItems: finishItems.length });
});

// Return picking list items back to purchasing requirements.
// Resets stockStatus → null and purchaseRequired → true.
// Decrements product stock_quantity to reflect that the stock isn't actually there.
router.post("/picking-list/return", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const items = await db
    .select({
      id: orderItemsTable.id,
      productId: orderItemsTable.productId,
      quantity: orderItemsTable.quantity,
    })
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  for (const item of items) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: null, purchaseRequired: true, stockAllocatedAt: null })
      .where(eq(orderItemsTable.id, item.id));

    if (item.productId != null) {
      await db.execute(
        sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ${item.quantity} WHERE id = ${item.productId}`
      );
    }
  }

  res.json({ ok: true, returned: items.length });
});

// ── Pending production: confirmed orders awaiting stock ───────────────────────
router.get("/production/pending", async (req, res): Promise<void> => {
  const pendingItems = await db
    .select({
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      requiredDate: ordersTable.requiredDate,
      itemId: orderItemsTable.id,
      productName: orderItemsTable.productName,
      catalogueName: productsTable.name,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      purchaseQuantity: orderItemsTable.purchaseQuantity,
      supplierName: orderItemsTable.supplierName,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, and(
      eq(orderItemsTable.orderId, ordersTable.id),
      eq(ordersTable.status, "confirmed"),
    ))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.purchaseRequired, true))
    .orderBy(ordersTable.requiredDate, ordersTable.id);

  // Group by order
  const orderMap = new Map<number, {
    orderId: number; orderNumber: string; customerName: string | null;
    requiredDate: Date | null;
    items: Array<{ id: number; productName: string; colour: string | null; size: string | null; purchaseQuantity: number; supplierName: string | null }>;
  }>();

  for (const row of pendingItems) {
    if (!orderMap.has(row.orderId)) {
      orderMap.set(row.orderId, {
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        customerName: row.customerName,
        requiredDate: row.requiredDate,
        items: [],
      });
    }
    orderMap.get(row.orderId)!.items.push({
      id: row.itemId,
      productName: row.catalogueName ?? row.productName,
      colour: row.colour,
      size: row.size,
      purchaseQuantity: row.purchaseQuantity ?? 1,
      supplierName: row.supplierName,
    });
  }

  res.json(Array.from(orderMap.values()));
});

router.get("/worksheets", async (req, res): Promise<void> => {
  const parsed = z.object({ status: z.string().optional() }).safeParse(req.query);
  const statusFilter = parsed.success ? parsed.data.status : undefined;

  const rows = statusFilter
    ? await db.select().from(worksheetsTable).where(eq(worksheetsTable.status, statusFilter)).orderBy(desc(worksheetsTable.createdAt))
    : await db.select().from(worksheetsTable).orderBy(desc(worksheetsTable.createdAt));

  const wsIds = rows.map((w) => w.id);
  const items = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const result = rows.map((ws) => ({
    ...ws,
    items: items.filter((i) => i.worksheetId === ws.id).map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
    })),
  }));

  res.json(result);
});

router.get("/worksheets/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ws] = await db.select().from(worksheetsTable).where(eq(worksheetsTable.id, parsed.data.id));
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }

  const items = await db.select().from(worksheetItemsTable).where(eq(worksheetItemsTable.worksheetId, ws.id));

  res.json({
    ...ws,
    items: items.map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
    })),
  });
});

router.post("/worksheets", async (req, res): Promise<void> => {
  const bodySchema = z.object({
    orderId: z.number().int().positive(),
    orderNumber: z.string(),
    customerId: z.number().int().positive().optional().nullable(),
    customerName: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    itemIds: z.array(z.number().int().positive()),
  });

  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderItems = await db
    .select()
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  if (orderItems.length === 0) {
    res.status(400).json({ error: "No valid order items found" });
    return;
  }

  const worksheetNumber = generateWorksheetNumber();
  const [ws] = await db
    .insert(worksheetsTable)
    .values({
      worksheetNumber,
      status: "pre_wip",
      orderId: parsed.data.orderId,
      orderNumber: parsed.data.orderNumber,
      customerId: parsed.data.customerId ?? null,
      customerName: parsed.data.customerName ?? null,
      notes: parsed.data.notes ?? null,
    })
    .returning();

  const wsItems = await Promise.all(
    orderItems.map(async (oi) => {
      let processesSnapshot: string | null = null;

      if (oi.finishId && parsed.data.customerId) {
        const finishProcessLinks = await db
          .select()
          .from(customerFinishProcessesTable)
          .where(eq(customerFinishProcessesTable.finishId, oi.finishId));

        const processIds = finishProcessLinks.map((fp) => fp.processId);
        if (processIds.length > 0) {
          const processes = await db
            .select()
            .from(customerProcessesTable)
            .where(inArray(customerProcessesTable.id, processIds));

          processesSnapshot = JSON.stringify(
            processes.map((p) => ({
              id: p.id,
              name: p.name,
              type: p.type,
              placement: p.placement,
              price: p.price ? parseFloat(p.price) : null,
              notes: p.notes,
            }))
          );
        }
      }

      return db.insert(worksheetItemsTable).values({
        worksheetId: ws.id,
        orderItemId: oi.id,
        productName: oi.productName,
        colour: oi.colour ?? null,
        size: oi.size ?? null,
        quantity: oi.quantity - (oi.purchaseQuantity ?? 0),
        recipientType: oi.recipientType,
        recipientName: oi.recipientName ?? null,
        finishId: oi.finishId ?? null,
        finishName: oi.finishName ?? null,
        processesSnapshot,
      }).returning();
    })
  );

  res.status(201).json({
    ...ws,
    items: wsItems.flat().map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
    })),
  });
});

router.patch("/worksheets/:id", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    status: z.enum(["pre_wip", "wip", "complete"]).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
  if (parsed.data.status === "complete") {
    updateData.completedAt = new Date();
  }

  const [ws] = await db
    .update(worksheetsTable)
    .set(updateData)
    .where(eq(worksheetsTable.id, params.data.id))
    .returning();

  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }
  res.json(ws);
});

// Return all items in a worksheet back to the picking list (stockStatus → 'allocated')
// then delete the worksheet.
router.post("/worksheets/:id/return-to-picking", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const wsId = parsed.data.id;

  // Get all worksheet items so we know which order items to reset
  const items = await db
    .select({ orderItemId: worksheetItemsTable.orderItemId })
    .from(worksheetItemsTable)
    .where(eq(worksheetItemsTable.worksheetId, wsId));

  const orderItemIds = items.map((i) => i.orderItemId).filter((id): id is number => id != null);

  // Reset order items back to allocated (returns them to the picking list)
  if (orderItemIds.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: "allocated", stockAllocatedAt: new Date() })
      .where(inArray(orderItemsTable.id, orderItemIds));
  }

  // Delete the worksheet (cascade deletes worksheet_items)
  const [ws] = await db.delete(worksheetsTable).where(eq(worksheetsTable.id, wsId)).returning();
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }

  res.json({ ok: true, resetItems: orderItemIds.length });
});

router.delete("/worksheets/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ws] = await db.delete(worksheetsTable).where(eq(worksheetsTable.id, parsed.data.id)).returning();
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }
  res.sendStatus(204);
});

export default router;
