import { db, settingsTable, customersTable, suppliersTable, ordersTable, orderItemsTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";

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
  tenantId: string | null;
  tenantName: string | null;
  expiresAt: string | null;
}

export async function getXeroStatus(): Promise<XeroStatus> {
  const tenantId = await getSetting("xero_tenant_id");
  const tenantName = await getSetting("xero_tenant_name");
  const expiresAt = await getSetting("xero_token_expires_at");
  const refreshToken = await getSetting("xero_refresh_token");
  return {
    connected: !!(tenantId && refreshToken),
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
  Addresses?: { AddressType: string; AddressLine1?: string; City?: string; PostalCode?: string }[];
  IsCustomer?: boolean;
  IsSupplier?: boolean;
  Balances?: {
    AccountsReceivable?: { Outstanding: number; Overdue: number };
    AccountsPayable?: { Outstanding: number; Overdue: number };
  };
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
      // Try to match existing customer by email, then name
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
          await db.update(customersTable)
            .set({ xeroContactId: contact.ContactID, updatedAt: new Date() })
            .where(eq(customersTable.id, match.id));
        } else {
          // Create new customer from Xero contact
          const phone = contact.Phones?.find((p) => p.PhoneType === "DEFAULT")?.PhoneNumber;
          const addr = contact.Addresses?.find((a) => a.AddressType === "STREET");
          await db.insert(customersTable).values({
            name: contact.Name,
            contactFirstName: contact.FirstName ?? null,
            contactLastName: contact.LastName ?? null,
            email: contact.EmailAddress ?? null,
            phone: phone ?? null,
            address: addr?.AddressLine1 ?? null,
            city: addr?.City ?? null,
            postcode: addr?.PostalCode ?? null,
            xeroContactId: contact.ContactID,
          });
          customersImported++;
        }
      }
    }

    if (contact.IsSupplier) {
      const localSuppliers = await db.select().from(suppliersTable)
        .where(eq(suppliersTable.xeroContactId, contact.ContactID));

      if (localSuppliers.length === 0) {
        const allSuppliers = await db.select().from(suppliersTable);
        const match = allSuppliers.find(
          (s) =>
            (contact.EmailAddress && s.email?.toLowerCase() === contact.EmailAddress.toLowerCase()) ||
            s.name.toLowerCase() === contact.Name.toLowerCase()
        );

        if (match) {
          await db.update(suppliersTable)
            .set({ xeroContactId: contact.ContactID, updatedAt: new Date() })
            .where(eq(suppliersTable.id, match.id));
        } else {
          const phone = contact.Phones?.find((p) => p.PhoneType === "DEFAULT")?.PhoneNumber;
          const addr = contact.Addresses?.find((a) => a.AddressType === "STREET");
          await db.insert(suppliersTable).values({
            name: contact.Name,
            contactName: [contact.FirstName, contact.LastName].filter(Boolean).join(" ") || null,
            email: contact.EmailAddress ?? null,
            phone: phone ?? null,
            address: addr?.AddressLine1 ?? null,
            city: addr?.City ?? null,
            postcode: addr?.PostalCode ?? null,
            xeroContactId: contact.ContactID,
          });
          suppliersImported++;
        }
      }
    }
  }

  // Push local customers without xeroContactId to Xero
  let pushed = 0;
  const unmatchedCustomers = await db.select().from(customersTable).where(isNull(customersTable.xeroContactId));
  for (const customer of unmatchedCustomers) {
    try {
      const body = {
        Contacts: [{
          Name: customer.name,
          FirstName: customer.contactFirstName,
          LastName: customer.contactLastName,
          EmailAddress: customer.email,
          IsCustomer: true,
        }],
      };
      const cr = await xeroFetch("/Contacts", { method: "POST", body: JSON.stringify(body) });
      if (cr.ok) {
        const cd = await cr.json() as { Contacts: XeroContact[] };
        if (cd.Contacts?.[0]?.ContactID) {
          await db.update(customersTable)
            .set({ xeroContactId: cd.Contacts[0].ContactID, updatedAt: new Date() })
            .where(eq(customersTable.id, customer.id));
          pushed++;
        }
      }
    } catch {
      // Skip individual failures, continue with rest
    }
  }

  // Push local suppliers without xeroContactId to Xero
  const unmatchedSuppliers = await db.select().from(suppliersTable).where(isNull(suppliersTable.xeroContactId));
  for (const supplier of unmatchedSuppliers) {
    try {
      const body = {
        Contacts: [{
          Name: supplier.name,
          EmailAddress: supplier.email,
          IsSupplier: true,
        }],
      };
      const sr = await xeroFetch("/Contacts", { method: "POST", body: JSON.stringify(body) });
      if (sr.ok) {
        const sd = await sr.json() as { Contacts: XeroContact[] };
        if (sd.Contacts?.[0]?.ContactID) {
          await db.update(suppliersTable)
            .set({ xeroContactId: sd.Contacts[0].ContactID, updatedAt: new Date() })
            .where(eq(suppliersTable.id, supplier.id));
          pushed++;
        }
      }
    } catch {
      // Skip individual failures, continue with rest
    }
  }

  return { customersImported, suppliersImported, pushed };
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

  const lineItems = items.map((item) => ({
    Description: [item.productName, item.colour, item.size].filter(Boolean).join(" – "),
    Quantity: item.quantity,
    UnitAmount: parseFloat(item.unitPrice as string),
    AccountCode: "200", // Sales account — adjust if needed
    TaxType: "OUTPUT",
  }));

  const invoice = {
    Type: "ACCREC",
    Contact: { ContactID: xeroContactId },
    InvoiceNumber: order.orderNumber,
    Reference: order.orderNumber,
    Status: "DRAFT",
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
    .set({ xeroInvoiceId: created.InvoiceID, xeroInvoiceStatus: created.Status, updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));

  return {
    xeroInvoiceId: created.InvoiceID,
    xeroInvoiceStatus: created.Status,
    invoiceNumber: created.InvoiceNumber,
  };
}
