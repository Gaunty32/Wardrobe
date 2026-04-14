import { Router, type IRouter } from "express";
import { eq, desc, inArray, and } from "drizzle-orm";
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

router.delete("/worksheets/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [ws] = await db.delete(worksheetsTable).where(eq(worksheetsTable.id, parsed.data.id)).returning();
  if (!ws) { res.status(404).json({ error: "Worksheet not found" }); return; }
  res.sendStatus(204);
});

export default router;
