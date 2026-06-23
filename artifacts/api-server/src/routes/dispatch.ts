import { Router, type IRouter } from "express";
import { eq, inArray, and, notInArray, desc, or, ilike, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, worksheetsTable, worksheetItemsTable,
  customerEmployeesTable, customerDeliveryAddressesTable, customersTable, productsTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
} from "@workspace/db";
import { bookDpdConsignment, reprrintDpdLabel, isDpdConfigured } from "../services/dpd.js";
import { logOrderAction, getActor } from "../services/orderLog";
import { notifyAllPortalUsers } from "../services/notifications.js";
import { getWooSettings, wooUpdateOrderStatus } from "./woo.js";

const router: IRouter = Router();

router.get("/dispatch/orders", async (req, res): Promise<void> => {
  const excludedStatuses = ["draft", "cancelled", "shipped", "delivered"];

  const orders = await db
    .select()
    .from(ordersTable)
    .where(notInArray(ordersTable.status, excludedStatuses))
    .orderBy(ordersTable.requiredDate, ordersTable.createdAt);

  if (orders.length === 0) { res.json([]); return; }

  const orderIds = orders.map((o) => o.id);

  const worksheets = await db
    .select()
    .from(worksheetsTable)
    .where(inArray(worksheetsTable.orderId, orderIds));

  const wsIds = worksheets.map((w) => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const orderItemRows = await db
    .select({ item: orderItemsTable, productSku: productsTable.sku })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.orderId, orderIds));
  const orderItems = orderItemRows.map(r => ({ ...r.item, productSku: r.productSku ?? null }));

  // Item IDs that are still on outstanding PO lines — treat as "not ready" even if
  // stock_status='complete', because physical stock hasn't arrived yet.
  const blockedByPoItemIds = new Set<number>();
  if (orderItems.length > 0) {
    const blocked = await db.execute(sql`
      SELECT DISTINCT oi.id
      FROM order_items oi
      WHERE oi.order_id IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})
        AND oi.dispatched_at IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status NOT IN ('cancelled', 'delivered')
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND poi.order_item_id = oi.id
          )
          OR EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po ON po.id = poi.po_id
            WHERE po.status NOT IN ('cancelled', 'delivered')
              AND poi.quantity_delivered < poi.quantity_ordered
              AND poi.quantity_ordered > 0
              AND poi.order_id = oi.order_id
              AND poi.order_item_id IS NULL
              AND (poi.source_order_item_ids IS NULL OR poi.source_order_item_ids = '[]'::jsonb)
              AND LOWER(TRIM(COALESCE(poi.product_name,''))) = LOWER(TRIM(COALESCE(oi.product_name,'')))
              AND LOWER(TRIM(COALESCE(poi.colour,'')))       = LOWER(TRIM(COALESCE(oi.colour,'')))
              AND LOWER(TRIM(COALESCE(poi.size,'')))         = LOWER(TRIM(COALESCE(oi.size,'')))
          )
        )
    `);
    for (const row of blocked.rows as any[]) {
      blockedByPoItemIds.add(Number(row.id));
    }
  }

  const employeeIds = [...new Set(orderItems.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  const deliveryAddressIds = [...new Set(orders.map((o) => o.deliveryAddressId).filter((id): id is number => id != null))];
  // Also collect delivery addresses assigned at employee level (orders with no order-level address)
  const employeeDeliveryAddrIds = [...new Set(employees.map(e => (e as any).deliveryAddressId).filter((id): id is number => id != null))];
  const allAddrIds = [...new Set([...deliveryAddressIds, ...employeeDeliveryAddrIds])];
  const addresses = allAddrIds.length > 0
    ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, allAddrIds))
    : [];

  const result = orders
    .map((order) => {
      const orderWs = worksheets.filter((w) => w.orderId === order.id);
      const items = orderItems.filter((i) => i.orderId === order.id);

      const hasDecoratedItems = items.some(i => i.finishId != null);
      const hasIncompleteWorksheets = orderWs.some(w => w.status !== "complete");
      const isPartShipped = order.status === "part_shipped";

      // part_shipped: check only remaining (undispatched) items are ready for follow-up
      // confirmed: check all items are ready using the decoration-aware logic
      const remainingItems = isPartShipped ? items.filter(i => !i.dispatchedAt) : items;

      // Item IDs that are covered by a completed worksheet
      const wsCompleteItemIdsForOrder = new Set(
        orderWs.filter(w => w.status === "complete")
          .flatMap(w => wsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
      );

      // Items NOT on a completed worksheet that are not yet in a ready state —
      // e.g. plain items still in purchasing (ordered, purchaseRequired, etc.)
      // Also treat items blocked by an outstanding PO as "outstanding" even if
      // their stock_status is 'complete' (stock hasn't physically arrived yet).
      const hasOutstandingItems = items.some(i =>
        blockedByPoItemIds.has(i.id) ||
        (!wsCompleteItemIdsForOrder.has(i.id) &&
         i.stockStatus !== "complete" &&
         i.stockStatus !== "allocated")
      );

      let allComplete: boolean;
      if (isPartShipped) {
        allComplete = remainingItems.length > 0 && remainingItems.every(i =>
          !blockedByPoItemIds.has(i.id) &&
          (i.stockStatus === "complete" || i.stockStatus === "allocated")
        );
      } else {
        // An order is complete when all items are done — either via a completed
        // worksheet, or directly (stock_status='complete' with no outstanding PO).
        // For decorated orders we normally require worksheets, but if every item is
        // already stock_status='complete' (e.g. service charges auto-completed) we
        // treat the order as ready without needing worksheets.
        const allItemsDirectlyComplete = items.every(
          i => !blockedByPoItemIds.has(i.id) && i.stockStatus === "complete"
        );
        allComplete = items.length > 0 && !hasOutstandingItems && (
          hasDecoratedItems
            ? (orderWs.length > 0 && !hasIncompleteWorksheets) || allItemsDirectlyComplete
            : allItemsDirectlyComplete
        );
      }

      // Items that ARE ready to dispatch right now (complete worksheet or picked/plain-complete).
      // 'allocated' means "in the picking list for production" — not ready for dispatch yet.
      // Items blocked by an outstanding PO are excluded even if stock_status='complete'.
      const hasAnyReadyItems = items.some(i =>
        !blockedByPoItemIds.has(i.id) &&
        (wsCompleteItemIdsForOrder.has(i.id) || i.stockStatus === "complete")
      );

      // Show in dispatch queue if:
      //  • part_shipped (follow-up needed), OR
      //  • all items complete (full dispatch), OR
      //  • at least some items are ready (partial dispatch — remaining will follow)
      if (!isPartShipped && !allComplete && !hasAnyReadyItems) return null;

      // Resolve delivery address: order-level first, then fall back to employee location
      let address = order.deliveryAddressId ? addresses.find((a) => a.id === order.deliveryAddressId) ?? null : null;
      if (!address) {
        const orderEmpIds = [...new Set(items.map(i => i.recipientEmployeeId).filter((id): id is number => id != null))];
        const orderEmps = employees.filter(e => orderEmpIds.includes(e.id));
        const empAddrIds = [...new Set(orderEmps.map(e => (e as any).deliveryAddressId as number | null).filter((id): id is number => id != null))];
        if (empAddrIds.length === 1) address = addresses.find(a => a.id === empAddrIds[0]) ?? null;
      }

      const enrichedItems = items.map((item) => {
        const employee = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
        return {
          ...item,
          unitPrice: parseFloat(item.unitPrice ?? "0"),
          lineTotal: parseFloat(item.lineTotal ?? "0"),
          blockedByPo: blockedByPoItemIds.has(item.id),
          employee: employee ? {
            id: employee.id,
            firstName: employee.firstName,
            lastName: employee.lastName,
            jobTitle: employee.jobTitle,
            department: employee.department,
          } : null,
        };
      });

      return {
        ...order,
        totalAmount: parseFloat(order.totalAmount ?? "0"),
        worksheets: orderWs.map((w) => ({
          ...w,
          items: wsItems.filter((i) => i.worksheetId === w.id),
        })),
        items: enrichedItems,
        productionComplete: allComplete,
        deliveryAddress: address,
      };
    })
    .filter(Boolean);

  res.json(result);
});

// ── Dispatched/shipped order history ──────────────────────────────────────────
router.get("/dispatch/shipped", async (req, res): Promise<void> => {
  const { customer, search } = req.query as { customer?: string; search?: string };

  const conditions = [inArray(ordersTable.status, ["shipped", "delivered"])];

  if (customer && customer.trim()) {
    conditions.push(ilike(ordersTable.customerName, `%${customer.trim()}%`));
  }
  if (search && search.trim()) {
    conditions.push(
      or(
        ilike(ordersTable.orderNumber, `%${search.trim()}%`),
        ilike(ordersTable.trackingNumber, `%${search.trim()}%`),
        ilike(ordersTable.dpdConsignmentId, `%${search.trim()}%`),
      )!
    );
  }

  const orders = await db
    .select()
    .from(ordersTable)
    .where(and(...conditions))
    .orderBy(desc(ordersTable.dispatchedAt))
    .limit(200);

  if (orders.length === 0) { res.json([]); return; }

  const orderIds = orders.map((o) => o.id);

  const orderItemRows = await db
    .select({ item: orderItemsTable })
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, orderIds));
  const orderItems = orderItemRows.map(r => r.item);

  const employeeIds = [...new Set(orderItems.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  const deliveryAddressIds = [...new Set(orders.map((o) => o.deliveryAddressId).filter((id): id is number => id != null))];
  const addresses = deliveryAddressIds.length > 0
    ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, deliveryAddressIds))
    : [];

  const result = orders.map((order) => {
    const items = orderItems.filter((i) => i.orderId === order.id);
    const address = order.deliveryAddressId ? addresses.find((a) => a.id === order.deliveryAddressId) ?? null : null;
    const enrichedItems = items.map((item) => {
      const employee = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
      return {
        ...item,
        unitPrice: parseFloat(item.unitPrice ?? "0"),
        lineTotal: parseFloat(item.lineTotal ?? "0"),
        employee: employee ? {
          id: employee.id, firstName: employee.firstName, lastName: employee.lastName,
          jobTitle: employee.jobTitle, department: employee.department,
        } : null,
      };
    });
    return {
      ...order,
      totalAmount: parseFloat(order.totalAmount ?? "0"),
      items: enrichedItems,
      deliveryAddress: address,
    };
  });

  res.json(result);
});

// ── Check if a single order is fully complete & return all document data ───────
router.get("/dispatch/orders/:id/ready", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const worksheets = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, orderId));
  const wsIds = worksheets.map((w) => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const wsCompleteItemIds = new Set(
    worksheets.filter((w) => w.status === "complete")
      .flatMap((w) => wsItems.filter((wi) => wi.worksheetId === w.id).map((wi) => wi.orderItemId))
  );

  const hasDecoratedItems = items.some(i => i.finishId != null);
  const hasIncompleteWorksheets = worksheets.some(w => w.status !== "complete");
  const isPartShipped = order.status === "part_shipped";

  // For part_shipped: check remaining (undispatched) items; for confirmed: all items
  const remainingItems = isPartShipped ? items.filter(i => !i.dispatchedAt) : items;

  // Items NOT on a completed worksheet that are not yet in a ready state —
  // e.g. plain items still in purchasing (ordered, purchaseRequired, etc.)
  // 'allocated' = decorated item in the picking list (not yet picked for production).
  // Plain items are now auto-completed on allocation so they are never 'allocated'.
  const hasOutstandingItems = items.some(i =>
    !wsCompleteItemIds.has(i.id) &&
    i.stockStatus !== "complete"
  );

  let isComplete: boolean;
  if (isPartShipped) {
    isComplete = remainingItems.length > 0 && remainingItems.every(i =>
      i.stockStatus === "complete" || wsCompleteItemIds.has(i.id)
    );
  } else {
    const allItemsDirectlyComplete = items.every(i => i.stockStatus === "complete");
    isComplete = items.length > 0 && !hasOutstandingItems && (
      hasDecoratedItems
        ? (worksheets.length > 0 && !hasIncompleteWorksheets) || allItemsDirectlyComplete
        : allItemsDirectlyComplete
    );
  }

  const incompleteItemIds = remainingItems
    .filter((i) => i.stockStatus !== "complete" && !wsCompleteItemIds.has(i.id))
    .map((i) => i.id);

  let customer = null;
  if (order.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customer = c ?? null;
  }

  const employeeIds = [...new Set(items.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  // Resolve delivery address: order-level first, then fall back to employee location
  let address = null;
  if (order.deliveryAddressId) {
    const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    address = a ?? null;
  }
  if (!address) {
    const empAddrIds = [...new Set(employees.map(e => (e as any).deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      address = a ?? null;
    }
  }

  const enrichedItems = items.map((item) => {
    const emp = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
    return {
      ...item,
      unitPrice: parseFloat(item.unitPrice ?? "0"),
      lineTotal: parseFloat(item.lineTotal ?? "0"),
      employee: emp ? { id: emp.id, firstName: emp.firstName, lastName: emp.lastName, jobTitle: emp.jobTitle, department: emp.department } : null,
    };
  });

  res.json({
    isComplete,
    incompleteItemIds,
    order: {
      ...order,
      totalAmount: parseFloat(order.totalAmount ?? "0"),
      customer,
      deliveryAddress: address,
      worksheets,
      items: enrichedItems,
    },
  });
});

const DispatchBody = z.object({
  numberOfParcels: z.number().int().positive().optional(),
  totalWeightKg: z.number().positive().optional(),
  bookDpd: z.boolean().optional(),
});

router.patch("/dispatch/orders/:id/dispatch", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = DispatchBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { numberOfParcels, totalWeightKg, bookDpd } = body.data;

  // Fetch the order + delivery address before dispatching
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  let dpdResult: { consignmentNumber: string; shipmentId: number; trackingUrl: string; labelHtml: string | null } | null = null;
  let dpdError: string | null = null;

  if (bookDpd && numberOfParcels && totalWeightKg) {
    // Fetch delivery address for DPD — order-level first, fall back to employee location
    let address = null;
    if (order.deliveryAddressId) {
      const [a] = await db
        .select()
        .from(customerDeliveryAddressesTable)
        .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
      address = a ?? null;
    }
    if (!address) {
      // Try employee-level delivery addresses
      const dispatchItems = await db.select({ recipientEmployeeId: orderItemsTable.recipientEmployeeId })
        .from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
      const empIds = [...new Set(dispatchItems.map(i => i.recipientEmployeeId).filter((id): id is number => id != null))];
      if (empIds.length > 0) {
        const emps = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
          .from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, empIds));
        const addrIds = [...new Set(emps.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
        if (addrIds.length === 1) {
          const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, addrIds[0]));
          address = a ?? null;
        }
      }
    }

    if (!address) {
      dpdError = "No delivery address set on this order — DPD booking skipped.";
    } else {
      try {
        dpdResult = await bookDpdConsignment({
          orderNumber: order.orderNumber,
          delivery: {
            contactName: order.customerName ?? "Recipient",
            organisation: order.customerName ?? undefined,
            line1: address.line1 ?? "",
            line2: address.line2 ?? undefined,
            town: address.city ?? "",
            postcode: address.postcode ?? "",
            countryCode: address.country === "United Kingdom" || !address.country ? "GB" : address.country,
          },
          numberOfParcels,
          totalWeightKg,
        });
      } catch (err: unknown) {
        dpdError = err instanceof Error ? err.message : "DPD booking failed";
      }
    }
  }

  // ── Compute invoice date with cross-month logic ───────────────────────────
  // Default: dispatch date. Exception: if the order was placed in a different
  // month/year, use the order date so sales & purchase invoices stay in the
  // same reporting period.
  const now = new Date();
  const orderDate = order.orderDate ? new Date(order.orderDate) : null;
  const crossMonth = orderDate && (
    orderDate.getMonth() !== now.getMonth() ||
    orderDate.getFullYear() !== now.getFullYear()
  );
  const invoiceDate = crossMonth ? orderDate! : now;

  // ── Mark per-item dispatched_at and determine full vs partial shipment ────────
  const allOrderItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, parsed.data.id));
  const allWs = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, parsed.data.id));
  const allWsIds = allWs.map(w => w.id);
  const allWsItems = allWsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, allWsIds))
    : [];
  const wsCompleteItemIds = new Set(
    allWs.filter(w => w.status === "complete")
      .flatMap(w => allWsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
  );
  // Only consider items not already marked as dispatched
  const undispatchedItems = allOrderItems.filter(i => !i.dispatchedAt);
  // Ready to ship now: in a completed worksheet, stock is allocated/complete,
  // OR a service/charge line (no size, no colour, no stock tracking — e.g. logo digitising fee)
  const isServiceLine = (i: typeof allOrderItems[0]) => !i.size && !i.colour && i.stockStatus == null;
  const itemsToDispatch = undispatchedItems.filter(i =>
    wsCompleteItemIds.has(i.id) || i.stockStatus === "complete" || i.stockStatus === "allocated" || isServiceLine(i)
  );
  const remainingAfter = undispatchedItems.filter(i => !itemsToDispatch.some(d => d.id === i.id));

  if (itemsToDispatch.length > 0) {
    await db.update(orderItemsTable)
      .set({ dispatchedAt: now })
      .where(inArray(orderItemsTable.id, itemsToDispatch.map(i => i.id)));

    // Items that were still 'allocated' (picked directly from stock without a
    // production worksheet) must be marked 'complete' so they leave the picking list.
    const allocatedIds = itemsToDispatch.filter(i => i.stockStatus === "allocated").map(i => i.id);
    if (allocatedIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ stockStatus: "complete" })
        .where(inArray(orderItemsTable.id, allocatedIds));
    }
  }

  const isPartialShipment = remainingAfter.length > 0;
  const newStatus = isPartialShipment ? "part_shipped" : "shipped";

  const updateFields: Partial<typeof ordersTable.$inferInsert> = {
    status: newStatus,
    dispatchedAt: now,
    invoiceDate,
    updatedAt: now,
    ...(numberOfParcels != null ? { dpdParcelCount: numberOfParcels } : {}),
    ...(dpdResult ? {
      trackingNumber: dpdResult.consignmentNumber,
      dpdConsignmentId: dpdResult.consignmentNumber,
      dpdJobId: dpdResult.shipmentId,
    } : {}),
  };

  const [updated] = await db
    .update(ordersTable)
    .set(updateFields)
    .where(eq(ordersTable.id, parsed.data.id))
    .returning();

  await logOrderAction(parsed.data.id,
    isPartialShipment ? "Order part-shipped" : "Order dispatched",
    getActor(req),
    dpdResult
      ? `DPD consignment ${dpdResult.consignmentNumber}, ${numberOfParcels ?? 1} parcel(s)${isPartialShipment ? ` — ${remainingAfter.length} item line(s) to follow` : ""}`
      : `${isPartialShipment ? "Partial dispatch" : "Local/manual dispatch"}, ${numberOfParcels ?? 1} box(es)${isPartialShipment ? ` — ${remainingAfter.length} item line(s) to follow` : ""}${dpdError ? ` (DPD error: ${dpdError})` : ""}`);

  // Notify all portal users for this customer that their order has been dispatched
  if (updated.customerId && updated.source === "portal") {
    const trackingInfo = dpdResult ? ` Tracking: ${dpdResult.consignmentNumber}.` : "";
    notifyAllPortalUsers({
      customerId: updated.customerId,
      title: `Order ${updated.orderNumber} has been dispatched`,
      body: `Your order is on its way!${trackingInfo}`,
      link: "/orders",
      type: "dispatched",
    }).catch(() => {});
  }

  // ── Auto-book stock into customer Stores when add_to_stores is set ─────────
  try {
    const orderMeta = await db.execute(sql`
      SELECT add_to_stores, customer_id, order_number FROM orders WHERE id = ${updated.id} LIMIT 1
    `);
    const meta = orderMeta.rows[0] as any;
    if (meta?.add_to_stores && meta?.customer_id) {
      const stockOrderItems = await db.execute(sql`
        SELECT id, product_id, product_name, colour, size, quantity, unit_price, finish_id
        FROM order_items
        WHERE order_id = ${updated.id} AND recipient_type = 'stock' AND product_id IS NOT NULL
      `);
      for (const si of stockOrderItems.rows as any[]) {
        const qty = Number(si.quantity ?? 0);
        if (qty <= 0) continue;
        const existing = await db.execute(sql`
          SELECT id FROM customer_finished_items
          WHERE customer_id = ${meta.customer_id}
            AND product_id = ${si.product_id}
            AND (colour IS NOT DISTINCT FROM ${si.colour ?? null})
            AND (size IS NOT DISTINCT FROM ${si.size ?? null})
          LIMIT 1
        `);
        let stockItemId: number;
        if (existing.rows.length > 0) {
          stockItemId = (existing.rows[0] as any).id;
          await db.execute(sql`
            UPDATE customer_finished_items
            SET stock_quantity = stock_quantity + ${qty}, updated_at = now()
            WHERE id = ${stockItemId}
          `);
        } else {
          const inserted = await db.execute(sql`
            INSERT INTO customer_finished_items
              (customer_id, product_id, finish_id, name, colour, size, stock_quantity, unit_price, created_at, updated_at)
            VALUES
              (${meta.customer_id}, ${si.product_id}, ${si.finish_id ?? null}, ${si.product_name},
               ${si.colour ?? null}, ${si.size ?? null}, ${qty}, ${si.unit_price ?? "0.00"}, now(), now())
            RETURNING id
          `);
          stockItemId = (inserted.rows[0] as any).id;
        }
        await db.execute(sql`
          INSERT INTO customer_stock_movements
            (customer_id, stock_item_id, movement_type, quantity, reference, notes, created_by_name, created_at)
          VALUES
            (${meta.customer_id}, ${stockItemId}, 'in', ${qty}, ${meta.order_number},
             'Received — dispatched from SBS', 'SBS', now())
        `);
      }
    }
  } catch (err) {
    console.error("add_to_stores dispatch hook failed:", err);
    // Non-fatal — dispatch already succeeded
  }

  // ── Auto-complete WooCommerce order when despatched from SBS ─────────────
  if (updated.source === "woocommerce" && updated.wooOrderId) {
    try {
      const wooSettings = await getWooSettings();
      if (wooSettings) {
        await wooUpdateOrderStatus(wooSettings, updated.wooOrderId, "completed");
        console.log(`[dispatch] Marked WooCommerce order #${updated.wooOrderId} as completed`);
      }
    } catch (err) {
      console.error("WooCommerce auto-complete hook failed:", err);
      // Non-fatal — dispatch already succeeded
    }
  }

  res.json({
    order: updated,
    dispatchedItemIds: itemsToDispatch.map(i => i.id),
    dpd: dpdResult ? {
      consignmentNumber: dpdResult.consignmentNumber,
      trackingUrl: dpdResult.trackingUrl,
      labelHtml: dpdResult.labelHtml,
    } : null,
    dpdError,
    dpdConfigured: isDpdConfigured(),
  });
});

// ── Return an order from the dispatch queue back to purchasing ─────────────────
// Resets plain items (stockStatus='complete', no completed worksheet) so they
// leave dispatch and re-enter the purchasing/production flow.
router.post("/dispatch/orders/:id/return", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const orderId = parsed.data.id;

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const worksheets = await db.select().from(worksheetsTable).where(eq(worksheetsTable.orderId, orderId));
  const wsIds = worksheets.map(w => w.id);
  const wsItems = wsIds.length > 0
    ? await db.select().from(worksheetItemsTable).where(inArray(worksheetItemsTable.worksheetId, wsIds))
    : [];

  const wsCompleteItemIds = new Set(
    worksheets.filter(w => w.status === "complete")
      .flatMap(w => wsItems.filter(wi => wi.worksheetId === w.id).map(wi => wi.orderItemId))
  );

  // Only reset items that are "complete" without a completed worksheet backing them
  const itemsToReset = items.filter(i =>
    i.stockStatus === "complete" && !wsCompleteItemIds.has(i.id)
  );

  if (itemsToReset.length === 0) {
    res.status(400).json({ error: "All complete items are backed by completed worksheets — nothing to return." });
    return;
  }

  for (const item of itemsToReset) {
    await db.update(orderItemsTable)
      .set({ stockStatus: null, purchaseRequired: true, stockAllocatedAt: null })
      .where(eq(orderItemsTable.id, item.id));
    // Restore the stock that was decremented when this item was allocated from
    // product stock. We're saying "this allocation was wrong — the stock is
    // still available (or needs to be re-purchased)."
    if (item.productId != null) {
      await db.execute(sql`
        UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${item.quantity}
        WHERE id = ${item.productId}
      `);
    }
  }

  res.json({ returned: itemsToReset.length });
});

// ── Reduce an item quantity and create a backorder for the difference ──────────
// Used when stock is unavailable (damaged/lost). The item is updated to the new
// quantity (keeping its status so it can still be dispatched); a new sibling item
// is created for the shortfall with purchaseRequired=true so it flows back through
// the purchasing and picking pipeline automatically.
router.post("/dispatch/orders/:orderId/items/:itemId/reduce", async (req, res): Promise<void> => {
  const params = z.object({
    orderId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Bad request" }); return; }

  const body = z.object({ newQuantity: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { orderId, itemId } = params.data;
  const { newQuantity } = body.data;

  const [item] = await db.select().from(orderItemsTable).where(
    and(eq(orderItemsTable.id, itemId), eq(orderItemsTable.orderId, orderId)),
  );
  if (!item) { res.status(404).json({ error: "Order item not found" }); return; }
  if (item.dispatchedAt) { res.status(400).json({ error: "Cannot edit a dispatched item" }); return; }
  if (newQuantity >= item.quantity) { res.status(400).json({ error: "New quantity must be less than current quantity" }); return; }

  const diff = item.quantity - newQuantity;
  const unitPrice = parseFloat(String(item.unitPrice ?? "0"));
  const now = new Date();

  // Reduce the existing item quantity — keep its stockStatus/worksheetStatus intact
  // so it remains ready-to-dispatch at the new lower quantity.
  await db.update(orderItemsTable)
    .set({ quantity: newQuantity, lineTotal: String(newQuantity * unitPrice) })
    .where(eq(orderItemsTable.id, itemId));

  // Create a new sibling item for the shortfall in purchasing state
  await db.insert(orderItemsTable).values({
    orderId,
    productId: item.productId,
    productName: item.productName,
    colour: item.colour,
    size: item.size,
    finishId: item.finishId,
    finishName: item.finishName,
    recipientType: item.recipientType,
    recipientName: item.recipientName,
    recipientEmployeeId: item.recipientEmployeeId,
    quantity: diff,
    unitPrice: item.unitPrice,
    lineTotal: String(diff * unitPrice),
    vatRate: item.vatRate,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    purchaseRequired: true,
    purchaseQuantity: diff,
    stockStatus: null,
    purchasingQueuedAt: now,
    notes: item.notes ? `${item.notes} [backorder — ${diff} unit(s) short on dispatch]` : `Backorder — ${diff} unit(s) short on dispatch`,
  });

  // Recalculate order total
  const allItems = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const total = allItems.reduce((sum, i) => sum + parseFloat(String(i.lineTotal ?? "0")), 0);
  await db.update(ordersTable).set({ totalAmount: String(total), updatedAt: now }).where(eq(ordersTable.id, orderId));

  const variantStr = [item.colour, item.size].filter(Boolean).join("/") || "no variant";
  await logOrderAction(orderId, "Item quantity reduced — backorder created", getActor(req),
    `${item.productName} (${variantStr}): ${item.quantity} → ${newQuantity}; backorder of ${diff} unit(s) returned to purchasing queue`);

  res.json({ ok: true });
});

// ── Book DPD for an already-dispatched order (retry after API failure) ────────
router.post("/dispatch/orders/:id/retry-dpd", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const body = z.object({
    numberOfParcels: z.number().int().positive(),
    totalWeightKg: z.number().positive(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!order.dispatchedAt) { res.status(400).json({ error: "Order has not been dispatched yet" }); return; }
  if (order.dpdConsignmentId) { res.status(400).json({ error: "DPD consignment already booked" }); return; }

  let address = null;
  if (order.deliveryAddressId) {
    const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    address = a ?? null;
  }
  if (!address) {
    const empRows = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
      .from(orderItemsTable)
      .innerJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .where(eq(orderItemsTable.orderId, order.id));
    const addrIds = [...new Set(empRows.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (addrIds.length === 1) {
      const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, addrIds[0]));
      address = a ?? null;
    }
  }
  if (!address) { res.status(400).json({ error: "No delivery address on this order" }); return; }

  const { numberOfParcels, totalWeightKg } = body.data;
  const dpdResult = await bookDpdConsignment({
    orderNumber: order.orderNumber,
    delivery: {
      contactName: order.customerName ?? "Recipient",
      organisation: order.customerName ?? undefined,
      line1: address.line1 ?? "",
      line2: address.line2 ?? undefined,
      town: address.city ?? "",
      postcode: address.postcode ?? "",
      countryCode: address.country === "United Kingdom" || !address.country ? "GB" : address.country,
    },
    numberOfParcels,
    totalWeightKg,
  });

  await db.update(ordersTable).set({
    trackingNumber: dpdResult.consignmentNumber,
    dpdConsignmentId: dpdResult.consignmentNumber,
    dpdJobId: dpdResult.shipmentId,
    dpdParcelCount: numberOfParcels,
    updatedAt: new Date(),
  }).where(eq(ordersTable.id, parsed.data.id));

  await logOrderAction(parsed.data.id, "DPD booked (retry)", getActor(req),
    `Consignment ${dpdResult.consignmentNumber}, ${numberOfParcels} parcel(s)`);

  res.json({ consignmentNumber: dpdResult.consignmentNumber, trackingUrl: dpdResult.trackingUrl, labelHtml: dpdResult.labelHtml });
});

// ── Reprint DPD label for a dispatched order ──────────────────────────────────
router.get("/dispatch/orders/:id/dpd-label", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!order.dpdJobId) { res.status(404).json({ error: "No DPD label on record for this order" }); return; }

  const labelHtml = await reprrintDpdLabel(order.dpdJobId);
  if (!labelHtml) { res.status(502).json({ error: "Could not fetch DPD label" }); return; }

  res.json({ labelHtml });
});

export default router;
