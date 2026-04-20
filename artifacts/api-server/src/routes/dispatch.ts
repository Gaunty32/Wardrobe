import { Router, type IRouter } from "express";
import { eq, inArray, and, notInArray } from "drizzle-orm";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, worksheetsTable, worksheetItemsTable,
  customerEmployeesTable, customerDeliveryAddressesTable, customersTable,
} from "@workspace/db";

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

router.patch("/dispatch/orders/:id/dispatch", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db
    .update(ordersTable)
    .set({ status: "shipped", dispatchedAt: new Date(), updatedAt: new Date() })
    .where(eq(ordersTable.id, parsed.data.id))
    .returning();

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  res.json(order);
});

export default router;
