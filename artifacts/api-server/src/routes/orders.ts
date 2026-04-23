import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, inArray, and, ne, isNotNull, lt } from "drizzle-orm";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, customersTable, productsTable,
  worksheetsTable, worksheetItemsTable, customerEmployeesTable,
  customerDeliveryAddressesTable, customerEmployeeSizesTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
} from "@workspace/db";
import { buildAcknowledgementEmail, generateOrderAcknowledgementPdf, sendEmail, isEmailConfigured } from "../services/email";
import {
  UpdateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  DeleteOrderParams,
  ListOrdersQueryParams,
  AddOrderItemParams,
  AddOrderItemBody,
  UpdateOrderItemParams,
  UpdateOrderItemBody,
  DeleteOrderItemParams,
} from "@workspace/api-zod";

// Custom schema — generated CreateOrderBody uses zod.date() which rejects ISO strings from JSON
const CreateOrderBodyFixed = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  items: z.array(z.object({
    productId: z.number().optional().nullable(),
    productName: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })).optional(),
});

const router: IRouter = Router();

async function generateOrderNumber(): Promise<string> {
  const rows = await db.execute(sql`
    SELECT order_number FROM orders
    WHERE order_number ~ '^O[0-9]+$'
    ORDER BY LENGTH(order_number) DESC, order_number DESC
    LIMIT 1
  `);
  const last = (rows.rows[0] as any)?.order_number as string | undefined;
  const maxNum = last ? parseInt(last.slice(1), 10) : 99;
  return `O${maxNum + 1}`;
}

function numericToFloat(val: string | null | undefined): number {
  return val ? parseFloat(val) : 0;
}

async function recalcOrderTotal(orderId: number): Promise<void> {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  const total = items.reduce((sum, item) => sum + numericToFloat(item.lineTotal), 0);
  await db
    .update(ordersTable)
    .set({ totalAmount: String(total), updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
}

const DUE_DATE_SORT = [sql`${ordersTable.requiredDate} ASC NULLS LAST`, desc(ordersTable.createdAt)] as const;

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  let orders;
  if (query.success) {
    const conditions = [];
    if (query.data.status) conditions.push(eq(ordersTable.status, query.data.status));
    if (query.data.customerId) conditions.push(eq(ordersTable.customerId, query.data.customerId));
    orders = conditions.length > 0
      ? await db.select().from(ordersTable).where(and(...conditions)).orderBy(...DUE_DATE_SORT)
      : await db.select().from(ordersTable).orderBy(...DUE_DATE_SORT);
  } else {
    orders = await db.select().from(ordersTable).orderBy(...DUE_DATE_SORT);
  }
  res.json(orders.map((o) => ({ ...o, totalAmount: numericToFloat(o.totalAmount) })));
});

router.get("/orders/weekly-stats", async (req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', order_date AT TIME ZONE 'UTC')::date AS week_start,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(total_amount), 0)::float AS total_value
    FROM orders
    WHERE order_date >= NOW() - INTERVAL '12 weeks'
      AND status != 'cancelled'
    GROUP BY date_trunc('week', order_date AT TIME ZONE 'UTC')
    ORDER BY week_start ASC
  `);
  res.json(rows.rows);
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBodyFixed.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { items, customerId, notes, orderDate } = parsed.data;

  let customerName: string | null = null;
  if (customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
    customerName = customer?.name ?? null;
  }

  const orderNumber = await generateOrderNumber();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderNumber,
      customerId: customerId ?? null,
      customerName,
      status: "draft",
      totalAmount: "0",
      notes: notes ?? null,
      orderDate: orderDate ? new Date(orderDate) : new Date(),
    })
    .returning();

  if (items && items.length > 0) {
    const itemValues = items.map((item) => ({
      orderId: order.id,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      lineTotal: String(item.quantity * item.unitPrice),
    }));
    await db.insert(orderItemsTable).values(itemValues);
    await recalcOrderTotal(order.id);
  }

  // Auto-set default delivery address if customer has one
  if (customerId) {
    const defaultAddr = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.customerId, customerId))
      .limit(20);
    const def = defaultAddr.find(a => a.isDefault) ?? defaultAddr[0] ?? null;
    if (def) {
      await db.update(ordersTable).set({ deliveryAddressId: def.id }).where(eq(ordersTable.id, order.id));
    }
  }

  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));
  res.status(201).json({ ...updatedOrder, totalAmount: numericToFloat(updatedOrder.totalAmount) });
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const itemRows = await db
    .select({
      item: orderItemsTable,
      catalogueProductName: productsTable.name,
    })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, order.id));

  let deliveryAddress: Record<string, unknown> | null = null;
  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }

  res.json({
    ...order,
    totalAmount: numericToFloat(order.totalAmount),
    deliveryAddress,
    items: itemRows.map(({ item, catalogueProductName }) => ({
      ...item,
      productName: catalogueProductName ?? item.productName,
      unitPrice: numericToFloat(item.unitPrice),
      lineTotal: numericToFloat(item.lineTotal),
      purchaseRequired: item.purchaseRequired,
      purchaseQuantity: item.purchaseQuantity,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
    })),
  });
});

router.patch("/orders/:id", async (req, res): Promise<void> => {
  const params = UpdateOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  if (parsed.data.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, parsed.data.customerId));
    if (customer) {
      updateData.customerName = customer.name;
    }
  }

  if (parsed.data.orderDate) {
    updateData.orderDate = new Date(parsed.data.orderDate);
  }
  if (req.body.requiredDate !== undefined) {
    updateData.requiredDate = req.body.requiredDate ? new Date(req.body.requiredDate) : null;
  }
  if (req.body.shippingMethod !== undefined) {
    updateData.shippingMethod = req.body.shippingMethod ?? null;
  }
  if (req.body.deliveryAddressId !== undefined) {
    updateData.deliveryAddressId = req.body.deliveryAddressId ?? null;
  }

  const [order] = await db
    .update(ordersTable)
    .set(updateData)
    .where(eq(ordersTable.id, params.data.id))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // ── Stock allocation on confirmation ──────────────────────────────────────
  if (parsed.data.status === "confirmed") {
    const items = await db
      .select({
        id: orderItemsTable.id,
        productId: orderItemsTable.productId,
        productName: orderItemsTable.productName,
        colour: orderItemsTable.colour,
        size: orderItemsTable.size,
        quantity: orderItemsTable.quantity,
        unitPrice: orderItemsTable.unitPrice,
        lineTotal: orderItemsTable.lineTotal,
        recipientName: orderItemsTable.recipientName,
      })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, params.data.id));

    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))] as number[];

    let allocatedLines = 0;
    let purchaseLines = 0;
    const shortfallDetails: Array<{
      id: number; productName: string; colour: string | null; size: string | null;
      purchaseQuantity: number; supplierId: number | null; supplierName: string | null; supplierEmail: string | null;
    }> = [];

    if (productIds.length > 0) {
      const productStocks = await db
        .select({
          id: productsTable.id, stockQuantity: productsTable.stockQuantity,
          supplierId: productsTable.supplierId, supplierName: suppliersTable.name, supplierEmail: suppliersTable.email,
        })
        .from(productsTable)
        .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
        .where(inArray(productsTable.id, productIds));

      const stockMap = new Map(productStocks.map(p => [p.id, p]));
      const remainingStock = new Map(productStocks.map(p => [p.id, p.stockQuantity ?? 0]));

      for (const item of items) {
        if (!item.productId) continue;
        const stock = stockMap.get(item.productId);
        if (!stock) continue;

        const available = remainingStock.get(item.productId) ?? 0;
        const qty = item.quantity ?? 0;
        const allocatedQty = Math.min(available, qty);
        const shortfall = qty - allocatedQty;

        remainingStock.set(item.productId, available - allocatedQty);

        await db.update(orderItemsTable).set({
          purchaseRequired: shortfall > 0,
          purchaseQuantity: shortfall > 0 ? shortfall : null,
          supplierId: shortfall > 0 ? (stock.supplierId ?? null) : null,
          supplierName: shortfall > 0 ? (stock.supplierName ?? null) : null,
        }).where(eq(orderItemsTable.id, item.id));

        if (shortfall > 0) {
          purchaseLines++;
          shortfallDetails.push({
            id: item.id, productName: item.productName, colour: item.colour ?? null,
            size: item.size ?? null, purchaseQuantity: shortfall,
            supplierId: stock.supplierId ?? null, supplierName: stock.supplierName ?? null, supplierEmail: stock.supplierEmail ?? null,
          });
        } else {
          allocatedLines++;
        }
      }

      for (const [productId, remaining] of remainingStock.entries()) {
        const original = stockMap.get(productId);
        if (!original) continue;
        if ((original.stockQuantity ?? 0) - remaining > 0) {
          await db.update(productsTable).set({ stockQuantity: remaining }).where(eq(productsTable.id, productId));
        }
      }
    }

    // Build shortfall groups with existing draft POs per supplier
    const supplierIds = [...new Set(shortfallDetails.map(i => i.supplierId).filter(Boolean))] as number[];
    const draftPos = supplierIds.length > 0
      ? await db.select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber, supplierId: purchaseOrdersTable.supplierId })
          .from(purchaseOrdersTable)
          .where(inArray(purchaseOrdersTable.supplierId, supplierIds))
          .then(rows => rows.filter(r => r.supplierId !== null))
      : [];
    // Also include draft POs with no supplierId match (items with unknown supplier)
    const draftPosNoSupplier = shortfallDetails.some(i => !i.supplierId)
      ? await db.select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber, supplierId: purchaseOrdersTable.supplierId })
          .from(purchaseOrdersTable)
          .where(eq(purchaseOrdersTable.status, "draft"))
          .then(rows => rows.filter(r => !r.supplierId))
      : [];
    const allDraftPos = [...draftPos, ...draftPosNoSupplier];

    const groupMap = new Map<string, typeof shortfallDetails[0] & { itemIds: number[]; items: typeof shortfallDetails; existingDraftPos: Array<{id:number;poNumber:string}> }>();
    for (const s of shortfallDetails) {
      const key = s.supplierName ?? "Unknown Supplier";
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          ...s, itemIds: [], items: [],
          existingDraftPos: allDraftPos.filter(p => p.supplierId === s.supplierId).map(p => ({ id: p.id, poNumber: p.poNumber })),
        });
      }
      const g = groupMap.get(key)!;
      g.itemIds.push(s.id);
      g.items.push(s);
    }
    const shortfallGroups = [...groupMap.values()];

    res.json({
      ...order, totalAmount: numericToFloat(order.totalAmount),
      allocation: { allocated: allocatedLines, purchaseRequired: purchaseLines },
      shortfallGroups,
      emailConfigured: isEmailConfigured,
    });
    return;
  }
  // ──────────────────────────────────────────────────────────────────────────

  res.json({ ...order, totalAmount: numericToFloat(order.totalAmount) });
});

router.delete("/orders/:id", async (req, res): Promise<void> => {
  const params = DeleteOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Fetch the order first so we know its status
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // Restore stock only for confirmed orders (stock is deducted at confirmation).
  // Shipped/delivered orders have already left — don't restore.
  if (order.status === "confirmed") {
    const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
    for (const item of items) {
      // Only items where stock was actually allocated (not purchase-required)
      if (!item.purchaseRequired && item.productId && item.quantity) {
        await db.execute(
          sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${item.quantity} WHERE id = ${item.productId}`
        );
      }
    }
  }

  await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
  res.sendStatus(204);
});

// ─── Order Acknowledgement Email ──────────────────────────────────────────────
router.post("/orders/:id/send-acknowledgement", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const itemRows2 = await db
    .select({
      productName: orderItemsTable.productName,
      catalogueProductName: productsTable.name,
      sku: productsTable.sku,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size, quantity: orderItemsTable.quantity,
      unitPrice: orderItemsTable.unitPrice, lineTotal: orderItemsTable.lineTotal,
      recipientName: orderItemsTable.recipientName,
    })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, params.data.id));

  const items = itemRows2.map(r => ({ ...r, productName: r.catalogueProductName ?? r.productName }));

  // Resolve customer email and address
  const body = z.object({ toEmail: z.string().email().optional() }).safeParse(req.body);
  let toEmail = body.success ? body.data.toEmail : undefined;
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;

  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    if (!toEmail) toEmail = customer?.email ?? undefined;
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
  }
  if (!toEmail) { res.status(400).json({ error: "No customer email address found" }); return; }

  // Resolve delivery address if linked
  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) {
      deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    recipientName: i.recipientName ?? null,
  }));

  const { subject, html, text } = buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    contactFirstName,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: numericToFloat(order.totalAmount),
    items: mappedItems,
  });

  // Generate PDF attachment
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      totalAmount: numericToFloat(order.totalAmount),
      items: mappedItems,
    });
    attachments = [{ filename: `Order-Acknowledgement-${order.orderNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (_err) {
    // PDF failure is non-fatal — email still sends without attachment
  }

  const result = await sendEmail({ to: toEmail, subject, html, text, attachments });

  res.json({ sent: result.sent, error: result.error, subject, html, text, to: toEmail, emailConfigured: isEmailConfigured });
});

router.post("/orders/:id/items", async (req, res): Promise<void> => {
  const params = AddOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const addItemSchema = z.object({
    productId: z.number().int().positive().optional().nullable(),
    productName: z.string(),
    colour: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    finishId: z.number().int().positive().optional().nullable(),
    finishName: z.string().optional().nullable(),
    recipientType: z.enum(["stock", "person"]).default("stock"),
    recipientName: z.string().optional().nullable(),
    recipientEmployeeId: z.number().int().positive().optional().nullable(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0),
    purchaseRequired: z.boolean().optional().default(false),
    purchaseQuantity: z.number().int().min(0).optional().nullable(),
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().optional().nullable(),
  });

  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const lineTotal = parsed.data.quantity * parsed.data.unitPrice;
  const [item] = await db
    .insert(orderItemsTable)
    .values({
      orderId: params.data.id,
      productId: parsed.data.productId ?? null,
      productName: parsed.data.productName,
      colour: parsed.data.colour ?? null,
      size: parsed.data.size ?? null,
      finishId: parsed.data.finishId ?? null,
      finishName: parsed.data.finishName ?? null,
      recipientType: parsed.data.recipientType,
      recipientName: parsed.data.recipientName ?? null,
      recipientEmployeeId: parsed.data.recipientEmployeeId ?? null,
      quantity: parsed.data.quantity,
      unitPrice: String(parsed.data.unitPrice),
      lineTotal: String(lineTotal),
      purchaseRequired: parsed.data.purchaseRequired ?? false,
      purchaseQuantity: parsed.data.purchaseQuantity ?? null,
      supplierId: parsed.data.supplierId ?? null,
      supplierName: parsed.data.supplierName ?? null,
    })
    .returning();

  await recalcOrderTotal(params.data.id);

  // Save the size against the employee so it can be suggested on reorder
  if (parsed.data.recipientEmployeeId && parsed.data.size && parsed.data.productName) {
    const empId = parsed.data.recipientEmployeeId;
    const label = parsed.data.productName;
    const sizeVal = parsed.data.size;
    const allSizes = await db.select().from(customerEmployeeSizesTable)
      .where(eq(customerEmployeeSizesTable.employeeId, empId));
    const match = allSizes.find(s => s.label === label);
    if (match) {
      await db.update(customerEmployeeSizesTable)
        .set({ size: sizeVal, updatedAt: new Date() })
        .where(eq(customerEmployeeSizesTable.id, match.id));
    } else {
      await db.insert(customerEmployeeSizesTable)
        .values({ employeeId: empId, label, size: sizeVal });
    }
  }

  res.status(201).json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
  });
});

router.patch("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = UpdateOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingItem] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId));
  if (!existingItem) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  const quantity = parsed.data.quantity ?? existingItem.quantity;
  const unitPrice = parsed.data.unitPrice ?? numericToFloat(existingItem.unitPrice);
  const lineTotal = quantity * unitPrice;

  const updateData: Record<string, unknown> = {
    quantity,
    unitPrice: String(unitPrice),
    lineTotal: String(lineTotal),
  };

  const [item] = await db
    .update(orderItemsTable)
    .set(updateData)
    .where(eq(orderItemsTable.id, params.data.itemId))
    .returning();

  await recalcOrderTotal(params.data.id);

  res.json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
  });
});

router.delete("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [item] = await db.delete(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId)).returning();
  if (!item) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  await recalcOrderTotal(params.data.id);
  res.sendStatus(204);
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [{ count: totalOrders }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable);

  const [{ total: totalRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(total_amount), 0)::float` })
    .from(ordersTable)
    .where(eq(ordersTable.status, "delivered"));

  const [{ count: totalCustomers }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable);

  const [{ count: totalProducts }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productsTable);

  const statusCounts = await db
    .select({
      status: ordersTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .groupBy(ordersTable.status);

  const ordersByStatus = { draft: 0, confirmed: 0, shipped: 0, delivered: 0, cancelled: 0 };
  for (const row of statusCounts) {
    const key = row.status as keyof typeof ordersByStatus;
    if (key in ordersByStatus) {
      ordersByStatus[key] = row.count;
    }
  }

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);

  res.json({
    totalOrders,
    totalRevenue,
    totalCustomers,
    totalProducts,
    ordersByStatus,
    recentOrders: recentOrders.map((o) => ({ ...o, totalAmount: numericToFloat(o.totalAmount) })),
  });
});

router.get("/orders/:id/pack-status", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (items.length === 0) { res.json({ recipients: [] }); return; }

  const itemIds = items.map((i) => i.id);
  const wsItems = await db
    .select({ wsItem: worksheetItemsTable, ws: worksheetsTable })
    .from(worksheetItemsTable)
    .innerJoin(worksheetsTable, eq(worksheetItemsTable.worksheetId, worksheetsTable.id))
    .where(inArray(worksheetItemsTable.orderItemId, itemIds));

  const employeeIds = [...new Set(items.filter((i) => i.recipientEmployeeId).map((i) => i.recipientEmployeeId!))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const wsItemMap = new Map<number, { worksheetNumber: string; status: string }>();
  for (const { wsItem, ws } of wsItems) {
    if (wsItem.orderItemId) wsItemMap.set(wsItem.orderItemId, { worksheetNumber: ws.worksheetNumber, status: ws.status });
  }

  const stockItems: {
    orderItemId: number; productName: string; colour: string | null; size: string | null;
    quantity: number; isComplete: boolean; worksheetNumber: string | null;
  }[] = [];

  type PersonGroup = {
    recipientName: string;
    employeeId: number | null;
    jobTitle: string | null;
    department: string | null;
    allComplete: boolean;
    items: { orderItemId: number; productName: string; colour: string | null; size: string | null; quantity: number; isComplete: boolean; worksheetNumber: string | null; }[];
  };

  const personMap = new Map<string, PersonGroup>();

  for (const oi of items) {
    const wsInfo = wsItemMap.get(oi.id);
    const isComplete = wsInfo?.status === "complete";
    const entry = { orderItemId: oi.id, productName: oi.productName, colour: oi.colour, size: oi.size, quantity: oi.quantity, isComplete, worksheetNumber: wsInfo?.worksheetNumber ?? null };

    if (oi.recipientType === "person" && oi.recipientName) {
      const key = oi.recipientName;
      if (!personMap.has(key)) {
        const emp = oi.recipientEmployeeId ? empMap.get(oi.recipientEmployeeId) : undefined;
        personMap.set(key, { recipientType: "person" as const, recipientName: key, employeeId: oi.recipientEmployeeId ?? null, jobTitle: emp?.jobTitle ?? null, department: emp?.department ?? null, allComplete: true, items: [] });
      }
      const group = personMap.get(key)!;
      group.items.push(entry);
      if (!isComplete) group.allComplete = false;
    } else {
      stockItems.push(entry);
    }
  }

  const stockAllComplete = stockItems.length > 0 && stockItems.every((i) => i.isComplete);

  res.json({
    orderId,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    recipients: [
      ...(stockItems.length > 0 ? [{ recipientType: "stock", recipientName: null, employeeId: null, jobTitle: null, department: null, allComplete: stockAllComplete, items: stockItems }] : []),
      ...[...personMap.values()],
    ],
  });
});

// ── Order backorders: PO lines linked to this order that are still pending ─────
router.get("/orders/:id/backorders", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

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
      orderItemId: purchaseOrderItemsTable.orderItemId,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .innerJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .where(and(
      eq(orderItemsTable.orderId, orderId),
      ne(purchaseOrdersTable.status, "delivered"),
      lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
    ))
    .orderBy(purchaseOrderItemsTable.estimatedDueDate);

  res.json(rows.map((r) => ({ ...r, remaining: r.quantityOrdered - r.quantityDelivered })));
});

export default router;
