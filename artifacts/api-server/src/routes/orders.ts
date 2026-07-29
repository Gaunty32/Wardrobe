import { Router, type IRouter } from "express";
import { eq, desc, asc, sql, inArray, and, ne, isNotNull, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  db, ordersTable, orderItemsTable, orderLogsTable, orderEmailLogsTable, customersTable, productsTable,
  worksheetsTable, worksheetItemsTable, customerEmployeesTable, customerTeamsTable,
  customerDeliveryAddressesTable, customerEmployeeSizesTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable,
  customerProcessesTable, customerFinishProcessesTable, processStockTable,
  productVariantsTable,
} from "@workspace/db";
import { buildAcknowledgementEmail, generateOrderAcknowledgementPdf, sendEmail, isEmailConfigured } from "../services/email";
import { buildInviteEmail } from "./portal.js";
import { SBS_LOGO_DATA_URL } from "../assets/logo-data.js";
import { ObjectStorageService } from "../lib/objectStorage";
import { logOrderAction, getActor } from "../services/orderLog";
import { getUncachableStripeClient } from "../services/stripeClient.js";
import {
  UpdateOrderBody,
  GetOrderParams,
  UpdateOrderParams,
  DeleteOrderParams,
  ListOrdersQueryParams,
  AddOrderItemParams,
  AddOrderItemBody,
  UpdateOrderItemParams,
  UpdateOrderItemBody,
  DeleteOrderItemParams,
} from "@workspace/api-zod";

// Custom schema — generated CreateOrderBody uses zod.date() which rejects ISO strings from JSON
const CreateOrderBodyFixed = z.object({
  customerId: z.number().int().positive().optional().nullable(),
  notes: z.string().optional().nullable(),
  orderDate: z.string().optional().nullable(),
  items: z.array(z.object({
    productId: z.number().optional().nullable(),
    productName: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
  })).optional(),
});

const router: IRouter = Router();
const _objectStorageService = new ObjectStorageService();

// Read a customer logo from wherever it's stored — handles relative object storage
// paths like /api/storage/objects/... as well as absolute http(s) URLs.
async function readLogoForSending(logoUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!logoUrl) return null;
  try {
    // Relative object-storage path: read directly from GCS without an HTTP round-trip
    if (logoUrl.startsWith("/api/storage/objects/")) {
      const objectPath = logoUrl.replace("/api/storage", ""); // /objects/uploads/<uuid>.ext
      const file = await _objectStorageService.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      const contentType = (metadata.contentType as string | undefined)?.trim() || "image/png";
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        file.createReadStream()
          .on("data", (c: Buffer) => chunks.push(c))
          .on("end", resolve)
          .on("error", reject);
      });
      return { buffer: Buffer.concat(chunks), contentType };
    }
    // Absolute URL fallback
    const resp = await fetch(logoUrl, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const ct = resp.headers.get("content-type") ?? "image/png";
    return { buffer: Buffer.from(await resp.arrayBuffer()), contentType: ct };
  } catch { return null; }
}

async function generateOrderNumber(): Promise<string> {
  const rows = await db.execute(sql`
    SELECT order_number FROM orders
    WHERE order_number ~ '^O[0-9]+$'
    ORDER BY LENGTH(order_number) DESC, order_number DESC
    LIMIT 1
  `);
  const last = (rows.rows[0] as any)?.order_number as string | undefined;
  const maxNum = last ? parseInt(last.slice(1), 10) : 99;
  return `O${maxNum + 1}`;
}

async function createStripePaymentLink(opts: {
  orderNumber: string;
  totalAmount: number;
  stripeCustomerId?: string | null;
  baseUrl: string;
}): Promise<string | null> {
  try {
    const stripe = await getUncachableStripeClient();
    const amountPence = Math.round(opts.totalAmount * 100);
    if (amountPence <= 0) return null;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "gbp",
          product_data: {
            name: `Order Payment – Ref: ${opts.orderNumber}`,
            description: "Select Branding Solutions Ltd",
          },
          unit_amount: amountPence,
        },
        quantity: 1,
      }],
      ...(opts.stripeCustomerId ? { customer: opts.stripeCustomerId } : {}),
      success_url: `${opts.baseUrl}/customer-portal/`,
      cancel_url: `${opts.baseUrl}/customer-portal/`,
      metadata: { sbs_order_number: opts.orderNumber },
    });
    return session.url;
  } catch {
    return null;
  }
}

function numericToFloat(val: string | null | undefined): number {
  return val ? parseFloat(val) : 0;
}

async function recalcOrderTotal(orderId: number): Promise<void> {
  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  // Exclude bundle component rows — their price is already included in the bundle header's line_total.
  // A component row has bundle_ref set AND is_bundle_header = false/null.
  const total = items
    .filter((item) => !(item.bundleRef && !item.isBundleHeader))
    .reduce((sum, item) => sum + numericToFloat(item.lineTotal), 0);
  await db
    .update(ordersTable)
    .set({ totalAmount: String(total), updatedAt: new Date() })
    .where(eq(ordersTable.id, orderId));
}

const ORDER_NUM_SORT = [sql`NULLIF(REGEXP_REPLACE(${ordersTable.orderNumber}, '[^0-9]', '', 'g'), '')::integer DESC NULLS LAST`] as const;

router.get("/orders", async (req, res): Promise<void> => {
  const query = ListOrdersQueryParams.safeParse(req.query);
  // Exclude portal_draft orders (awaiting customer manager approval),
  // portal_pending orders (awaiting SBS confirmation — shown in the dedicated panel instead),
  // and cancelled orders (not needed in the orders view).
  // Do NOT filter by portal_status='rejected' here — orders that went through the portal flow
  // can end up confirmed/cancelled with that flag set, and should still appear in the list.
  const baseCondition = sql`(${ordersTable.status} IS DISTINCT FROM 'portal_draft' AND ${ordersTable.status} IS DISTINCT FROM 'portal_pending' AND ${ordersTable.status} IS DISTINCT FROM 'cancelled')`;
  let orders;
  if (query.success) {
    const conditions = [baseCondition];
    if (query.data.status === "active") {
      // Hide orders that are fully done: shipped + (invoiced to Xero OR zero-value — £0 orders can never get a Xero invoice)
      conditions.push(sql`NOT (${ordersTable.status} = 'shipped' AND (${ordersTable.xeroInvoiceId} IS NOT NULL OR COALESCE(${ordersTable.totalAmount}::numeric, 0) = 0))`);
    } else if (query.data.status) {
      conditions.push(eq(ordersTable.status, query.data.status));
    }
    if (query.data.customerId) conditions.push(eq(ordersTable.customerId, query.data.customerId));
    orders = await db.select().from(ordersTable).where(and(...conditions)).orderBy(...ORDER_NUM_SORT);
  } else {
    orders = await db.select().from(ordersTable).where(baseCondition).orderBy(...ORDER_NUM_SORT);
  }
  // Attach per-order GP margin — only when EVERY non-service line item has a supplier price.
  // Variant-level supplier_price takes precedence over product-level (COALESCE pv → p).
  // If any item is missing a cost we return null so the UI shows "—" rather than a false 100%.
  const orderIds = orders.map(o => o.id);
  type CostRow = { orderId: number; cost: number; missingCost: number };
  const costByOrderId = new Map<number, CostRow>();
  if (orderIds.length > 0) {
    const costRows = await db.execute(sql`
      SELECT
        oi.order_id AS "orderId",
        COALESCE(SUM(oi.quantity * resolved.supplier_price), 0)::float AS cost,
        COUNT(*) FILTER (
          WHERE oi.product_id IS NOT NULL
            AND oi.is_bundle_header IS NOT TRUE
            AND p.is_service IS NOT TRUE
            AND (resolved.supplier_price IS NULL OR resolved.supplier_price = 0)
        )::int AS "missingCost"
      FROM order_items oi
      LEFT JOIN products p ON p.id = oi.product_id
      -- LATERAL ensures at most one variant row per order item, preventing cost multiplication
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT pv.supplier_price
           FROM product_variants pv
           WHERE pv.product_id = oi.product_id
             AND (pv.colour IS NOT DISTINCT FROM oi.colour)
             AND (pv.size   IS NOT DISTINCT FROM oi.size)
           LIMIT 1),
          p.supplier_price
        ) AS supplier_price
      ) resolved ON true
      WHERE oi.order_id = ANY(ARRAY[${sql.raw(orderIds.join(","))}])
      GROUP BY oi.order_id
    `);
    for (const row of costRows.rows as CostRow[]) {
      if (row.orderId != null) costByOrderId.set(Number(row.orderId), row);
    }
  }
  res.json(orders.map((o) => {
    const revenue = numericToFloat(o.totalAmount);
    const row = costByOrderId.get(o.id);
    // Only compute GP when all non-service items have a supplier price
    const gpMargin = (revenue > 0 && row && row.missingCost === 0)
      ? ((revenue - row.cost) / revenue) * 100
      : null;
    return { ...o, totalAmount: revenue, gpMargin };
  }));
});

router.get("/orders/weekly-stats", async (req, res): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT
      date_trunc('week', order_date AT TIME ZONE 'UTC')::date AS week_start,
      COUNT(*)::int AS order_count,
      COALESCE(SUM(total_amount), 0)::float AS total_value
    FROM orders
    WHERE order_date >= NOW() - INTERVAL '12 weeks'
      AND status != 'cancelled'
    GROUP BY date_trunc('week', order_date AT TIME ZONE 'UTC')
    ORDER BY week_start ASC
  `);
  res.json(rows.rows);
});

router.get("/dashboard/profit-stats", async (_req, res): Promise<void> => {
  const notCancelled = `o.status NOT IN ('cancelled', 'portal_draft')`;

  // Revenue is pulled from orders alone (to avoid multiplying by item count),
  // cost is aggregated from order_items separately, then the two are joined.
  const weekly = await db.execute(sql`
    SELECT
      rev.week_start,
      rev.order_count,
      rev.revenue,
      COALESCE(cst.cost, 0)::float AS cost
    FROM (
      SELECT
        date_trunc('week', o.order_date AT TIME ZONE 'UTC')::date AS week_start,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS revenue
      FROM orders o
      WHERE o.order_date >= NOW() - INTERVAL '13 weeks'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY week_start
    ) rev
    LEFT JOIN (
      SELECT
        date_trunc('week', o.order_date AT TIME ZONE 'UTC')::date AS week_start,
        COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv
        ON pv.product_id = oi.product_id
        AND (pv.colour IS NOT DISTINCT FROM oi.colour)
        AND (pv.size IS NOT DISTINCT FROM oi.size)
      WHERE o.order_date >= NOW() - INTERVAL '13 weeks'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY week_start
    ) cst ON cst.week_start = rev.week_start
    ORDER BY rev.week_start ASC
  `);

  const monthly = await db.execute(sql`
    SELECT
      rev.month_start,
      rev.order_count,
      rev.revenue,
      COALESCE(cst.cost, 0)::float AS cost
    FROM (
      SELECT
        date_trunc('month', o.order_date AT TIME ZONE 'UTC')::date AS month_start,
        COUNT(o.id)::int AS order_count,
        COALESCE(SUM(o.total_amount), 0)::float AS revenue
      FROM orders o
      WHERE o.order_date >= NOW() - INTERVAL '12 months'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY month_start
    ) rev
    LEFT JOIN (
      SELECT
        date_trunc('month', o.order_date AT TIME ZONE 'UTC')::date AS month_start,
        COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
      FROM orders o
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      LEFT JOIN product_variants pv
        ON pv.product_id = oi.product_id
        AND (pv.colour IS NOT DISTINCT FROM oi.colour)
        AND (pv.size IS NOT DISTINCT FROM oi.size)
      WHERE o.order_date >= NOW() - INTERVAL '12 months'
        AND o.status NOT IN ('cancelled', 'portal_draft')
      GROUP BY month_start
    ) cst ON cst.month_start = rev.month_start
    ORDER BY rev.month_start ASC
  `);

  const jobs = await db.execute(sql`
    SELECT
      o.id,
      o.order_number,
      o.customer_name,
      o.order_date,
      o.status,
      COALESCE(o.total_amount, 0)::float AS revenue,
      COALESCE(SUM(oi.quantity * COALESCE(pv.supplier_price, p.supplier_price)), 0)::float AS cost
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN product_variants pv
      ON pv.product_id = oi.product_id
      AND (pv.colour IS NOT DISTINCT FROM oi.colour)
      AND (pv.size IS NOT DISTINCT FROM oi.size)
    WHERE o.status NOT IN ('cancelled', 'portal_draft')
    GROUP BY o.id, o.order_number, o.customer_name, o.order_date, o.status, o.total_amount
    ORDER BY o.order_date DESC
    LIMIT 25
  `);

  const enrich = (r: any) => ({
    ...r,
    gross_profit: (r.revenue ?? 0) - (r.cost ?? 0),
    gp_margin: r.revenue > 0 ? (((r.revenue - r.cost) / r.revenue) * 100) : null,
  });

  res.json({
    weekly: (weekly.rows as any[]).map(enrich),
    monthly: (monthly.rows as any[]).map(enrich),
    jobs: (jobs.rows as any[]).map(enrich),
  });
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBodyFixed.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { items, customerId, notes, orderDate } = parsed.data;

  let customerName: string | null = null;
  if (customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, customerId));
    customerName = customer?.name ?? null;
  }

  const orderNumber = await generateOrderNumber();
  const [order] = await db
    .insert(ordersTable)
    .values({
      orderNumber,
      customerId: customerId ?? null,
      customerName,
      status: "draft",
      totalAmount: "0",
      notes: notes ?? null,
      orderDate: orderDate ? new Date(orderDate) : new Date(),
    })
    .returning();

  if (items && items.length > 0) {
    const itemValues = items.map((item) => ({
      orderId: order.id,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      lineTotal: String(item.quantity * item.unitPrice),
    }));
    await db.insert(orderItemsTable).values(itemValues);
    await recalcOrderTotal(order.id);
  }

  // Auto-set default delivery address if customer has one
  if (customerId) {
    const defaultAddr = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.customerId, customerId))
      .limit(20);
    const def = defaultAddr.find(a => a.isDefault) ?? defaultAddr[0] ?? null;
    if (def) {
      await db.update(ordersTable).set({ deliveryAddressId: def.id }).where(eq(ordersTable.id, order.id));
    }
  }

  const [updatedOrder] = await db.select().from(ordersTable).where(eq(ordersTable.id, order.id));

  await logOrderAction(order.id, "Order created", getActor(req), `Order ${order.orderNumber} created${customerName ? ` for ${customerName}` : ""}`);

  res.status(201).json({ ...updatedOrder, totalAmount: numericToFloat(updatedOrder.totalAmount) });
});

// ── Confirm preflight: check for finishes with no processes assigned ─────────
router.get("/orders/:id/confirm-preflight", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid order id" }); return; }

  const rows = await db.execute(sql`
    SELECT DISTINCT cf.id, cf.name
    FROM order_items oi
    JOIN customer_finishes cf ON cf.id = oi.finish_id
    WHERE oi.order_id = ${params.data.id}
      AND NOT EXISTS (
        SELECT 1 FROM customer_finish_processes cfp WHERE cfp.finish_id = cf.id
      )
  `);
  const finishesWithNoProcesses = (rows.rows as Array<{ id: number; name: string }>).map(r => r.name);
  res.json({ ok: finishesWithNoProcesses.length === 0, finishesWithNoProcesses });
});

router.get("/orders/:id", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // Join product_variants to get variant-level supplier price (COALESCE variant → product).
  // Size matching handles two formats:
  //   1. Direct: variant.size = oi.size (most products)
  //   2. Split: order item stores "collar/sleeve" (e.g. "17.0/Short Sleeve") but the variant
  //      has size = "17.0" and sleeve = "Short Sleeve" as separate columns (shirts).
  // Prefer the direct match; fall back to the split match.
  const itemRowsRaw = await db.execute(sql`
    SELECT
      oi.*,
      p.name         AS catalogue_product_name,
      p.sku          AS product_sku,
      p.price_breaks AS price_breaks,
      p.is_service   AS p_is_service,
      COALESCE(pv.supplier_price, p.supplier_price) AS resolved_supplier_price
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN LATERAL (
      SELECT supplier_price
      FROM product_variants
      WHERE product_id = oi.product_id
        AND (colour IS NOT DISTINCT FROM oi.colour)
        AND (
          (size IS NOT DISTINCT FROM oi.size)
          OR (
            oi.size LIKE '%/%'
            AND size = split_part(oi.size, '/', 1)
            AND sleeve = split_part(oi.size, '/', 2)
          )
        )
      ORDER BY CASE WHEN size IS NOT DISTINCT FROM oi.size THEN 0 ELSE 1 END
      LIMIT 1
    ) pv ON true
    WHERE oi.order_id = ${order.id}
  `);
  type RawItemRow = typeof orderItemsTable.$inferSelect & {
    catalogue_product_name: string | null;
    product_sku: string | null;
    resolved_supplier_price: string | null;
    price_breaks: { qty: number; price: number }[] | null;
    p_is_service: boolean | null;
  };
  const itemRows = (itemRowsRaw.rows as RawItemRow[]).map(r => ({
    item: r as typeof orderItemsTable.$inferSelect,
    catalogueProductName: r.catalogue_product_name,
    productSku: r.product_sku,
    supplierPrice: r.resolved_supplier_price,
    priceBreaks: (r.price_breaks as { qty: number; price: number }[] | null) ?? null,
    isService: r.p_is_service ?? false,
  }));

  // Sum total quantity per product across all lines — price break tier is per-product total, not per-size
  const totalQtyByProductId = new Map<number, number>();
  for (const r of itemRows) {
    const pid = (r.item as any).product_id as number | null;
    if (pid != null) {
      totalQtyByProductId.set(pid, (totalQtyByProductId.get(pid) ?? 0) + ((r.item as any).quantity ?? 1));
    }
  }

  // ── PO numbers (+ status) per order item (direct link + consolidated source_order_item_ids) ─
  const orderItemIds = itemRows.map(r => r.item.id);
  const poByItemId = new Map<number, string[]>();
  const poInfoByItemId = new Map<number, Array<{ poNumber: string; status: string; poId: number }>>();
  if (orderItemIds.length > 0) {
    const idsStr = orderItemIds.join(",");
    const poRows = await db.execute(sql`
      SELECT oi_id, po_number, po_status, po_id FROM (
        SELECT poi.order_item_id AS oi_id, po.po_number, po.status AS po_status, po.id AS po_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id
        WHERE poi.order_item_id IN (${sql.raw(idsStr)})
          AND po.status != 'cancelled'
        UNION
        SELECT elem::int AS oi_id, po.po_number, po.status AS po_status, po.id AS po_id
        FROM purchase_order_items poi
        JOIN purchase_orders po ON po.id = poi.po_id,
        jsonb_array_elements_text(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) AS elem
        WHERE jsonb_array_length(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) > 0
          AND po.status != 'cancelled'
          AND elem::int IN (${sql.raw(idsStr)})
      ) t
    `);
    for (const row of poRows.rows as Array<{ oi_id: number; po_number: string; po_status: string; po_id: number }>) {
      const id = Number(row.oi_id);
      const existing = poByItemId.get(id) ?? [];
      existing.push(row.po_number);
      poByItemId.set(id, existing);
      const existingInfo = poInfoByItemId.get(id) ?? [];
      existingInfo.push({ poNumber: row.po_number, status: row.po_status, poId: Number(row.po_id) });
      poInfoByItemId.set(id, existingInfo);
    }
  }

  // ── Process stock cost per finish ID ──────────────────────────────────────
  const finishIds = [...new Set(itemRows.map(r => (r.item as any).finish_id as number | null).filter((id): id is number => id != null))];
  const processCostByFinishId = new Map<number, number>();
  if (finishIds.length > 0) {
    const costRows = await db.execute(sql`
      SELECT cfp.finish_id, COALESCE(SUM(ps.unit_cost), 0)::float AS process_cost
      FROM customer_finish_processes cfp
      JOIN customer_processes cp ON cp.id = cfp.process_id
      JOIN process_stock ps ON ps.id = cp.process_stock_id
      WHERE cfp.finish_id IN (${sql.raw(finishIds.join(","))})
      GROUP BY cfp.finish_id
    `);
    for (const row of costRows.rows as Array<{ finish_id: number; process_cost: number }>) {
      processCostByFinishId.set(row.finish_id, row.process_cost);
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  let deliveryAddress: Record<string, unknown> | null = null;
  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }

  // Fallback: include customer's main address if no delivery address is linked
  let customerMainAddress: { line1: string; city: string | null; postcode: string | null } | null = null;
  let customerEmail: string | null = null;
  if (order.customerId) {
    const [cust] = await db.select({ address: customersTable.address, city: customersTable.city, postcode: customersTable.postcode, email: customersTable.email })
      .from(customersTable).where(eq(customersTable.id, order.customerId));
    if (!deliveryAddress && cust?.address) {
      customerMainAddress = { line1: cust.address, city: cust.city ?? null, postcode: cust.postcode ?? null };
    }
    // Use customer main email; if missing fall back to portal manager/dept_manager emails
    if (cust?.email) {
      customerEmail = cust.email;
    } else {
      const managerRows = await db.execute(sql`
        SELECT email FROM customer_portal_users
        WHERE customer_id = ${order.customerId}
          AND portal_role IN ('manager', 'dept_manager')
          AND email IS NOT NULL
        ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
      `);
      const emails = (managerRows.rows as Array<{ email: string }>).map(r => r.email).filter(Boolean);
      if (emails.length > 0) customerEmail = emails.join(", ");
    }
  }

  // Compute per-address groupings when employees have different delivery addresses
  let addressGroups: Array<{ address: Record<string, unknown>; itemIds: number[] }> = [];
  {
    const itemEmpRows = (await db.execute(sql`
      SELECT oi.id, e.delivery_address_id AS emp_addr_id
      FROM order_items oi
      LEFT JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id}
    `)).rows as Array<{ id: number; emp_addr_id: number | null }>;

    const effectiveAddrMap = new Map<number, number[]>();
    for (const r of itemEmpRows) {
      const effId = r.emp_addr_id ?? order.deliveryAddressId ?? -1;
      if (!effectiveAddrMap.has(effId)) effectiveAddrMap.set(effId, []);
      effectiveAddrMap.get(effId)!.push(r.id);
    }
    if (effectiveAddrMap.size > 1) {
      const addrIds = [...effectiveAddrMap.keys()].filter(id => id > 0);
      if (addrIds.length > 0) {
        const addrs = await db.select().from(customerDeliveryAddressesTable)
          .where(inArray(customerDeliveryAddressesTable.id, addrIds));
        const addrMap = new Map(addrs.map(a => [a.id, a as Record<string, unknown>]));
        for (const [effId, itemIds] of effectiveAddrMap) {
          const addr = addrMap.get(effId);
          if (addr) addressGroups.push({ address: addr, itemIds });
        }
      }
    } else if (effectiveAddrMap.size === 1) {
      // Single effective address — if it's an employee address, override the order-level one
      const [singleEffId] = [...effectiveAddrMap.keys()];
      if (singleEffId > 0 && singleEffId !== (order.deliveryAddressId ?? -1)) {
        const [empAddr] = await db.select().from(customerDeliveryAddressesTable)
          .where(eq(customerDeliveryAddressesTable.id, singleEffId));
        if (empAddr) deliveryAddress = empAddr as Record<string, unknown>;
      }
    }
  }

  res.json({
    ...order,
    totalAmount: numericToFloat(order.totalAmount),
    deliveryAddress,
    customerEmail,
    customerMainAddress,
    addressGroups,
    items: itemRows.map(({ item, catalogueProductName, productSku, supplierPrice, priceBreaks, isService: itemIsService }) => {
      const raw = item as any;
      const qty = raw.quantity ?? 1;
      const finishId: number | null = raw.finish_id ?? null;
      // Cost is always the supplier price (variant level preferred, falls back to product level).
      // price_breaks stores SELL price tiers — never use them as cost.
      const effectiveUnitCost: number | null = supplierPrice != null ? parseFloat(String(supplierPrice)) : null;
      const garmentCost = effectiveUnitCost != null ? effectiveUnitCost * qty : null;
      const processCostPerItem = finishId != null ? (processCostByFinishId.get(finishId) ?? 0) : 0;
      const processCost = processCostPerItem * qty;
      return {
        ...item,
        id: raw.id,
        orderId: raw.order_id,
        productId: raw.product_id,
        productName: catalogueProductName ?? raw.product_name,
        productSku: productSku ?? null,
        finishId: raw.finish_id ?? null,
        finishName: raw.finish_name ?? null,
        colour: raw.colour ?? null,
        size: raw.size ?? null,
        quantity: qty,
        recipientType: raw.recipient_type ?? null,
        recipientName: raw.recipient_name ?? null,
        notes: raw.notes ?? null,
        unitPrice: numericToFloat(raw.unit_price),
        lineTotal: numericToFloat(raw.line_total),
        vatRate: parseFloat(String(raw.vat_rate ?? 0.20)),
        purchaseRequired: raw.purchase_required ?? false,
        purchaseQuantity: raw.purchase_quantity ?? null,
        supplierId: raw.supplier_id ?? null,
        supplierName: raw.supplier_name ?? null,
        isService: itemIsService ?? false,
        garmentCost,
        processCost,
        poNumbers: poByItemId.get(raw.id) ?? [],
        poInfo: poInfoByItemId.get(raw.id) ?? [],
      };
    }),
  });
});

// Local extension: adds 'part_shipped' which the generated schema omits
// (part_shipped is set internally by the dispatch flow but also needs to be
// settable directly when correcting a premature full-dispatch).
const UpdateOrderBodyExtended = UpdateOrderBody.extend({
  status: z.enum(["draft", "confirmed", "shipped", "delivered", "cancelled", "part_shipped"]).optional(),
});

router.patch("/orders/:id", async (req, res): Promise<void> => {
  const params = UpdateOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderBodyExtended.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };

  if (parsed.data.customerId) {
    const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, parsed.data.customerId));
    if (customer) {
      updateData.customerName = customer.name;
    }
  }

  if (parsed.data.orderDate) {
    updateData.orderDate = new Date(parsed.data.orderDate);
  }
  if (req.body.requiredDate !== undefined) {
    updateData.requiredDate = req.body.requiredDate ? new Date(req.body.requiredDate) : null;
  }
  if (req.body.shippingMethod !== undefined) {
    updateData.shippingMethod = req.body.shippingMethod ?? null;
  }
  if (req.body.carriageAmount !== undefined && req.body.carriageAmount !== null) {
    const v = parseFloat(req.body.carriageAmount);
    if (!isNaN(v) && v >= 0) updateData.carriageAmount = v.toFixed(2);
  }
  if (req.body.deliveryAddressId !== undefined) {
    updateData.deliveryAddressId = req.body.deliveryAddressId ?? null;
  }
  if (req.body.invoiceAddressId !== undefined) {
    updateData.invoiceAddressId = req.body.invoiceAddressId ?? null;
  }

  const [order] = await db
    .update(ordersTable)
    .set(updateData)
    .where(eq(ordersTable.id, params.data.id))
    .returning();
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  // ── Re-generate Stripe payment link when carriage changes ─────────────────
  // The link amount is (totalAmount + carriageAmount) × 1.2, so it goes stale
  // whenever shipping is added/changed after the link was first created.
  if (req.body.carriageAmount !== undefined && order.stripePaymentLinkId) {
    try {
      const stripe = await getUncachableStripeClient();
      await stripe.paymentLinks.update(order.stripePaymentLinkId, { active: false });
      const tAmt = parseFloat(String(order.totalAmount ?? 0));
      const cAmt = parseFloat(String(order.carriageAmount ?? 0));
      const newPrice = await stripe.prices.create({
        unit_amount: Math.round((tAmt + cAmt) * 100 * 1.2),
        currency: "gbp",
        product_data: { name: `Order ${order.orderNumber} — Select Branding Solutions Ltd` },
      });
      const newLink = await stripe.paymentLinks.create({
        line_items: [{ price: newPrice.id, quantity: 1 }],
        metadata: { order_id: String(order.id), order_number: order.orderNumber },
        after_completion: {
          type: "hosted_confirmation",
          hosted_confirmation: { custom_message: `Payment received for order ${order.orderNumber}. Thank you — Select Branding Solutions Ltd` },
        },
      });
      await db.update(ordersTable)
        .set({ stripePaymentLinkUrl: newLink.url, stripePaymentLinkId: newLink.id })
        .where(eq(ordersTable.id, order.id));
    } catch {
      // Non-fatal — Stripe may not be configured; carry on
    }
  }

  // ── Stock allocation on confirmation ──────────────────────────────────────
  if (parsed.data.status === "confirmed") {
    // Block confirmation if any finish on this order has no processes assigned
    const emptyFinishRows = await db.execute(sql`
      SELECT DISTINCT cf.name
      FROM order_items oi
      JOIN customer_finishes cf ON cf.id = oi.finish_id
      WHERE oi.order_id = ${params.data.id}
        AND NOT EXISTS (
          SELECT 1 FROM customer_finish_processes cfp WHERE cfp.finish_id = cf.id
        )
    `);
    const emptyFinishNames = (emptyFinishRows.rows as Array<{ name: string }>).map(r => r.name);
    if (emptyFinishNames.length > 0) {
      res.status(400).json({
        error: `Cannot confirm: the following finish${emptyFinishNames.length > 1 ? 'es have' : ' has'} no processes assigned — ${emptyFinishNames.join(", ")}. Go to the customer's Finishes tab and add processes before confirming.`,
      });
      return;
    }

    const items = await db
      .select({
        id: orderItemsTable.id,
        productId: orderItemsTable.productId,
        productName: orderItemsTable.productName,
        colour: orderItemsTable.colour,
        size: orderItemsTable.size,
        quantity: orderItemsTable.quantity,
        unitPrice: orderItemsTable.unitPrice,
        lineTotal: orderItemsTable.lineTotal,
        recipientName: orderItemsTable.recipientName,
        finishId: orderItemsTable.finishId,
      })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, params.data.id));

    const productIds = [...new Set(items.map(i => i.productId).filter(Boolean))] as number[];

    let allocatedLines = 0;
    let purchaseLines = 0;
    let serviceItemCount = 0;
    const allocatedItemIds: number[] = [];
    const shortfallDetails: Array<{
      id: number; productName: string; colour: string | null; size: string | null;
      purchaseQuantity: number; supplierId: number | null; supplierName: string | null; supplierEmail: string | null;
    }> = [];

    // Items with no product link have no stock to allocate — they go straight to production
    const noProductItemIds: number[] = [];
    for (const item of items) {
      if (!item.productId) {
        allocatedItemIds.push(item.id);
        noProductItemIds.push(item.id);
      }
    }
    if (noProductItemIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null, stockStatus: "allocated", stockAllocatedAt: new Date() })
        .where(inArray(orderItemsTable.id, noProductItemIds));
    }

    if (productIds.length > 0) {
      // Fetch supplier info keyed by product id
      const productInfoRows = await db
        .select({
          id: productsTable.id,
          supplierId: productsTable.supplierId,
          supplierName: suppliersTable.name,
          supplierEmail: suppliersTable.email,
          isService: productsTable.isService,
        })
        .from(productsTable)
        .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
        .where(inArray(productsTable.id, productIds));
      const supplierMap = new Map(productInfoRows.map(p => [p.id, p]));

      // Fetch variant-level stock for all relevant products.
      // For plain products (no variants), fall back to product.stock_quantity.
      // Order items store size as either a plain value ("17.0") or, for split products
      // like shirts, a combined "size/sleeve" string ("17.0/Short Sleeve") — while the
      // variant keeps size and sleeve in separate columns. Build the lookup key using the
      // same combined format so both shapes match correctly (instead of only ever matching
      // plain-size products and silently treating split products as having zero stock).
      const combinedSize = (size: string | null, sleeve: string | null) =>
        sleeve ? `${size ?? ""}/${sleeve}` : (size ?? "");

      const variantStockRows = await db.execute(sql`
        SELECT pv.product_id, pv.colour, pv.size, pv.sleeve, pv.stock_quantity
        FROM product_variants pv
        WHERE pv.product_id IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})
      `);

      // Fetch variant-level supplier overrides so colour-specific suppliers are respected
      const variantSupplierAlias = alias(suppliersTable, "vs");
      const variantSupplierRows = await db
        .select({
          productId: productVariantsTable.productId,
          colour: productVariantsTable.colour,
          size: productVariantsTable.size,
          sleeve: productVariantsTable.sleeve,
          supplierId: productVariantsTable.primarySupplierId,
          supplierName: variantSupplierAlias.name,
          supplierEmail: variantSupplierAlias.email,
        })
        .from(productVariantsTable)
        .innerJoin(variantSupplierAlias, eq(productVariantsTable.primarySupplierId, variantSupplierAlias.id))
        .where(inArray(productVariantsTable.productId, productIds));
      // Key: "productId|colour|size" — colour/size normalised to lower-case for matching.
      // Size uses the combined "size/sleeve" form so split products key the same way order
      // items store them.
      const variantSupplierMap = new Map(
        variantSupplierRows.map(r => [
          `${r.productId}|${(r.colour ?? "").toLowerCase()}|${combinedSize(r.size, r.sleeve).toLowerCase()}`,
          { supplierId: r.supplierId!, supplierName: r.supplierName, supplierEmail: r.supplierEmail },
        ])
      );
      // Some products don't split stock/supplier by size at all — they have a single
      // variant per colour with size/sleeve left blank (e.g. "Charcoal" covering all sizes).
      // Order items for those products still record a real size ("Large", "Medium", ...),
      // so the exact-key lookup above never matches and the variant supplier was silently
      // ignored in favour of the product-level default. Add a colour-only fallback keyed off
      // those blank-size variants (only when the colour has no other size-specific variant
      // rows, so this stays unambiguous) for the size-specific lookup to fall back to.
      const variantSupplierColourMap = new Map(
        variantSupplierRows
          .filter(r => !r.size && !r.sleeve)
          .map(r => [
            `${r.productId}|${(r.colour ?? "").toLowerCase()}`,
            { supplierId: r.supplierId!, supplierName: r.supplierName, supplierEmail: r.supplierEmail },
          ])
      );
      const plainStockRows = await db.execute(sql`
        SELECT p.id AS product_id, NULL::text AS colour, NULL::text AS size, p.stock_quantity
        FROM products p
        WHERE p.id IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})
          AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id)
      `);

      // Build mutable stock pool keyed by "productId|colour|size" (combined size/sleeve form).
      // Also track the raw pv.size/pv.sleeve pieces per key so the later persistence step
      // can write back to the correct variant columns instead of re-splitting the combined key.
      const vKey = (pid: number, c: string | null, s: string | null) => `${pid}|${c ?? ""}|${s ?? ""}`;
      const remainingStock = new Map<string, number>();
      const variantKeyParts = new Map<string, { colour: string | null; size: string | null; sleeve: string | null }>();
      for (const r of variantStockRows.rows as Array<{ product_id: number; colour: string | null; size: string | null; sleeve: string | null; stock_quantity: number | null }>) {
        const k = vKey(r.product_id, r.colour, combinedSize(r.size, r.sleeve));
        remainingStock.set(k, Number(r.stock_quantity) || 0);
        variantKeyParts.set(k, { colour: r.colour, size: r.size, sleeve: r.sleeve });
      }
      for (const r of plainStockRows.rows as Array<{ product_id: number; colour: string | null; size: string | null; stock_quantity: number | null }>) {
        const k = vKey(r.product_id, r.colour, r.size);
        remainingStock.set(k, Number(r.stock_quantity) || 0);
        variantKeyParts.set(k, { colour: r.colour, size: r.size, sleeve: null });
      }

      for (const item of items) {
        if (!item.productId) continue;
        const sup = supplierMap.get(item.productId);

        // Service products need no purchasing — treat as fully allocated
        if (sup?.isService) {
          allocatedLines++;
          serviceItemCount++;
          allocatedItemIds.push(item.id);
          await db.update(orderItemsTable)
            .set({ purchaseRequired: false, purchaseQuantity: null, stockStatus: "allocated", stockAllocatedAt: new Date() })
            .where(eq(orderItemsTable.id, item.id));
          continue;
        }

        // Look up stock for this exact colour+size variant first; fall back to plain product key
        const k = vKey(item.productId, item.colour ?? null, item.size ?? null);
        const plainK = vKey(item.productId, null, null);
        const available = remainingStock.has(k) ? (remainingStock.get(k) ?? 0)
                        : (remainingStock.get(plainK) ?? 0);
        const activeKey = remainingStock.has(k) ? k : plainK;

        const qty = item.quantity ?? 0;
        const allocatedQty = Math.min(available, qty);
        const shortfall = qty - allocatedQty;

        remainingStock.set(activeKey, available - allocatedQty);

        // Prefer colour+size-specific variant supplier; fall back to a colour-only variant
        // supplier (products with a single blank-size variant per colour), then finally to
        // the product-level supplier.
        const varSupKey = `${item.productId}|${(item.colour ?? "").toLowerCase()}|${(item.size ?? "").toLowerCase()}`;
        const varSupColourKey = `${item.productId}|${(item.colour ?? "").toLowerCase()}`;
        const varSup = variantSupplierMap.get(varSupKey) ?? variantSupplierColourMap.get(varSupColourKey);
        const resolvedSupplierId = varSup?.supplierId ?? sup?.supplierId ?? null;
        const resolvedSupplierName = varSup?.supplierName ?? sup?.supplierName ?? null;
        const resolvedSupplierEmail = varSup?.supplierEmail ?? sup?.supplierEmail ?? null;

        // Items with shortfall=0 and no finish go straight to the picking list.
        // Items with a finish still go through the worksheet → in_production → complete
        // production flow, so leave their stockStatus null for the worksheet to manage.
        const itemStockStatus = shortfall > 0 ? null : (!item.finishId ? "allocated" : null);
        await db.update(orderItemsTable).set({
          purchaseRequired: shortfall > 0,
          purchaseQuantity: shortfall > 0 ? shortfall : null,
          supplierId: shortfall > 0 ? resolvedSupplierId : null,
          supplierName: shortfall > 0 ? resolvedSupplierName : null,
          ...(itemStockStatus ? { stockStatus: itemStockStatus, stockAllocatedAt: new Date() } : {}),
        }).where(eq(orderItemsTable.id, item.id));

        if (shortfall > 0) {
          purchaseLines++;
          shortfallDetails.push({
            id: item.id, productName: item.productName, colour: item.colour ?? null,
            size: item.size ?? null, purchaseQuantity: shortfall,
            supplierId: resolvedSupplierId, supplierName: resolvedSupplierName, supplierEmail: resolvedSupplierEmail,
          });
        } else {
          allocatedLines++;
          allocatedItemIds.push(item.id);
        }
      }

      // Persist deductions: update variant stock (+ rollup) or plain product stock.
      // Use the tracked raw size/sleeve pieces (not a re-split of the combined key) so
      // split-format products (e.g. shirts) write back to the correct variant row.
      for (const [key, remaining] of remainingStock.entries()) {
        const [pidStr] = key.split("|");
        const productId = parseInt(pidStr, 10);
        const parts = variantKeyParts.get(key);
        const colourVal = parts?.colour ?? null;
        const sizeVal = parts?.size ?? null;
        const sleeveVal = parts?.sleeve ?? null;

        if (colourVal !== null || sizeVal !== null) {
          // Variant row — update directly then roll up to product
          await db.execute(sql`
            UPDATE product_variants
            SET stock_quantity = ${remaining}
            WHERE product_id = ${productId}
              AND (colour IS NOT DISTINCT FROM ${colourVal})
              AND (size   IS NOT DISTINCT FROM ${sizeVal})
              AND (sleeve IS NOT DISTINCT FROM ${sleeveVal})
          `);
          await db.execute(sql`
            UPDATE products
            SET stock_quantity = (
              SELECT COALESCE(SUM(stock_quantity), 0)
              FROM product_variants WHERE product_id = ${productId}
            )
            WHERE id = ${productId}
          `);
        } else {
          // Plain product
          await db.execute(sql`
            UPDATE products SET stock_quantity = ${remaining} WHERE id = ${productId}
          `);
        }
      }
    }

    // ── Process stock shortfall calculation ───────────────────────────────────
    // For each order item that has a finish, walk: finish → processes → processStockId
    // and check whether enough consumable stock (e.g. DTF sheets) is available.
    const processShortfallMap = new Map<number, {
      processStockId: number; name: string; sku: string | null;
      shortfall: number; supplierId: number | null; supplierName: string | null;
    }>();

    const finishIds = [...new Set(items.map(i => i.finishId).filter(Boolean))] as number[];
    if (finishIds.length > 0) {
      const finishProcessLinks = await db
        .select({ finishId: customerFinishProcessesTable.finishId, processId: customerFinishProcessesTable.processId })
        .from(customerFinishProcessesTable)
        .where(inArray(customerFinishProcessesTable.finishId, finishIds));

      const processIds = [...new Set(finishProcessLinks.map(fp => fp.processId))];
      if (processIds.length > 0) {
        const processes = await db
          .select({ id: customerProcessesTable.id, processStockId: customerProcessesTable.processStockId })
          .from(customerProcessesTable)
          .where(inArray(customerProcessesTable.id, processIds));

        const psIds = [...new Set(processes.map(p => p.processStockId).filter(Boolean))] as number[];
        if (psIds.length > 0) {
          const psRows = await db
            .select({
              id: processStockTable.id, name: processStockTable.name, sku: processStockTable.sku,
              stockQuantity: processStockTable.stockQuantity,
              supplierId: processStockTable.supplierId, supplierName: suppliersTable.name,
            })
            .from(processStockTable)
            .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
            .where(inArray(processStockTable.id, psIds));

          const psMap = new Map(psRows.map(ps => [ps.id, ps]));
          const remainingPs = new Map(psRows.map(ps => [ps.id, ps.stockQuantity ?? 0]));
          const processToPs = new Map(processes.filter(p => p.processStockId).map(p => [p.id, p.processStockId!]));
          const finishToProcesses = new Map<number, number[]>();
          for (const fp of finishProcessLinks) {
            if (!finishToProcesses.has(fp.finishId)) finishToProcesses.set(fp.finishId, []);
            finishToProcesses.get(fp.finishId)!.push(fp.processId);
          }

          for (const item of items) {
            if (!item.finishId) continue;
            const qty = item.quantity ?? 0;
            for (const pid of (finishToProcesses.get(item.finishId) ?? [])) {
              const psId = processToPs.get(pid);
              if (!psId) continue;
              const available = remainingPs.get(psId) ?? 0;
              const used = Math.min(available, qty);
              const shortfall = qty - used;
              remainingPs.set(psId, available - used);
              if (shortfall > 0) {
                const existing = processShortfallMap.get(psId);
                processShortfallMap.set(psId, {
                  processStockId: psId,
                  name: psMap.get(psId)?.name ?? "Unknown",
                  sku: psMap.get(psId)?.sku ?? null,
                  shortfall: (existing?.shortfall ?? 0) + shortfall,
                  supplierId: psMap.get(psId)?.supplierId ?? null,
                  supplierName: psMap.get(psId)?.supplierName ?? null,
                });
              }
            }
          }

          // Deduct used process stock
          for (const [psId, remaining] of remainingPs.entries()) {
            const original = psMap.get(psId);
            if (!original) continue;
            if ((original.stockQuantity ?? 0) - remaining > 0) {
              await db.update(processStockTable).set({ stockQuantity: remaining }).where(eq(processStockTable.id, psId));
            }
          }
        }
      }
    }

    // Group process shortfalls by supplier
    const psGroupMap = new Map<string, { supplierName: string; supplierId: number | null; items: Array<{ name: string; sku: string | null; shortfall: number }> }>();
    for (const s of processShortfallMap.values()) {
      const key = s.supplierName ?? "Unknown Supplier";
      if (!psGroupMap.has(key)) psGroupMap.set(key, { supplierName: key, supplierId: s.supplierId, items: [] });
      psGroupMap.get(key)!.items.push({ name: s.name, sku: s.sku, shortfall: s.shortfall });
    }
    const processShortfallGroups = [...psGroupMap.values()];
    // ─────────────────────────────────────────────────────────────────────────

    // Build shortfall groups with existing draft POs per supplier
    const supplierIds = [...new Set(shortfallDetails.map(i => i.supplierId).filter(Boolean))] as number[];
    const draftPos = supplierIds.length > 0
      ? await db.select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber, supplierId: purchaseOrdersTable.supplierId })
          .from(purchaseOrdersTable)
          .where(inArray(purchaseOrdersTable.supplierId, supplierIds))
          .then(rows => rows.filter(r => r.supplierId !== null))
      : [];
    // Also include draft POs with no supplierId match (items with unknown supplier)
    const draftPosNoSupplier = shortfallDetails.some(i => !i.supplierId)
      ? await db.select({ id: purchaseOrdersTable.id, poNumber: purchaseOrdersTable.poNumber, supplierId: purchaseOrdersTable.supplierId })
          .from(purchaseOrdersTable)
          .where(eq(purchaseOrdersTable.status, "draft"))
          .then(rows => rows.filter(r => !r.supplierId))
      : [];
    const allDraftPos = [...draftPos, ...draftPosNoSupplier];

    const groupMap = new Map<string, typeof shortfallDetails[0] & { itemIds: number[]; items: typeof shortfallDetails; existingDraftPos: Array<{id:number;poNumber:string}> }>();
    for (const s of shortfallDetails) {
      const key = s.supplierName ?? "Unknown Supplier";
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          ...s,
          supplierName: key, // use the resolved key so supplierName is never null
          itemIds: [], items: [],
          existingDraftPos: allDraftPos.filter(p => p.supplierId === s.supplierId).map(p => ({ id: p.id, poNumber: p.poNumber })),
        });
      }
      const g = groupMap.get(key)!;
      g.itemIds.push(s.id);
      g.items.push(s);
    }
    const shortfallGroups = [...groupMap.values()];

    // ── Auto-create production worksheet ──────────────────────────────────────
    // If there are items ready for production (no purchase required), auto-create
    // a worksheet so the order flows into production automatically on confirmation.
    if (allocatedItemIds.length > 0) {
      const existingWs = await db
        .select({ id: worksheetsTable.id })
        .from(worksheetsTable)
        .where(eq(worksheetsTable.orderId, params.data.id))
        .limit(1);

      if (existingWs.length === 0) {
        // Generate next worksheet number
        const wsRows = await db.execute(sql`
          SELECT worksheet_number FROM worksheets
          WHERE worksheet_number ~ '^F[0-9]+$'
          ORDER BY LENGTH(worksheet_number) DESC, worksheet_number DESC
          LIMIT 1
        `);
        const lastWsNum = (wsRows.rows[0] as any)?.worksheet_number as string | undefined;
        const worksheetNumber = `F${(lastWsNum ? parseInt(lastWsNum.slice(1), 10) : 99) + 1}`;

        const [ws] = await db
          .insert(worksheetsTable)
          .values({
            worksheetNumber,
            status: "wip",
            orderId: params.data.id,
            orderNumber: order.orderNumber,
            customerId: order.customerId ?? null,
            customerName: order.customerName ?? null,
          })
          .returning();

        const wsOrderItemsRaw = await db
          .select()
          .from(orderItemsTable)
          .where(inArray(orderItemsTable.id, allocatedItemIds));

        // Exclude service items — they don't go through production
        const serviceProductIdSet = new Set<number>();
        const linkedProductIds = wsOrderItemsRaw.map(i => i.productId).filter((id): id is number => id != null);
        if (linkedProductIds.length > 0) {
          const serviceRows = await db
            .select({ id: productsTable.id })
            .from(productsTable)
            .where(and(eq(productsTable.isService, true), inArray(productsTable.id, linkedProductIds)));
          serviceRows.forEach(r => serviceProductIdSet.add(r.id));
        }
        const wsOrderItems = wsOrderItemsRaw.filter(oi => !oi.productId || !serviceProductIdSet.has(oi.productId));

        // Nothing left to produce — remove the worksheet and skip
        if (wsOrderItems.length === 0) {
          await db.delete(worksheetsTable).where(eq(worksheetsTable.id, ws.id));
        } else await Promise.all(
          wsOrderItems.map(async (oi) => {
            let processesSnapshot: string | null = null;
            if (oi.finishId && order.customerId) {
              const finishProcessLinks = await db
                .select()
                .from(customerFinishProcessesTable)
                .where(eq(customerFinishProcessesTable.finishId, oi.finishId));
              const processIds = finishProcessLinks.map((fp) => fp.processId);
              if (processIds.length > 0) {
                const processes = await db
                  .select()
                  .from(customerProcessesTable)
                  .where(inArray(customerProcessesTable.id, processIds));
                processesSnapshot = JSON.stringify(
                  processes.map((p) => ({ id: p.id, name: p.name, type: p.type, placement: p.placement, price: p.price ? parseFloat(p.price as any) : null, notes: p.notes }))
                );
              }
            }
            return db.insert(worksheetItemsTable).values({
              worksheetId: ws.id,
              orderItemId: oi.id,
              productName: oi.productName,
              colour: oi.colour ?? null,
              size: oi.size ?? null,
              quantity: oi.quantity ?? 1,
              recipientType: oi.recipientType ?? "stock",
              recipientName: oi.recipientName ?? null,
              finishId: oi.finishId ?? null,
              finishName: oi.finishName ?? null,
              processesSnapshot,
            });
          })
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    // ── Service-only order: skip purchasing & production, go straight to dispatch
    // If every item with a product link is a service product (no purchasing, no
    // worksheet), leave the order at 'confirmed' — service items are always
    // "ready" (see dispatch.ts readiness logic), so it will immediately appear
    // in the Dispatch queue where a delivery note can be produced before the
    // order is marked shipped. (Previously this auto-promoted straight to
    // 'shipped', which skipped the dispatch screen and its delivery note.)
    const linkedItemCount = items.filter(i => i.productId != null).length;
    if (linkedItemCount > 0 && serviceItemCount === linkedItemCount && purchaseLines === 0) {
      await logOrderAction(params.data.id, "Ready for dispatch", getActor(req),
        "All items are service products — skipped purchasing and production, sent straight to dispatch");
    }
    // ──────────────────────────────────────────────────────────────────────────

    const unlinkedItems = items.filter(i => !i.productId).length;

    // ── Stripe: charge most recently added saved card on confirmation ──────────
    let stripeCharge: { success: boolean; paymentIntentId?: string; cardLast4?: string; error?: string } | null = null;
    const orderTotal = parseFloat(String(order.totalAmount ?? 0));
    if (order.customerId && orderTotal > 0) {
      try {
        const [customerRow] = await db
          .select({ stripeCustomerId: customersTable.stripeCustomerId })
          .from(customersTable)
          .where(eq(customersTable.id, order.customerId));

        if (customerRow?.stripeCustomerId) {
          const stripe = await getUncachableStripeClient();
          // Stripe returns payment methods newest-first — take the first one
          const pms = await stripe.paymentMethods.list({
            customer: customerRow.stripeCustomerId,
            type: "card",
            limit: 1,
          });
          const pm = pms.data[0];
          if (pm) {
            const amountPence = Math.round(orderTotal * 100);
            const intent = await stripe.paymentIntents.create({
              amount: amountPence,
              currency: "gbp",
              customer: customerRow.stripeCustomerId,
              payment_method: pm.id,
              confirm: true,
              off_session: true,
              description: `Order ${order.orderNumber} — Select Branding Solutions`,
            });
            stripeCharge = {
              success: true,
              paymentIntentId: intent.id,
              cardLast4: pm.card?.last4,
            };
            await logOrderAction(order.id, "Payment taken", getActor(req),
              `Charged £${orderTotal.toFixed(2)} to card ending ${pm.card?.last4} (${intent.id})`);
          }
        }
      } catch (err: any) {
        stripeCharge = { success: false, error: err.message };
        await logOrderAction(order.id, "Payment failed", getActor(req),
          `Stripe charge failed: ${err.message}`);
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    await logOrderAction(order.id, "Order confirmed", getActor(req),
      `Allocated ${allocatedLines} line(s); ${purchaseLines} line(s) raised to PO; ${unlinkedItems} unlinked line(s)`);

    res.json({
      ...order, totalAmount: numericToFloat(order.totalAmount),
      allocation: { allocated: allocatedLines, purchaseRequired: purchaseLines },
      shortfallGroups,
      processShortfallGroups,
      unlinkedItems,
      emailConfigured: isEmailConfigured,
      stripeCharge,
    });
    return;
  }
  // ── Purchase-flag cleanup when reverting to draft ─────────────────────────
  // If the order is being set back to draft (from confirmed or any active state),
  // clear purchase_required/purchase_quantity on all items and restore any stock
  // that was deducted during the prior confirmation.
  if (parsed.data.status === "draft") {
    const itemRows = await db.execute(sql`
      SELECT id, product_id, quantity, purchase_required, purchase_quantity
      FROM order_items WHERE order_id = ${params.data.id} AND product_id IS NOT NULL
    `);
    const items = itemRows.rows as Array<{
      id: number; product_id: number; quantity: number;
      purchase_required: boolean | null; purchase_quantity: number | null;
    }>;

    // Restore stock that was deducted during confirmation
    const stockRestore = new Map<number, number>();
    for (const item of items) {
      const qty = Number(item.quantity ?? 0);
      const purchaseQty = Number(item.purchase_quantity ?? 0);
      // Stock decremented = quantity - purchase_quantity (items fulfilled from stock)
      const allocated = item.purchase_required ? qty - purchaseQty : qty;
      if (allocated > 0) {
        stockRestore.set(item.product_id, (stockRestore.get(item.product_id) ?? 0) + allocated);
      }
    }
    for (const [productId, restoreQty] of stockRestore.entries()) {
      await db.execute(sql`
        UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${restoreQty}
        WHERE id = ${productId}
      `);
    }

    // Clear all purchase and stock-allocation flags
    await db.execute(sql`
      UPDATE order_items
      SET purchase_required = false, purchase_quantity = NULL,
          supplier_id = NULL, supplier_name = NULL,
          stock_status = NULL, stock_allocated_at = NULL
      WHERE order_id = ${params.data.id}
    `);

    // Also delete any pre_wip worksheets that were auto-created on confirmation
    await db.execute(sql`
      DELETE FROM worksheet_items
      WHERE worksheet_id IN (
        SELECT id FROM worksheets WHERE order_id = ${params.data.id} AND status = 'pre_wip'
      )
    `);
    await db.execute(sql`
      DELETE FROM worksheets WHERE order_id = ${params.data.id} AND status = 'pre_wip'
    `);
  }

  // ── Worksheet cleanup on cancellation / archiving ─────────────────────────
  if (parsed.data.status === "cancelled" || parsed.data.status === "archived") {
    const linkedWorksheets = await db
      .select({ id: worksheetsTable.id, status: worksheetsTable.status })
      .from(worksheetsTable)
      .where(eq(worksheetsTable.orderId, order.id));

    const wsToDelete = linkedWorksheets
      .filter(ws => ws.status !== "complete")
      .map(ws => ws.id);

    if (wsToDelete.length > 0) {
      await db.delete(worksheetsTable).where(inArray(worksheetsTable.id, wsToDelete));
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  res.json({ ...order, totalAmount: numericToFloat(order.totalAmount) });
});

// ── Update order attachments ───────────────────────────────────────────────
router.patch("/orders/:id/attachments", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = z.object({
    attachments: z.array(z.object({ name: z.string(), objectPath: z.string() })),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db
    .update(ordersTable)
    .set({ attachments: parsed.data.attachments, updatedAt: new Date() })
    .where(eq(ordersTable.id, id))
    .returning({ id: ordersTable.id, attachments: ordersTable.attachments });
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  res.json(order);
});

router.delete("/orders/:id", async (req, res): Promise<void> => {
  const params = DeleteOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Fetch the order first so we know its status
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, order.id));
  const itemIds = items.map(i => i.id);

  // ── 1. Restore stock ────────────────────────────────────────────────────────
  // Stock is deducted at confirmation. Restore for any status that isn't
  // a pre-confirmation draft or a post-dispatch state (items have already left).
  const NO_STOCK_YET = ["draft", "portal_draft", "portal_pending"];
  const ALREADY_GONE = ["dispatched", "delivered"];
  const shouldRestoreStock = !NO_STOCK_YET.includes(order.status) && !ALREADY_GONE.includes(order.status);

  if (shouldRestoreStock) {
    for (const item of items) {
      if (!item.purchaseRequired && item.productId && item.quantity) {
        await db.execute(
          sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${item.quantity} WHERE id = ${item.productId}`
        );
      }
    }
  }

  // ── 2. Clean up purchase order items linked to this order ──────────────────
  // Delete PO items that reference this order, then remove any POs that are
  // now empty and haven't been sent to the supplier yet.
  if (itemIds.length > 0) {
    await db.delete(purchaseOrderItemsTable)
      .where(inArray(purchaseOrderItemsTable.orderItemId, itemIds));
  }
  // Also catch any PO items linked by orderId (in case orderItemId wasn't set)
  await db.delete(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.orderId, order.id));

  // Remove draft POs that are now empty
  const emptyDraftPoIds = await db
    .select({ id: purchaseOrdersTable.id })
    .from(purchaseOrdersTable)
    .where(and(eq(purchaseOrdersTable.status, "draft")))
    .then(async (pos) => {
      const ids: number[] = [];
      for (const po of pos) {
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(purchaseOrderItemsTable)
          .where(eq(purchaseOrderItemsTable.poId, po.id));
        if (count === 0) ids.push(po.id);
      }
      return ids;
    });
  if (emptyDraftPoIds.length > 0) {
    await db.delete(purchaseOrdersTable).where(inArray(purchaseOrdersTable.id, emptyDraftPoIds));
  }

  // ── 3. Clean up worksheets linked to this order ────────────────────────────
  // Remove worksheets that haven't been completed yet. Completed worksheets
  // represent work already done and are kept for records.
  const linkedWorksheets = await db
    .select({ id: worksheetsTable.id, status: worksheetsTable.status })
    .from(worksheetsTable)
    .where(eq(worksheetsTable.orderId, order.id));

  const worksheetIdsToDelete = linkedWorksheets
    .filter(ws => ws.status !== "complete")
    .map(ws => ws.id);

  if (worksheetIdsToDelete.length > 0) {
    // worksheet_items cascade-delete when worksheet is deleted
    await db.delete(worksheetsTable).where(inArray(worksheetsTable.id, worksheetIdsToDelete));
  }

  // ── 4. Delete the order (cascades to order_items, logs, email_logs) ─────────
  await logOrderAction(order.id, "Order deleted", getActor(req), `Order ${order.orderNumber} deleted (was ${order.status})`);
  await db.delete(ordersTable).where(eq(ordersTable.id, order.id));
  res.sendStatus(204);
});

// ─── Order Acknowledgement Email ──────────────────────────────────────────────
router.post("/orders/:id/send-acknowledgement", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
      stripePaymentLinkUrl: ordersTable.stripePaymentLinkUrl,
      shippingMethod: ordersTable.shippingMethod,
      carriageAmount: ordersTable.carriageAmount,
      portalSubmittedByName: ordersTable.portalSubmittedByName,
      portalSubmittedByEmail: ordersTable.portalSubmittedByEmail,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const itemRows2Raw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header,
      e.delivery_address_id AS emp_delivery_address_id
    FROM order_items oi
    LEFT JOIN products          p ON p.id = oi.product_id
    LEFT JOIN bundles           b ON b.id = oi.bundle_def_id
    LEFT JOIN customer_employees e ON e.id = oi.recipient_employee_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((itemRows2Raw.rows ?? itemRows2Raw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
    empDeliveryAddressId: r.emp_delivery_address_id ? Number(r.emp_delivery_address_id) : null,
  }));

  // Build per-address delivery groups for the PDF when employees have distinct delivery addresses
  type AckItem = {
    productName: string; sku: string | null; colour: string | null; size: string | null;
    quantity: number; unitPrice: number; lineTotal: number; vatRate: number;
    recipientName: string | null; finishName: string | null;
    bundleRef: string | null; isBundleHeader: boolean;
  };
  let ackDeliveryGroups: Array<{ addressLabel: string; addressText: string; items: AckItem[] }> | undefined;
  let empSingleDeliveryAddressText: string | null = null;
  const getEffAddrId = (item: typeof items[0]) =>
    item.empDeliveryAddressId ?? (order.deliveryAddressId ? order.deliveryAddressId : null);
  const uniqueAddrIds = [...new Set(items.map(i => getEffAddrId(i)))];
  if (uniqueAddrIds.length > 1 || (uniqueAddrIds.length === 1 && uniqueAddrIds[0] !== null)) {
    const addrIds = uniqueAddrIds.filter((id): id is number => id !== null);
    const addrRows = addrIds.length > 0
      ? await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, addrIds))
      : [];
    const addrMap = new Map(addrRows.map(a => [a.id, a]));
    if (uniqueAddrIds.length > 1) {
      const groupMap = new Map<string | null, AckItem[]>();
      for (const item of items) {
        const effId = getEffAddrId(item);
        const key = effId !== null ? String(effId) : "null";
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(item);
      }
      ackDeliveryGroups = [];
      for (const [key, gItems] of groupMap) {
        const addrId = key !== "null" ? Number(key) : null;
        const addr = addrId !== null ? addrMap.get(addrId) : null;
        const addressText = addr
          ? [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ")
          : (order.deliveryAddressId ? "Order delivery address" : "—");
        ackDeliveryGroups.push({
          addressLabel: addr?.label ?? "",
          addressText,
          items: gItems,
        });
      }
    } else {
      // Single effective address from employee — will override order-level address in PDF
      const singleId = uniqueAddrIds[0];
      const addr = singleId !== null ? addrMap.get(singleId) : null;
      if (addr) empSingleDeliveryAddressText = [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ");
    }
  }

  // Resolve customer email and address
  const body = z.object({ toEmail: z.string().optional(), previewOnly: z.boolean().optional() }).safeParse(req.body);
  let toEmail = body.success ? body.data.toEmail : undefined;
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;

  let customerLogoUrl: string | null = null;
  let customerLogoDataUrl: string | null = null;
  let customerLogoBuffer: Buffer | null = null;
  let sendAckZeroVat = false;

  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      logoUrl: customersTable.logoUrl,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    customerLogoUrl = customer?.logoUrl ?? null;
    sendAckZeroVat = customer?.zeroVat ?? false;

    if (!toEmail) {
      // For portal orders, prefer the email of the person who placed the order
      if (order.portalSubmittedByEmail) {
        toEmail = order.portalSubmittedByEmail;
      } else {
        // Fall back to manager/dept_manager portal users' emails (any status — we just want a valid contact)
        const managerRows = await db.execute(sql`
          SELECT email FROM customer_portal_users
          WHERE customer_id = ${order.customerId}
            AND portal_role IN ('manager', 'dept_manager')
            AND email IS NOT NULL
          ORDER BY portal_role = 'manager' DESC, status = 'active' DESC, id ASC
        `);
        const managerEmails = (managerRows.rows as Array<{ email: string }>)
          .map(r => r.email)
          .filter(Boolean);
        if (managerEmails.length > 0) {
          toEmail = managerEmails.join(", ");
        } else {
          toEmail = customer?.email ?? undefined;
        }
      }
    }
  }
  if (!toEmail) {
    if (body.success && body.data.previewOnly) {
      // Preview mode — no email yet, return preview with empty to so dialog can display it
      toEmail = "";
    } else {
      res.status(400).json({ error: "No customer email address found" }); return;
    }
  }

  // Read customer logo directly from storage (URL is a relative object-storage path, not a public URL)
  if (customerLogoUrl) {
    const logoResult = await readLogoForSending(customerLogoUrl);
    if (logoResult) {
      customerLogoBuffer = logoResult.buffer;
      customerLogoDataUrl = `data:${logoResult.contentType};base64,${logoResult.buffer.toString("base64")}`;
    }
  }

  // Resolve delivery address if linked
  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) {
      deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  // Generate a fresh Stripe payment link for the acknowledgement so it doesn't
  // share a link with the invoice (which would make it stale if the invoice is
  // resent). Errors here are non-fatal — email still sends without a payment link.
  let ackStripeLink: string | null = order.stripePaymentLinkUrl ?? null;
  if (!order.paidAt) {
    try {
      const stripeForAck = await getUncachableStripeClient();
      const totalAmt = numericToFloat(order.totalAmount);
      const carriageAmt = numericToFloat(order.carriageAmount);
      if (totalAmt > 0) {
        const amountPence = Math.round((totalAmt + carriageAmt) * 100 * 1.2);
        const ackPrice = await stripeForAck.prices.create({
          unit_amount: amountPence,
          currency: "gbp",
          product_data: { name: `Order ${order.orderNumber} — Select Branding Solutions Ltd` },
        });
        const ackLink = await stripeForAck.paymentLinks.create({
          line_items: [{ price: ackPrice.id, quantity: 1 }],
          metadata: { order_id: String(order.id), order_number: order.orderNumber },
          after_completion: {
            type: "hosted_confirmation",
            hosted_confirmation: {
              custom_message: `Payment received for order ${order.orderNumber}. Thank you — Select Branding Solutions Ltd`,
            },
          },
        });
        ackStripeLink = ackLink.url;
        // Store as the canonical link so the invoice can also see it
        await db.update(ordersTable)
          .set({ stripePaymentLinkUrl: ackLink.url, stripePaymentLinkId: ackLink.id })
          .where(eq(ordersTable.id, order.id));
      }
    } catch {
      // Stripe not configured or API error — continue without a payment link
    }
  }

  const { subject, html, text } = buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    customerLogoDataUrl,
    shippingMethod: order.shippingMethod ?? null,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: numericToFloat(order.totalAmount),
    carriageAmount: numericToFloat(order.carriageAmount),
    items: mappedItems,
    stripePaymentLink: ackStripeLink,
  });

  // Generate PDF attachment
  let attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: ackDeliveryGroups ? null : (empSingleDeliveryAddressText ?? deliveryAddressText),
      shippingMethod: order.shippingMethod ?? null,
      customerLogoBuffer,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      zeroVat: sendAckZeroVat,
      items: mappedItems,
      deliveryGroups: ackDeliveryGroups,
    });
    attachments = [{ filename: `Order-Acknowledgement-${order.orderNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" }];
  } catch (_err) {
    // PDF failure is non-fatal — email still sends without attachment
  }

  // Always return the PDF as base64 so the client can build a .eml file
  const pdfBase64 = attachments.length > 0 ? attachments[0].content.toString("base64") : null;
  const pdfFilename = attachments.length > 0 ? attachments[0].filename : null;

  const previewOnly = body.success ? (body.data.previewOnly ?? false) : false;
  const result = previewOnly
    ? { sent: false as const, error: null as string | null }
    : await sendEmail({ to: toEmail, subject, html, text, attachments });

  if (!previewOnly) {
    await logOrderAction(order.id, "Acknowledgement sent", getActor(req),
      result.sent ? `Email sent to ${toEmail}` : `Email not sent (${result.error ?? "unconfigured"}); VBS/EML download`);
    await db.insert(orderEmailLogsTable).values({
      orderId: order.id,
      emailType: "acknowledgement",
      toEmail,
      subject,
      sentBy: getActor(req),
      success: result.sent,
      error: result.sent ? null : (result.error ?? "not configured"),
    }).catch((err) => console.error("[orderEmailLog] Failed to log:", err));
  }

  // ── Portal promo email ─────────────────────────────────────────────────────
  // After a non-portal ack, if the customer has no portal users set up,
  // send a one-off intro email (max once every 120 days).
  if (!previewOnly && result.sent && order.customerId) {
    (async () => {
      try {
        // Is this a portal order?
        const sourceRow = await db.execute(sql`SELECT source FROM orders WHERE id = ${order.id} LIMIT 1`);
        const orderSource = (sourceRow.rows[0] as any)?.source ?? null;
        if (orderSource === "portal") return;

        // Does this customer already have any portal users?
        const portalUserRows = await db.execute(sql`
          SELECT id FROM customer_portal_users WHERE customer_id = ${order.customerId} LIMIT 1
        `);
        if (portalUserRows.rows.length > 0) return;

        // 120-day throttle — stored per customer in settings table
        const throttleKey = `portal_promo_sent_${order.customerId}`;
        const throttleRow = await db.execute(sql`
          SELECT value FROM settings WHERE key = ${throttleKey} LIMIT 1
        `);
        const lastSentStr = (throttleRow.rows[0] as any)?.value ?? null;
        const daysSinceLast = lastSentStr
          ? (Date.now() - new Date(lastSentStr).getTime()) / 86_400_000
          : Infinity;
        if (daysSinceLast < 120) return;

        // Build and send the promo email using the invite template
        const promoCtaUrl = `mailto:info@selectbranding.co.uk?subject=${encodeURIComponent(`Portal Access Enquiry — ${order.customerName ?? ""}`)}`;
        const { html: promoHtml, text: promoText } = buildInviteEmail(
          toEmail!,
          promoCtaUrl,
          order.customerName ?? "your business",
          customerLogoDataUrl,
        );
        const promoSubject = `${order.customerName ?? "Your business"} — manage your workwear online with the SBS portal`;
        const promoResult = await sendEmail({ to: toEmail!, subject: promoSubject, html: promoHtml, text: promoText });
        if (promoResult.sent) {
          await db.execute(sql`
            INSERT INTO settings (key, value)
            VALUES (${throttleKey}, ${new Date().toISOString()})
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `);
          console.log(`[portal-promo] Sent to customer ${order.customerId} (${toEmail})`);
        }
      } catch (err) {
        console.error("[portal-promo] Non-fatal error:", err);
      }
    })();
  }

  res.json({
    sent: result.sent,
    error: result.error,
    subject,
    html,
    text,
    to: toEmail,
    emailConfigured: isEmailConfigured,
    pdfBase64,
    pdfFilename,
    orderNumber: order.orderNumber,
    stripePaymentLinkUrl: order.stripePaymentLinkUrl ?? null,
  });
});

// ─── GET email send log for an order ─────────────────────────────────────────

router.get("/orders/:id/email-logs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const logs = await db
    .select()
    .from(orderEmailLogsTable)
    .where(eq(orderEmailLogsTable.orderId, params.data.id))
    .orderBy(desc(orderEmailLogsTable.sentAt));

  res.json(logs);
});

// ─── GET acknowledgement as PDF ──────────────────────────────────────────────

router.get("/orders/:id/acknowledgement-pdf", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
      shippingMethod: ordersTable.shippingMethod,
      carriageAmount: ordersTable.carriageAmount,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const itemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((itemRowsRaw.rows ?? itemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let customerLogoBuffer: Buffer | null = null;

  let customerZeroVat = false;
  if (order.customerId) {
    const [customer] = await db.select({
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      logoUrl: customersTable.logoUrl,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    customerZeroVat = customer?.zeroVat ?? false;
    if (customer?.logoUrl) {
      const logoResult = await readLogoForSending(customer.logoUrl);
      if (logoResult) customerLogoBuffer = logoResult.buffer;
    }
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  try {
    const pdf = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      shippingMethod: order.shippingMethod ?? null,
      customerLogoBuffer,
      totalAmount: items.reduce((s, i) => s + i.lineTotal, 0),
      shippingAmount: numericToFloat(order.carriageAmount),
      zeroVat: customerZeroVat,
      items,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="Order-Acknowledgement-${order.orderNumber}.pdf"`);
    res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` });
  }
});

// ─── GET acknowledgement as .eml (opens Outlook directly) ────────────────────

router.get("/orders/:id/acknowledgement.eml", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      shippingMethod: ordersTable.shippingMethod,
      poNumber: ordersTable.poNumber,
      deliveryAddressId: ordersTable.deliveryAddressId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const emlItemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((emlItemRowsRaw.rows ?? emlItemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let toEmail = "";
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let stripeCustomerId: string | null = null;

  let emlZeroVat = false;
  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      stripeCustomerId: customersTable.stripeCustomerId,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    toEmail = customer?.email ?? "";
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    stripeCustomerId = customer?.stripeCustomerId ?? null;
    emlZeroVat = customer?.zeroVat ?? false;
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const orderTotal = numericToFloat(order.totalAmount);
  const stripePaymentLink = await createStripePaymentLink({
    orderNumber: order.orderNumber,
    totalAmount: orderTotal,
    stripeCustomerId,
    baseUrl,
  });

  const { subject, html, text } = buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: orderTotal,
    carriageAmount: numericToFloat(order.carriageAmount),
    stripePaymentLink,
    items: mappedItems,
  });

  // Generate PDF
  let pdfBase64 = "";
  let pdfFilename = `Order-Acknowledgement-${order.orderNumber}.pdf`;
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      shippingMethod: order.shippingMethod ?? null,
      zeroVat: emlZeroVat,
      items: mappedItems,
    });
    pdfBase64 = pdfBuffer.toString("base64");
  } catch (_) { /* non-fatal */ }

  // Build MIME .eml
  const boundary = `----=_SBS_ACK_${Date.now()}`;
  const htmlB64 = Buffer.from(html, "utf8").toString("base64");
  const dateStr = new Date().toUTCString();

  let eml = [
    `MIME-Version: 1.0`,
    `X-Unsent: 1`,
    `From: "Select Branding Solutions Ltd" <orders@selectbrandingsolutions.co.uk>`,
    `To: ${toEmail}`,
    `Subject: ${subject}`,
    `Date: ${dateStr}`,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset="utf-8"`,
    `Content-Transfer-Encoding: base64`,
    ``,
    ...chunkBase64(htmlB64),
    ``,
  ].join("\r\n");

  if (pdfBase64) {
    eml += [
      `--${boundary}`,
      `Content-Type: application/pdf; name="${pdfFilename}"`,
      `Content-Transfer-Encoding: base64`,
      `Content-Disposition: attachment; filename="${pdfFilename}"`,
      ``,
      ...chunkBase64(pdfBase64),
      ``,
    ].join("\r\n");
  }

  eml += `--${boundary}--`;

  const filename = `Acknowledgement-${order.orderNumber}.eml`;
  res
    .status(200)
    .header("Content-Type", "message/rfc822")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .header("X-Order-Number", order.orderNumber)
    .send(eml);
});

// ─── GET acknowledgement as .vbs (opens Outlook compose window via COM) ───────

router.get("/orders/:id/acknowledgement.vbs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db
    .select({
      id: ordersTable.id, orderNumber: ordersTable.orderNumber,
      customerId: ordersTable.customerId, customerName: ordersTable.customerName,
      orderDate: ordersTable.orderDate, requiredDate: ordersTable.requiredDate,
      notes: ordersTable.notes, totalAmount: ordersTable.totalAmount,
      carriageAmount: ordersTable.carriageAmount,
      shippingMethod: ordersTable.shippingMethod,
      poNumber: ordersTable.poNumber, deliveryAddressId: ordersTable.deliveryAddressId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.id));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const vbsItemRowsRaw = await db.execute(sql`
    SELECT
      COALESCE(p.name, oi.product_name) AS product_name,
      COALESCE(p.sku, b.sku)            AS sku,
      oi.colour, oi.size, oi.quantity, oi.unit_price, oi.line_total, oi.vat_rate,
      oi.recipient_name, oi.finish_name,
      oi.bundle_ref, oi.is_bundle_header
    FROM order_items oi
    LEFT JOIN products p ON p.id = oi.product_id
    LEFT JOIN bundles  b ON b.id = oi.bundle_def_id
    WHERE oi.order_id = ${params.data.id}
    ORDER BY oi.id
  `);
  const items = ((vbsItemRowsRaw.rows ?? vbsItemRowsRaw) as any[]).map(r => ({
    productName: r.product_name,
    sku: r.sku ?? null,
    colour: r.colour ?? null,
    size: r.size ?? null,
    quantity: r.quantity ?? 1,
    unitPrice: parseFloat(String(r.unit_price ?? 0)),
    lineTotal: parseFloat(String(r.line_total ?? 0)),
    vatRate: parseFloat(String(r.vat_rate ?? 0.20)),
    recipientName: r.recipient_name ?? null,
    finishName: r.finish_name ?? null,
    bundleRef: r.bundle_ref ?? null,
    isBundleHeader: r.is_bundle_header ?? false,
  }));

  let toEmail = "";
  let contactFirstName: string | null = null;
  let customerAddress: string | null = null;
  let customerCity: string | null = null;
  let customerPostcode: string | null = null;
  let stripeCustomerId2: string | null = null;
  let vbsZeroVat = false;

  if (order.customerId) {
    const [customer] = await db.select({
      email: customersTable.email,
      contactFirstName: customersTable.contactFirstName,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
      stripeCustomerId: customersTable.stripeCustomerId,
      zeroVat: customersTable.zeroVat,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    toEmail = customer?.email ?? "";
    contactFirstName = customer?.contactFirstName ?? null;
    customerAddress = customer?.address ?? null;
    customerCity = customer?.city ?? null;
    customerPostcode = customer?.postcode ?? null;
    stripeCustomerId2 = customer?.stripeCustomerId ?? null;
    vbsZeroVat = customer?.zeroVat ?? false;
  }

  let deliveryAddressText: string | null = null;
  if (order.deliveryAddressId) {
    const [da] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    if (da) deliveryAddressText = [da.line1, da.line2, da.city, da.postcode].filter(Boolean).join(", ");
  }
  // Employee delivery address takes priority — override if all items share one employee address
  {
    const empAddrRows = (await db.execute(sql`
      SELECT DISTINCT e.delivery_address_id
      FROM order_items oi
      JOIN customer_employees e ON e.id = oi.recipient_employee_id
      WHERE oi.order_id = ${order.id} AND e.delivery_address_id IS NOT NULL
    `)).rows as Array<{ delivery_address_id: number }>;
    if (empAddrRows.length === 1) {
      const [empAddr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrRows[0].delivery_address_id));
      if (empAddr) deliveryAddressText = [empAddr.line1, empAddr.line2, empAddr.city, empAddr.postcode].filter(Boolean).join(", ");
    }
  }

  const mappedItems = items.map(i => ({
    productName: i.productName,
    sku: i.sku ?? null,
    colour: i.colour ?? null,
    size: i.size ?? null,
    quantity: i.quantity ?? 1,
    unitPrice: parseFloat(String(i.unitPrice ?? 0)),
    lineTotal: parseFloat(String(i.lineTotal ?? 0)),
    vatRate: parseFloat(String(i.vatRate ?? 0.20)),
    recipientName: i.recipientName ?? null,
    finishName: i.finishName ?? null,
    bundleRef: i.bundleRef ?? null,
    isBundleHeader: i.isBundleHeader ?? false,
  }));

  const baseUrl2 = `${req.protocol}://${req.get("host")}`;
  const orderTotal2 = numericToFloat(order.totalAmount);
  const stripePaymentLink2 = await createStripePaymentLink({
    orderNumber: order.orderNumber,
    totalAmount: orderTotal2,
    stripeCustomerId: stripeCustomerId2,
    baseUrl: baseUrl2,
  });

  const { subject, html } = buildAcknowledgementEmail({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? null,
    portalSubmittedByName: order.portalSubmittedByName ?? null,
    contactFirstName,
    orderDate: order.orderDate ?? null,
    requiredDate: order.requiredDate ?? null,
    notes: order.notes ?? null,
    totalAmount: orderTotal2,
    carriageAmount: numericToFloat(order.carriageAmount),
    stripePaymentLink: stripePaymentLink2,
    items: mappedItems,
  });

  let pdfBase64 = "";
  const pdfFilename = `Order-Acknowledgement-${order.orderNumber}.pdf`;
  try {
    const pdfBuffer = await generateOrderAcknowledgementPdf({
      orderNumber: order.orderNumber,
      orderDate: order.orderDate ?? null,
      requiredDate: order.requiredDate ?? null,
      poNumber: order.poNumber ?? null,
      customerName: order.customerName ?? null,
      customerAddress,
      customerCity,
      customerPostcode,
      deliveryAddress: deliveryAddressText,
      totalAmount: numericToFloat(order.totalAmount),
      shippingAmount: numericToFloat(order.carriageAmount),
      shippingMethod: order.shippingMethod ?? null,
      zeroVat: vbsZeroVat,
      items: mappedItems,
    });
    pdfBase64 = pdfBuffer.toString("base64");
  } catch (_) { /* non-fatal */ }

  // Encode HTML and PDF as base64 chunks for embedding in VBScript
  const htmlB64 = Buffer.from(html, "utf8").toString("base64");

  function vbsChunks(b64: string): string {
    const size = 60;
    const lines: string[] = [];
    for (let i = 0; i < b64.length; i += size) {
      lines.push(JSON.stringify(b64.slice(i, i + size)));
    }
    if (lines.length === 0) return '""';
    return lines.join(" & _\r\n    ");
  }

  const escapedSubject = subject.replace(/"/g, '""');
  const escapedToEmail = toEmail.replace(/"/g, '""');
  const escapedPdfFilename = pdfFilename.replace(/"/g, '""');

  const vbs = `Option Explicit

' ── Base64 decode helper (via MSXML2) ───────────────────────────────────────
Function B64ToBytes(b64)
  Dim doc, node
  Set doc = CreateObject("MSXML2.DOMDocument")
  Set node = doc.createElement("b64")
  node.DataType = "bin.base64"
  node.Text = b64
  B64ToBytes = node.NodeTypedValue
End Function

Function B64ToString(b64)
  Dim st
  Set st = CreateObject("ADODB.Stream")
  st.Type = 1
  st.Open
  st.Write B64ToBytes(b64)
  st.Position = 0
  st.Type = 2
  st.Charset = "utf-8"
  B64ToString = st.ReadText
  st.Close
End Function

' ── Embedded data ────────────────────────────────────────────────────────────
Dim toEmail, subj, pdfFile, htmlB64, pdfB64
toEmail  = "${escapedToEmail}"
subj     = "${escapedSubject}"
pdfFile  = "${escapedPdfFilename}"

htmlB64 = ${vbsChunks(htmlB64)}

${pdfBase64 ? `pdfB64 = ${vbsChunks(pdfBase64)}` : `pdfB64 = ""`}

' ── Write PDF to temp file ───────────────────────────────────────────────────
Dim fso, tmpPdf
Set fso = CreateObject("Scripting.FileSystemObject")
tmpPdf = fso.GetSpecialFolder(2) & "\\" & pdfFile

If Len(pdfB64) > 0 Then
  Dim pdfStream
  Set pdfStream = CreateObject("ADODB.Stream")
  pdfStream.Type = 1
  pdfStream.Open
  pdfStream.Write B64ToBytes(pdfB64)
  pdfStream.SaveToFile tmpPdf, 2
  pdfStream.Close
End If

' ── Create Outlook compose window ────────────────────────────────────────────
Dim olApp, mail
Set olApp = CreateObject("Outlook.Application")
Set mail = olApp.CreateItem(0)

' ── Set sending account so email saves to correct Sent Items ─────────────────
On Error Resume Next
Dim ns, accts, j
Set ns = olApp.GetNamespace("MAPI")
Set accts = ns.Accounts
For j = 1 To accts.Count
  If LCase(accts.Item(j).SmtpAddress) = "accounts@selectbranding.co.uk" Then
    Set mail.SendUsingAccount = accts.Item(j)
    Exit For
  End If
Next
On Error GoTo 0

mail.To       = toEmail
mail.Subject  = subj
mail.HTMLBody = B64ToString(htmlB64)

If Len(pdfB64) > 0 And fso.FileExists(tmpPdf) Then
  mail.Attachments.Add tmpPdf
End If

mail.Display

' Clean up temp PDF after Outlook has loaded it
WScript.Sleep 5000
If fso.FileExists(tmpPdf) Then fso.DeleteFile tmpPdf
`;

  await logOrderAction(order.id, "Acknowledgement prepared", getActor(req),
    `VBS script downloaded for ${order.orderNumber} — to be sent via Outlook`);

  const filename = `SendAck-${order.orderNumber}.vbs`;
  res
    .status(200)
    .header("Content-Type", "application/octet-stream")
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(vbs);
});

function chunkBase64(b64: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < b64.length; i += 76) chunks.push(b64.slice(i, i + 76));
  return chunks;
}

router.post("/orders/:id/items", async (req, res): Promise<void> => {
  const params = AddOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.id));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }

  const addItemSchema = z.object({
    productId: z.number().int().positive().optional().nullable(),
    productName: z.string(),
    colour: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    finishId: z.number().int().positive().optional().nullable(),
    finishName: z.string().optional().nullable(),
    recipientType: z.enum(["stock", "person"]).default("stock"),
    recipientName: z.string().optional().nullable(),
    recipientEmployeeId: z.number().int().positive().optional().nullable(),
    quantity: z.number().int().positive(),
    unitPrice: z.number().min(0),
    vatRate: z.number().min(0).max(1).optional(),
    purchaseRequired: z.boolean().optional().default(false),
    purchaseQuantity: z.number().int().min(0).optional().nullable(),
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().optional().nullable(),
  });

  const parsed = addItemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Resolve VAT rate: use client-supplied value if given, otherwise look up from product
  let effectiveVatRate = parsed.data.vatRate;
  if (effectiveVatRate === undefined && parsed.data.productId) {
    const [prod] = await db
      .select({ vatRate: productsTable.vatRate })
      .from(productsTable)
      .where(eq(productsTable.id, parsed.data.productId))
      .limit(1);
    effectiveVatRate = prod ? parseFloat(String(prod.vatRate ?? 0.20)) : 0.20;
  }
  effectiveVatRate = effectiveVatRate ?? 0.20;
  // Override to zero-rated if the customer is Channel Islands / zero-VAT
  if (order.customerId) {
    const [cust] = await db
      .select({ zeroVat: customersTable.zeroVat })
      .from(customersTable)
      .where(eq(customersTable.id, order.customerId))
      .limit(1);
    if (cust?.zeroVat) effectiveVatRate = 0;
  }

  // For confirmed orders, run a real stock check rather than trusting the
  // client-supplied purchaseRequired flag (which defaults to false).
  let resolvedPurchaseRequired = parsed.data.purchaseRequired ?? false;
  let resolvedPurchaseQuantity = parsed.data.purchaseQuantity ?? null;
  let resolvedSupplierId = parsed.data.supplierId ?? null;
  let resolvedSupplierName = parsed.data.supplierName ?? null;

  if (order.status === "confirmed" && parsed.data.productId) {
    const productId = parsed.data.productId;
    const qty = parsed.data.quantity;
    const colour = parsed.data.colour ?? null;
    const size = parsed.data.size ?? null;

    // Look up variant or plain product stock.
    // Size matching handles two stored formats: direct (pv.size = size) and split
    // ("size/sleeve" order item value vs pv.size + pv.sleeve columns), preferring a
    // direct match when both are present.
    const stockRows = await db.execute(sql`
      SELECT
        COALESCE(
          (SELECT pv.stock_quantity
           FROM product_variants pv
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
           LIMIT 1),
          CASE WHEN NOT EXISTS (
                 SELECT 1 FROM product_variants pv WHERE pv.product_id = ${productId}
               )
               THEN p.stock_quantity
               ELSE 0
          END
        ) AS available_stock,
        -- Orphaned on-order: ordered PO lines for this variant whose linked order items
        -- were all deleted. Goods are still incoming → treat as available supply.
        COALESCE((
          SELECT SUM(poi2.quantity_ordered - COALESCE(poi2.quantity_delivered, 0))
          FROM purchase_order_items poi2
          JOIN purchase_orders po2 ON poi2.po_id = po2.id
          WHERE po2.status = 'ordered'
            AND poi2.quantity_ordered > COALESCE(poi2.quantity_delivered, 0)
            AND poi2.product_id = ${productId}
            AND poi2.colour IS NOT DISTINCT FROM ${colour}
            AND (poi2.size IS NOT DISTINCT FROM ${size}
                 OR (${size}::text LIKE '%/%' AND poi2.size = split_part(${size}, '/', 1))
                 OR poi2.size IS NULL)
            AND (poi2.order_item_id IS NULL
                 OR NOT EXISTS (SELECT 1 FROM order_items oi_chk WHERE oi_chk.id = poi2.order_item_id))
            AND (jsonb_array_length(COALESCE(poi2.source_order_item_ids, '[]'::jsonb)) = 0
                 OR NOT EXISTS (
                   SELECT 1 FROM order_items oi3
                   WHERE oi3.id IN (
                     SELECT (elem.value)::integer
                     FROM jsonb_array_elements_text(poi2.source_order_item_ids) AS elem(value)
                   )
                 ))
        ), 0) AS orphaned_on_order,
        COALESCE(
          (SELECT pv.primary_supplier_id
           FROM product_variants pv
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
           LIMIT 1),
          p.supplier_id
        ) AS supplier_id,
        COALESCE(
          (SELECT vs.name
           FROM product_variants pv
           JOIN suppliers vs ON vs.id = pv.primary_supplier_id
           WHERE pv.product_id = ${productId}
             AND (pv.colour IS NOT DISTINCT FROM ${colour})
             AND (
                  (pv.size IS NOT DISTINCT FROM ${size})
                  OR (${size}::text LIKE '%/%' AND pv.size = split_part(${size}, '/', 1) AND pv.sleeve = split_part(${size}, '/', 2))
                  OR (pv.size IS NULL AND pv.sleeve IS NULL)
             )
           ORDER BY CASE WHEN pv.size IS NOT DISTINCT FROM ${size} THEN 0 ELSE 1 END
           LIMIT 1),
          s.name
        ) AS supplier_name
      FROM products p
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = ${productId}
    `);
    const stockRow = stockRows.rows[0] as any;
    const available = Number(stockRow?.available_stock ?? 0) + Number(stockRow?.orphaned_on_order ?? 0);
    const allocatedQty = Math.min(available, qty);
    const shortfall = qty - allocatedQty;

    resolvedPurchaseRequired = shortfall > 0;
    resolvedPurchaseQuantity = shortfall > 0 ? shortfall : null;
    resolvedSupplierId = shortfall > 0 ? (stockRow?.supplier_id ?? null) : null;
    resolvedSupplierName = shortfall > 0 ? (stockRow?.supplier_name ?? null) : null;

    // Deduct allocated stock from the variant (or plain product).
    // Same direct-or-split size matching as the stock lookup above.
    if (allocatedQty > 0) {
      await db.execute(sql`
        UPDATE product_variants
        SET stock_quantity = GREATEST(0, stock_quantity - ${allocatedQty})
        WHERE product_id = ${productId}
          AND (colour IS NOT DISTINCT FROM ${colour})
          AND (
               (size IS NOT DISTINCT FROM ${size})
               OR (${size}::text LIKE '%/%' AND size = split_part(${size}, '/', 1) AND sleeve = split_part(${size}, '/', 2))
          )
      `);
      // Roll up to parent product
      await db.execute(sql`
        UPDATE products
        SET stock_quantity = (
          SELECT COALESCE(SUM(stock_quantity), 0) FROM product_variants WHERE product_id = ${productId}
        )
        WHERE id = ${productId}
      `);
    }
  }

  // For confirmed orders where stock was fully allocated (no shortfall) and the item
  // has no finish (no production step), mark it as allocated immediately so it appears
  // on the picking list without needing the safety-net startup promotion.
  // Items with a finish go through a worksheet → in_production → complete flow instead.
  const resolvedStockStatus =
    order.status === "confirmed" && !resolvedPurchaseRequired && !parsed.data.finishId
      ? "allocated"
      : null;
  const resolvedStockAllocatedAt = resolvedStockStatus === "allocated" ? new Date() : null;

  const lineTotal = parsed.data.quantity * parsed.data.unitPrice;
  const [item] = await db
    .insert(orderItemsTable)
    .values({
      orderId: params.data.id,
      productId: parsed.data.productId ?? null,
      productName: parsed.data.productName,
      colour: parsed.data.colour ?? null,
      size: parsed.data.size ?? null,
      finishId: parsed.data.finishId ?? null,
      finishName: parsed.data.finishName ?? null,
      recipientType: parsed.data.recipientType,
      recipientName: parsed.data.recipientName ?? null,
      recipientEmployeeId: parsed.data.recipientEmployeeId ?? null,
      quantity: parsed.data.quantity,
      unitPrice: String(parsed.data.unitPrice),
      lineTotal: String(lineTotal),
      vatRate: String(effectiveVatRate),
      purchaseRequired: resolvedPurchaseRequired,
      purchaseQuantity: resolvedPurchaseQuantity,
      supplierId: resolvedSupplierId,
      supplierName: resolvedSupplierName,
      stockStatus: resolvedStockStatus,
      stockAllocatedAt: resolvedStockAllocatedAt,
    })
    .returning();

  await recalcOrderTotal(params.data.id);

  // Save the size against the employee so it can be suggested on reorder
  if (parsed.data.recipientEmployeeId && parsed.data.size && parsed.data.productName) {
    const empId = parsed.data.recipientEmployeeId;
    const label = parsed.data.productName;
    const sizeVal = parsed.data.size;
    const allSizes = await db.select().from(customerEmployeeSizesTable)
      .where(eq(customerEmployeeSizesTable.employeeId, empId));
    const match = allSizes.find(s => s.label === label);
    if (match) {
      await db.update(customerEmployeeSizesTable)
        .set({ size: sizeVal, updatedAt: new Date() })
        .where(eq(customerEmployeeSizesTable.id, match.id));
    } else {
      await db.insert(customerEmployeeSizesTable)
        .values({ employeeId: empId, label, size: sizeVal });
    }
  }

  res.status(201).json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
    vatRate: parseFloat(String(item.vatRate ?? 0.20)),
  });
});

const UpdateOrderItemBodyExtended = z.object({
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().min(0).optional(),
  vatRate: z.number().min(0).max(1).optional(),
  purchaseRequired: z.boolean().optional(),
  purchaseQuantity: z.number().int().min(0).nullable().optional(),
  supplierId: z.number().int().positive().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  size: z.string().nullable().optional(),
  colour: z.string().nullable().optional(),
  stockStatus: z.string().nullable().optional(),
  stockAllocatedAt: z.string().nullable().optional(),
  dispatchedAt: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

router.patch("/orders/:id/items/bulk-price", async (req, res): Promise<void> => {
  const orderId = parseInt(req.params.id);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid order id" }); return; }

  const body = z.object({
    productId: z.number().int().positive(),
    unitPrice: z.number().positive(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { productId, unitPrice } = body.data;

  const updated = await db.execute(sql`
    UPDATE order_items
    SET unit_price = ${String(unitPrice)},
        line_total = (quantity::numeric * ${String(unitPrice)})::numeric
    WHERE order_id = ${orderId}
      AND product_id = ${productId}
      AND is_bundle_header IS NOT TRUE
    RETURNING id
  `);

  await recalcOrderTotal(orderId);

  res.json({ updated: (updated.rows ?? updated).length });
});

router.patch("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = UpdateOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateOrderItemBodyExtended.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existingItem] = await db.select().from(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId));
  if (!existingItem) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  const quantity = parsed.data.quantity ?? existingItem.quantity;
  const unitPrice = parsed.data.unitPrice ?? numericToFloat(existingItem.unitPrice);
  const lineTotal = quantity * unitPrice;

  const updateData: Record<string, unknown> = {
    quantity,
    unitPrice: String(unitPrice),
    lineTotal: String(lineTotal),
  };

  if (parsed.data.vatRate !== undefined) updateData.vatRate = String(parsed.data.vatRate);
  if (parsed.data.purchaseRequired !== undefined) updateData.purchaseRequired = parsed.data.purchaseRequired;
  if (parsed.data.purchaseQuantity !== undefined) updateData.purchaseQuantity = parsed.data.purchaseQuantity;
  if (parsed.data.supplierId !== undefined) updateData.supplierId = parsed.data.supplierId;
  if (parsed.data.supplierName !== undefined) updateData.supplierName = parsed.data.supplierName;
  if (parsed.data.size !== undefined) updateData.size = parsed.data.size;
  if (parsed.data.colour !== undefined) updateData.colour = parsed.data.colour;
  if (parsed.data.stockStatus !== undefined) updateData.stockStatus = parsed.data.stockStatus;
  if (parsed.data.stockAllocatedAt !== undefined) updateData.stockAllocatedAt = parsed.data.stockAllocatedAt ? new Date(parsed.data.stockAllocatedAt) : null;
  if (parsed.data.dispatchedAt !== undefined) updateData.dispatchedAt = parsed.data.dispatchedAt ? new Date(parsed.data.dispatchedAt) : null;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [item] = await db
    .update(orderItemsTable)
    .set(updateData)
    .where(eq(orderItemsTable.id, params.data.itemId))
    .returning();

  await recalcOrderTotal(params.data.id);

  res.json({
    ...item,
    unitPrice: numericToFloat(item.unitPrice),
    lineTotal: numericToFloat(item.lineTotal),
    vatRate: parseFloat(String(item.vatRate ?? 0.20)),
  });
});

router.delete("/orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = DeleteOrderItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const removeFromPo = req.query.removeFromPo === "true";

  // Optionally remove from any draft POs before deleting the item
  if (removeFromPo) {
    await db.execute(sql`
      DELETE FROM purchase_order_items poi
      USING purchase_orders po
      WHERE poi.po_id = po.id
        AND po.status = 'draft'
        AND (
          poi.order_item_id = ${params.data.itemId}
          OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(${params.data.itemId}::int)
        )
    `);
  }

  const [item] = await db.delete(orderItemsTable).where(eq(orderItemsTable.id, params.data.itemId)).returning();
  if (!item) {
    res.status(404).json({ error: "Order item not found" });
    return;
  }

  await recalcOrderTotal(params.data.id);
  res.sendStatus(204);
});

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  // Exclude portal_draft orders (not yet in SBS workflow) and cancelled orders
  const visibleOrders = sql`(${ordersTable.status} IS DISTINCT FROM 'portal_draft' AND ${ordersTable.status} IS DISTINCT FROM 'cancelled')`;

  const [{ count: totalOrders }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ordersTable)
    .where(visibleOrders);

  const [{ total: totalRevenue }] = await db
    .select({ total: sql<number>`coalesce(sum(total_amount), 0)::float` })
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "delivered"), visibleOrders));

  const [{ count: totalCustomers }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(customersTable);

  const [{ count: totalProducts }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(productsTable);

  const statusCounts = await db
    .select({
      status: ordersTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(ordersTable)
    .where(visibleOrders)
    .groupBy(ordersTable.status);

  const ordersByStatus = { draft: 0, confirmed: 0, shipped: 0, delivered: 0 };
  for (const row of statusCounts) {
    const key = row.status as keyof typeof ordersByStatus;
    if (key in ordersByStatus) {
      ordersByStatus[key] = row.count;
    }
  }

  const recentOrders = await db
    .select()
    .from(ordersTable)
    .where(visibleOrders)
    .orderBy(desc(ordersTable.createdAt))
    .limit(10);

  res.json({
    totalOrders,
    totalRevenue,
    totalCustomers,
    totalProducts,
    ordersByStatus,
    recentOrders: recentOrders.map((o) => ({ ...o, totalAmount: numericToFloat(o.totalAmount) })),
  });
});

router.get("/orders/:id/pack-status", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const items = await db.select().from(orderItemsTable).where(eq(orderItemsTable.orderId, orderId));
  if (items.length === 0) { res.json({ recipients: [] }); return; }

  const itemIds = items.map((i) => i.id);
  const wsItems = await db
    .select({ wsItem: worksheetItemsTable, ws: worksheetsTable })
    .from(worksheetItemsTable)
    .innerJoin(worksheetsTable, eq(worksheetItemsTable.worksheetId, worksheetsTable.id))
    .where(inArray(worksheetItemsTable.orderItemId, itemIds));

  const employeeIds = [...new Set(items.filter((i) => i.recipientEmployeeId).map((i) => i.recipientEmployeeId!))];
  const employees = employeeIds.length > 0
    ? await db.select().from(customerEmployeesTable).where(inArray(customerEmployeesTable.id, employeeIds))
    : [];
  const empMap = new Map(employees.map((e) => [e.id, e]));

  const wsItemMap = new Map<number, { worksheetNumber: string; status: string }>();
  for (const { wsItem, ws } of wsItems) {
    if (wsItem.orderItemId) wsItemMap.set(wsItem.orderItemId, { worksheetNumber: ws.worksheetNumber, status: ws.status });
  }

  const stockItems: {
    orderItemId: number; productName: string; colour: string | null; size: string | null;
    quantity: number; isComplete: boolean; worksheetNumber: string | null;
  }[] = [];

  type PersonGroup = {
    recipientName: string;
    employeeId: number | null;
    jobTitle: string | null;
    department: string | null;
    allComplete: boolean;
    items: { orderItemId: number; productName: string; colour: string | null; size: string | null; quantity: number; isComplete: boolean; worksheetNumber: string | null; }[];
  };

  const personMap = new Map<string, PersonGroup>();

  for (const oi of items) {
    const wsInfo = wsItemMap.get(oi.id);
    // Decorated items: complete when worksheet is done. Plain items (no worksheet): complete when stockStatus = 'complete'.
    const isComplete = wsInfo ? wsInfo.status === "complete" : oi.stockStatus === "complete";
    const entry = { orderItemId: oi.id, productName: oi.productName, colour: oi.colour, size: oi.size, quantity: oi.quantity, isComplete, worksheetNumber: wsInfo?.worksheetNumber ?? null };

    if (oi.recipientType === "person" && oi.recipientName) {
      const key = oi.recipientName;
      if (!personMap.has(key)) {
        const emp = oi.recipientEmployeeId ? empMap.get(oi.recipientEmployeeId) : undefined;
        personMap.set(key, { recipientType: "person" as const, recipientName: key, employeeId: oi.recipientEmployeeId ?? null, jobTitle: emp?.jobTitle ?? null, department: emp?.department ?? null, allComplete: true, items: [] });
      }
      const group = personMap.get(key)!;
      group.items.push(entry);
      if (!isComplete) group.allComplete = false;
    } else {
      stockItems.push(entry);
    }
  }

  const stockAllComplete = stockItems.length > 0 && stockItems.every((i) => i.isComplete);

  res.json({
    orderId,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    recipients: [
      ...(stockItems.length > 0 ? [{ recipientType: "stock", recipientName: null, employeeId: null, jobTitle: null, department: null, allComplete: stockAllComplete, items: stockItems }] : []),
      ...[...personMap.values()],
    ],
  });
});

// ── Consolidation candidates: other open orders for the same customer that could be merged ──
router.get("/orders/:id/consolidation-candidates", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const [order] = await db.select({
    id: ordersTable.id,
    status: ordersTable.status,
    customerId: ordersTable.customerId,
    deliveryAddressId: ordersTable.deliveryAddressId,
    poNumber: ordersTable.poNumber,
  }).from(ordersTable).where(eq(ordersTable.id, orderId));

  if (!order) { res.status(404).json({ error: "Order not found" }); return; }
  // Only suggest consolidation for draft orders
  if (order.status !== "draft") { res.json([]); return; }

  // Normalise PO number: treat blank/null the same
  const normPo = (v: string | null | undefined) => (v ?? "").trim() || null;
  const thisPo = normPo(order.poNumber);

  // Find other open orders for the same customer
  const candidates = await db.execute(sql`
    SELECT
      o.id,
      o.order_number  AS "orderNumber",
      o.status,
      o.total_amount  AS "totalAmount",
      o.po_number     AS "poNumber",
      COUNT(oi.id)::int AS "itemCount"
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    WHERE o.customer_id = ${order.customerId}
      AND o.id != ${orderId}
      AND o.status IN ('draft', 'confirmed')
      AND (o.delivery_address_id IS NOT DISTINCT FROM ${order.deliveryAddressId ?? null})
      AND (NULLIF(TRIM(COALESCE(o.po_number, '')), '') IS NOT DISTINCT FROM ${thisPo})
    GROUP BY o.id, o.order_number, o.status, o.total_amount, o.po_number
    ORDER BY o.id DESC
  `);

  res.json(candidates.rows);
});

// ── Merge a draft order into a target order ────────────────────────────────────
// Moves all order_items from the source (draft) order into the target order,
// records the source order number in the target's absorbed_order_numbers,
// recalculates the target total, then deletes the now-empty source order.
router.post("/orders/:id/merge-into/:targetId", async (req, res): Promise<void> => {
  const parsed = z.object({
    id: z.coerce.number().int().positive(),
    targetId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { id: sourceId, targetId } = parsed.data;

  if (sourceId === targetId) { res.status(400).json({ error: "Cannot merge an order into itself." }); return; }

  const [sourceOrder] = await db.select({
    id: ordersTable.id,
    orderNumber: ordersTable.orderNumber,
    status: ordersTable.status,
    customerId: ordersTable.customerId,
  }).from(ordersTable).where(eq(ordersTable.id, sourceId));

  if (!sourceOrder) { res.status(404).json({ error: "Source order not found." }); return; }
  if (sourceOrder.status !== "draft") { res.status(400).json({ error: "Only draft orders can be merged." }); return; }

  const [targetOrder] = await db.select({
    id: ordersTable.id,
    customerId: ordersTable.customerId,
    absorbedOrderNumbers: ordersTable.absorbedOrderNumbers,
  }).from(ordersTable).where(eq(ordersTable.id, targetId));

  if (!targetOrder) { res.status(404).json({ error: "Target order not found." }); return; }
  if (targetOrder.customerId !== sourceOrder.customerId) {
    res.status(400).json({ error: "Orders must belong to the same customer." }); return;
  }

  // Move all items from source → target
  await db.update(orderItemsTable)
    .set({ orderId: targetId })
    .where(eq(orderItemsTable.orderId, sourceId));

  // Record the absorbed order number on the target
  const existing = targetOrder.absorbedOrderNumbers ?? [];
  await db.update(ordersTable)
    .set({ absorbedOrderNumbers: [...existing, sourceOrder.orderNumber], updatedAt: new Date() })
    .where(eq(ordersTable.id, targetId));

  // Recalculate target total, then delete the (now-empty) source order
  await recalcOrderTotal(targetId);
  await db.delete(ordersTable).where(eq(ordersTable.id, sourceId));

  res.json({ targetId });
});

// ── Order backorders: PO lines linked to this order that are still pending ─────
router.get("/orders/:id/backorders", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const orderId = parsed.data.id;

  const rows = await db
    .select({
      id: purchaseOrderItemsTable.id,
      poId: purchaseOrderItemsTable.poId,
      poNumber: purchaseOrdersTable.poNumber,
      supplierName: purchaseOrdersTable.supplierName,
      productName: purchaseOrderItemsTable.productName,
      colour: purchaseOrderItemsTable.colour,
      size: purchaseOrderItemsTable.size,
      supplierCode: purchaseOrderItemsTable.supplierCode,
      quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
      quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
      orderItemId: purchaseOrderItemsTable.orderItemId,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .innerJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .where(and(
      eq(orderItemsTable.orderId, orderId),
      ne(purchaseOrdersTable.status, "delivered"),
      lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
    ))
    .orderBy(purchaseOrderItemsTable.estimatedDueDate);

  res.json(rows.map((r) => ({ ...r, remaining: r.quantityOrdered - r.quantityDelivered })));
});

// ── Delivery Note HTML ────────────────────────────────────────────────────────
router.get("/orders/:id/delivery-note", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const isDraft = req.query.draft === "1";
  const dispatchedIdsRaw = req.query.dispatchedItemIds ? String(req.query.dispatchedItemIds) : null;
  const dispatchedIds: number[] | null = dispatchedIdsRaw
    ? dispatchedIdsRaw.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
    : null;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }

  // ── Guard: all production worksheets must be complete before issuing a delivery note ──
  // Skip the guard when:
  //   • isDraft is set (preview mode)
  //   • dispatchedIds are provided (explicit partial dispatch — API already validated readiness)
  //   • order is already part_shipped, shipped, or delivered (items were validated at dispatch time)
  const skipGuard = isDraft || dispatchedIds !== null || ["part_shipped", "shipped", "delivered"].includes(order.status);
  if (!skipGuard) {
    const incompleteWs = await db
      .select({ worksheetNumber: worksheetsTable.worksheetNumber, status: worksheetsTable.status })
      .from(worksheetsTable)
      .where(and(
        eq(worksheetsTable.orderId, orderId),
        inArray(worksheetsTable.status, ["pre_wip", "wip"]),
      ));

    if (incompleteWs.length > 0) {
      const wsDetails = incompleteWs
        .map(w => `${w.worksheetNumber} — ${w.status === "pre_wip" ? "Awaiting Production" : "In Production"}`)
        .join("<br>");
      res.status(409).send(`<!DOCTYPE html>
<html lang="en"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Delivery Note Blocked — ${order.orderNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.1); max-width: 480px; width: 90%; padding: 2rem; }
    .icon { font-size: 2.5rem; margin-bottom: 1rem; }
    h1 { margin: 0 0 .5rem; font-size: 1.25rem; color: #1e3a5f; }
    p { margin: 0 0 1rem; color: #444; font-size: .95rem; line-height: 1.5; }
    .ws-list { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: .75rem 1rem; font-size: .875rem; color: #92400e; line-height: 1.8; }
    button { margin-top: 1.25rem; background: #1e3a5f; color: #fff; border: none; border-radius: 6px; padding: .6rem 1.25rem; font-size: .9rem; cursor: pointer; }
    button:hover { background: #16304f; }
  </style>
</head><body>
  <div class="card">
    <div class="icon">🚫</div>
    <h1>Cannot Generate Delivery Note</h1>
    <p>The delivery note for <strong>${order.orderNumber}</strong> cannot be produced until all production worksheets are marked as <strong>Complete</strong>.</p>
    <div class="ws-list"><strong>Incomplete worksheets:</strong><br>${wsDetails}</div>
    <p style="margin-top:1rem;margin-bottom:0;font-size:.85rem;color:#666;">Mark each worksheet as complete on the Production tab, then try again.</p>
    <button onclick="window.close()">Close</button>
  </div>
</body></html>`);
      return;
    }
  }

  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
    lineTotal: parseFloat(String(r.item.lineTotal ?? "0")),
    employee: r.employee ?? null,
    productSku: r.productSku ?? null,
  }));

  // Split into dispatched-now vs to-follow:
  //   1. Explicit dispatchedItemIds param → use those IDs
  //   2. part_shipped order with no explicit IDs → use dispatchedAt field on items
  //   3. Fully dispatched / normal → all items dispatched, none pending
  const dispatchedItems = dispatchedIds
    ? allItems.filter(i => dispatchedIds.includes(i.id))
    : order.status === "part_shipped"
      ? allItems.filter(i => i.dispatchedAt != null)
      : allItems;
  const pendingItems = dispatchedIds
    // When explicit IDs are given (fresh partial dispatch), exclude both the current
    // batch AND any items already dispatched in a prior shipment — only truly
    // outstanding (never-dispatched) items should appear in "To Follow".
    ? allItems.filter(i => !dispatchedIds.includes(i.id) && i.dispatchedAt == null)
    : order.status === "part_shipped"
      ? allItems.filter(i => i.dispatchedAt == null)
      : [];

  let customerLogoDataUrl: string | null = null;
  let customerPostalAddress: string | null = null;
  let customerPostalCity: string | null = null;
  let customerPostalPostcode: string | null = null;
  let customerContactName: string | null = null;
  let customerPhone: string | null = null;
  if (order.customerId) {
    const [cust] = await db.select({ logoUrl: customersTable.logoUrl, address: customersTable.address, city: customersTable.city, postcode: customersTable.postcode, contactFirstName: customersTable.contactFirstName, contactLastName: customersTable.contactLastName, phone: customersTable.phone })
      .from(customersTable).where(eq(customersTable.id, order.customerId));
    if (cust?.logoUrl) {
      try {
        const logo = await readLogoForSending(cust.logoUrl);
        if (logo) customerLogoDataUrl = `data:${logo.contentType};base64,${logo.buffer.toString("base64")}`;
      } catch {}
    }
    customerPostalAddress = cust?.address ?? null;
    customerPostalCity = cust?.city ?? null;
    customerPostalPostcode = cust?.postcode ?? null;
    customerContactName = [cust?.contactFirstName, cust?.contactLastName].filter(Boolean).join(" ") || null;
    customerPhone = cust?.phone ?? null;
  }

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null } | null = null;
  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    // Fall back to employee-level delivery address if all employees share the same one
    const empAddrIds = [...new Set(allItems.map(i => (i.employee as any)?.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }

  // Multi-address: group items by their effective delivery address ID
  const getEffAddrId = (item: typeof allItems[0]): number | null =>
    (item.employee as any)?.deliveryAddressId ?? order.deliveryAddressId ?? null;

  const addrGroupMap = new Map<number | null, { dispItems: typeof allItems; pendItems: typeof allItems }>();
  for (const item of [...dispatchedItems, ...pendingItems]) {
    const id = getEffAddrId(item);
    if (!addrGroupMap.has(id)) addrGroupMap.set(id, { dispItems: [], pendItems: [] });
  }
  for (const item of dispatchedItems) { addrGroupMap.get(getEffAddrId(item))!.dispItems.push(item); }
  for (const item of pendingItems) { addrGroupMap.get(getEffAddrId(item))!.pendItems.push(item); }
  const isMultiAddr = addrGroupMap.size > 1;

  // Fetch all delivery addresses referenced across all groups
  const dnAddrById = new Map<number, typeof deliveryAddress>();
  {
    const idsNeeded = [...new Set([...addrGroupMap.keys()].filter((id): id is number => id != null && id > 0))];
    if (idsNeeded.length > 0) {
      const fetched = await db.select().from(customerDeliveryAddressesTable).where(inArray(customerDeliveryAddressesTable.id, idsNeeded));
      for (const a of fetched) dnAddrById.set(a.id, a as typeof deliveryAddress);
    }
  }
  if (deliveryAddress && order.deliveryAddressId) dnAddrById.set(order.deliveryAddressId, deliveryAddress);

  const backorderMap = new Map<number, { estimatedDueDate: string | null }>();
  if (pendingItems.length > 0) {
    const pendingIds = pendingItems.map(i => i.id);
    const boRows = await db
      .select({
        orderItemId: purchaseOrderItemsTable.orderItemId,
        estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
        quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
        quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      })
      .from(purchaseOrderItemsTable)
      .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
      .where(and(
        inArray(purchaseOrderItemsTable.orderItemId, pendingIds),
        ne(purchaseOrdersTable.status, "delivered"),
        lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
      ));
    for (const bo of boRows) {
      if (bo.orderItemId != null) backorderMap.set(bo.orderItemId, { estimatedDueDate: bo.estimatedDueDate });
    }
  }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : null;

  const fmtDate = (d: Date | string | null | undefined) =>
    d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };

  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  const renderRow = (item: typeof allItems[0]) =>
    `<tr>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.productName}${item.finishName ? ` <span style="color:#4f46e5;font-size:8.5pt;">(${item.finishName})</span>` : ""}${item.productSku ? `<br><span style="font-family:monospace;font-size:8pt;color:#4338ca;">${item.productSku}</span>` : ""}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.colour ?? "—"}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;">${item.size ?? "—"}</td>
      <td style="padding:5px 10px;border-bottom:1px solid #e5e7eb;font-size:10pt;text-align:center;font-weight:700;">${item.quantity}</td>
    </tr>`;

  // Per-address sheet builder (used for both single and multi-address modes)
  const buildSheetHtml = (effAddrId: number | null, dispItems: typeof allItems, pendItems: typeof allItems): string => {
    const addrObj = effAddrId != null ? dnAddrById.get(effAddrId) : null;
    const effAddrLines = addrObj
      ? [addrObj.line1, addrObj.line2, addrObj.city, (addrObj as any).county ?? null, addrObj.postcode, addrObj.country].filter((x): x is string => !!x)
      : [customerPostalAddress, customerPostalCity, customerPostalPostcode].filter((x): x is string => !!x);
    const addrLabelLine = addrObj && (addrObj as any).label ? `<br><em style="color:#6b7280;font-size:9pt;">${(addrObj as any).label}</em>` : "";
    const dtBlock = `<strong>${order.customerName ?? ""}</strong>${effAddrLines.length > 0 ? "<br>" + effAddrLines.join("<br>") + addrLabelLine : `<br><em style="color:#aaa">No delivery address</em>`}`;

    const rGroups = new Map<string, { name: string; jobTitle: string | null; items: typeof allItems }>();
    const sItems: typeof allItems = [];
    for (const item of dispItems) {
      if (isNamed(item)) {
        const name = empName(item) ?? "Unknown";
        if (!rGroups.has(name)) rGroups.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, items: [] });
        rGroups.get(name)!.items.push(item);
      } else { sItems.push(item); }
    }
    const gRows = [...rGroups.values()].map(g =>
      `<tr style="background:#e8edf5;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        <td colspan="4" style="padding:5px 10px;font-size:10pt;border-bottom:1px solid #ccd5e0;font-weight:700;">${g.name}${g.jobTitle ? ` <span style="font-weight:normal;font-size:9pt;color:#555;"> — ${g.jobTitle}</span>` : ""}</td>
      </tr>
      ${g.items.map(renderRow).join("")}`
    ).join("");
    const sRows = sItems.length > 0
      ? `<tr style="background:#e8edf5;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><td colspan="4" style="padding:5px 10px;font-size:10pt;border-bottom:1px solid #ccd5e0;font-weight:700;">General Stock</td></tr>${sItems.map(renderRow).join("")}`
      : "";
    const totQty = dispItems.reduce((s, i) => s + i.quantity, 0);
    const isPart = dispatchedIds !== null || pendItems.length > 0;

    const toFollow = pendItems.length > 0 ? `
      <div style="margin-top:22px;border:2px solid #f59e0b;border-radius:6px;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid;break-inside:avoid;">
        <div style="background:#f59e0b;padding:8px 14px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <span style="font-size:11pt;font-weight:900;color:#fff;letter-spacing:.06em;text-transform:uppercase;">Items To Follow</span>
          <span style="font-size:9pt;color:#fff;opacity:.9;margin-left:12px;">Outstanding items — will be dispatched as soon as they are available</span>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#fffbeb;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Item</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Colour</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Size</th>
              <th style="padding:6px 10px;text-align:center;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Qty O/S</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Est. Due</th>
              <th style="padding:6px 10px;text-align:left;font-size:8pt;color:#92400e;text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid #fde68a;">Named Wearer</th>
            </tr>
          </thead>
          <tbody>
            ${pendItems.map(item => {
              const bo = backorderMap.get(item.id);
              const recipient = empName(item);
              return `<tr>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.productName}${item.finishName ? ` <span style="color:#4f46e5;font-size:8.5pt;">(${item.finishName})</span>` : ""}${(item as any).productSku ? `<br><span style="font-family:monospace;font-size:8pt;color:#4338ca;">${(item as any).productSku}</span>` : ""}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.colour ?? "—"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${item.size ?? "—"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;text-align:center;font-weight:700;">${item.quantity}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${bo?.estimatedDueDate ? fmtDate(bo.estimatedDueDate) : "<em style='color:#aaa'>TBC</em>"}</td>
                <td style="padding:5px 10px;border-bottom:1px solid #fef3c7;font-size:10pt;">${recipient ?? "—"}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>` : "";

    return `
      ${isDraft ? `<div style="background:#dc2626;color:white;text-align:center;font-size:11pt;font-weight:900;letter-spacing:.14em;padding:7px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">DRAFT — PARTIAL DISPATCH — NOT ALL ITEMS INCLUDED</div>` : ""}
      <div style="background:#1e293b;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${sbsLogoHtml}
        <div style="text-align:center;">
          <div style="font-size:14pt;font-weight:900;color:white;letter-spacing:.08em;text-transform:uppercase;">Delivery Note</div>
          <div style="font-size:9pt;color:#94a3b8;margin-top:2px;font-family:monospace;">${order.orderNumber}</div>
        </div>
        ${custLogoHtml}
      </div>
      <div style="background:#1e3a5f;padding:10px 0 10px 18px;display:flex;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
        ${infoStripCols}
      </div>
      <div style="padding:18px 28px 0;">
        <div style="display:flex;gap:32px;margin-bottom:16px;">
          <div style="flex:1;">
            <div style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px;">Deliver To</div>
            <p style="font-size:10pt;line-height:1.6;">${dtBlock}</p>
          </div>
          <div style="flex:1;">
            <div style="font-size:7.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:5px;">Select Branding Solutions</div>
            <p style="font-size:9pt;line-height:1.6;color:#555;">Spence Mills, Mill Lane<br>Leeds, LS13 3HE<br>info@selectbranding.co.uk<br>www.selectbranding.co.uk</p>
          </div>
        </div>
        ${isPart ? `<div style="background:#1e293b;padding:7px 10px;margin-bottom:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;"><span style="font-size:10.5pt;font-weight:900;color:white;letter-spacing:.04em;text-transform:uppercase;">Items Delivered Now</span></div>` : ""}
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#1e293b;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Item</th>
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Colour</th>
              <th style="padding:7px 10px;text-align:left;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Size</th>
              <th style="padding:7px 10px;text-align:center;font-size:8.5pt;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${gRows}
            ${sRows}
            <tr style="border-top:2px solid #1e293b;">
              <td colspan="3" style="padding:7px 10px;text-align:right;font-weight:700;font-size:10pt;">Total Items</td>
              <td style="padding:7px 10px;text-align:center;font-weight:900;font-size:13pt;">${totQty}</td>
            </tr>
          </tbody>
        </table>
        ${toFollow}
        <div style="margin-top:22px;display:flex;gap:40px;">
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Packed by: ______________________</div>
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Checked by: ______________________</div>
          <div style="flex:1;border-top:1px solid #999;padding-top:5px;font-size:9pt;color:#555;">Date: ______________________</div>
        </div>
        ${shippingLabel ? `
        <div style="margin-top:18px;background:#0f172a;border-radius:6px;padding:10px 18px;display:flex;align-items:center;gap:16px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
          <span style="font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#64748b;flex-shrink:0;">Delivery Method</span>
          <span style="font-size:15pt;font-weight:900;color:#fff;letter-spacing:.02em;">${shippingLabel}</span>
        </div>` : ""}
        <div style="margin-top:14px;margin-bottom:20px;font-size:8pt;color:#aaa;border-top:1px solid #e5e7eb;padding-top:8px;text-align:center;">
          Please check contents carefully. Any discrepancies should be reported within 48 hours of receipt.${pendItems.length > 0 ? " Outstanding items will be dispatched as soon as they become available." : ""}<br>
          Select Branding Solutions Ltd · Spence Mills, Mill Lane, Leeds, LS13 3HE · info@selectbranding.co.uk
        </div>
      </div>`;
  };

  const infoCols: { label: string; value: string }[] = [
    { label: "Order Date", value: fmtDate(order.orderDate) },
    { label: "Required By", value: fmtDate(order.requiredDate) },
    { label: "Dispatched",  value: fmtDate(new Date()) },
    { label: "Order Ref",   value: order.orderNumber },
  ];
  if (order.poNumber) infoCols.push({ label: "PO Number", value: order.poNumber });
  if (shippingLabel) infoCols.push({ label: "Delivery", value: shippingLabel });
  if (order.trackingNumber && order.shippingMethod === "dpd") infoCols.push({ label: "Tracking", value: order.trackingNumber });

  const infoStripCols = infoCols.map(col =>
    `<div style="flex:1;padding:0 10px;border-right:1px solid rgba(255,255,255,.15);">
      <div style="font-size:7pt;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">${col.label}</div>
      <div style="font-size:9.5pt;font-weight:700;color:white;margin-top:2px;">${col.value}</div>
    </div>`
  ).join("");

  const sbsLogoHtml = SBS_LOGO_DATA_URL
    ? `<img src="${SBS_LOGO_DATA_URL}" alt="Select Branding Solutions" style="height:44px;width:auto;display:block;" />`
    : `<span style="font-size:15pt;font-weight:900;color:white;">Select Branding Solutions</span>`;

  const custLogoHtml = customerLogoDataUrl
    ? `<img src="${customerLogoDataUrl}" alt="${(order.customerName ?? "").replace(/"/g, "&quot;")}" style="height:44px;width:auto;max-width:130px;display:block;" />`
    : `<span></span>`;

  // Build sheet(s): one per address group (single sheet for single-address orders)
  // For single-address: use the effective address id from the map (may be an employee address)
  const singleEffAddrId: number | null = !isMultiAddr
    ? (([...addrGroupMap.keys()][0] as number | null | undefined) ?? null)
    : null;
  const sheetsHtml = isMultiAddr
    ? [...addrGroupMap.entries()].map(([effId, { dispItems, pendItems }]) =>
        `<div style="background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15);">${buildSheetHtml(effId as number | null, dispItems, pendItems)}</div>`
      ).join("")
    : `<div id="sheet">${buildSheetHtml(
        singleEffAddrId !== null && singleEffAddrId > 0 ? singleEffAddrId : null,
        dispatchedItems, pendingItems
      )}</div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${isDraft ? "DRAFT " : ""}Delivery Note — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif;font-size:10pt;color:#111827}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:10px 24px;background:#1e293b;color:white;box-shadow:0 2px 8px rgba(0,0,0,.3)}
    #toolbar .title{flex:1;font-size:14px;font-weight:600}
    #toolbar button{padding:7px 22px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white}
    #page{display:flex;flex-direction:column;align-items:center;gap:24px;padding:28px 0 48px}
    #sheet{background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    @media print{
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0}
      #sheet,#page>div{box-shadow:none;width:100%;page-break-after:always}
      #sheet:last-child,#page>div:last-child{page-break-after:avoid}
      @page{size:A4;margin:12mm}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <span class="title">📄 ${isDraft ? "DRAFT — " : ""}Delivery Note · ${order.orderNumber} · ${(order.customerName ?? "").replace(/</g, "&lt;")}${isMultiAddr ? ` · ${addrGroupMap.size} addresses` : ""}</span>
    <button id="btn-box" onclick="window.open('/api/orders/${orderId}/shipping-label','_blank')" style="background:#f59e0b;color:white">🏷 Print Box Label</button>
    <button id="btn-print" onclick="window.print()">🖨 Print Delivery Note</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">
    ${sheetsHtml}
  </div>
  <script>document.getElementById('btn-print').focus();</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

const WEARER_LOGO_HTML = `<img src="data:image/png;base64,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" alt="SBS" class="sbs-logo" />`;

function renderWearerItemTable(items: Array<{
  productName: string; colour: string | null; size: string | null;
  quantity: number; finishName: string | null; productSku?: string | null;
}>) {
  return `
    <table class="items-table">
      <thead><tr>
        <th class="col-product">Item</th>
        <th class="col-code">FCC Code</th>
        <th class="col-colour">Colour</th>
        <th class="col-size">Size</th>
        <th class="col-qty">Qty</th>
      </tr></thead>
      <tbody>
        ${items.map(item => `<tr>
          <td class="col-product">${item.productName}${item.finishName ? `<br><span class="finish-sub">${item.finishName}</span>` : ""}</td>
          <td class="col-code">${item.productSku ?? "\u2014"}</td>
          <td class="col-colour">${item.colour ?? "\u2014"}</td>
          <td class="col-size">${item.size ?? "\u2014"}</td>
          <td class="col-qty">${item.quantity}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

// ── Standalone box / shipping label (4×3 in) ─────────────────────────────────
router.get("/orders/:id/shipping-label", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingMethodLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : "Not specified";
  const isDpd = !!order.shippingMethod?.toLowerCase().includes("dpd");

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null; notes: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;

  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    const empRows = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
      .from(orderItemsTable)
      .innerJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
    const empAddrIds = [...new Set(empRows.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  if (order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const addrLines = deliveryAddress
    ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean)
    : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean);

  const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;
  const contactPhone = customerContact?.phone || null;

  const numBoxes = Math.max(1, order.numberOfBoxes ?? 1);

  const buildLabel = (boxNum: number) => `<div class="label delivery-label">
    <div class="dl-header">
      <span class="dl-badge">BOX LABEL${numBoxes > 1 ? ` · ${boxNum} of ${numBoxes}` : ""}</span>
      <span class="dl-order">${order.orderNumber}</span>
    </div>
    <div class="dl-customer">${order.customerName ?? ""}</div>
    <div class="dl-divider"></div>
    <div class="dl-row"><span class="dl-key">Delivery</span><span class="dl-val">${shippingMethodLabel}</span></div>
    ${isDpd && order.trackingNumber ? `<div class="dl-row"><span class="dl-key">DPD</span><span class="dl-val dl-tracking">${order.trackingNumber}</span></div>` : ""}
    ${order.poNumber ? `<div class="dl-row"><span class="dl-key">PO Ref</span><span class="dl-val">${order.poNumber}</span></div>` : ""}
    ${contactName ? `<div class="dl-row"><span class="dl-key">Contact</span><span class="dl-val">${contactName}</span></div>` : ""}
    ${contactPhone ? `<div class="dl-row"><span class="dl-key">Phone</span><span class="dl-val">${contactPhone}</span></div>` : ""}
    ${addrLines.length > 0 ? `<div class="dl-addr-block">${addrLines.map(l => `<div>${l}</div>`).join("")}</div>` : ""}
  </div>`;

  const labelHtml = Array.from({ length: numBoxes }, (_, i) => buildLabel(i + 1)).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Box Label — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}
    .label{width:4in;height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}
    .delivery-label{display:flex;flex-direction:column;padding:0}
    .dl-header{background:white;color:#000;padding:0.1in 0.2in 0.08in;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000}
    .dl-badge{font-size:8pt;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .dl-order{font-size:11pt;font-weight:900;font-family:monospace}
    .dl-customer{font-size:18pt;font-weight:900;color:#000;padding:0.08in 0.2in 0.04in;line-height:1.1;word-break:break-word}
    .dl-divider{border-top:1.5px solid #000;margin:0 0.2in 0.06in}
    .dl-row{display:flex;align-items:baseline;gap:8px;padding:0.03in 0.2in}
    .dl-key{font-size:7pt;color:#000;text-transform:uppercase;letter-spacing:.06em;width:0.7in;flex-shrink:0;font-weight:700}
    .dl-val{font-size:10pt;font-weight:600;color:#000}
    .dl-tracking{font-family:monospace;font-size:10pt}
    .dl-addr-block{font-size:9pt;color:#000;font-weight:600;padding:0.06in 0.2in 0;line-height:1.4}
    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;min-height:3in;height:auto;border:none;border-radius:0;box-shadow:none;page-break-after:always;overflow:visible}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">📦 Box Label${numBoxes > 1 ? ` (${numBoxes} copies)` : ""} · ${(order.customerName ?? order.orderNumber).replace(/</g, "&lt;")} · ${order.orderNumber}</div>
      <div id="toolbar-sub">⚠️ Paper: <strong>User defined 4×3 in</strong> · Orientation: <strong>Landscape</strong> · Margins: None (GC420d)</div>
    </div>
    <button id="btn-print" onclick="window.print()">🖨 Print Label</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">${labelHtml}</div>
  <script>document.getElementById('btn-print').focus();</script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

// ── Wearer Labels HTML ────────────────────────────────────────────────────────
router.get("/orders/:id/wearer-labels", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).send("Bad request"); return; }

  const orderId = parsed.data.id;
  const dispatchedIdsRaw = req.query.dispatchedItemIds ? String(req.query.dispatchedItemIds) : null;
  const dispatchedIds: number[] | null = dispatchedIdsRaw
    ? dispatchedIdsRaw.split(",").map(Number).filter(n => !isNaN(n) && n > 0)
    : null;
  const includeDeliveryLabel = req.query.includeDeliveryLabel === "1";
  const recipientFilter = req.query.recipient ? String(req.query.recipient).trim() : null;

  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).send("Order not found"); return; }

  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku, isService: productsTable.isService })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
    lineTotal:  parseFloat(String(r.item.lineTotal ?? "0")),
    employee: r.employee ?? null,
    productSku: r.productSku ?? null,
    isService: r.isService ?? false,
  }));

  const dispatchedItems = dispatchedIds ? allItems.filter(i => dispatchedIds.includes(i.id)) : allItems;
  // Service items (e.g. "Logo Conversion to Stitches") are never physical goods — exclude them
  // from "Items to Follow" as they cannot be delivered separately.
  const pendingItems    = dispatchedIds ? allItems.filter(i => !dispatchedIds.includes(i.id) && !i.isService) : [];

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null; notes: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;
  if (includeDeliveryLabel && order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (includeDeliveryLabel && order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };
  const shippingMethodLabel = order.shippingMethod ? (SHIPPING_LABELS[order.shippingMethod] ?? order.shippingMethod) : "Not specified";
  const isDpd = !!order.shippingMethod?.toLowerCase().includes("dpd");

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };
  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  // Group dispatched items by wearer name
  const wearerMap = new Map<string, { name: string; jobTitle: string | null; items: typeof allItems }>();
  for (const item of dispatchedItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    if (!wearerMap.has(name)) wearerMap.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, items: [] });
    wearerMap.get(name)!.items.push(item);
  }

  // Group pending items by wearer name (for "Items to Follow" label)
  const pendingWearerMap = new Map<string, typeof allItems>();
  for (const item of pendingItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    if (!pendingWearerMap.has(name)) pendingWearerMap.set(name, []);
    pendingWearerMap.get(name)!.push(item);
  }

  // Filter to a single recipient when ?recipient= is provided
  if (recipientFilter) {
    for (const key of wearerMap.keys()) {
      if (key !== recipientFilter) wearerMap.delete(key);
    }
    if (wearerMap.size === 0) {
      res.status(400).send(`No label found for recipient "${recipientFilter}".`);
      return;
    }
  }

  if (wearerMap.size === 0) {
    res.status(400).send("No named recipients found for wearer labels.");
    return;
  }

  const logoHtml = WEARER_LOGO_HTML;

  const renderItemTable = (items: typeof allItems) => renderWearerItemTable(items as any);

  const labels: string[] = [];

  // ── Delivery label (first, when requested) ────────────────────────────────
  if (includeDeliveryLabel) {
    const addrLines = deliveryAddress
      ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean)
      : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean);
    const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;
    const contactPhone = customerContact?.phone || null;
    labels.push(`<div class="label delivery-label">
      <div class="dl-header">
        <span class="dl-badge">DELIVERY LABEL</span>
        <span class="dl-order">${order.orderNumber}</span>
      </div>
      <div class="dl-customer">${order.customerName ?? ""}</div>
      <div class="dl-divider"></div>
      <div class="dl-row"><span class="dl-key">Delivery method</span><span class="dl-val">${shippingMethodLabel}</span></div>
      ${isDpd ? `<div class="dl-row"><span class="dl-key">DPD tracking</span><span class="dl-val dl-tracking">${order.trackingNumber ?? "To be assigned"}</span></div>` : ""}
      ${contactName ? `<div class="dl-row"><span class="dl-key">Contact</span><span class="dl-val">${contactName}</span></div>` : ""}
      ${contactPhone ? `<div class="dl-row"><span class="dl-key">Phone</span><span class="dl-val">${contactPhone}</span></div>` : ""}
      ${addrLines.length > 0 ? `<div class="dl-addr-block">${addrLines.map(l => `<div>${l}</div>`).join("")}</div>` : ""}
    </div>`);
  }

  // ── One label per named wearer ────────────────────────────────────────────
  for (const [name, wearer] of wearerMap) {
    const pending = pendingWearerMap.get(name);
    const followSection = pending?.length
      ? `<div class="follow-section">
          <div class="follow-heading">Items to Follow:-</div>
          ${renderItemTable(pending)}
        </div>`
      : "";
    labels.push(`<div class="label wearer-label">
      <div class="wearer-name-row">
        <div class="wearer-name">${name}</div>
      </div>
      <div class="label-sub-row">
        ${logoHtml}
        ${wearer.jobTitle ? `<span class="job-title">${wearer.jobTitle}</span>` : ""}
      </div>
      ${renderItemTable(wearer.items)}
      ${followSection}
      <div class="label-footer">
        <span class="footer-customer">${order.customerName ?? ""}</span>
        <span class="footer-order">${order.orderNumber}</span>
      </div>
    </div>`);
  }

  const totalCount = labels.length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wearer Labels — ${order.orderNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-dl{background:#3b82f6;color:white;margin-left:4px}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}

    /* ── Label shell (4×3 in) ── */
    .label{width:4in;height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}

    /* ── Wearer label inner layout ── */
    .wearer-label{display:flex;flex-direction:column;padding:0.12in 0.18in 0.1in}
    .wearer-name-row{border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:4px;width:100%}
    .wearer-name{font-size:12pt;font-weight:900;color:#000;line-height:1.2;white-space:normal;word-break:break-word;display:block;width:100%}
    .label-sub-row{display:flex;align-items:center;gap:10px;margin-bottom:4px}
    .sbs-logo{height:0.42in;width:auto;flex-shrink:0;filter:grayscale(100%) contrast(200%)}
    .job-title{font-size:8pt;color:#333}
    .follow-section{margin-top:3px}
    .follow-heading{font-size:6pt;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:.06em;margin-bottom:2px;border-top:1px dashed #000;padding-top:3px}

    /* ── Items table ── */
    .items-table{width:100%;border-collapse:collapse}
    .items-table thead tr{border-bottom:1.5px solid #000}
    .items-table th{color:#000;font-size:6pt;text-transform:uppercase;letter-spacing:.04em;padding:2px 4px;text-align:left;font-weight:700}
    .items-table td{padding:2px 4px;border-bottom:0.5px solid #ccc;font-size:8pt;vertical-align:middle;color:#000}
    .col-product{width:42%}.col-code{width:13%}.col-colour{width:19%}.col-size{width:13%}
    .col-qty{width:9%;text-align:center;font-weight:700}
    .finish-sub{font-size:6pt;color:#000;font-style:italic}

    /* ── Label footer (customer + order number) ── */
    .label-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;border-top:1px solid #ccc}
    .footer-customer{font-size:8pt;font-weight:700;color:#000;letter-spacing:.02em}
    .footer-order{font-size:8pt;font-weight:600;color:#555;font-family:monospace}

    /* ── Delivery label ── */
    .delivery-label{display:flex;flex-direction:column;padding:0}
    .dl-header{background:white;color:#000;padding:0.07in 0.18in 0.06in;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #000}
    .dl-badge{font-size:7.5pt;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
    .dl-order{font-size:10pt;font-weight:900;font-family:monospace}
    .dl-customer{font-size:15pt;font-weight:900;color:#000;padding:0.05in 0.18in 0.03in;line-height:1.15;word-break:break-word}
    .dl-divider{border-top:1.5px solid #000;margin:0 0.18in 0.04in}
    .dl-row{display:flex;align-items:baseline;gap:8px;padding:0.025in 0.18in}
    .dl-key{font-size:6.5pt;color:#000;text-transform:uppercase;letter-spacing:.06em;width:0.9in;flex-shrink:0;font-weight:700}
    .dl-val{font-size:9.5pt;font-weight:600;color:#000}
    .dl-tracking{font-family:monospace;font-size:9.5pt;color:#000}
    .dl-addr-block{font-size:8.5pt;color:#000;font-weight:600;padding:0.04in 0.18in 0;line-height:1.35}

    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;height:3in;border:none;border-radius:0;box-shadow:none;overflow:hidden;page-break-after:always;break-after:page}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">🏷️ ${totalCount} Label${totalCount !== 1 ? "s" : ""} · ${(order.customerName ?? order.orderNumber).replace(/</g, "&lt;")}</div>
      <div id="toolbar-sub"><span id="_qz_status" style="font-style:italic;opacity:.85">Starting…</span></div>
    </div>
    <button id="btn-print" onclick="window.print()">🖨 Print manually</button>
    <button id="btn-dl" onclick="downloadPdf()">💾 Download PDF</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">${labels.join("\n")}</div>
  <script>
    function downloadPdf() {
      var hint = document.createElement('div');
      hint.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1e3a5f;color:white;padding:12px 24px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.35);white-space:nowrap';
      hint.innerHTML = '&#128161; In the print dialog set <strong>Destination</strong> &rarr; <strong>Save as PDF</strong>';
      document.body.appendChild(hint);
      setTimeout(function() { window.print(); setTimeout(function() { hint.remove(); }, 4000); }, 300);
    }
    (function(){
      var KEY='sbs_label_printer';
      function getPrinter(){try{return localStorage.getItem(KEY)||'TSC DA210';}catch(e){return 'TSC DA210';}}
      function setStatus(t){var el=document.getElementById('_qz_status');if(el)el.textContent=t;}
      function buildPrintHtml(){
        var c=document.documentElement.cloneNode(true);
        var rem=c.querySelectorAll('#toolbar,script');
        for(var i=0;i<rem.length;i++){if(rem[i].parentNode)rem[i].parentNode.removeChild(rem[i]);}
        return '<!DOCTYPE html><html>'+c.innerHTML+'</html>';
      }
      window.addEventListener('load',function(){
        var printer=getPrinter();
        setStatus('Connecting to QZ Tray\u2026');
        var s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
        s.onload=function(){
          var qz=window.qz;
          qz.security.setCertificatePromise(function(){return Promise.resolve('');});
          qz.security.setSignatureAlgorithm('SHA512');
          qz.security.setSignaturePromise(function(){return Promise.resolve('');});
          var conn=qz.websocket.isActive()?Promise.resolve():qz.websocket.connect({retries:1,delay:0.5});
          conn.then(function(){
            setStatus('Sending to '+printer+'\u2026');
            return qz.print(qz.configs.create(printer),[{type:'pixel',format:'html',flavor:'plain',data:buildPrintHtml()}]);
          }).then(function(){
            setStatus('\u2714 Sent to '+printer);
          }).catch(function(e){
            setStatus('QZ Tray error \u2014 using browser dialog');
            console.warn('QZ Tray error:',e&&e.message);
            window.print();
          });
        };
        s.onerror=function(){
          setStatus('QZ Tray not running \u2014 using browser dialog');
          window.print();
        };
        document.head.appendChild(s);
      });
    })();
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});


// ── Bulk Wearer Labels HTML (by customer name or order number) ──────────────
router.get("/wearer-labels/bulk", async (req, res): Promise<void> => {
  const customerQ = req.query.customer ? String(req.query.customer).trim() : null;
  const orderNumberQ = req.query.orderNumber ? String(req.query.orderNumber).trim() : null;

  if (!customerQ && !orderNumberQ) {
    res.status(400).send("Provide ?customer= or ?orderNumber= query parameter.");
    return;
  }

  // Find matching orders (confirmed or dispatched)
  let orderRows: typeof ordersTable.$inferSelect[] = [];
  if (orderNumberQ) {
    orderRows = await db.select().from(ordersTable)
      .where(and(
        sql`LOWER(${ordersTable.orderNumber}) = LOWER(${orderNumberQ})`,
        inArray(ordersTable.status, ["confirmed", "dispatched"]),
      ));
  } else if (customerQ) {
    orderRows = await db.select().from(ordersTable)
      .where(and(
        sql`LOWER(${ordersTable.customerName}) LIKE ${'%' + customerQ.toLowerCase() + '%'}`,
        inArray(ordersTable.status, ["confirmed", "dispatched"]),
      ));
  }

  if (orderRows.length === 0) {
    res.status(404).send(`<!DOCTYPE html><html><head><title>No Orders Found</title>
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f7fa}
.card{background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);padding:2rem;max-width:400px;text-align:center}
h1{color:#1e3a5f;font-size:1.2rem}p{color:#555}button{margin-top:1rem;background:#1e3a5f;color:#fff;border:none;border-radius:6px;padding:.6rem 1.2rem;cursor:pointer;font-size:.9rem}</style></head>
<body><div class="card"><h1>No orders found</h1><p>No confirmed or dispatched orders matched <strong>${
  orderNumberQ ?? customerQ
}</strong>.</p><button onclick="window.close()">Close</button></div></body></html>`);
    return;
  }

  const allLabels: string[] = [];
  const orderSummaries: string[] = [];

  for (const order of orderRows) {
    const itemRows = await db
      .select({ item: orderItemsTable, employee: customerEmployeesTable, productSku: productsTable.sku })
      .from(orderItemsTable)
      .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
      .where(eq(orderItemsTable.orderId, order.id));

    const allItems = itemRows.map(r => ({
      ...r.item,
      unitPrice: parseFloat(String(r.item.unitPrice ?? "0")),
      lineTotal:  parseFloat(String(r.item.lineTotal ?? "0")),
      employee: r.employee ?? null,
      productSku: r.productSku ?? null,
    }));

    const empName = (item: typeof allItems[0]) => {
      if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
      return item.recipientName ?? null;
    };
    const isNamed = (item: typeof allItems[0]) =>
      item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

    const wearerMap = new Map<string, { name: string; jobTitle: string | null; items: typeof allItems }>();
    for (const item of allItems.filter(isNamed)) {
      const name = empName(item) ?? "Unknown";
      if (!wearerMap.has(name)) wearerMap.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, items: [] });
      wearerMap.get(name)!.items.push(item);
    }

    if (wearerMap.size === 0) continue;

    orderSummaries.push(`${order.orderNumber} (${wearerMap.size} wearer${wearerMap.size !== 1 ? "s" : ""})`);

    for (const [, wearer] of wearerMap) {
      allLabels.push(`<div class="label wearer-label">
      <div class="wearer-name-row">
        <div class="wearer-name">${wearer.name}</div>
      </div>
      <div class="label-sub-row">
        ${WEARER_LOGO_HTML}
        ${wearer.jobTitle ? `<span class="job-title">${wearer.jobTitle}</span>` : ""}
      </div>
      ${renderWearerItemTable(wearer.items as any)}
      <div class="label-footer">
        <span class="footer-customer">${order.customerName ?? ""}</span>
        <span class="footer-order">${order.orderNumber}</span>
      </div>
    </div>`);
    }
  }

  if (allLabels.length === 0) {
    res.status(400).send("No named recipients found across the matched orders.");
    return;
  }

  const totalCount = allLabels.length;
  const summaryText = orderSummaries.join(", ");
  const titleText = orderNumberQ ?? customerQ ?? "Bulk";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Wearer Labels — ${titleText}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;color:#000}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar-text{flex:1}
    #toolbar-title{font-size:14px;font-weight:700}
    #toolbar-sub{font-size:12px;opacity:.8;margin-top:2px}
    #toolbar button{padding:7px 20px;border:none;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
    #btn-print{background:#22c55e;color:white}
    #btn-close{background:rgba(255,255,255,.15);color:white;margin-left:4px}
    #page{padding:20px;display:flex;flex-direction:column;gap:16px;align-items:center}
    .label{width:4in;min-height:3in;background:white;border:1px solid #999;border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.15);overflow:hidden}
    .wearer-label{display:flex;flex-direction:column;padding:0.12in 0.18in 0.1in}
    .wearer-name-row{border-bottom:2px solid #000;padding-bottom:3px;margin-bottom:4px;width:100%}
    .wearer-name{font-size:12pt;font-weight:900;color:#000;line-height:1.2;white-space:normal;word-break:break-word;display:block;width:100%}
    .label-sub-row{display:flex;align-items:center;gap:10px;margin-bottom:4px}
    .sbs-logo{height:0.42in;width:auto;flex-shrink:0;filter:grayscale(100%) contrast(200%)}
    .job-title{font-size:8pt;color:#333}
    .items-table{width:100%;border-collapse:collapse}
    .items-table thead tr{border-bottom:1.5px solid #000}
    .items-table th{color:#000;font-size:6pt;text-transform:uppercase;letter-spacing:.04em;padding:2px 4px;text-align:left;font-weight:700}
    .items-table td{padding:2px 4px;border-bottom:0.5px solid #ccc;font-size:8pt;vertical-align:middle;color:#000}
    .col-product{width:42%}.col-code{width:13%}.col-colour{width:19%}.col-size{width:13%}
    .col-qty{width:9%;text-align:center;font-weight:700}
    .finish-sub{font-size:6pt;color:#000;font-style:italic}
    .label-footer{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;border-top:1px solid #ccc}
    .footer-customer{font-size:8pt;font-weight:700;color:#000;letter-spacing:.02em}
    .footer-order{font-size:8pt;font-weight:600;color:#555;font-family:monospace}
    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{margin:0!important;padding:0!important;width:4in}
      #toolbar{display:none}
      body{background:white}
      #page{padding:0;gap:0;margin:0;align-items:flex-start}
      .label{width:4in;height:3in;border:none;border-radius:0;box-shadow:none;overflow:hidden;page-break-after:always;break-after:page}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <div id="toolbar-text">
      <div id="toolbar-title">🏷️ ${totalCount} Label${totalCount !== 1 ? "s" : ""} · ${titleText}</div>
      <div id="toolbar-sub">⚠️ Paper: <strong>User defined 4×3 in</strong> · Orientation: <strong>Landscape</strong> · Margins: <strong>None</strong> &nbsp;·&nbsp; ${summaryText}</div>
    </div>
    <button id="btn-print" onclick="window.print()">🖨 Print All Labels</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">${allLabels.join("\n")}</div>
  <script>
    document.getElementById('btn-print').focus();
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
});

// ─── Order Activity Log ───────────────────────────────────────────────────────
router.get("/orders/:id/logs", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const logs = await db
    .select()
    .from(orderLogsTable)
    .where(eq(orderLogsTable.orderId, params.data.id))
    .orderBy(asc(orderLogsTable.createdAt));

  res.json(logs);
});

// ── Label data JSON (for Zebra Browser Print / ZPL generation) ───────────────
router.get("/orders/:id/label-data", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: "Bad request" }); return; }

  const orderId = parsed.data.id;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) { res.status(404).json({ error: "Order not found" }); return; }

  const SHIPPING_LABELS: Record<string, string> = {
    free_local: "Free Local Delivery", local_delivery: "Local Delivery",
    office_collection: "Office Collection", warehouse_collection: "Warehouse Collection",
    courier: "Courier", dpd: "DPD Courier",
  };

  let deliveryAddress: { line1: string | null; line2: string | null; city: string | null; postcode: string | null; country: string | null } | null = null;
  let customerContact: { contactFirstName: string | null; contactLastName: string | null; phone: string | null; address: string | null; city: string | null; postcode: string | null } | null = null;

  if (order.deliveryAddressId) {
    const [addr] = await db.select().from(customerDeliveryAddressesTable)
      .where(eq(customerDeliveryAddressesTable.id, order.deliveryAddressId));
    deliveryAddress = addr ?? null;
  }
  if (!deliveryAddress) {
    const empRows = await db.select({ deliveryAddressId: (customerEmployeesTable as any).deliveryAddressId })
      .from(orderItemsTable)
      .innerJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
      .where(eq(orderItemsTable.orderId, orderId));
    const empAddrIds = [...new Set(empRows.map((e: any) => e.deliveryAddressId as number | null).filter((id): id is number => id != null))];
    if (empAddrIds.length === 1) {
      const [addr] = await db.select().from(customerDeliveryAddressesTable).where(eq(customerDeliveryAddressesTable.id, empAddrIds[0]));
      deliveryAddress = addr ?? null;
    }
  }
  if (order.customerId) {
    const [cust] = await db.select({
      contactFirstName: customersTable.contactFirstName,
      contactLastName: customersTable.contactLastName,
      phone: customersTable.phone,
      address: customersTable.address,
      city: customersTable.city,
      postcode: customersTable.postcode,
    }).from(customersTable).where(eq(customersTable.id, order.customerId));
    customerContact = cust ?? null;
  }

  const addrLines = deliveryAddress
    ? [deliveryAddress.line1, deliveryAddress.line2, deliveryAddress.city, deliveryAddress.postcode, deliveryAddress.country].filter(Boolean) as string[]
    : [customerContact?.address, customerContact?.city, customerContact?.postcode].filter(Boolean) as string[];

  const contactName = [customerContact?.contactFirstName, customerContact?.contactLastName].filter(Boolean).join(" ") || null;

  // Wearer labels data
  const itemRows = await db
    .select({ item: orderItemsTable, employee: customerEmployeesTable })
    .from(orderItemsTable)
    .leftJoin(customerEmployeesTable, eq(orderItemsTable.recipientEmployeeId, customerEmployeesTable.id))
    .where(eq(orderItemsTable.orderId, orderId));

  const allItems = itemRows.map(r => ({
    ...r.item,
    employee: r.employee ?? null,
  }));

  const empName = (item: typeof allItems[0]) => {
    if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
    return item.recipientName ?? null;
  };
  const isNamed = (item: typeof allItems[0]) =>
    item.recipientType === "person" && !!(item.recipientName || item.recipientEmployeeId);

  // Fetch team names for any employees that have a teamId
  const teamIds = [...new Set(allItems.map(i => (i.employee as any)?.teamId as number | null | undefined).filter((id): id is number => id != null))];
  const teamMap = new Map<number, string>();
  if (teamIds.length > 0) {
    const teams = await db.select({ id: customerTeamsTable.id, name: customerTeamsTable.name })
      .from(customerTeamsTable)
      .where(inArray(customerTeamsTable.id, teamIds));
    for (const t of teams) teamMap.set(t.id, t.name);
  }

  const wearerMap = new Map<string, { name: string; jobTitle: string | null; employeeNumber: string | null; team: string | null; items: Array<{ productName: string; colour: string | null; size: string | null; quantity: number; finishName: string | null }> }>();
  for (const item of allItems.filter(isNamed)) {
    const name = empName(item) ?? "Unknown";
    if (!wearerMap.has(name)) {
      const teamId = (item.employee as any)?.teamId as number | null | undefined;
      wearerMap.set(name, {
        name,
        jobTitle: item.employee?.jobTitle ?? null,
        employeeNumber: (item.employee as any)?.employeeNumber ?? null,
        team: teamId ? (teamMap.get(teamId) ?? null) : null,
        items: [],
      });
    }
    wearerMap.get(name)!.items.push({
      productName: item.productName,
      colour: item.colour ?? null,
      size: item.size ?? null,
      quantity: item.quantity,
      finishName: item.finishName ?? null,
    });
  }

  res.json({
    orderNumber: order.orderNumber,
    customerName: order.customerName ?? "",
    shippingMethod: SHIPPING_LABELS[order.shippingMethod ?? ""] ?? order.shippingMethod ?? "",
    isDpd: !!order.shippingMethod?.toLowerCase().includes("dpd"),
    trackingNumber: order.trackingNumber ?? null,
    poNumber: order.poNumber ?? null,
    contactName,
    phone: customerContact?.phone ?? null,
    addressLines: addrLines,
    wearers: Array.from(wearerMap.values()),
  });
});

export default router;
