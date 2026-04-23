import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, ordersTable, orderItemsTable, customersTable, settingsTable } from "@workspace/db";
import { eq, desc, and, isNotNull, isNull, sql } from "drizzle-orm";
import { sendInvoiceEmail, getSmtpConfig, testSmtpConnection } from "../services/email";
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
      dispatchedAt: ordersTable.dispatchedAt,
      trackingNumber: ordersTable.trackingNumber,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      invoiceEmailSentTo: ordersTable.invoiceEmailSentTo,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      xeroInvoiceStatus: ordersTable.xeroInvoiceStatus,
    })
    .from(ordersTable)
    .where(eq(ordersTable.status, "dispatched"))
    .orderBy(desc(ordersTable.dispatchedAt));

  const toSend = orders.filter((o) => !o.invoiceEmailSentAt);
  const toPost = orders.filter((o) => o.invoiceEmailSentAt && !o.xeroInvoiceId);
  const done = orders.filter((o) => o.invoiceEmailSentAt && o.xeroInvoiceId);

  res.json({ toSend, toPost, done });
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

// ─── SMTP status ─────────────────────────────────────────────────────────────

router.get("/settings/email/status", async (_req, res): Promise<void> => {
  const config = await getSmtpConfig();
  res.json({ configured: !!config, host: config?.host ?? null, fromEmail: config?.fromEmail ?? null });
});

// ─── SMTP test connection ─────────────────────────────────────────────────────

router.post("/settings/email/test", async (_req, res): Promise<void> => {
  try {
    const result = await testSmtpConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : "Test failed" });
  }
});

export default router;
