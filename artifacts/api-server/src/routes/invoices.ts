import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ordersTable, orderItemsTable, customersTable, settingsTable } from "@workspace/db";
import { eq, desc, and, isNotNull, isNull, sql } from "drizzle-orm";
import {
  sendInvoiceEmail, getSmtpConfig, testSmtpConnection,
  buildInvoiceEmail, generateInvoicePDF, buildInvoiceDataForOrder,
  fetchLogoDataUrl,
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

// ─── Send invoice email ──────────────────────────────────────────────────────

router.post("/invoices/:orderId/send-email", async (req, res): Promise<void> => {
  const idParse = z.coerce.number().int().positive().safeParse(req.params.orderId);
  if (!idParse.success) { res.status(400).json({ error: "Invalid order ID" }); return; }

  try {
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
    const { order, items, customerEmail } = await buildInvoiceDataForOrder(idParse.data);
    const pdfBuffer = await generateInvoicePDF({
      orderNumber: order.orderNumber,
      customerName: order.customerName ?? "Customer",
      customerEmail,
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
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
    const { order, items, contactFirstName, customerLogoDataUrl } = await buildInvoiceDataForOrder(idParse.data);
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
      invoiceDate: order.invoiceDate,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      notes: order.notes,
      paidAt: order.paidAt,
      stripePaymentLinkUrl: order.stripePaymentLinkUrl,
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

router.post("/settings/email/test", async (_req, res): Promise<void> => {
  try {
    if (isResendAvailable) {
      // Test Resend by fetching credentials — throws if not connected
      const { getResendClient } = await import("../services/resend-client.js");
      const { client } = await getResendClient();
      // Send a quick API ping by listing domains (read-only, no email sent)
      const domains = await client.domains.list();
      if ((domains as any).error) throw new Error((domains as any).error.message);
      res.json({ ok: true, provider: "resend" });
      return;
    }
    const result = await testSmtpConnection();
    res.json({ ...result, provider: "smtp" });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
  }
});

export default router;
