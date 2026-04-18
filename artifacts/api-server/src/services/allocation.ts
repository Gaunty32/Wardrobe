/**
 * Smart stock allocation service.
 *
 * When a purchase order is delivered, this service:
 *  1. Finds the order items that were waiting for this stock.
 *  2. Groups them by order and sorts by required date (soonest first) so that
 *     complete, on-time orders are prioritised when stock is short.
 *  3. All fully-delivered items are placed on the picking list (stockStatus = 'allocated').
 *  4. Production worksheets are created later, at pick time, for items with a finish.
 */

import { eq, inArray, and } from "drizzle-orm";
import {
  db,
  orderItemsTable,
  ordersTable,
  purchaseOrderItemsTable,
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
    let wsPickCount = 0;

    // ── All items → picking list (worksheets created at pick time, not here) ─
    for (const item of items) {
      if (item.stockStatus === "allocated" || item.stockStatus === "in_production" || item.stockStatus === "complete") continue;
      await db
        .update(orderItemsTable)
        .set({ stockStatus: "allocated", stockAllocatedAt: new Date() })
        .where(eq(orderItemsTable.id, item.id));
      pickingItems++;
      wsPickCount++;
    }

    summary.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerName: order.customerName ?? null,
      worksheetNumber: null,
      pickingCount: wsPickCount,
      worksheetCount: 0,
    });
  }

  return { ordersAffected: sortedOrders.length, worksheetsCreated, worksheetsUpdated, pickingItems, summary };
}
