import { Router, type IRouter } from "express";
import { eq, ilike, or, isNotNull, and, ne, sql } from "drizzle-orm";
import { db, customersTable, ordersTable, customerEmployeesTable } from "@workspace/db";
import { z } from "zod";
import { randomBytes } from "crypto";
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

  // Auto-create default employee + portal user from primary contact details
  const { contactFirstName, contactLastName, email, phone } = parsed.data;
  if (contactFirstName?.trim()) {
    autoCreateContactDefaults(customer.id, contactFirstName.trim(), contactLastName ?? null, email ?? null, phone ?? null).catch(() => {});
  }
});

async function autoCreateContactDefaults(
  customerId: number,
  firstName: string,
  lastName: string | null,
  email: string | null,
  phone: string | null,
): Promise<void> {
  const [employee] = await db.insert(customerEmployeesTable).values({
    customerId,
    firstName,
    lastName: lastName || null,
    email: email ? email.toLowerCase().trim() : null,
    phone: phone || null,
    isActive: true,
  }).returning();

  if (email && employee) {
    const normalised = email.toLowerCase().trim();
    const token = randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.execute(sql`
      INSERT INTO customer_portal_users
        (customer_id, email, invite_token, invite_expires_at, status, portal_role, linked_employee_id)
      VALUES
        (${customerId}, ${normalised}, ${token}, ${expires.toISOString()}, 'pending', 'manager', ${employee.id})
      ON CONFLICT (email) DO NOTHING
    `);
  }
}

// ─── Import a contact from High Level as a new customer ───────────────────────
router.post("/customers/import-from-hl", async (req, res): Promise<void> => {
  const { hlContactId } = req.body ?? {};
  if (!hlContactId) { res.status(400).json({ error: "hlContactId is required" }); return; }

  // Load HL credentials
  const settingsRows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('high_level_api_key', 'high_level_location_id')
  `);
  const settingsMap = Object.fromEntries(
    (settingsRows.rows as any[]).map((r: any) => [r.key, r.value])
  );
  const apiKey: string | undefined = settingsMap["high_level_api_key"];
  if (!apiKey) { res.status(400).json({ error: "High Level API key not configured — go to Settings → High Level." }); return; }

  // Fetch the contact from HL
  let hlContact: any;
  try {
    const hlRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/${hlContactId}`,
      { headers: { "Authorization": `Bearer ${apiKey}`, "Version": "2021-07-28" } }
    );
    if (!hlRes.ok) { res.status(502).json({ error: `High Level returned ${hlRes.status}` }); return; }
    const hlData = await hlRes.json() as any;
    hlContact = hlData?.contact ?? hlData;
  } catch (err: any) {
    res.status(502).json({ error: `Could not reach High Level: ${err.message}` }); return;
  }

  // Check if this HL contact is already a customer
  const existing = await db.execute(sql`
    SELECT id FROM customers WHERE high_level_contact_id = ${hlContactId} LIMIT 1
  `);
  if ((existing.rows as any[]).length > 0) {
    const existingId = (existing.rows[0] as any).id;
    res.json({ customerId: existingId, alreadyExisted: true });
    return;
  }

  // Also check by email to avoid duplicates
  const email = hlContact.email?.toLowerCase().trim() ?? null;
  if (email) {
    const byEmail = await db.execute(sql`
      SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1
    `);
    if ((byEmail.rows as any[]).length > 0) {
      const existingId = (byEmail.rows[0] as any).id;
      // Update the HL contact ID on the existing record
      await db.execute(sql`
        UPDATE customers SET
          high_level_contact_id = ${hlContactId},
          contact_first_name = COALESCE(contact_first_name, ${hlContact.firstName ?? null}),
          contact_last_name  = COALESCE(contact_last_name,  ${hlContact.lastName  ?? null}),
          phone = COALESCE(phone, ${hlContact.phone ?? null}),
          updated_at = now()
        WHERE id = ${existingId}
      `);
      res.json({ customerId: existingId, alreadyExisted: true });
      return;
    }
  }

  // Build the company / customer name
  const billingName = [hlContact.firstName, hlContact.lastName].filter(Boolean).join(" ");
  const companyName = hlContact.companyName?.trim() || billingName || "Unknown";

  // Build address from HL fields
  const address = [hlContact.address1].filter(Boolean).join(", ") || null;
  const city    = hlContact.city     ?? null;
  const state   = hlContact.state    ?? null;
  const postcode = hlContact.postalCode ?? null;

  // Create the customer
  const result = await db.execute(sql`
    INSERT INTO customers (
      name, contact_first_name, contact_last_name, email, phone,
      address, city, state, postcode, high_level_contact_id,
      created_at, updated_at
    ) VALUES (
      ${companyName},
      ${hlContact.firstName ?? null},
      ${hlContact.lastName  ?? null},
      ${email},
      ${hlContact.phone ?? null},
      ${address},
      ${city},
      ${state},
      ${postcode},
      ${hlContactId},
      now(), now()
    )
    RETURNING id
  `);
  const customerId = (result.rows[0] as any).id;

  // Auto-create default contact/portal user
  if (hlContact.firstName?.trim()) {
    await autoCreateContactDefaults(
      customerId,
      hlContact.firstName.trim(),
      hlContact.lastName ?? null,
      email,
      hlContact.phone ?? null,
    ).catch(() => {});
  }

  res.status(201).json({ customerId, alreadyExisted: false });
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
