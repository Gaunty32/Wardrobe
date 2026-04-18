/**
 * Smart stock allocation service.
 *
 * When a purchase order is delivered, this service:
 *  1. Finds the order items that were waiting for this stock.
 *  2. Groups them by order and sorts by required date (soonest first) so that
 *     complete, on-time orders are prioritised when stock is short.
 *  3. For items that received their full quantity:
 *       - finishId set  → creates / appends to a production worksheet
 *       - no finishId   → marks as "allocated" (picking list)
 *  4. Checks each affected order for completion so the dispatch page stays
 *     accurate.
 */

import { eq, inArray, and, ne } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  purchaseOrderItemsTable,
  worksheetsTable,
  worksheetItemsTable,
  customerFinishProcessesTable,
  customerProcessesTable,
} from "@workspace/db";

export interface AllocationResult {
  ordersAffected: number;
  worksheetsCreated: number;
  worksheetsUpdated: number;
  pickingItems: number;
  summary: Array<{
    orderId: number;
    orderNumber: string;
    customerName: string | null;
    worksheetNumber: string | null;
    pickingCount: number;
    worksheetCount: number;
  }>;
}

async function getProcessesSnapshot(finishId: number, customerId: number | null): Promise<string | null> {
  if (!customerId) return null;
  const links = await db
    .select()
    .from(customerFinishProcessesTable)
    .where(eq(customerFinishProcessesTable.finishId, finishId));
  if (links.length === 0) return null;
  const processes = await db
    .select()
    .from(customerProcessesTable)
    .where(inArray(customerProcessesTable.id, links.map((l) => l.processId)));
  return JSON.stringify(
    processes.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      placement: p.placement,
      price: p.price ? parseFloat(p.price as string) : null,
      notes: p.notes,
    }))
  );
}

function generateWorksheetNumber(): string {
  return `WS-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000) + 1000}`;
}

export async function allocatePODelivery(poId: number): Promise<AllocationResult> {
  const poItems = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.poId, poId));

  const linkedOrderItemIds = poItems
    .map((i) => i.orderItemId)
    .filter((id): id is number => id != null);

  if (linkedOrderItemIds.length === 0) {
    return { ordersAffected: 0, worksheetsCreated: 0, worksheetsUpdated: 0, pickingItems: 0, summary: [] };
  }

  // Build a map of quantityDelivered by orderItemId
  const poItemByOrderItemId = new Map(
    poItems
      .filter((i) => i.orderItemId != null)
      .map((i) => [i.orderItemId!, i])
  );

  // Fetch the linked order items and their orders
  const rows = await db
    .select({ item: orderItemsTable, order: ordersTable })
    .from(orderItemsTable)
    .innerJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(inArray(orderItemsTable.id, linkedOrderItemIds));

  // Separate fully-delivered from partial
  const fullyDelivered = rows.filter(({ item }) => {
    const poi = poItemByOrderItemId.get(item.id);
    return poi && poi.quantityDelivered >= poi.quantityOrdered;
  });

  // Group by order, sort by requiredDate (smart: soonest first)
  const orderGroups = new Map<
    number,
    { order: typeof ordersTable.$inferSelect; items: typeof orderItemsTable.$inferSelect[] }
  >();
  for (const { item, order } of fullyDelivered) {
    if (!orderGroups.has(order.id)) orderGroups.set(order.id, { order, items: [] });
    orderGroups.get(order.id)!.items.push(item);
  }

  const sortedOrders = [...orderGroups.values()].sort((a, b) => {
    if (!a.order.requiredDate) return 1;
    if (!b.order.requiredDate) return -1;
    return new Date(a.order.requiredDate).getTime() - new Date(b.order.requiredDate).getTime();
  });

  let worksheetsCreated = 0;
  let worksheetsUpdated = 0;
  let pickingItems = 0;
  const summary: AllocationResult["summary"] = [];

  for (const { order, items } of sortedOrders) {
    const finishItems = items.filter((i) => i.finishId != null);
    const plainItems = items.filter((i) => i.finishId == null);

    let worksheetNumber: string | null = null;
    let wsPickCount = 0;
    let wsFinishCount = 0;

    // ── Plain items → picking list ──────────────────────────────────────────
    for (const item of plainItems) {
      // Skip if already allocated
      if (item.stockStatus === "allocated" || item.stockStatus === "in_production" || item.stockStatus === "complete") continue;
      await db
        .update(orderItemsTable)
        .set({ stockStatus: "allocated", stockAllocatedAt: new Date() })
        .where(eq(orderItemsTable.id, item.id));
      pickingItems++;
      wsPickCount++;
    }

    // ── Finish items → worksheet ────────────────────────────────────────────
    if (finishItems.length > 0) {
      // Find existing open worksheet for this order
      const existingWss = await db
        .select()
        .from(worksheetsTable)
        .where(and(eq(worksheetsTable.orderId, order.id), ne(worksheetsTable.status, "complete")));

      let worksheetId: number;
      if (existingWss.length > 0) {
        worksheetId = existingWss[0].id;
        worksheetNumber = existingWss[0].worksheetNumber;
        worksheetsUpdated++;
      } else {
        const wsNum = generateWorksheetNumber();
        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber: wsNum,
            status: "pre_wip",
            orderId: order.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId ?? null,
            customerName: order.customerName ?? null,
          })
          .returning();
        worksheetId = ws.id;
        worksheetNumber = ws.worksheetNumber;
        worksheetsCreated++;
      }

      for (const item of finishItems) {
        if (item.stockStatus === "in_production" || item.stockStatus === "complete") continue;

        // Avoid duplicate worksheet items
        const [existing] = await db
          .select()
          .from(worksheetItemsTable)
          .where(
            and(
              eq(worksheetItemsTable.worksheetId, worksheetId),
              eq(worksheetItemsTable.orderItemId, item.id)
            )
          );
        if (existing) continue;

        const processesSnapshot = await getProcessesSnapshot(item.finishId!, order.customerId ?? null);

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
          .set({ stockStatus: "in_production", stockAllocatedAt: new Date() })
          .where(eq(orderItemsTable.id, item.id));

        wsFinishCount++;
      }
    }

    summary.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName ?? null,
      worksheetNumber,
      pickingCount: wsPickCount,
      worksheetCount: wsFinishCount,
    });
  }

  return { ordersAffected: sortedOrders.length, worksheetsCreated, worksheetsUpdated, pickingItems, summary };
}
