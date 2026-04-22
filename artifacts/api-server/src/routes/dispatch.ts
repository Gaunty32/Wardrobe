import { Router, type IRouter } from "express";
import { eq, inArray, and, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, worksheetsTable, worksheetItemsTable,
  customerEmployeesTable, customerDeliveryAddressesTable, customersTable,
} from "@workspace/db";
import { bookDpdConsignment, reprrintDpdLabel, isDpdConfigured } from "../services/dpd.js";

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

  const orderItems = await db
    .select()
    .from(orderItemsTable)
    .where(inArray(orderItemsTable.orderId, orderIds));

  const employeeIds = [...new Set(orderItems.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

  const deliveryAddressIds = [...new Set(orders.map((o) => o.deliveryAddressId).filter((id): id is number => id != null))];
  const addresses = deliveryAddressIds.length > 0
    ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, deliveryAddressIds))
    : [];

  const result = orders
    .map((order) => {
      const orderWs = worksheets.filter((w) => w.orderId === order.id);
      const items = orderItems.filter((i) => i.orderId === order.id);

      // Plain items (no finish) go straight to stockStatus='complete' with no worksheet.
      // Decorated items create a worksheet; dispatch only when that worksheet is complete.
      const hasPlainComplete = items.some((i) => i.finishId == null && i.stockStatus === "complete");
      const hasWorksheetComplete = orderWs.some((w) => w.status === "complete");

      if (!hasPlainComplete && !hasWorksheetComplete) return null;

      // productionComplete = every item in the order is either plainly complete or in a completed worksheet
      const wsCompleteItemIds = new Set(
        orderWs.filter((w) => w.status === "complete")
          .flatMap((w) => wsItems.filter((wi) => wi.worksheetId === w.id).map((wi) => wi.orderItemId))
      );
      const allComplete = items.every(
        (i) => i.stockStatus === "complete" || wsCompleteItemIds.has(i.id)
      );
      const address = order.deliveryAddressId ? addresses.find((a) => a.id === order.deliveryAddressId) ?? null : null;

      const enrichedItems = items.map((item) => {
        const employee = item.recipientEmployeeId ? employees.find((e) => e.id === item.recipientEmployeeId) ?? null : null;
        return {
          ...item,
          unitPrice: parseFloat(item.unitPrice ?? "0"),
          lineTotal: parseFloat(item.lineTotal ?? "0"),
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
  const isComplete = items.length > 0 && items.every(
    (i) => i.stockStatus === "complete" || wsCompleteItemIds.has(i.id)
  );

  let customer = null;
  if (order.customerId) {
    const [c] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    customer = c ?? null;
  }

  let address = null;
  if (order.deliveryAddressId) {
    const [a] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    address = a ?? null;
  }

  const employeeIds = [...new Set(items.map((i) => i.recipientEmployeeId).filter((id): id is number => id != null))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];

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

  let dpdResult: { consignmentNumber: string; jobId: number; trackingUrl: string; labelPdfBase64: string | null } | null = null;
  let dpdError: string | null = null;

  if (bookDpd && numberOfParcels && totalWeightKg) {
    // Fetch delivery address for DPD
    let address = null;
    if (order.deliveryAddressId) {
      const [a] = await db
        .select()
        .from(customerDeliveryAddressesTable)
        .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
      address = a ?? null;
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

  // Mark order as shipped regardless of DPD outcome
  const updateFields: Partial<typeof ordersTable.$inferInsert> = {
    status: "shipped",
    dispatchedAt: new Date(),
    updatedAt: new Date(),
    ...(numberOfParcels != null ? { dpdParcelCount: numberOfParcels } : {}),
    ...(dpdResult ? {
      trackingNumber: dpdResult.consignmentNumber,
      dpdConsignmentId: dpdResult.consignmentNumber,
      dpdJobId: dpdResult.jobId,
    } : {}),
  };

  const [updated] = await db
    .update(ordersTable)
    .set(updateFields)
    .where(eq(ordersTable.id, parsed.data.id))
    .returning();

  res.json({
    order: updated,
    dpd: dpdResult ? {
      consignmentNumber: dpdResult.consignmentNumber,
      trackingUrl: dpdResult.trackingUrl,
      labelPdfBase64: dpdResult.labelPdfBase64,
    } : null,
    dpdError,
    dpdConfigured: isDpdConfigured(),
  });
});

// ── Reprint DPD label for a dispatched order ──────────────────────────────────
router.get("/dispatch/orders/:id/dpd-label", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, parsed.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  if (!order.dpdJobId) { res.status(404).json({ error: "No DPD label on record for this order" }); return; }

  const labelBase64 = await reprrintDpdLabel(order.dpdJobId);
  if (!labelBase64) { res.status(502).json({ error: "Could not fetch DPD label" }); return; }

  res.json({ labelPdfBase64: labelBase64 });
});

export default router;
