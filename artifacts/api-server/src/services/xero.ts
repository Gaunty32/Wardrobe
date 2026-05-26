import { db, settingsTable, customersTable, suppliersTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Xero OAuth endpoints ────────────────────────────────────────────────────
const XERO_AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
// accounting.transactions is deprecated for apps created after 2 March 2026.
// Use the new granular scopes instead.
const XERO_SCOPES = "accounting.contacts accounting.invoices accounting.reports.aged.read offline_access";

// ─── Settings helpers ─────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

// ─── Token management ─────────────────────────────────────────────────────────

export interface XeroStatus {
  connected: boolean;
  hasCredentials: boolean;
  tenantId: string | null;
  tenantName: string | null;
  expiresAt: string | null;
}

export async function getXeroStatus(): Promise<XeroStatus> {
  const tenantId = await getSetting("xero_tenant_id");
  const tenantName = await getSetting("xero_tenant_name");
  const expiresAt = await getSetting("xero_token_expires_at");
  const refreshToken = await getSetting("xero_refresh_token");
  const clientId = await getSetting("xero_client_id");
  const clientSecret = await getSetting("xero_client_secret");
  return {
    connected: !!(tenantId && refreshToken),
    hasCredentials: !!(clientId && clientSecret),
    tenantId,
    tenantName,
    expiresAt,
  };
}

async function getValidAccessToken(): Promise<string> {
  const clientId = await getSetting("xero_client_id");
  const clientSecret = await getSetting("xero_client_secret");
  const refreshToken = await getSetting("xero_refresh_token");

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Xero is not connected. Please connect in Settings → Xero.");
  }

  const expiresAtStr = await getSetting("xero_token_expires_at");
  const expiresAt = expiresAtStr ? new Date(expiresAtStr).getTime() : 0;
  const nowMs = Date.now();

  // If the access token is still valid (with 60s buffer), return it
  if (expiresAt > nowMs + 60_000) {
    const token = await getSetting("xero_access_token");
    if (token) return token;
  }

  // Refresh the access token
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token refresh failed: ${text}`);
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await setSetting("xero_access_token", data.access_token);
  await setSetting("xero_refresh_token", data.refresh_token);
  await setSetting("xero_token_expires_at", newExpiry);

  return data.access_token;
}

async function xeroFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const tenantId = await getSetting("xero_tenant_id");

  if (!tenantId) throw new Error("No Xero tenant selected.");

  const url = path.startsWith("http") ? path : `${XERO_API_BASE}${path}`;

  return fetch(url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${token}`,
      "Xero-tenant-id": tenantId,
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

// ─── OAuth flow ───────────────────────────────────────────────────────────────

export async function generateAuthUrl(redirectUri: string): Promise<string> {
  const clientId = await getSetting("xero_client_id");
  if (!clientId) throw new Error("Xero Client ID not configured.");

  const state = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  await setSetting("xero_oauth_state", state);
  await setSetting("xero_redirect_uri", redirectUri);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: XERO_SCOPES,
    state,
  });

  return `${XERO_AUTH_URL}?${params.toString()}`;
}

export async function handleCallback(code: string, state: string): Promise<void> {
  const expectedState = await getSetting("xero_oauth_state");
  if (state !== expectedState) throw new Error("Invalid OAuth state — possible CSRF attack.");

  const clientId = await getSetting("xero_client_id");
  const clientSecret = await getSetting("xero_client_secret");
  const redirectUri = await getSetting("xero_redirect_uri");

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Xero credentials in settings.");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token exchange failed: ${text}`);
  }

  const data = await res.json() as { access_token: string; refresh_token: string; expires_in: number };
  const expiry = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await setSetting("xero_access_token", data.access_token);
  await setSetting("xero_refresh_token", data.refresh_token);
  await setSetting("xero_token_expires_at", expiry);

  // Fetch tenant list and pick the first one
  const connectRes = await fetch(XERO_CONNECTIONS_URL, {
    headers: { "Authorization": `Bearer ${data.access_token}`, "Accept": "application/json" },
  });
  if (!connectRes.ok) throw new Error("Failed to fetch Xero tenants.");

  const tenants = await connectRes.json() as Array<{ tenantId: string; tenantName: string }>;
  if (!tenants.length) throw new Error("No Xero organisations found on this account.");

  await setSetting("xero_tenant_id", tenants[0].tenantId);
  await setSetting("xero_tenant_name", tenants[0].tenantName);
  await setSetting("xero_oauth_state", null);
}

export async function disconnectXero(): Promise<void> {
  for (const key of ["xero_access_token", "xero_refresh_token", "xero_token_expires_at", "xero_tenant_id", "xero_tenant_name", "xero_oauth_state"]) {
    await setSetting(key, null);
  }
}

// ─── Contact sync ─────────────────────────────────────────────────────────────

interface XeroContact {
  ContactID: string;
  Name: string;
  FirstName?: string;
  LastName?: string;
  EmailAddress?: string;
  Phones?: { PhoneType: string; PhoneNumber: string }[];
  Addresses?: { AddressType: string; AddressLine1?: string; AddressLine2?: string; City?: string; Region?: string; PostalCode?: string; Country?: string }[];
  ContactPersons?: { FirstName?: string; LastName?: string; EmailAddress?: string }[];
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  Balances?: {
    AccountsReceivable?: { Outstanding: number; Overdue: number };
    AccountsPayable?: { Outstanding: number; Overdue: number };
  };
}

/**
 * Extract the best available first/last name from a Xero contact.
 * Priority: top-level FirstName/LastName → first ContactPerson → split Name on first space.
 * Splitting Name is only done when the name looks like a person (one or two words, no
 * punctuation patterns typical of company names like Ltd, &, /).
 */
function extractXeroName(contact: XeroContact): { firstName: string | null; lastName: string | null } {
  // 1. Top-level fields (most reliable)
  if (contact.FirstName || contact.LastName) {
    return {
      firstName: contact.FirstName?.trim() || null,
      lastName: contact.LastName?.trim() || null,
    };
  }

  // 2. First ContactPerson entry
  const person = contact.ContactPersons?.[0];
  if (person?.FirstName || person?.LastName) {
    return {
      firstName: person.FirstName?.trim() || null,
      lastName: person.LastName?.trim() || null,
    };
  }

  // 3. Split the Name field — but only if it looks like a person name, not a company
  const name = contact.Name?.trim() ?? "";
  const companyPatterns = /\b(Ltd|Limited|LLP|LLC|plc|Inc|Corp|Group|Co\.|&|\/)\b/i;
  const parts = name.split(/\s+/);
  if (parts.length >= 2 && parts.length <= 3 && !companyPatterns.test(name)) {
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
    };
  }

  return { firstName: null, lastName: null };
}

export async function syncContacts(): Promise<{ customersImported: number; suppliersImported: number; pushed: number }> {
  const res = await xeroFetch("/Contacts?includeArchived=false&summaryOnly=false");
  if (!res.ok) throw new Error(`Xero contacts fetch failed: ${await res.text()}`);

  const data = await res.json() as { Contacts: XeroContact[] };
  const contacts = data.Contacts ?? [];

  let customersImported = 0;
  let suppliersImported = 0;

  for (const contact of contacts) {
    if (contact.IsCustomer) {
      const { firstName, lastName } = extractXeroName(contact);
      const phone = contact.Phones?.find((p) => p.PhoneType === "DEFAULT")?.PhoneNumber;
      const addr = contact.Addresses?.find((a) => a.AddressType === "STREET");

      const localCustomers = await db.select().from(customersTable)
        .where(eq(customersTable.xeroContactId, contact.ContactID));

      if (localCustomers.length === 0) {
        // Try to match by email or name
        const allCustomers = await db.select().from(customersTable);
        const match = allCustomers.find(
          (c) =>
            (contact.EmailAddress && c.email?.toLowerCase() === contact.EmailAddress.toLowerCase()) ||
            c.name.toLowerCase() === contact.Name.toLowerCase()
        );

        if (match) {
          // Link existing customer and sync all available Xero fields
          await db.update(customersTable).set({
            xeroContactId: contact.ContactID,
            email: contact.EmailAddress?.toLowerCase() ?? match.email,
            contactFirstName: match.contactFirstName ?? firstName,
            contactLastName: match.contactLastName ?? lastName,
            phone: phone || match.phone || null,
            address: addr?.AddressLine1 || match.address || null,
            city: addr?.City || match.city || null,
            state: addr?.Region || match.state || null,
            postcode: addr?.PostalCode || match.postcode || null,
            updatedAt: new Date(),
          }).where(eq(customersTable.id, match.id));
        }
        // No else — ignore Xero-only customers; new customers flow order-system → Xero
      } else {
        // Already linked — keep all fields up to date from Xero
        const existing = localCustomers[0];
        await db.update(customersTable).set({
          email: contact.EmailAddress?.toLowerCase() ?? existing.email,
          contactFirstName: firstName ?? existing.contactFirstName,
          contactLastName: lastName ?? existing.contactLastName,
          phone: phone || existing.phone || null,
          address: addr?.AddressLine1 || existing.address || null,
          city: addr?.City || existing.city || null,
          state: addr?.Region || existing.state || null,
          postcode: addr?.PostalCode || existing.postcode || null,
          updatedAt: new Date(),
        }).where(eq(customersTable.id, existing.id));
      }
    }

    if (contact.IsSupplier) {
      const { firstName, lastName } = extractXeroName(contact);
      const contactName = [firstName, lastName].filter(Boolean).join(" ") || null;

      const localSuppliers = await db.select().from(suppliersTable)
        .where(eq(suppliersTable.xeroContactId, contact.ContactID));

      if (localSuppliers.length === 0) {
        // Only link existing local suppliers — do NOT create new ones from Xero.
        // New suppliers flow order-system → Xero, not the other way.
        const allSuppliers = await db.select().from(suppliersTable);
        const match = allSuppliers.find(
          (s) =>
            (contact.EmailAddress && s.email?.toLowerCase() === contact.EmailAddress.toLowerCase()) ||
            s.name.toLowerCase() === contact.Name.toLowerCase()
        );

        if (match) {
          await db.update(suppliersTable).set({
            xeroContactId: contact.ContactID,
            contactName: match.contactName ?? contactName,
            updatedAt: new Date(),
          }).where(eq(suppliersTable.id, match.id));
        }
        // No else — ignore Xero-only suppliers
      } else {
        // Already linked — keep contact name up to date
        const existing = localSuppliers[0];
        await db.update(suppliersTable).set({
          contactName: contactName ?? existing.contactName,
          updatedAt: new Date(),
        }).where(eq(suppliersTable.id, existing.id));
      }
    }
  }

  const pushed = 0;

  return { customersImported, suppliersImported, pushed };
}

// ─── Supplier push (order-system → Xero) ─────────────────────────────────────

/**
 * Create or update a supplier in Xero and store the resulting ContactID.
 * Safe to call even when Xero is not connected — errors are swallowed so the
 * local save always succeeds.
 */
export async function pushSupplierToXero(supplierId: number): Promise<void> {
  try {
    const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, supplierId));
    if (!supplier) return;

    const contactPayload = {
      Name: supplier.name,
      EmailAddress: supplier.email ?? undefined,
      IsSupplier: true,
      ...(supplier.contactName
        ? (() => {
            const parts = supplier.contactName.trim().split(/\s+/);
            return parts.length >= 2
              ? { FirstName: parts[0], LastName: parts.slice(1).join(" ") }
              : { FirstName: supplier.contactName };
          })()
        : {}),
      Phones: supplier.phone
        ? [{ PhoneType: "DEFAULT", PhoneNumber: supplier.phone }]
        : undefined,
      Addresses: supplier.address
        ? [{
            AddressType: "STREET",
            AddressLine1: supplier.address ?? undefined,
            City: supplier.city ?? undefined,
            PostalCode: supplier.postcode ?? undefined,
          }]
        : undefined,
    };

    if (supplier.xeroContactId) {
      // Update existing Xero contact
      await xeroFetch(`/Contacts/${supplier.xeroContactId}`, {
        method: "POST",
        body: JSON.stringify({ Contacts: [{ ContactID: supplier.xeroContactId, ...contactPayload }] }),
      });
    } else {
      // Create new Xero contact
      const res = await xeroFetch("/Contacts", {
        method: "POST",
        body: JSON.stringify({ Contacts: [contactPayload] }),
      });
      if (res.ok) {
        const data = await res.json() as { Contacts: XeroContact[] };
        const xeroId = data.Contacts?.[0]?.ContactID;
        if (xeroId) {
          await db.update(suppliersTable)
            .set({ xeroContactId: xeroId, updatedAt: new Date() })
            .where(eq(suppliersTable.id, supplierId));
        }
      }
    }
  } catch {
    // Never block the local save — Xero push is best-effort
  }
}

// ─── Customer push (order-system → Xero) ─────────────────────────────────────

/**
 * Create or update a customer in Xero and store the resulting ContactID.
 * Safe to call even when Xero is not connected — errors are swallowed so the
 * local save always succeeds.
 */
export async function pushCustomerToXero(customerId: number): Promise<void> {
  try {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
    if (!customer) return;

    const contactPayload = {
      Name: customer.name,
      FirstName: customer.contactFirstName ?? undefined,
      LastName: customer.contactLastName ?? undefined,
      EmailAddress: customer.email ?? undefined,
      IsCustomer: true,
      Phones: customer.phone
        ? [{ PhoneType: "DEFAULT", PhoneNumber: customer.phone }]
        : undefined,
      Addresses: customer.address
        ? [{
            AddressType: "STREET",
            AddressLine1: customer.address ?? undefined,
            City: customer.city ?? undefined,
            PostalCode: customer.postcode ?? undefined,
          }]
        : undefined,
    };

    if (customer.xeroContactId) {
      // Update existing Xero contact
      await xeroFetch(`/Contacts/${customer.xeroContactId}`, {
        method: "POST",
        body: JSON.stringify({ Contacts: [{ ContactID: customer.xeroContactId, ...contactPayload }] }),
      });
    } else {
      // Create new Xero contact
      const res = await xeroFetch("/Contacts", {
        method: "POST",
        body: JSON.stringify({ Contacts: [contactPayload] }),
      });
      if (res.ok) {
        const data = await res.json() as { Contacts: XeroContact[] };
        const xeroId = data.Contacts?.[0]?.ContactID;
        if (xeroId) {
          await db.update(customersTable)
            .set({ xeroContactId: xeroId, updatedAt: new Date() })
            .where(eq(customersTable.id, customerId));
        }
      }
    }
  } catch {
    // Never block the local save — Xero push is best-effort
  }
}

// ─── Balance lookup ───────────────────────────────────────────────────────────

export async function getContactBalance(xeroContactId: string): Promise<{
  arOutstanding: number;
  arOverdue: number;
  apOutstanding: number;
  apOverdue: number;
}> {
  const res = await xeroFetch(`/Contacts/${xeroContactId}`);
  if (!res.ok) throw new Error(`Xero contact fetch failed: ${await res.text()}`);

  const data = await res.json() as { Contacts: XeroContact[] };
  const contact = data.Contacts?.[0];

  return {
    arOutstanding: contact?.Balances?.AccountsReceivable?.Outstanding ?? 0,
    arOverdue: contact?.Balances?.AccountsReceivable?.Overdue ?? 0,
    apOutstanding: contact?.Balances?.AccountsPayable?.Outstanding ?? 0,
    apOverdue: contact?.Balances?.AccountsPayable?.Overdue ?? 0,
  };
}

// ─── Invoice posting ──────────────────────────────────────────────────────────

export async function postInvoiceToXero(orderId: number): Promise<{ xeroInvoiceId: string; xeroInvoiceStatus: string; invoiceNumber: string }> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) throw new Error("Order not found.");

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));

  // Get customer's xeroContactId
  let xeroContactId: string | null = null;
  if (order.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, order.customerId));
    xeroContactId = customer?.xeroContactId ?? null;
  }

  if (!xeroContactId) {
    throw new Error("Customer is not linked to a Xero contact. Run a Xero contact sync first.");
  }

  function xeroTaxType(vatRate: string | null): string | undefined {
    const rate = vatRate ? parseFloat(vatRate) : null;
    if (rate === null) return undefined;
    if (rate >= 0.19) return "OUTPUT2";       // 20% standard rate
    if (rate <= 0.01) return "ZERORATEDOUTPUT"; // 0% zero-rated
    if (Math.abs(rate - 0.05) < 0.01) return "RROUTPUT"; // 5% reduced
    return undefined; // let Xero use the account default
  }

  const lineItems = items.map((item) => {
    const taxType = xeroTaxType(item.vatRate as string | null);
    const line: Record<string, unknown> = {
      Description: [item.productName, item.colour, item.size, item.finishName].filter(Boolean).join(" – "),
      Quantity: item.quantity,
      UnitAmount: parseFloat(item.unitPrice as string),
      AccountCode: "4000",
    };
    if (taxType) line.TaxType = taxType;
    return line;
  });

  const invoiceDate = order.invoiceDate ? new Date(order.invoiceDate) : new Date();
  const invoiceDateStr = invoiceDate.toISOString().slice(0, 10);
  const dueDate = new Date(invoiceDate);
  dueDate.setDate(dueDate.getDate() + 14);
  const dueDateStr = dueDate.toISOString().slice(0, 10);

  // Generate a unique sequential invoice number (INV-0001, INV-0002, …).
  // This avoids Xero duplicate-InvoiceNumber errors when one order is invoiced
  // across multiple dispatches. The order number is kept as the Reference.
  const seqRows = await db.execute(sql`SELECT nextval('invoice_number_seq') AS n`);
  const seqN = Number((seqRows.rows[0] as any).n);
  const invoiceNumber = `INV-${String(seqN).padStart(4, "0")}`;

  const invoice = {
    Type: "ACCREC",
    Contact: { ContactID: xeroContactId },
    InvoiceNumber: invoiceNumber,
    Reference: order.orderNumber,
    DateString: invoiceDateStr,
    DueDateString: dueDateStr,
    Status: "AUTHORISED",
    LineAmountTypes: "Exclusive",
    LineItems: lineItems,
  };

  const res = await xeroFetch("/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [invoice] }) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero invoice creation failed: ${text}`);
  }

  const data = await res.json() as { Invoices: Array<{ InvoiceID: string; Status: string; InvoiceNumber: string }> };
  const created = data.Invoices?.[0];
  if (!created?.InvoiceID) throw new Error("Xero did not return an invoice ID.");

  // Persist IDs back to order
  await db.update(ordersTable)
    .set({ xeroInvoiceId: created.InvoiceID, xeroInvoiceNumber: invoiceNumber, xeroInvoiceStatus: created.Status, updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));

  return {
    xeroInvoiceId: created.InvoiceID,
    xeroInvoiceStatus: created.Status,
    invoiceNumber: created.InvoiceNumber,
  };
}
