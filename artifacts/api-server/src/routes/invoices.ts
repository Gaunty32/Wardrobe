import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ordersTable, orderItemsTable, customersTable, settingsTable } from "@workspace/db";
import { eq, desc, and, isNotNull, isNull, sql, inArray } from "drizzle-orm";
import {
  sendInvoiceEmail, getSmtpConfig, testSmtpConnection,
  buildInvoiceEmail, generateInvoicePDF, buildInvoiceDataForOrder,
  fetchLogoDataUrl, sendEmail,
} from "../services/email";
import { postInvoiceToXero } from "../services/xero";
import { logOrderAction, getActor } from "../services/orderLog";

const router: IRouter = Router();

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

// ─── List invoiceable orders ─────────────────────────────────────────────────
// Returns dispatched orders split into two groups:
//   to_send  — not yet emailed
//   to_post  — emailed but not yet in Xero

router.get("/invoices", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      status: ordersTable.status,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceDate: ordersTable.invoiceDate,
      trackingNumber: ordersTable.trackingNumber,
      shippingMethod: ordersTable.shippingMethod,
      paidAt: ordersTable.paidAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      invoiceEmailSentTo: ordersTable.invoiceEmailSentTo,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      xeroInvoiceStatus: ordersTable.xeroInvoiceStatus,
      customerPhone: customersTable.phone,
      invoiceScheduledSendAt: ordersTable.invoiceScheduledSendAt,
      customerHighLevelContactId: customersTable.highLevelContactId,
      poNumber: ordersTable.poNumber,
      poNumberRequired: customersTable.poNumberRequired,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(sql`${ordersTable.status} IN ('shipped', 'dispatched')`)
    .orderBy(desc(ordersTable.dispatchedAt));

  const toSend = orders.filter((o) => !o.invoiceEmailSentAt);
  const toPost = orders.filter((o) => o.invoiceEmailSentAt && !o.xeroInvoiceId);
  const done = orders.filter((o) => o.invoiceEmailSentAt && o.xeroInvoiceId);

  res.json({ toSend, toPost, done });
});

// ─── Update invoice date ──────────────────────────────────────────────────────

router.patch("/invoices/:orderId/invoice-date", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const body = z.object({ invoiceDate: z.string() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "invoiceDate (ISO string) required" }); return; }

  const date = new Date(body.data.invoiceDate);
  if (isNaN(date.getTime())) { res.status(400).json({ error: "Invalid date" }); return; }

  await db.update(ordersTable)
    .set({ invoiceDate: date, updatedAt: new Date() })
    .where(eq(ordersTable.id, idParse.data));

  res.json({ ok: true });
});

// ─── Update tracking number ──────────────────────────────────────────────────

router.patch("/invoices/:orderId/tracking", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const body = z.object({ trackingNumber: z.string().nullable() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "trackingNumber required" }); return; }

  await db.update(ordersTable)
    .set({ trackingNumber: body.data.trackingNumber, updatedAt: new Date() })
    .where(eq(ordersTable.id, idParse.data));

  res.json({ ok: true });
});

// ─── Consolidated invoice (multiple orders → single PDF) ─────────────────────
// IMPORTANT: must be registered BEFORE the parameterised /invoices/:orderId/send-email
// route, otherwise Express matches "consolidated" as the :orderId param.

router.post("/invoices/consolidated/send-email", async (req, res): Promise<void> => {
  const body = z.object({
    orderIds: z.array(z.number().int().positive()).min(1),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "orderIds array required" }); return; }

  try {
    const { orderIds } = body.data;

    // Fetch all orders with customer info
    const orderRows = await db
      .select({
        id: ordersTable.id,
        orderNumber: ordersTable.orderNumber,
        customerName: ordersTable.customerName,
        customerId: ordersTable.customerId,
        totalAmount: ordersTable.totalAmount,
        status: ordersTable.status,
        poNumber: ordersTable.poNumber,
        notes: ordersTable.notes,
        customerEmail: customersTable.email,
        contactFirstName: customersTable.contactFirstName,
        customerLogoUrl: customersTable.logoUrl,
        customerAddress: customersTable.address,
        customerCity: customersTable.city,
        customerPostcode: customersTable.postcode,
        poNumberRequired: customersTable.poNumberRequired,
      })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(inArray(ordersTable.id, orderIds));

    if (orderRows.length === 0) { res.status(404).json({ error: "No orders found" }); return; }

    // Validate same customer
    const uniqueCustomerIds = [...new Set(orderRows.map((o) => o.customerId))];
    if (uniqueCustomerIds.length > 1) {
      res.status(400).json({ error: "All orders must belong to the same customer" }); return;
    }

    const firstOrder = orderRows[0];
    const customerEmail = firstOrder.customerEmail ?? null;
    if (!customerEmail) { res.status(400).json({ error: "Customer has no email address on record" }); return; }

    // Block if customer requires a PO number but none is set on any order
    if (firstOrder.poNumberRequired && orderRows.every((o) => !o.poNumber)) {
      res.status(400).json({ error: "This customer requires a PO number before an invoice can be sent. Please add a PO number to the order(s) first." });
      return;
    }

    const poNumber = firstOrder.poNumber ?? null;
    // For multi-order consolidated invoices always join all order numbers so the
    // reference clearly identifies every order on the invoice.  For a single
    // order keep the legacy PO/… style when a PO number is present.
    const invoiceRef = orderRows.length === 1 && poNumber
      ? `PO/${poNumber}`
      : orderRows.map((o) => o.orderNumber).join("+");

    const customerLogoDataUrl = firstOrder.customerLogoUrl
      ? await fetchLogoDataUrl(firstOrder.customerLogoUrl).catch(() => null)
      : null;

    // Collect all items across orders, tagged with their orderRef
    const allItems: Array<{
      productName: string;
      colour: string | null;
      size: string | null;
      finishName: string | null;
      quantity: number;
      unitPrice: string;
      lineTotal: string;
      vatRate: number;
      orderRef: string;
    }> = [];

    for (const order of orderRows) {
      const items = await db
        .select()
        .from(orderItemsTable)
        .where(eq(orderItemsTable.orderId, order.id));

      for (const item of items) {
        allItems.push({
          productName: item.productName,
          colour: item.colour,
          size: item.size,
          finishName: item.finishName,
          quantity: item.quantity,
          unitPrice: item.unitPrice as string,
          lineTotal: item.lineTotal as string,
          vatRate: parseFloat(item.vatRate as string),
          orderRef: order.orderNumber,
        });
      }
    }

    const totalAmount = orderRows.reduce((s, o) => s + parseFloat(String(o.totalAmount ?? "0")), 0);

    // Generate consolidated PDF
    const pdfBuffer = await generateInvoicePDF({
      orderNumber: invoiceRef,
      customerName: firstOrder.customerName ?? "Customer",
      customerEmail,
      customerAddress: firstOrder.customerAddress,
      customerCity: firstOrder.customerCity,
      customerPostcode: firstOrder.customerPostcode,
      invoiceDate: new Date(),
      poNumber,
      items: allItems,
      totalAmount: totalAmount.toFixed(2),
      notes: null,
    });

    // Build email
    const { subject, html, text } = buildInvoiceEmail({
      orderNumber: invoiceRef,
      customerName: firstOrder.customerName,
      contactFirstName: firstOrder.contactFirstName,
      customerLogoDataUrl,
      invoiceDate: new Date(),
      poNumber,
      items: allItems.map((i) => ({
        ...i,
        unitPrice: parseFloat(i.unitPrice),
        lineTotal: parseFloat(i.lineTotal),
      })),
    });

    // Send email
    const safeName = invoiceRef.replace(/[/\\]/g, "-");
    const result = await sendEmail({
      to: customerEmail,
      subject,
      html,
      text,
      attachments: [{ filename: `Invoice-${safeName}.pdf`, content: pdfBuffer, contentType: "application/pdf" }],
    });

    if (!result.sent) throw new Error(result.error ?? "Failed to send email");

    // Mark all orders as invoiced
    await db
      .update(ordersTable)
      .set({ invoiceEmailSentAt: new Date(), invoiceEmailSentTo: customerEmail, updatedAt: new Date() })
      .where(inArray(ordersTable.id, orderIds));

    // Log action on each order
    for (const id of orderIds) {
      await logOrderAction(
        id,
        "Consolidated invoice sent",
        getActor(req),
        `Combined invoice ${invoiceRef} emailed to ${customerEmail} covering ${orderIds.length} order(s)`
      );
    }

    res.json({ ok: true, sentTo: customerEmail, invoiceRef });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send consolidated invoice" });
  }
});

// ─── Send invoice email ──────────────────────────────────────────────────────

router.post("/invoices/:orderId/send-email", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    // Block invoice send if customer requires a PO number but none is set
    const [orderCheck] = await db
      .select({ poNumber: ordersTable.poNumber, poNumberRequired: customersTable.poNumberRequired })
      .from(ordersTable)
      .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
      .where(eq(ordersTable.id, idParse.data));
    if (orderCheck?.poNumberRequired && !orderCheck?.poNumber) {
      res.status(400).json({ error: "This customer requires a PO number before an invoice can be sent. Please add a PO number to the order first." });
      return;
    }

    const result = await sendInvoiceEmail(idParse.data);

    await logOrderAction(idParse.data, "Invoice sent", getActor(req), `Invoice emailed to ${result.sentTo}`);

    // Auto-post to Xero if connected (non-blocking — best effort)
    let xeroResult: { xeroInvoiceId?: string; xeroInvoiceStatus?: string } = {};
    try {
      const xeroPosted = await postInvoiceToXero(idParse.data);
      xeroResult = { xeroInvoiceId: xeroPosted.xeroInvoiceId, xeroInvoiceStatus: xeroPosted.xeroInvoiceStatus };
      if (xeroPosted.xeroInvoiceId) {
        await logOrderAction(idParse.data, "Posted to Xero", getActor(req), `Xero invoice ID: ${xeroPosted.xeroInvoiceId}`);
      }
    } catch {
      // Xero not connected or customer not linked — silently skip
    }

    res.json({ ok: true, sentTo: result.sentTo, ...xeroResult });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to send invoice" });
  }
});

// ─── Schedule / cancel scheduled invoice send ────────────────────────────────

router.patch("/invoices/:orderId/schedule", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  const { scheduledSendAt } = req.body as { scheduledSendAt: string | null };
  try {
    const val = scheduledSendAt ? new Date(scheduledSendAt) : null;
    await db.update(ordersTable)
      .set({ invoiceScheduledSendAt: val, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));
    if (val) {
      await logOrderAction(idParse.data, "Invoice send scheduled", getActor(req),
        `Scheduled for ${val.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })}`);
    } else {
      await logOrderAction(idParse.data, "Invoice schedule cancelled", getActor(req));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// ─── Mark order as paid / unpaid ─────────────────────────────────────────────

router.patch("/invoices/:orderId/paid", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  const { paid } = req.body as { paid: boolean };
  try {
    await db.update(ordersTable)
      .set({ paidAt: paid ? new Date() : null, updatedAt: new Date() })
      .where(eq(ordersTable.id, idParse.data));
    await logOrderAction(idParse.data, paid ? "Invoice marked as paid" : "Invoice marked as unpaid", getActor(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

// ─── Preview invoice PDF (returns raw PDF) ───────────────────────────────────

router.get("/invoices/:orderId/preview-pdf", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  try {
    const { order, items, customerEmail, customerAddress, customerCity, customerPostcode } = await buildInvoiceDataForOrder(idParse.data);
    const pdfBuffer = await generateInvoicePDF({
      orderNumber: order.orderNumber,
      customerName: order.customerName ?? "Customer",
      customerEmail,
      customerAddress,
      customerCity,
      customerPostcode,
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
      poNumber: order.poNumber,
      items: items.map((i) => ({
        productName: i.productName,
        colour: i.colour,
        size: i.size,
        finishName: i.finishName,
        quantity: i.quantity,
        unitPrice: i.unitPrice as string,
        lineTotal: i.lineTotal as string,
        vatRate: parseFloat(i.vatRate as string),
      })),
      totalAmount: order.totalAmount as string,
      notes: order.notes,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Invoice-${order.orderNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to generate PDF" });
  }
});

// ─── Preview invoice email HTML ───────────────────────────────────────────────

router.get("/invoices/:orderId/preview-email", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }
  try {
    const { order, items, contactFirstName, customerLogoDataUrl, customerAddress, customerCity, customerPostcode } = await buildInvoiceDataForOrder(idParse.data);
    const mappedItems = items.map((i) => ({
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      finishName: i.finishName,
      quantity: i.quantity,
      unitPrice: parseFloat(i.unitPrice as string),
      lineTotal: parseFloat(i.lineTotal as string),
      vatRate: parseFloat(i.vatRate as string),
    }));
    const { subject, html } = buildInvoiceEmail({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      contactFirstName,
      customerLogoDataUrl,
      customerAddress,
      customerCity,
      customerPostcode,
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      notes: order.notes,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
      poNumber: order.poNumber,
      items: mappedItems,
    });
    res.json({ subject, html });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to build preview" });
  }
});

// ─── Manually post to Xero ───────────────────────────────────────────────────

router.post("/invoices/:orderId/post-xero", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
    const result = await postInvoiceToXero(idParse.data);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to post to Xero" });
  }
});

// ─── Email status ─────────────────────────────────────────────────────────────

const isResendAvailable = !!(process.env.REPLIT_CONNECTORS_HOSTNAME);

router.get("/settings/email/status", async (_req, res): Promise<void> => {
  if (isResendAvailable) {
    res.json({ configured: true, provider: "resend", host: null, fromEmail: null });
    return;
  }
  const config = await getSmtpConfig();
  res.json({ configured: !!config, provider: "smtp", host: config?.host ?? null, fromEmail: config?.fromEmail ?? null });
});

// ─── Orders grouped by customer ──────────────────────────────────────────────

router.get("/invoices/by-customer", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      status: ordersTable.status,
      poNumber: ordersTable.poNumber,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
    })
    .from(ordersTable)
    .where(sql`${ordersTable.status} IN ('shipped', 'dispatched')`)
    .orderBy(desc(ordersTable.dispatchedAt));

  const groupMap = new Map<string, {
    customerId: number | null;
    customerName: string | null;
    orders: typeof orders;
    totalEx: number;
    totalInc: number;
  }>();

  for (const o of orders) {
    const key = o.customerId ? String(o.customerId) : `name__${o.customerName ?? "unknown"}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { customerId: o.customerId, customerName: o.customerName, orders: [], totalEx: 0, totalInc: 0 });
    }
    const g = groupMap.get(key)!;
    g.orders.push(o);
    const ex = parseFloat(String(o.totalAmount ?? 0));
    g.totalEx += ex;
    g.totalInc += ex * 1.2;
  }

  res.json([...groupMap.values()].map((g) => ({
    ...g,
    totalEx: Math.round(g.totalEx * 100) / 100,
    totalInc: Math.round(g.totalInc * 100) / 100,
  })));
});

// ─── Orders grouped by customer PO number ────────────────────────────────────

router.get("/invoices/by-po-number", async (_req, res): Promise<void> => {
  const orders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      customerId: ordersTable.customerId,
      totalAmount: ordersTable.totalAmount,
      status: ordersTable.status,
      poNumber: ordersTable.poNumber,
      orderDate: ordersTable.orderDate,
      dispatchedAt: ordersTable.dispatchedAt,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
    })
    .from(ordersTable)
    .where(isNotNull(ordersTable.poNumber))
    .orderBy(ordersTable.poNumber, desc(ordersTable.orderDate));

  // Group by poNumber + customer
  const groupMap = new Map<string, {
    poNumber: string;
    customerName: string | null;
    customerId: number | null;
    orders: typeof orders;
    totalEx: number;
    totalInc: number;
  }>();

  for (const o of orders) {
    const key = `${o.poNumber}__${o.customerId ?? "none"}`;
    if (!groupMap.has(key)) {
      groupMap.set(key, { poNumber: o.poNumber!, customerName: o.customerName, customerId: o.customerId, orders: [], totalEx: 0, totalInc: 0 });
    }
    const g = groupMap.get(key)!;
    g.orders.push(o);
    const ex = parseFloat(String(o.totalAmount ?? 0));
    g.totalEx += ex;
    g.totalInc += ex * 1.2;
  }

  res.json([...groupMap.values()].map((g) => ({
    ...g,
    totalEx: Math.round(g.totalEx * 100) / 100,
    totalInc: Math.round(g.totalInc * 100) / 100,
  })));
});

// ─── Send via High Level webhook ─────────────────────────────────────────────

router.post("/invoices/:orderId/send-highlevel", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  const [row] = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      totalAmount: ordersTable.totalAmount,
      shippingMethod: ordersTable.shippingMethod,
      highLevelContactId: customersTable.highLevelContactId,
      customerEmail: customersTable.email,
    })
    .from(ordersTable)
    .leftJoin(customersTable, eq(ordersTable.customerId, customersTable.id))
    .where(eq(ordersTable.id, idParse.data));

  if (!row) { res.status(404).json({ error: "Order not found" }); return; }
  if (!row.highLevelContactId) {
    res.status(400).json({ error: "Customer does not have a High Level contact ID set" });
    return;
  }

  const [webhookSetting] = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(eq(settingsTable.key, "high_level_webhook_url"));

  const webhookUrl = webhookSetting?.value;
  if (!webhookUrl) {
    res.status(400).json({ error: "High Level webhook URL not configured in Settings" });
    return;
  }

  const totalInc = (parseFloat(row.totalAmount ?? "0") * 1.2).toFixed(2);

  const payload = {
    contactId: row.highLevelContactId,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    totalAmountExVat: row.totalAmount,
    totalAmountIncVat: totalInc,
    customerEmail: row.customerEmail,
    shippingMethod: row.shippingMethod,
  };

  const hlRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!hlRes.ok) {
    const text = await hlRes.text().catch(() => "");
    res.status(502).json({ error: `High Level webhook returned ${hlRes.status}: ${text}` });
    return;
  }

  res.json({ ok: true, contactId: row.highLevelContactId, orderNumber: row.orderNumber });
});

router.post("/settings/email/test", async (req, res): Promise<void> => {
  const { to } = req.body ?? {};
  if (!to || typeof to !== "string" || !to.includes("@")) {
    res.status(400).json({ ok: false, error: "Provide a valid 'to' email address" });
    return;
  }
  try {
    const result = await sendEmail({
      to,
      subject: "SBS email test — delivery check",
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
    <tr><td align="center" style="padding:32px 16px;">
      <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.1);">
        <tr><td style="background:#1e293b;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">Select Branding Solutions</p>
          <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">Email Delivery Test</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 12px;font-size:15px;color:#374151;">✅ Email delivery is working correctly.</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">This is a test message sent from the SBS Order Management System. If you received this, your email configuration is working correctly and staff login codes will be delivered to this inbox.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:14px 28px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:11px;color:#9ca3af;">Select Branding Solutions Ltd · wardrobe.selectbranding.co.uk</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`,
      text: `Email delivery test from Select Branding Solutions.\n\nIf you received this, email delivery is working correctly and staff login codes will be delivered to this inbox.\n\n— SBS Order Management System`,
    });
    if (!result.sent) {
      res.status(500).json({ ok: false, error: result.error ?? "Email send failed", provider: result.provider });
      return;
    }
    console.log(`[email] Test email sent to ${to} via ${result.provider}, messageId=${result.messageId ?? "n/a"}`);
    res.json({ ok: true, provider: result.provider, messageId: result.messageId });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
  }
});

export default router;
