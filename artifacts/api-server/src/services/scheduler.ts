import { schedule, type ScheduledTask } from "node-cron";
import { db, settingsTable, customersTable, ordersTable, tasksTable } from "@workspace/db";
import { eq, sql, and, or, isNull, lt, lte, isNotNull } from "drizzle-orm";
import { runWooSync } from "./woo-sync";
import { sendInvoiceEmail, buildCheckInEmail, sendEmail, isEmailConfigured, fetchLogoDataUrl, buildDeliveryFollowupEmail } from "./email.js";
import { postInvoiceToXero } from "./xero.js";

let currentTask: ScheduledTask | null = null;

const SCHEDULES: Record<string, string> = {
  hourly: "0 * * * *",
  every6hours: "0 */6 * * *",
  daily: "0 2 * * *",
};

async function getSyncSchedule(): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_sync_schedule"));
  return row?.value ?? null;
}

async function hasCredentials(): Promise<boolean> {
  const [urlRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_url"));
  const [ckRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_key"));
  const [csRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "woo_consumer_secret"));
  return !!(urlRow?.value && ckRow?.value && csRow?.value);
}

export async function initScheduler(): Promise<void> {
  if (currentTask) { currentTask.stop(); currentTask = null; }

  const scheduleKey = await getSyncSchedule();
  if (!scheduleKey || !SCHEDULES[scheduleKey]) return;

  const credentialsOk = await hasCredentials();
  if (!credentialsOk) return;

  const cronExpr = SCHEDULES[scheduleKey];
  currentTask = schedule(cronExpr, async () => {
    console.log(`[scheduler] Running WooCommerce sync (${scheduleKey})`);
    try {
      const result = await runWooSync();
      console.log(`[scheduler] Sync complete: +${result.created} created, ~${result.updated} updated, ${result.errors.length} errors`);
    } catch (err) {
      console.error("[scheduler] Sync failed:", err);
    }
  });

  console.log(`[scheduler] WooCommerce sync scheduled: ${scheduleKey} (${cronExpr})`);
}

export async function reschedule(): Promise<void> {
  await initScheduler();
}

// ─── Customer check-in reminders ──────────────────────────────────────────────

/**
 * For every customer whose most recent order is older than 90 days (or who has
 * never placed an order), create a high-priority task — unless an open or
 * in-progress check-in task already exists for them.
 */
export async function createCheckInReminders(): Promise<{ created: number }> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);

  // Find customers with no recent orders using raw SQL for the aggregation
  const staleCustomers = await db.execute<{ id: number; name: string; last_order: Date | null }>(sql`
    SELECT c.id, c.name, MAX(o.order_date) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    GROUP BY c.id, c.name
    HAVING MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL
  `);

  let created = 0;
  for (const customer of staleCustomers.rows) {
    // Skip if there's already an open/in_progress check-in task for this customer
    const existing = await db.select({ id: tasksTable.id }).from(tasksTable).where(
      and(
        eq(tasksTable.customerId, customer.id),
        or(eq(tasksTable.status, "open"), eq(tasksTable.status, "in_progress")),
        sql`${tasksTable.title} LIKE ${"Check in with%"}`
      )
    );

    if (existing.length > 0) continue;

    const daysSince = customer.last_order
      ? Math.floor((Date.now() - new Date(customer.last_order).getTime()) / 86_400_000)
      : null;

    const description = daysSince != null
      ? `No order placed in the last ${daysSince} days. Consider reaching out to maintain the relationship.`
      : "This customer has never placed an order. Consider making initial contact.";

    await db.insert(tasksTable).values({
      title: `Check in with ${customer.name}`,
      description,
      priority: "high",
      status: "open",
      customerId: customer.id,
      customerName: customer.name,
    });
    created++;
  }

  console.log(`[reminders] Created ${created} customer check-in task(s)`);
  return { created };
}

// ─── Customer data normalisation ──────────────────────────────────────────────

/**
 * Converts all-caps customer text fields to proper title case / lowercase
 * using PostgreSQL's built-in initcap() and lower() functions.
 * Only touches fields that are detectably all-uppercase (have letters and
 * equal their own upper() value).
 */
export async function normalizeCustomerCasing(): Promise<{ updated: number }> {
  const result = await db.execute<{ count: string }>(sql`
    WITH updated AS (
      UPDATE customers SET
        name             = CASE WHEN name ~ '[A-Za-z]' AND name = upper(name)
                                THEN initcap(name) ELSE name END,
        contact_first_name = CASE WHEN contact_first_name IS NOT NULL
                                       AND contact_first_name ~ '[A-Za-z]'
                                       AND contact_first_name = upper(contact_first_name)
                                  THEN initcap(contact_first_name) ELSE contact_first_name END,
        contact_last_name  = CASE WHEN contact_last_name IS NOT NULL
                                       AND contact_last_name ~ '[A-Za-z]'
                                       AND contact_last_name = upper(contact_last_name)
                                  THEN initcap(contact_last_name) ELSE contact_last_name END,
        email            = CASE WHEN email IS NOT NULL THEN lower(email) ELSE email END,
        address          = CASE WHEN address IS NOT NULL
                                     AND address ~ '[A-Za-z]'
                                     AND address = upper(address)
                                THEN initcap(address) ELSE address END,
        city             = CASE WHEN city IS NOT NULL
                                     AND city ~ '[A-Za-z]'
                                     AND city = upper(city)
                                THEN initcap(city) ELSE city END,
        state            = CASE WHEN state IS NOT NULL
                                     AND state ~ '[A-Za-z]'
                                     AND state = upper(state)
                                THEN initcap(state) ELSE state END
      RETURNING 1
    )
    SELECT count(*)::text AS count FROM updated
  `);
  const updated = parseInt(result.rows[0]?.count ?? "0", 10);
  console.log(`[normalise] Updated ${updated} customer record(s)`);
  return { updated };
}

// Run customer casing normalisation every Sunday at 3am
schedule("0 3 * * 0", async () => {
  console.log("[normalise] Running weekly customer casing normalisation");
  try {
    await normalizeCustomerCasing();
  } catch (err) {
    console.error("[normalise] Normalisation job failed:", err);
  }
});

// Run check-in reminders every day at 9am
schedule("0 9 * * *", async () => {
  console.log("[reminders] Running daily customer check-in check");
  try {
    await createCheckInReminders();
  } catch (err) {
    console.error("[reminders] Check-in reminder job failed:", err);
  }
});

// ─── Customer re-engagement emails ────────────────────────────────────────────

/**
 * Sends a friendly "checking in" email to customers who haven't placed an order
 * in the last 4 months (120 days) and haven't received a check-in email in the
 * last 120 days either. Controlled by the `checkin_email_enabled` setting.
 */
export async function sendCheckInEmails(): Promise<{ sent: number; skipped: number; errors: number }> {
  // Check if feature is enabled
  const [enabledRow] = await db.select().from(settingsTable).where(eq(settingsTable.key, "checkin_email_enabled"));
  if (enabledRow?.value !== "true") {
    console.log("[checkin-email] Feature disabled — skipping");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  if (!isEmailConfigured) {
    console.log("[checkin-email] No email provider configured — skipping");
    return { sent: 0, skipped: 0, errors: 0 };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 120);

  // Find customers with email, no order in 120 days, and no check-in email in 120 days
  const eligible = await db.execute<{
    id: number;
    name: string;
    email: string;
    contact_first_name: string | null;
    contact_last_name: string | null;
    logo_url: string | null;
    last_order: Date | null;
    checkin_email_sent_at: Date | null;
  }>(sql`
    SELECT
      c.id,
      c.name,
      c.email,
      c.contact_first_name,
      c.contact_last_name,
      c.logo_url,
      c.checkin_email_sent_at,
      MAX(o.order_date) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.email IS NOT NULL AND c.email <> ''
    GROUP BY c.id, c.name, c.email, c.contact_first_name, c.contact_last_name, c.logo_url, c.checkin_email_sent_at
    HAVING
      (MAX(o.order_date) < ${cutoff} OR MAX(o.order_date) IS NULL)
      AND (c.checkin_email_sent_at IS NULL OR c.checkin_email_sent_at < ${cutoff})
  `);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const customer of eligible.rows) {
    try {
      const firstName = customer.contact_first_name?.trim() || customer.name;
      const logoDataUrl = await fetchLogoDataUrl(customer.logo_url).catch(() => null);

      const { html, text } = buildCheckInEmail({
        customerName: customer.name,
        firstName,
        portalUrl: null,
        customerLogoDataUrl: logoDataUrl,
      });

      const result = await sendEmail({
        to: customer.email,
        subject: `Just checking in — ${customer.name}`,
        html,
        text,
      });

      if (result.sent) {
        await db.execute(sql`
          UPDATE customers SET checkin_email_sent_at = now() WHERE id = ${customer.id}
        `);
        console.log(`[checkin-email] Sent to ${customer.email} (${customer.name})`);
        sent++;
      } else {
        console.error(`[checkin-email] Failed for ${customer.email}: ${result.error}`);
        errors++;
      }
    } catch (err: any) {
      console.error(`[checkin-email] Error for customer ${customer.id}:`, err?.message ?? err);
      errors++;
    }
  }

  // Record last run time
  await db.execute(sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('checkin_email_last_run', ${new Date().toISOString()}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `).catch(() => {});

  console.log(`[checkin-email] Done — sent: ${sent}, skipped: ${skipped}, errors: ${errors}`);
  return { sent, skipped, errors };
}

// Run re-engagement emails every Monday at 10am
schedule("0 10 * * 1", async () => {
  console.log("[checkin-email] Running weekly re-engagement email check");
  try {
    await sendCheckInEmails();
  } catch (err) {
    console.error("[checkin-email] Re-engagement email job failed:", err);
  }
});

// ─── Scheduled invoice sends ──────────────────────────────────────────────────
// Every minute: find orders with a scheduled send time that has now passed
// and fire off the invoice email + Xero post, then clear the schedule.
schedule("* * * * *", async () => {
  try {
    const due = await db
      .select({ id: ordersTable.id, orderNumber: ordersTable.orderNumber, invoiceScheduledSendAt: ordersTable.invoiceScheduledSendAt, invoiceScheduleToEmail: ordersTable.invoiceScheduleToEmail })
      .from(ordersTable)
      .where(
        and(
          isNotNull(ordersTable.invoiceScheduledSendAt),
          lte(ordersTable.invoiceScheduledSendAt, new Date()),
          isNull(ordersTable.invoiceEmailSentAt),
        )
      );

    for (const order of due) {
      // Atomically claim by clearing schedule — prevents double-fire if two instances run.
      // On failure below we restore it so the next tick will retry.
      await db.update(ordersTable)
        .set({ invoiceScheduledSendAt: null, updatedAt: new Date() })
        .where(eq(ordersTable.id, order.id));

      try {
        await sendInvoiceEmail(order.id, order.invoiceScheduleToEmail ?? undefined);
        console.log(`[invoice-scheduler] Sent scheduled invoice for ${order.orderNumber}`);

        try {
          await postInvoiceToXero(order.id);
        } catch {
          // Xero not connected — non-fatal; order will appear in "To Post to Xero"
        }
      } catch (err) {
        console.error(`[invoice-scheduler] Failed to send invoice for ${order.orderNumber}:`, err);
        // Restore the original scheduled time so the job retries on the next tick.
        // Leave a short delay (2 min) to avoid hammering a broken service.
        const retryAt = new Date(Date.now() + 2 * 60 * 1000);
        await db.update(ordersTable)
          .set({ invoiceScheduledSendAt: retryAt, updatedAt: new Date() })
          .where(eq(ordersTable.id, order.id))
          .catch((restoreErr: unknown) => {
            console.error(`[invoice-scheduler] Could not restore schedule for ${order.orderNumber}:`, restoreErr);
          });
      }
    }
  } catch (err) {
    console.error("[invoice-scheduler] Scheduled invoice job failed:", err);
  }
});

// ─── Local delivery 48-hour follow-up sends ───────────────────────────────────
// Every minute: find orders whose follow-up window has elapsed and fire the
// review-request email + GHL WhatsApp webhook, then mark as sent.
schedule("* * * * *", async () => {
  try {
    const due = await db.execute(sql`
      SELECT o.id, o.order_number, o.customer_name, o.local_delivery_actor_name,
             c.email, c.logo_url, c.high_level_contact_id
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.local_delivery_followup_due_at <= now()
        AND o.local_delivery_followup_due_at IS NOT NULL
        AND o.local_delivery_followup_sent_at IS NULL
    `);

    for (const row of due.rows as any[]) {
      // Atomically claim — prevents double-fire if two server instances run
      const claimed = await db.execute(sql`
        UPDATE orders
        SET local_delivery_followup_sent_at = now(), updated_at = now()
        WHERE id = ${row.id} AND local_delivery_followup_sent_at IS NULL
        RETURNING id
      `);
      if (claimed.rows.length === 0) continue;

      try {
        const settingsRows = await db.execute(sql`
          SELECT key, value FROM settings
          WHERE key IN ('google_review_url', 'facebook_review_url', 'local_delivery_ghl_webhook_url')
        `);
        const sm: Record<string, string> = {};
        for (const s of settingsRows.rows as any[]) sm[s.key] = s.value;

        // Send follow-up email
        if (row.email) {
          const logoDataUrl = row.logo_url ? await fetchLogoDataUrl(row.logo_url) : null;
          const { html, text } = buildDeliveryFollowupEmail({
            customerName: row.customer_name ?? "there",
            orderNumber: row.order_number,
            actorName: row.local_delivery_actor_name ?? null,
            googleReviewUrl: sm["google_review_url"] ?? null,
            facebookReviewUrl: sm["facebook_review_url"] ?? null,
            customerLogoDataUrl: logoDataUrl,
          });
          await sendEmail({
            to: row.email,
            subject: `How did your ${row.order_number} order arrive?`,
            html,
            text,
          });
        }

        // Fire GHL follow-up webhook (WhatsApp)
        if (sm["local_delivery_ghl_webhook_url"] && row.high_level_contact_id) {
          fetch(sm["local_delivery_ghl_webhook_url"], {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventType: "delivery_followup",
              contactId: row.high_level_contact_id,
              orderNumber: row.order_number,
              customerName: row.customer_name,
              actorName: row.local_delivery_actor_name ?? null,
            }),
          }).catch((e) => console.error("[delivery-followup] GHL webhook failed:", e));
        }

        console.log(`[delivery-followup] Sent for ${row.order_number}`);
      } catch (err) {
        console.error(`[delivery-followup] Failed for ${row.order_number}:`, err);
        // Restore so the next tick retries
        await db.execute(sql`
          UPDATE orders SET local_delivery_followup_sent_at = NULL, updated_at = now()
          WHERE id = ${row.id}
        `).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[delivery-followup] Job failed:", err);
  }
});
