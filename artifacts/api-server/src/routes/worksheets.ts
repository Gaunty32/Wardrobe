import { Router, type IRouter } from "express";
import { eq, desc, inArray, and, sql, notExists } from "drizzle-orm";
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
  processStockTable,
} from "@workspace/db";
import { logOrderAction, getActor } from "../services/orderLog";

const router: IRouter = Router();

async function generateWorksheetNumber(): Promise<string> {
  const rows = await db.execute(sql`
    SELECT worksheet_number FROM worksheets
    WHERE worksheet_number ~ '^F[0-9]+$'
    ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC
    LIMIT 1
  `);
  const last = (rows.rows[0] as any)?.worksheet_number as string | undefined;
  const maxNum = last ? parseInt(last.slice(1), 10) : 99;
  return `F${maxNum + 1}`;
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
  const parsed = z.object({
    itemIds: z.array(z.number().int().positive()),
    qtyOverrides: z.record(z.string(), z.number().int().min(1)).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const items = await db
    .select({
      id: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      productId: orderItemsTable.productId,
      productName: orderItemsTable.productName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      quantity: orderItemsTable.quantity,
      unitPrice: orderItemsTable.unitPrice,
      vatRate: orderItemsTable.vatRate,
      recipientType: orderItemsTable.recipientType,
      recipientName: orderItemsTable.recipientName,
      recipientEmployeeId: orderItemsTable.recipientEmployeeId,
      finishId: orderItemsTable.finishId,
      finishName: orderItemsTable.finishName,
      supplierId: orderItemsTable.supplierId,
      supplierName: orderItemsTable.supplierName,
      orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId,
      customerName: ordersTable.customerName,
    })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, parsed.data.itemIds));

  // ── Partial pick: split items where fewer units were found than required ──
  const overrides = parsed.data.qtyOverrides ?? {};
  for (const item of items) {
    const pickedQty = overrides[String(item.id)];
    if (pickedQty == null || pickedQty >= item.quantity) continue;

    const shortfallQty = item.quantity - pickedQty;
    const unitPriceNum = parseFloat(item.unitPrice ?? "0");

    // Reduce original item to the picked quantity
    await db.update(orderItemsTable).set({
      quantity: pickedQty,
      lineTotal: String((pickedQty * unitPriceNum).toFixed(2)),
    }).where(eq(orderItemsTable.id, item.id));

    // Insert shortfall item — goes straight to purchasing requirements
    await db.insert(orderItemsTable).values({
      orderId: item.orderId,
      productId: item.productId ?? null,
      productName: item.productName,
      colour: item.colour ?? null,
      size: item.size ?? null,
      finishId: item.finishId ?? null,
      finishName: item.finishName ?? null,
      recipientType: item.recipientType,
      recipientName: item.recipientName ?? null,
      recipientEmployeeId: item.recipientEmployeeId ?? null,
      quantity: shortfallQty,
      unitPrice: item.unitPrice ?? "0",
      lineTotal: String((shortfallQty * unitPriceNum).toFixed(2)),
      vatRate: item.vatRate ?? "0.2000",
      purchaseRequired: true,
      purchaseQuantity: shortfallQty,
      supplierId: item.supplierId ?? null,
      supplierName: item.supplierName ?? null,
      stockStatus: null,
      stockAllocatedAt: null,
    });

    // Decrement product stock by shortfall (those units aren't actually in stock)
    if (item.productId != null) {
      await db.execute(
        sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) - ${shortfallQty} WHERE id = ${item.productId}`
      );
    }

    // Update in-memory quantity so the pick logic below uses the reduced amount
    item.quantity = pickedQty;
  }

  const plainItems = items.filter((i) => i.finishId == null);
  const finishItems = items.filter((i) => i.finishId != null);

  // Plain items → complete (ready for dispatch, no decoration needed)
  if (plainItems.length > 0) {
    await db
      .update(orderItemsTable)
      .set({ stockStatus: "complete" })
      .where(inArray(orderItemsTable.id, plainItems.map((i) => i.id)));
  }

  // ── Guard: all required process stock must have been delivered (stockQuantity > 0) ──
  if (finishItems.length > 0) {
    const finishIds = [...new Set(finishItems.map(i => i.finishId!))] as number[];

    const finishProcessLinks = await db
      .select({ finishId: customerFinishProcessesTable.finishId, processId: customerFinishProcessesTable.processId })
      .from(customerFinishProcessesTable)
      .where(inArray(customerFinishProcessesTable.finishId, finishIds));

    if (finishProcessLinks.length > 0) {
      const processIds = [...new Set(finishProcessLinks.map(fp => fp.processId))];

      const processes = await db
        .select({ id: customerProcessesTable.id, processStockId: customerProcessesTable.processStockId })
        .from(customerProcessesTable)
        .where(inArray(customerProcessesTable.id, processIds));

      const psIds = [...new Set(processes.filter(p => p.processStockId != null).map(p => p.processStockId!))] as number[];

      if (psIds.length > 0) {
        const missingStock = await db
          .select({ id: processStockTable.id, name: processStockTable.name, sku: processStockTable.sku })
          .from(processStockTable)
          .where(and(inArray(processStockTable.id, psIds), eq(processStockTable.stockQuantity, 0)));

        if (missingStock.length > 0) {
          const names = missingStock.map(p => p.name + (p.sku ? ` (${p.sku})` : "")).join(", ");
          res.status(409).json({
            error: `Process stock not yet delivered — cannot send to production. Missing: ${names}`,
            missingProcessStock: missingStock,
          });
          return;
        }
      }
    }
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
        const wsNum = await generateWorksheetNumber();
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
  // 1. Items awaiting stock (purchase required)
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

  // 2. Confirmed orders that have NO worksheets yet (need "Send to Production")
  const readyRows = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      requiredDate: ordersTable.requiredDate,
      totalAmount: ordersTable.totalAmount,
      itemCount: sql<number>`(SELECT COUNT(*) FROM order_items WHERE order_id = ${ordersTable.id})`.as("itemCount"),
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.status, "confirmed"),
        notExists(
          db.select({ one: sql`1` }).from(worksheetsTable).where(eq(worksheetsTable.orderId, ordersTable.id))
        ),
      )
    )
    .orderBy(ordersTable.requiredDate, ordersTable.id);

  res.json({
    awaitingStock: Array.from(orderMap.values()),
    readyForProduction: readyRows.map(r => ({
      ...r,
      totalAmount: r.totalAmount ? parseFloat(r.totalAmount) : 0,
      itemCount: Number(r.itemCount),
    })),
  });
});

// ── Daily Work Plan ───────────────────────────────────────────────────────────
// Returns all active production work grouped by finish type so staff can
// batch identical processes together and prioritise by required date.
router.get("/production/daily-plan", async (req, res): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 1. Picking list items that need decoration (finish set)
  const pickingRows = await db.execute(sql`
    SELECT
      'picking'          AS work_type,
      oi.id              AS item_id,
      COALESCE(oi.finish_name, 'Plain') AS finish_name,
      oi.finish_id,
      oi.quantity,
      oi.product_name,
      oi.colour,
      oi.size,
      oi.recipient_name,
      oi.recipient_type,
      o.id               AS order_id,
      o.order_number,
      o.customer_name,
      o.required_date,
      NULL::int          AS worksheet_id,
      NULL::text         AS worksheet_number,
      NULL::text         AS ws_status
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE oi.stock_status = 'allocated' AND oi.finish_id IS NOT NULL
      AND o.status NOT IN ('cancelled', 'archived')
    ORDER BY o.required_date ASC NULLS LAST
  `);

  // 2. All active worksheet items (pre_wip + wip)
  const wsRows = await db.execute(sql`
    SELECT
      'worksheet'        AS work_type,
      wi.id              AS item_id,
      COALESCE(wi.finish_name, 'Plain') AS finish_name,
      wi.finish_id,
      wi.quantity,
      wi.product_name,
      wi.colour,
      wi.size,
      wi.recipient_name,
      wi.recipient_type,
      o.id               AS order_id,
      o.order_number,
      o.customer_name,
      o.required_date,
      w.id               AS worksheet_id,
      w.worksheet_number,
      w.status           AS ws_status
    FROM worksheet_items wi
    JOIN worksheets w ON w.id = wi.worksheet_id
    LEFT JOIN orders o ON o.id = w.order_id
    WHERE w.status IN ('pre_wip', 'wip')
      AND (o.id IS NULL OR o.status NOT IN ('cancelled', 'archived'))
    ORDER BY o.required_date ASC NULLS LAST
  `);

  const allRows = [...(pickingRows.rows as any[]), ...(wsRows.rows as any[])];

  // Group by finish_name
  const finishGroups = new Map<string, any[]>();
  for (const row of allRows) {
    const key = (row.finish_name as string) ?? "Plain";
    if (!finishGroups.has(key)) finishGroups.set(key, []);
    finishGroups.get(key)!.push(row);
  }

  const taskGroups = Array.from(finishGroups.entries()).map(([finishName, rows]) => {
    const totalQty = rows.reduce((sum: number, r: any) => sum + Number(r.quantity), 0);

    // Earliest required date across every item in this finish group
    const dates = rows
      .map((r: any) => (r.required_date ? new Date(r.required_date) : null))
      .filter((d): d is Date => d != null);
    const earliestDate = dates.length > 0
      ? new Date(Math.min(...dates.map((d) => d.getTime())))
      : null;

    const daysUntilDue = earliestDate
      ? Math.floor((earliestDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    let urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
    if (daysUntilDue === null)   urgency = "upcoming";
    else if (daysUntilDue < 0)  urgency = "overdue";
    else if (daysUntilDue === 0) urgency = "today";
    else if (daysUntilDue <= 2) urgency = "soon";
    else if (daysUntilDue <= 7) urgency = "this_week";
    else                        urgency = "upcoming";

    const hasWip     = rows.some((r: any) => r.ws_status === "wip");
    const hasPreWip  = rows.some((r: any) => r.ws_status === "pre_wip");
    const hasPicking = rows.some((r: any) => r.work_type === "picking");

    let overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
    if      (hasWip && !hasPreWip && !hasPicking) overallStatus = "in_progress";
    else if (hasPreWip && !hasPicking && !hasWip) overallStatus = "ready";
    else if (hasPicking && !hasWip && !hasPreWip) overallStatus = "pick_first";
    else                                          overallStatus = "mixed";

    // Sub-group by order + stage so each worksheet / picking batch is one row
    const byTask = new Map<string, any[]>();
    for (const row of rows) {
      const key = `${row.order_id ?? "none"}:${row.ws_status ?? "picking"}:${row.worksheet_id ?? ""}`;
      if (!byTask.has(key)) byTask.set(key, []);
      byTask.get(key)!.push(row);
    }

    const tasks = Array.from(byTask.values()).map((taskRows) => {
      const first = taskRows[0];
      return {
        type:            first.work_type === "picking" ? "picking" : (first.ws_status as string),
        worksheetId:     first.worksheet_id    as number | null,
        worksheetNumber: first.worksheet_number as string | null,
        orderId:         first.order_id         as number | null,
        orderNumber:     first.order_number     as string | null,
        customerName:    first.customer_name    as string | null,
        requiredDate:    first.required_date ? new Date(first.required_date).toISOString() : null,
        qty:             taskRows.reduce((s: number, r: any) => s + Number(r.quantity), 0),
        items:           taskRows.map((r: any) => ({
          productName: r.product_name    as string,
          colour:      r.colour          as string | null,
          size:        r.size            as string | null,
          qty:         Number(r.quantity),
          recipient:   (r.recipient_name ?? r.recipient_type) as string | null,
        })),
      };
    });

    // Within each group: wip first → pre_wip → picking; then by required date
    const stageOrder: Record<string, number> = { wip: 0, pre_wip: 1, picking: 2 };
    tasks.sort((a, b) => {
      const sa = stageOrder[a.type] ?? 3;
      const sb = stageOrder[b.type] ?? 3;
      if (sa !== sb) return sa - sb;
      if (a.requiredDate && b.requiredDate)
        return new Date(a.requiredDate).getTime() - new Date(b.requiredDate).getTime();
      return 0;
    });

    return {
      finishName,
      totalQty,
      orderCount: new Set(rows.map((r: any) => r.order_id).filter(Boolean)).size,
      overallStatus,
      urgency,
      daysUntilDue,
      earliestRequired: earliestDate?.toISOString() ?? null,
      tasks,
    };
  });

  // Sort groups: overdue → today → soon → this_week → upcoming
  const urgencyOrder: Record<string, number> = {
    overdue: 0, today: 1, soon: 2, this_week: 3, upcoming: 4,
  };
  taskGroups.sort((a, b) => {
    const ua = urgencyOrder[a.urgency] ?? 5;
    const ub = urgencyOrder[b.urgency] ?? 5;
    if (ua !== ub) return ua - ub;
    if (a.daysUntilDue !== null && b.daysUntilDue !== null)
      return a.daysUntilDue - b.daysUntilDue;
    return 0;
  });

  const urgentCount = taskGroups.filter(
    (g) => g.urgency === "overdue" || g.urgency === "today" || g.urgency === "soon"
  ).length;

  res.json({
    generatedAt: new Date().toISOString(),
    taskGroups,
    summary: {
      overdue:    taskGroups.filter((g) => g.urgency === "overdue").length,
      today:      taskGroups.filter((g) => g.urgency === "today").length,
      soon:       taskGroups.filter((g) => g.urgency === "soon").length,
      thisWeek:   taskGroups.filter((g) => g.urgency === "this_week").length,
      upcoming:   taskGroups.filter((g) => g.urgency === "upcoming").length,
      urgentCount,
      totalItems: taskGroups.reduce((s, g) => s + g.totalQty, 0),
    },
  });
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

  // Fetch requiredDate from orders for sorting
  const orderIds = [...new Set(rows.filter((w) => w.orderId != null).map((w) => w.orderId!))];
  const orderDates = orderIds.length > 0
    ? await db.select({ id: ordersTable.id, requiredDate: ordersTable.requiredDate })
        .from(ordersTable).where(inArray(ordersTable.id, orderIds))
    : [];
  const orderDateMap = new Map(orderDates.map((o) => [o.id, o.requiredDate]));

  const result = rows.map((ws) => ({
    ...ws,
    requiredDate: ws.orderId ? (orderDateMap.get(ws.orderId) ?? null) : null,
    items: items.filter((i) => i.worksheetId === ws.id).map((i) => ({
      ...i,
      processes: i.processesSnapshot ? JSON.parse(i.processesSnapshot) : [],
    })),
  }));

  // Sort by requiredDate asc (nulls last), then createdAt desc
  result.sort((a, b) => {
    if (a.requiredDate && b.requiredDate)
      return new Date(a.requiredDate as unknown as string).getTime() - new Date(b.requiredDate as unknown as string).getTime();
    if (a.requiredDate) return -1;
    if (b.requiredDate) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

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

  const worksheetNumber = await generateWorksheetNumber();
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

  if (ws.orderId) {
    await logOrderAction(ws.orderId, "Production worksheet created", getActor(req),
      `Worksheet ${ws.worksheetNumber} created with ${wsItems.flat().length} item(s)`);
  }

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

  if (ws.orderId && parsed.data.status) {
    const statusLabels: Record<string, string> = { pre_wip: "Production started (pre-WIP)", wip: "Production in progress (WIP)", complete: "Production completed" };
    await logOrderAction(ws.orderId, statusLabels[parsed.data.status] ?? `Worksheet status: ${parsed.data.status}`, getActor(req),
      `Worksheet ${ws.worksheetNumber}`);
  }

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
