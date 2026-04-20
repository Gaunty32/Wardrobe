import { Router, type IRouter } from "express";
import { eq, ilike, or, isNotNull, and, ne } from "drizzle-orm";
import { db, customersTable, ordersTable } from "@workspace/db";
import { z } from "zod";
import { pushCustomerToXero } from "../services/xero.js";
import {
  CreateCustomerBody,
  UpdateCustomerBody,
  GetCustomerParams,
  UpdateCustomerParams,
  DeleteCustomerParams,
  ListCustomersQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/customers", async (req, res): Promise<void> => {
  const query = ListCustomersQueryParams.safeParse(req.query);
  let customers;
  if (query.success && query.data.search) {
    const term = `%${query.data.search}%`;
    customers = await db
      .select()
      .from(customersTable)
      .where(or(
        ilike(customersTable.name, term),
        ilike(customersTable.email, term),
        ilike(customersTable.phone, term),
        ilike(customersTable.contactFirstName, term),
        ilike(customersTable.contactLastName, term),
      ))
      .orderBy(customersTable.name);
  } else {
    customers = await db.select().from(customersTable).orderBy(customersTable.name);
  }
  res.json(customers);
});

router.post("/customers", async (req, res): Promise<void> => {
  const parsed = CreateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [customer] = await db.insert(customersTable).values(parsed.data).returning();
  res.status(201).json(customer);
  // Best-effort push to Xero — don't await so the response is immediate
  pushCustomerToXero(customer.id).catch(() => {});
});

router.get("/customers/:id", async (req, res): Promise<void> => {
  const params = GetCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, params.data.id));
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
  const params = UpdateCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [customer] = await db
    .update(customersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(customersTable.id, params.data.id))
    .returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.json(customer);
  // Best-effort sync to Xero — don't await so the response is immediate
  pushCustomerToXero(params.data.id).catch(() => {});
});

router.delete("/customers/:id", async (req, res): Promise<void> => {
  const params = DeleteCustomerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [customer] = await db.delete(customersTable).where(eq(customersTable.id, params.data.id)).returning();
  if (!customer) {
    res.status(404).json({ error: "Customer not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/customers/:id/invoice-summary", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid customer ID" }); return; }

  const invoicedOrders = await db
    .select({
      id: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      totalAmount: ordersTable.totalAmount,
      invoiceEmailSentAt: ordersTable.invoiceEmailSentAt,
      xeroInvoiceId: ordersTable.xeroInvoiceId,
      xeroInvoiceStatus: ordersTable.xeroInvoiceStatus,
      dispatchedAt: ordersTable.dispatchedAt,
      orderDate: ordersTable.orderDate,
    })
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.customerId, id),
        isNotNull(ordersTable.invoiceEmailSentAt),
      )
    )
    .orderBy(ordersTable.invoiceEmailSentAt);

  const PAID_STATUSES = ["PAID", "VOIDED", "DELETED"];
  const unpaid = invoicedOrders.filter(
    (o) => !PAID_STATUSES.includes((o.xeroInvoiceStatus || "").toUpperCase())
  );

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  const overdue = unpaid.filter(
    (o) => o.invoiceEmailSentAt && new Date(o.invoiceEmailSentAt) < cutoff
  );

  const balanceDue = unpaid.reduce((sum, o) => sum + parseFloat(o.totalAmount || "0"), 0);
  const overdueTotal = overdue.reduce((sum, o) => sum + parseFloat(o.totalAmount || "0"), 0);

  res.json({
    balanceDue: balanceDue.toFixed(2),
    overdueTotal: overdueTotal.toFixed(2),
    unpaidCount: unpaid.length,
    overdueCount: overdue.length,
    overdueInvoices: overdue.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      amount: parseFloat(o.totalAmount || "0").toFixed(2),
      invoicedAt: o.invoiceEmailSentAt,
      daysOverdue: Math.floor((Date.now() - new Date(o.invoiceEmailSentAt!).getTime()) / 86400000) - 14,
      xeroInvoiceId: o.xeroInvoiceId,
      xeroInvoiceStatus: o.xeroInvoiceStatus,
    })),
  });
});

export default router;
