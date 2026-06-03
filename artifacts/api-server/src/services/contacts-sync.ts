import { db, customersTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

// ─── GoHighLevel ─────────────────────────────────────────────────────────────
// Pushes a customer's contact details to GHL (create or update).
// If the customer already has a highLevelContactId we PATCH that contact,
// otherwise we search GHL by email/phone and either link an existing contact
// or create a new one, storing the returned contact ID back on the customer.

export async function pushCustomerToHighLevel(customerId: number): Promise<void> {
  const apiKey    = await getSetting("high_level_api_key");
  const locationId = await getSetting("high_level_location_id");
  if (!apiKey || !locationId) return; // Not configured — skip silently

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) return;

  const headers: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Version": "2021-07-28",
    "Content-Type": "application/json",
  };

  const payload: Record<string, unknown> = {
    firstName: customer.contactFirstName ?? undefined,
    lastName:  customer.contactLastName  ?? undefined,
    email:     customer.email            ?? undefined,
    phone:     customer.phone            ?? undefined,
    companyName: customer.name,
    address1:  (customer as any).address ?? undefined,
    city:      customer.city             ?? undefined,
    state:     customer.state            ?? undefined,
    postalCode: (customer as any).postcode ?? undefined,
    locationId,
  };

  // Remove undefined keys
  for (const k of Object.keys(payload)) {
    if (payload[k] === undefined) delete payload[k];
  }

  const existingContactId = customer.highLevelContactId;

  if (existingContactId) {
    // PATCH the existing contact
    const res = await fetch(
      `https://services.leadconnectorhq.com/contacts/${existingContactId}`,
      { method: "PUT", headers, body: JSON.stringify(payload) }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[GHL] Failed to update contact ${existingContactId}: ${res.status} ${text}`);
    }
    return;
  }

  // No existing GHL contact ID — try to find by email first
  if (customer.email) {
    const searchRes = await fetch(
      `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${encodeURIComponent(locationId)}&email=${encodeURIComponent(customer.email)}`,
      { headers }
    );
    if (searchRes.ok) {
      const data = await searchRes.json() as any;
      const match = data?.contact ?? data?.contacts?.[0];
      if (match?.id) {
        await db.update(customersTable)
          .set({ highLevelContactId: match.id, updatedAt: new Date() })
          .where(eq(customersTable.id, customerId));
        // Now update the matched contact
        await fetch(
          `https://services.leadconnectorhq.com/contacts/${match.id}`,
          { method: "PUT", headers, body: JSON.stringify(payload) }
        ).catch(() => {});
        return;
      }
    }
  }

  // Create a new GHL contact
  const createRes = await fetch(
    "https://services.leadconnectorhq.com/contacts/",
    { method: "POST", headers, body: JSON.stringify(payload) }
  );
  if (createRes.ok) {
    const data = await createRes.json() as any;
    const newContactId = data?.contact?.id ?? data?.id;
    if (newContactId) {
      await db.update(customersTable)
        .set({ highLevelContactId: newContactId, updatedAt: new Date() })
        .where(eq(customersTable.id, customerId));
    }
  } else {
    const text = await createRes.text().catch(() => "");
    console.error(`[GHL] Failed to create contact for customer ${customerId}: ${createRes.status} ${text}`);
  }
}

// ─── Invoco ───────────────────────────────────────────────────────────────────
// Pushes a customer's phone number + name to the Invoco phonebook so incoming
// calls show the customer name on the handset display.
// Auth: Basic (username:password), endpoint TBD — stored in settings as
//   invoco_username, invoco_password, invoco_api_url
// The API URL can be updated once Invoco supply the correct write endpoint.

export async function pushCustomerToInvoco(customerId: number): Promise<void> {
  const username = await getSetting("invoco_username");
  const password = await getSetting("invoco_password");
  const apiUrl   = await getSetting("invoco_api_url");
  if (!username || !password || !apiUrl) return; // Not configured — skip silently

  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
  if (!customer) return;

  const phone = customer.phone?.replace(/\s/g, "") ?? null;
  if (!phone) return; // No phone — nothing to push

  const contactName = [customer.contactFirstName, customer.contactLastName]
    .filter(Boolean).join(" ") || customer.name;

  const basicAuth = Buffer.from(`${username}:${password}`).toString("base64");

  const body = JSON.stringify({
    Number: phone,
    Name: contactName,
    IsPrivate: false,
  });

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Invoco] Failed to push contact for customer ${customerId}: ${res.status} ${text}`);
  }
}

// ─── Combined helper ──────────────────────────────────────────────────────────
export async function syncCustomerToPhoneDirectory(customerId: number): Promise<void> {
  await Promise.allSettled([
    pushCustomerToHighLevel(customerId),
    pushCustomerToInvoco(customerId),
  ]);
}
