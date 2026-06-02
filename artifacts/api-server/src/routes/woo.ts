import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

function extractFileUploads(metaData: any[]): { name: string; url: string }[] {
  const uploads: { name: string; url: string }[] = [];
  for (const m of metaData) {
    const rawValue = String(m.value || "");
    const displayValue = String(m.display_value || "");
    const displayKey = String(m.display_key || m.key || "Uploaded file");
    if (/^https?:\/\//i.test(rawValue)) {
      uploads.push({ name: displayKey, url: rawValue });
    } else if (/^https?:\/\//i.test(displayValue)) {
      uploads.push({ name: displayKey, url: displayValue });
    } else {
      const match = displayValue.match(/href=["']([^"']+)["']/i);
      if (match) uploads.push({ name: displayKey, url: match[1] });
    }
  }
  return uploads;
}

interface WooSettings {
  baseUrl: string;
  ck: string;
  cs: string;
}

export async function getWooSettings(): Promise<WooSettings | null> {
  const rows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('woo_url', 'woo_consumer_key', 'woo_consumer_secret')
  `);
  const map = Object.fromEntries((rows.rows as any[]).map((r: any) => [r.key, r.value]));
  if (!map["woo_url"] || !map["woo_consumer_key"] || !map["woo_consumer_secret"]) return null;
  return { baseUrl: map["woo_url"], ck: map["woo_consumer_key"], cs: map["woo_consumer_secret"] };
}

async function wooFetch<T>(settings: WooSettings, path: string): Promise<T> {
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);
  const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

export async function wooUpdateOrderStatus(settings: WooSettings, wooOrderId: number, status: string): Promise<void> {
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders/${wooOrderId}`);
  url.searchParams.set("consumer_key", settings.ck);
  url.searchParams.set("consumer_secret", settings.cs);
  const res = await fetch(url.toString(), {
    method: "PUT",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
}

// ─── List recent WooCommerce orders ──────────────────────────────────────────
router.get("/woo/orders", async (req: Request, res: Response): Promise<void> => {
  const settings = await getWooSettings();
  if (!settings) {
    res.status(400).json({ error: "WooCommerce not configured. Check Settings → WooCommerce." });
    return;
  }

  try {
    const status = (req.query.status as string) || "processing,on-hold,pending";
    const page = parseInt(req.query.page as string) || 1;
    const perPage = 20;
    const path = `/orders?status=${status}&per_page=${perPage}&page=${page}&orderby=date&order=desc`;
    const wooOrders = await wooFetch<any[]>(settings, path);

    // Check which have already been imported
    const wooIds = wooOrders.map((o: any) => o.id);
    let importedIds = new Set<number>();
    let importedMap = new Map<number, string>(); // wooId -> internal order number
    if (wooIds.length > 0) {
      const imported = await db.execute(
        sql.raw(`SELECT woo_order_id, order_number FROM orders WHERE woo_order_id IN (${wooIds.join(",")})`)
      );
      for (const r of imported.rows as any[]) {
        importedIds.add(Number(r.woo_order_id));
        importedMap.set(Number(r.woo_order_id), r.order_number);
      }
    }

    const orders = wooOrders.map((o: any) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      dateCreated: o.date_created,
      customerNote: o.customer_note || null,
      billing: {
        firstName: o.billing?.first_name ?? "",
        lastName: o.billing?.last_name ?? "",
        company: o.billing?.company ?? "",
        email: o.billing?.email ?? "",
        phone: o.billing?.phone ?? "",
      },
      shipping: {
        firstName: o.shipping?.first_name ?? "",
        lastName: o.shipping?.last_name ?? "",
        company: o.shipping?.company ?? "",
        address1: o.shipping?.address_1 ?? "",
        address2: o.shipping?.address_2 ?? "",
        city: o.shipping?.city ?? "",
        postcode: o.shipping?.postcode ?? "",
        country: o.shipping?.country ?? "",
      },
      lineItems: (o.line_items ?? []).map((li: any) => {
        const fileUploads = extractFileUploads(li.meta_data ?? []);
        const fileUrls = new Set(fileUploads.map(f => f.url));
        return {
          id: li.id,
          name: li.name,
          sku: li.sku || null,
          quantity: li.quantity,
          price: li.price,
          total: li.total,
          metaData: (li.meta_data ?? []).filter((m: any) =>
            !m.key.startsWith("_") && m.display_value &&
            !fileUrls.has(String(m.display_value)) &&
            !/^https?:\/\//i.test(String(m.display_value))
          ).map((m: any) => ({ key: m.display_key || m.key, value: m.display_value })),
          fileUploads,
        };
      }),
      shippingLines: (o.shipping_lines ?? []).map((sl: any) => ({
        methodTitle: sl.method_title,
        total: sl.total,
      })),
      total: o.total,
      currency: o.currency,
      paymentMethodTitle: o.payment_method_title || null,
      alreadyImported: importedIds.has(o.id),
      importedOrderNumber: importedMap.get(o.id) ?? null,
    }));

    res.json({ orders, page, perPage });
  } catch (err: any) {
    console.error("[woo/orders] Error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Mark a WooCommerce order as Completed (dismiss from import queue) ────────
router.post("/woo/orders/:wooId/mark-completed", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid WooCommerce order ID" }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  try {
    await wooUpdateOrderStatus(settings, wooId, "completed");
    res.json({ ok: true });
  } catch (err: any) {
    console.error(`[woo/orders/${wooId}/mark-completed] Error:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Bulk mark WooCommerce orders as Completed ────────────────────────────────
router.post("/woo/orders/bulk-mark-completed", async (req: Request, res: Response): Promise<void> => {
  const body = req.body as { wooIds: number[] };
  if (!Array.isArray(body?.wooIds) || body.wooIds.length === 0) {
    res.status(400).json({ error: "wooIds array required" }); return;
  }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  const results: { wooId: number; ok: boolean; error?: string }[] = [];
  for (const wooId of body.wooIds) {
    try {
      await wooUpdateOrderStatus(settings, wooId, "completed");
      results.push({ wooId, ok: true });
    } catch (err: any) {
      results.push({ wooId, ok: false, error: err.message });
    }
  }

  const failed = results.filter(r => !r.ok);
  res.json({ results, failedCount: failed.length });
});

// ─── Import a WooCommerce order into the order system ────────────────────────
router.post("/woo/orders/:wooId/import", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid WooCommerce order ID" }); return; }

  const settings = await getWooSettings();
  if (!settings) {
    res.status(400).json({ error: "WooCommerce not configured." });
    return;
  }

  // Check not already imported
  const existing = await db.execute(sql`
    SELECT id, order_number FROM orders WHERE woo_order_id = ${wooId}
  `);
  if ((existing.rows as any[]).length > 0) {
    const row = existing.rows[0] as any;
    res.status(409).json({ error: `Already imported as ${row.order_number}`, orderNumber: row.order_number, orderId: row.id });
    return;
  }

  try {
    const woo = await wooFetch<any>(settings, `/orders/${wooId}`);

    // Determine customer name (billing company > full name)
    const billingName = [woo.billing?.first_name, woo.billing?.last_name].filter(Boolean).join(" ");
    const customerName = woo.billing?.company?.trim() || billingName || `WooCommerce #${woo.number}`;

    // Try to find matching customer in our DB by email or company name
    let customerId: number | null = null;
    const email = woo.billing?.email?.toLowerCase().trim();
    if (email) {
      const byEmail = await db.execute(sql`
        SELECT id FROM customers WHERE LOWER(email) = ${email} LIMIT 1
      `);
      if ((byEmail.rows as any[]).length > 0) {
        customerId = (byEmail.rows[0] as any).id;
      }
    }
    if (!customerId && woo.billing?.company) {
      const byName = await db.execute(sql`
        SELECT id FROM customers WHERE LOWER(name) = LOWER(${woo.billing.company.trim()}) LIMIT 1
      `);
      if ((byName.rows as any[]).length > 0) {
        customerId = (byName.rows[0] as any).id;
      }
    }

    // Generate the next order number
    const numRows = await db.execute(sql`
      SELECT order_number FROM orders
      WHERE order_number ~ '^O[0-9]+$'
      ORDER BY LENGTH(order_number) DESC, order_number DESC
      LIMIT 1
    `);
    const lastNum = (numRows.rows[0] as any)?.order_number as string | undefined;
    const orderNumber = `O${(lastNum ? parseInt(lastNum.slice(1), 10) : 99) + 1}`;

    // Calculate carriage from shipping lines
    const carriageAmount = (woo.shipping_lines ?? [])
      .reduce((sum: number, sl: any) => sum + parseFloat(sl.total || "0"), 0);

    // Collect all file uploads from line items + order meta
    const allFileUploads: { name: string; url: string }[] = [];
    for (const li of woo.line_items ?? []) {
      allFileUploads.push(...extractFileUploads(li.meta_data ?? []));
    }
    allFileUploads.push(...extractFileUploads(woo.meta_data ?? []));
    // Deduplicate by URL
    const seenUrls = new Set<string>();
    const dedupedFiles = allFileUploads.filter(f => {
      if (seenUrls.has(f.url)) return false;
      seenUrls.add(f.url);
      return true;
    });

    // Build notes
    const notesParts: string[] = [];
    if (woo.customer_note?.trim()) notesParts.push(`Customer note: ${woo.customer_note.trim()}`);
    if (woo.payment_method_title) notesParts.push(`Payment: ${woo.payment_method_title}`);

    // Store the WooCommerce order number for reference
    const wooOrderNumber = String(woo.number);
    if (wooOrderNumber && wooOrderNumber !== String(wooId)) {
      notesParts.push(`WooCommerce order #${wooOrderNumber}`);
    }

    const attachmentsJson = dedupedFiles.length > 0 ? JSON.stringify(dedupedFiles) : null;
    const orderResult = await db.execute(sql`
      INSERT INTO orders (
        order_number, customer_id, customer_name, status, total_amount,
        carriage_amount, notes, order_date, source, woo_order_id, attachments, created_at, updated_at
      ) VALUES (
        ${orderNumber},
        ${customerId},
        ${customerName},
        'draft',
        ${woo.total},
        ${carriageAmount.toFixed(2)},
        ${notesParts.join("\n") || null},
        ${woo.date_created ? new Date(woo.date_created).toISOString() : new Date().toISOString()},
        'woocommerce',
        ${wooId},
        ${attachmentsJson}::jsonb,
        now(), now()
      )
      RETURNING id, order_number
    `);
    const order = orderResult.rows[0] as any;

    // Import line items — try to match products by SKU
    for (const li of woo.line_items ?? []) {
      let productId: number | null = null;
      if (li.sku) {
        const prod = await db.execute(sql`
          SELECT id FROM products WHERE sku = ${li.sku} LIMIT 1
        `);
        if ((prod.rows as any[]).length > 0) productId = (prod.rows[0] as any).id;
      }

      // Extract colour/size from meta_data
      let colour: string | null = null;
      let size: string | null = null;
      const fileUploads = extractFileUploads(li.meta_data ?? []);
      const fileUrls = new Set(fileUploads.map((f: { url: string }) => f.url));
      const notesLines: string[] = [];
      for (const m of li.meta_data ?? []) {
        const key = (m.key || "").toLowerCase();
        const displayKey = m.display_key || m.key || "";
        const val = String(m.display_value || m.value || "").trim();
        if (!val || key.startsWith("_")) continue;
        if (key.includes("colour") || key.includes("color") || key.includes("pa_colour") || key.includes("pa_color")) { colour = val; continue; }
        if (key.includes("size") || key.includes("pa_size")) { size = val; continue; }
        if (fileUrls.has(val) || /^https?:\/\//i.test(val)) continue; // skip raw URLs
        if (/<[a-z][\s\S]*>/i.test(val)) continue; // skip HTML blobs
        notesLines.push(`${displayKey}: ${val}`);
      }
      const itemNotes = notesLines.length > 0 ? notesLines.join("\n") : null;

      const unitPrice = li.quantity > 0 ? (parseFloat(li.total || "0") / li.quantity).toFixed(2) : "0.00";
      await db.execute(sql`
        INSERT INTO order_items (
          order_id, product_id, product_name, colour, size,
          quantity, unit_price, line_total, recipient_type, notes, created_at
        ) VALUES (
          ${order.id},
          ${productId},
          ${li.name},
          ${colour},
          ${size},
          ${li.quantity},
          ${unitPrice},
          ${li.total},
          'stock',
          ${itemNotes},
          now()
        )
      `);
    }

    // Recalc total (includes carriage)
    await db.execute(sql`
      UPDATE orders SET
        total_amount = (
          SELECT COALESCE(SUM(line_total::numeric), 0) + ${carriageAmount}
          FROM order_items WHERE order_id = ${order.id}
        ),
        updated_at = now()
      WHERE id = ${order.id}
    `);

    // Log the import
    await db.execute(sql`
      INSERT INTO order_logs (order_id, action, actor, details, created_at)
      VALUES (${order.id}, 'Order imported', 'WooCommerce', ${`Imported from WooCommerce order #${woo.number}`}, now())
    `);

    res.status(201).json({ orderId: order.id, orderNumber: order.order_number, wooNumber: wooOrderNumber, customerName });
  } catch (err: any) {
    console.error("[woo/orders/:id/import] Error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Fetch a single WooCommerce order (for preview) ──────────────────────────
router.get("/woo/orders/:wooId", async (req: Request, res: Response): Promise<void> => {
  const wooId = parseInt(req.params.wooId);
  if (isNaN(wooId)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const settings = await getWooSettings();
  if (!settings) { res.status(400).json({ error: "WooCommerce not configured." }); return; }

  try {
    const woo = await wooFetch<any>(settings, `/orders/${wooId}`);
    res.json(woo);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
