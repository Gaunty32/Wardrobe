import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  db, orderItemsTable, ordersTable, productsTable, suppliersTable,
  purchaseOrdersTable, purchaseOrderItemsTable, processStockTable, customerProcessesTable,
  productVariantsTable,
} from "@workspace/db";
import { sendEmail, generatePOPdf, buildPOEmail, isEmailConfigured } from "../services/email.js";
import { allocatePODelivery } from "../services/allocation.js";
import { ObjectStorageService } from "../lib/objectStorage.js";

const objectStorageService = new ObjectStorageService();

const router: IRouter = Router();

// ─── Rescan: restore any requirements lost due to PO deletion bugs ────────────

router.post("/purchasing/rescan", async (_req, res): Promise<void> => {
  // Full re-evaluation of ALL order items from active orders not already covered
  // by a live draft or ordered PO.
  //
  // Stock is matched at colour+size granularity:
  //   available = variant stock for (product, colour, size), or product stock
  //               for plain products that have no variants at all.
  //   shortfall = max(0, quantity - available)
  //
  // Idempotency: before allocating we "credit back" any stock previously
  // allocated to each candidate item, so the pool always starts from the true
  // unallocated total regardless of how many times rescan has run.

  const candidateRows = await db.execute(sql`
    SELECT oi.id, oi.product_id, oi.quantity, oi.purchase_required,
           oi.purchase_quantity, oi.colour, oi.size, oi.stock_status,
           -- Variant-level stock when a matching variant exists;
           -- product-level stock only for plain products with no variants at all.
           COALESCE(
             (SELECT pv.stock_quantity
              FROM product_variants pv
              WHERE pv.product_id = oi.product_id
                AND (pv.colour IS NOT DISTINCT FROM oi.colour)
                AND (pv.size   IS NOT DISTINCT FROM oi.size)
              LIMIT 1),
             CASE WHEN NOT EXISTS (
                    SELECT 1 FROM product_variants pv WHERE pv.product_id = oi.product_id
                  )
                  THEN p.stock_quantity
                  ELSE 0
             END
           ) AS available_stock,
           -- Prefer colour+size-specific variant supplier over the product-level default
           COALESCE(
             (SELECT pv2.primary_supplier_id
              FROM product_variants pv2
              WHERE pv2.product_id = oi.product_id
                AND (pv2.colour IS NOT DISTINCT FROM oi.colour)
                AND (pv2.size   IS NOT DISTINCT FROM oi.size)
                AND pv2.primary_supplier_id IS NOT NULL
              LIMIT 1),
             p.supplier_id
           ) AS supplier_id,
           COALESCE(
             (SELECT sv.name
              FROM product_variants pv2
              INNER JOIN suppliers sv ON sv.id = pv2.primary_supplier_id
              WHERE pv2.product_id = oi.product_id
                AND (pv2.colour IS NOT DISTINCT FROM oi.colour)
                AND (pv2.size   IS NOT DISTINCT FROM oi.size)
                AND pv2.primary_supplier_id IS NOT NULL
              LIMIT 1),
             s.name
           ) AS supplier_name,
           COALESCE(
             (SELECT sv.email
              FROM product_variants pv2
              INNER JOIN suppliers sv ON sv.id = pv2.primary_supplier_id
              WHERE pv2.product_id = oi.product_id
                AND (pv2.colour IS NOT DISTINCT FROM oi.colour)
                AND (pv2.size   IS NOT DISTINCT FROM oi.size)
                AND pv2.primary_supplier_id IS NOT NULL
              LIMIT 1),
             s.email
           ) AS supplier_email
    FROM order_items oi
    INNER JOIN orders o ON oi.order_id = o.id
    INNER JOIN products p ON p.id = oi.product_id
    LEFT  JOIN suppliers s ON s.id = p.supplier_id
    WHERE oi.product_id IS NOT NULL
      AND p.is_service IS NOT TRUE
      AND COALESCE(o.status, '') NOT IN ('cancelled', 'archived', 'completed', 'delivered', 'shipped', 'invoiced', 'draft', 'portal_draft', 'portal_pending')
      AND NOT EXISTS (
        SELECT 1
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.po_id = po.id
        WHERE po.status IN ('draft', 'ordered')
          AND (
            poi.order_item_id = oi.id
            OR oi.id IN (
              SELECT (elem.value)::integer
              FROM jsonb_array_elements_text(
                COALESCE(poi.source_order_item_ids, '[]'::jsonb)
              ) AS elem(value)
            )
          )
      )
    ORDER BY oi.id
  `);

  const candidates = candidateRows.rows as Array<{
    id: number; product_id: number; quantity: number;
    purchase_required: boolean; purchase_quantity: number | null;
    colour: string | null; size: string | null; stock_status: string | null;
    available_stock: number | null;
    supplier_id: number | null; supplier_name: string | null; supplier_email: string | null;
  }>;

  if (candidates.length === 0) {
    res.json({ restored: 0 });
    return;
  }

  // Key: "productId|colour|size" — stock pool per variant (or per plain product)
  const variantKey = (productId: number, colour: string | null, size: string | null) =>
    `${productId}|${colour ?? ""}|${size ?? ""}`;

  // Initialise pool from current DB stock
  const stockPool = new Map<string, number>();
  for (const row of candidates) {
    const k = variantKey(row.product_id, row.colour, row.size);
    if (!stockPool.has(k)) {
      stockPool.set(k, Number(row.available_stock) || 0);
    }
  }

  // Credit back stock previously allocated to each candidate so the pool
  // starts from the true unallocated total (makes the scan idempotent).
  for (const row of candidates) {
    const k = variantKey(row.product_id, row.colour, row.size);
    // Previously allocated = quantity − purchaseQuantity (when purchaseRequired)
    //                      = quantity                    (when fully covered, purchaseRequired=false)
    let prevAllocated = 0;
    if (!row.purchase_required && row.purchase_quantity === null) {
      prevAllocated = row.quantity; // was fully covered by stock
    } else if (row.purchase_required && row.purchase_quantity !== null && row.purchase_quantity < row.quantity) {
      prevAllocated = row.quantity - row.purchase_quantity; // partially covered
    }
    if (prevAllocated > 0) {
      stockPool.set(k, (stockPool.get(k) ?? 0) + prevAllocated);
    }
  }

  let restored = 0;
  // Track how much to deduct per variant key after allocation
  const toDeduct = new Map<string, { productId: number; colour: string | null; size: string | null; amount: number }>();

  for (const row of candidates) {
    const k = variantKey(row.product_id, row.colour, row.size);
    const available = stockPool.get(k) ?? 0;
    const qty = row.quantity ?? 0;
    const allocated = Math.min(available, qty);
    const shortfall = qty - allocated;

    stockPool.set(k, available - allocated);

    if (allocated > 0) {
      const entry = toDeduct.get(k);
      if (entry) entry.amount += allocated;
      else toDeduct.set(k, { productId: row.product_id, colour: row.colour, size: row.size, amount: allocated });
    }

    const newPurchaseRequired = shortfall > 0;
    const newPurchaseQuantity = shortfall > 0 ? shortfall : null;

    // When fully covered by stock: mark as allocated so it appears in the picking list.
    // Only promote to 'allocated' — never demote an item already in production or complete.
    const alreadyProgressed = ["in_production", "complete"].includes(row.stock_status ?? "");
    const newStockStatus = (!newPurchaseRequired && !alreadyProgressed && !row.stock_status)
      ? "allocated"
      : undefined;

    const unchanged =
      row.purchase_required === newPurchaseRequired &&
      (row.purchase_quantity ?? null) === newPurchaseQuantity &&
      newStockStatus === undefined;

    if (!unchanged) {
      await db.update(orderItemsTable)
        .set({
          purchaseRequired: newPurchaseRequired,
          purchaseQuantity: newPurchaseQuantity,
          supplierId: newPurchaseRequired ? (row.supplier_id ?? null) : null,
          supplierName: newPurchaseRequired ? (row.supplier_name ?? null) : null,
          ...(newStockStatus ? { stockStatus: newStockStatus, stockAllocatedAt: new Date() } : {}),
        })
        .where(eq(orderItemsTable.id, row.id));
      if (newPurchaseRequired) restored++;
    }
  }

  // Persist deductions: update variant stock (and roll up to product), or plain product stock
  for (const [, { productId, colour, size, amount }] of toDeduct.entries()) {
    if (amount <= 0) continue;
    if (colour !== null || size !== null) {
      // Variant-level deduction
      await db.execute(sql`
        UPDATE product_variants
        SET stock_quantity = GREATEST(0, stock_quantity - ${amount})
        WHERE product_id = ${productId}
          AND (colour IS NOT DISTINCT FROM ${colour})
          AND (size   IS NOT DISTINCT FROM ${size})
      `);
      // Roll up total to parent product
      await db.execute(sql`
        UPDATE products
        SET stock_quantity = (
          SELECT COALESCE(SUM(stock_quantity), 0)
          FROM product_variants
          WHERE product_id = ${productId}
        )
        WHERE id = ${productId}
      `);
    } else {
      // Plain product — deduct directly
      await db.execute(sql`
        UPDATE products
        SET stock_quantity = GREATEST(0, stock_quantity - ${amount})
        WHERE id = ${productId}
      `);
    }
  }

  res.json({ restored });
});

// ─── Requirements ────────────────────────────────────────────────────────────

router.get("/purchasing/requirements", async (req, res): Promise<void> => {
  const itemSupplier = alias(suppliersTable, "item_supplier");
  const productSupplier = alias(suppliersTable, "product_supplier");

  // Correlated subquery helpers: try exact colour+size match first, then colour-only
  // (handles order items with no size stored, or products where supplier is set at colour level)
  const variantSupplierIdSql = sql<number | null>`COALESCE(
    (SELECT pv.primary_supplier_id FROM product_variants pv
     WHERE pv.product_id = ${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1),
    (SELECT pv.primary_supplier_id FROM product_variants pv
     WHERE pv.product_id = ${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1)
  )`;

  const variantSupplierNameSql = sql<string | null>`COALESCE(
    (SELECT sv.name FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1),
    (SELECT sv.name FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1)
  )`;

  const variantSupplierEmailSql = sql<string | null>`COALESCE(
    (SELECT sv.email FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1),
    (SELECT sv.email FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1)
  )`;

  const variantSupplierCurrencySql = sql<string | null>`COALESCE(
    (SELECT sv.currency FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1),
    (SELECT sv.currency FROM product_variants pv JOIN suppliers sv ON sv.id=pv.primary_supplier_id
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.primary_supplier_id IS NOT NULL LIMIT 1)
  )`;

  const variantSupplierCodeSql = sql<string | null>`COALESCE(
    (SELECT pv.supplier_code FROM product_variants pv
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.supplier_code IS NOT NULL LIMIT 1),
    (SELECT pv.supplier_code FROM product_variants pv
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.supplier_code IS NOT NULL LIMIT 1)
  )`;

  const variantSupplierPriceSql = sql<string | null>`COALESCE(
    (SELECT pv.supplier_price FROM product_variants pv
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND LOWER(TRIM(COALESCE(pv.size,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.size},'')))
       AND pv.supplier_price IS NOT NULL LIMIT 1),
    (SELECT pv.supplier_price FROM product_variants pv
     WHERE pv.product_id=${orderItemsTable.productId}
       AND LOWER(TRIM(COALESCE(pv.colour,'')))=LOWER(TRIM(COALESCE(${orderItemsTable.colour},'')))
       AND pv.supplier_price IS NOT NULL LIMIT 1)
  )`;

  const rows = await db
    .select({
      itemId: orderItemsTable.id,
      orderId: orderItemsTable.orderId,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      productId: orderItemsTable.productId,
      productName: orderItemsTable.productName,
      colour: orderItemsTable.colour,
      size: orderItemsTable.size,
      purchaseQuantity: orderItemsTable.purchaseQuantity,
      supplierId: sql<number | null>`COALESCE(${variantSupplierIdSql}, ${orderItemsTable.supplierId}, ${productsTable.supplierId})`,
      supplierName: orderItemsTable.supplierName,
      resolvedSupplierName: sql<string | null>`COALESCE(${variantSupplierNameSql}, ${itemSupplier.name}, ${productSupplier.name})`,
      supplierEmail: sql<string | null>`COALESCE(${variantSupplierEmailSql}, ${itemSupplier.email}, ${productSupplier.email})`,
      supplierCode: sql<string | null>`COALESCE(${variantSupplierCodeSql}, ${productsTable.supplierCode})`,
      secondarySupplierCode: productsTable.secondarySupplierCode,
      productSku: productsTable.sku,
      canonicalProductName: productsTable.name,
      supplierPrice: sql<string | null>`COALESCE(${variantSupplierPriceSql}, ${productsTable.supplierPrice})`,
      supplierCurrency: sql<string | null>`COALESCE(${variantSupplierCurrencySql}, ${itemSupplier.currency}, ${productSupplier.currency})`,
      orderCreatedAt: ordersTable.createdAt,
      queuedAt: orderItemsTable.purchasingQueuedAt,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .leftJoin(itemSupplier, eq(orderItemsTable.supplierId, itemSupplier.id))
    .leftJoin(productSupplier, eq(productsTable.supplierId, productSupplier.id))
    .where(and(
      eq(orderItemsTable.purchaseRequired, true),
      sql`${productsTable.isService} IS NOT TRUE`,
      // Exclude items belonging to orders that are no longer active
      sql`COALESCE(${ordersTable.status}, '') NOT IN ('cancelled', 'archived', 'shipped', 'completed', 'delivered', 'invoiced', 'draft', 'portal_draft', 'portal_pending')`,
      sql`${orderItemsTable.id} NOT IN (
        SELECT poi.order_item_id
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.po_id = po.id
        WHERE po.status IN ('draft', 'ordered')
        AND poi.order_item_id IS NOT NULL
        UNION
        SELECT (elem.value)::integer
        FROM purchase_order_items poi
        INNER JOIN purchase_orders po ON poi.po_id = po.id,
        jsonb_array_elements_text(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) AS elem(value)
        WHERE po.status IN ('draft', 'ordered')
        AND jsonb_array_length(COALESCE(poi.source_order_item_ids, '[]'::jsonb)) > 0
      )`,
    ))
    .orderBy(
      sql`COALESCE(${itemSupplier.name}, ${productSupplier.name}, ${orderItemsTable.supplierName})`,
      orderItemsTable.productName,
    );

  const grouped: Record<string, {
    supplierId: number | null;
    supplierName: string;
    supplierEmail: string | null;
    supplierCurrency: string;
    items: typeof rows;
  }> = {};

  for (const row of rows) {
    const key = row.resolvedSupplierName ?? row.supplierName ?? "Unknown Supplier";
    if (!grouped[key]) {
      grouped[key] = { supplierId: row.supplierId, supplierName: key, supplierEmail: row.supplierEmail ?? null, supplierCurrency: row.supplierCurrency ?? "GBP", items: [] };
    }
    grouped[key].items.push(row);
  }

  const sortedGroups = Object.values(grouped).sort((a, b) => {
    const aUnknown = a.supplierId === null;
    const bUnknown = b.supplierId === null;
    if (aUnknown && !bUnknown) return -1;
    if (!aUnknown && bUnknown) return 1;
    return a.supplierName.localeCompare(b.supplierName);
  });
  res.json(sortedGroups);
});

router.post("/purchasing/mark-fulfilled", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  for (const itemId of parsed.data.itemIds) {
    await db.update(orderItemsTable).set({ purchaseRequired: false, purchaseQuantity: null }).where(eq(orderItemsTable.id, itemId));
  }
  res.json({ ok: true });
});

router.delete("/purchasing/requirements", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const itemIds = parsed.data.itemIds;
  const rows = await db
    .select({
      id: orderItemsTable.id,
      productId: orderItemsTable.productId,
      purchaseQuantity: orderItemsTable.purchaseQuantity,
      stockQuantity: productsTable.stockQuantity,
    })
    .from(orderItemsTable)
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.id, itemIds));

  // Group stock deductions by product so we handle multiple items per product correctly
  const productDeductions = new Map<number, number>();
  for (const row of rows) {
    if (row.productId) {
      productDeductions.set(row.productId, (productDeductions.get(row.productId) ?? 0) + (row.purchaseQuantity ?? 0));
    }
  }

  // Fetch current stock for each affected product
  const productIds = [...productDeductions.keys()];
  const productStockMap = new Map<number, number>();
  if (productIds.length > 0) {
    const stocks = await db
      .select({ id: productsTable.id, stockQuantity: productsTable.stockQuantity })
      .from(productsTable)
      .where(inArray(productsTable.id, productIds));
    for (const s of stocks) productStockMap.set(s.id, s.stockQuantity ?? 0);
  }

  for (const row of rows) {
    const needed = row.purchaseQuantity ?? 0;
    const stock = row.productId ? (productStockMap.get(row.productId) ?? 0) : 0;

    if (stock >= needed && row.productId && needed > 0) {
      // Stock covers it — allocate and clear
      const newStock = stock - needed;
      await db.update(productsTable).set({ stockQuantity: newStock }).where(eq(productsTable.id, row.productId));
      productStockMap.set(row.productId, newStock);
      await db.update(orderItemsTable).set({ purchaseRequired: false, purchaseQuantity: null }).where(eq(orderItemsTable.id, row.id));
    } else if (stock > 0 && row.productId) {
      // Partial stock — allocate what's available, re-queue remainder
      const shortfall = needed - stock;
      await db.update(productsTable).set({ stockQuantity: 0 }).where(eq(productsTable.id, row.productId));
      productStockMap.set(row.productId, 0);
      await db.update(orderItemsTable).set({ purchaseRequired: true, purchaseQuantity: shortfall }).where(eq(orderItemsTable.id, row.id));
    } else {
      // No stock — user explicitly chose to remove; clear the requirement
      await db.update(orderItemsTable).set({ purchaseRequired: false, purchaseQuantity: null }).where(eq(orderItemsTable.id, row.id));
    }
  }

  res.json({ ok: true });
});

// POST /purchasing/recheck-stock
// Re-evaluates all draft purchase requirements against current variant stock levels.
// Any order item where the variant now has enough stock to cover the purchase_quantity
// has purchase_required cleared and stock_status set to 'allocated'.
router.post("/purchasing/recheck-stock", async (req, res): Promise<void> => {
  // Find all active order items that still need purchasing.
  // Match variant stock via variant_id when set, or via product_id+colour+size fallback.
  const result = await db.execute(sql`
    WITH covered AS (
      SELECT oi.id AS item_id
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.purchase_required = true
        AND o.status NOT IN ('shipped','completed','delivered','invoiced','cancelled','archived','draft','portal_draft','portal_pending')
        AND COALESCE(
          -- Prefer explicit variant_id link
          CASE WHEN oi.variant_id IS NOT NULL THEN
            (SELECT pv.stock_quantity FROM product_variants pv WHERE pv.id = oi.variant_id)
          ELSE NULL END,
          -- Fall back to colour+size match on the product
          (SELECT pv.stock_quantity
           FROM product_variants pv
           WHERE pv.product_id = oi.product_id
             AND (pv.colour IS NOT DISTINCT FROM oi.colour)
             AND (pv.size   IS NOT DISTINCT FROM oi.size)
           LIMIT 1),
          -- Last resort: plain product stock (no variants at all)
          CASE WHEN NOT EXISTS (
            SELECT 1 FROM product_variants pv WHERE pv.product_id = oi.product_id
          ) THEN (SELECT p.stock_quantity FROM products p WHERE p.id = oi.product_id)
          ELSE 0 END
        ) >= COALESCE(oi.purchase_quantity, oi.quantity, 1)
    )
    UPDATE order_items oi
    SET purchase_required = false,
        purchase_quantity = NULL,
        stock_status = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    FROM covered
    WHERE oi.id = covered.item_id
    RETURNING oi.id
  `);
  const promoted = (result.rows as any[]).length;

  // Also promote stock-covered items that have no stock_status yet.
  // Plain items (no finish) go straight to 'complete'; decorated items to 'allocated'.
  await db.execute(sql`
    UPDATE order_items oi
    SET stock_status = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
        stock_allocated_at = NOW()
    FROM orders o
    WHERE oi.order_id = o.id
      AND oi.purchase_required = false
      AND oi.stock_status IS NULL
      AND o.status NOT IN ('shipped','completed','delivered','invoiced','cancelled','archived')
  `);

  res.json({ ok: true, promoted });
});

router.get("/purchasing/stock-check", async (req, res): Promise<void> => {
  const parsed = z.object({
    productId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
  }).safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [product] = await db
    .select({ id: productsTable.id, name: productsTable.name, stockQuantity: productsTable.stockQuantity, supplierId: productsTable.supplierId, supplierCode: productsTable.supplierCode, supplierName: suppliersTable.name, supplierEmail: suppliersTable.email })
    .from(productsTable)
    .leftJoin(suppliersTable, eq(productsTable.supplierId, suppliersTable.id))
    .where(eq(productsTable.id, parsed.data.productId));

  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const stock = product.stockQuantity ?? 0;
  const requested = parsed.data.quantity;
  const available = Math.min(stock, requested);
  const shortfall = Math.max(0, requested - stock);

  res.json({ productId: product.id, productName: product.name, stockQuantity: stock, requested, available, shortfall, purchaseRequired: shortfall > 0, supplierId: product.supplierId, supplierName: product.supplierName, supplierEmail: product.supplierEmail, supplierCode: product.supplierCode });
});

// ─── Purchase Orders ──────────────────────────────────────────────────────────

function parsePOItem(item: Record<string, unknown>) {
  return {
    ...item,
    supplierPrice: item.supplierPrice != null ? parseFloat(item.supplierPrice as string) : null,
  };
}

async function getPoWithItems(poId: number) {
  const [poRow] = await db
    .select({
      po: purchaseOrdersTable,
      supplierContactName: suppliersTable.contactName,
      supplierPhone: suppliersTable.phone,
      supplierAddress: suppliersTable.address,
    })
    .from(purchaseOrdersTable)
    .leftJoin(suppliersTable, eq(purchaseOrdersTable.supplierId, suppliersTable.id))
    .where(eq(purchaseOrdersTable.id, poId));
  if (!poRow) return null;
  const rows = await db
    .select({
      item: purchaseOrderItemsTable,
      productSku: sql<string | null>`COALESCE(
        ${productsTable.sku},
        (SELECT p2.sku FROM order_items oi2
         JOIN products p2 ON oi2.product_id = p2.id
         WHERE (${purchaseOrderItemsTable.sourceOrderItemIds}) @> to_jsonb(oi2.id)
         AND p2.sku IS NOT NULL
         LIMIT 1)
      )`,
      canonicalProductName: sql<string | null>`COALESCE(
        ${productsTable.name},
        (SELECT p2.name FROM order_items oi2
         JOIN products p2 ON oi2.product_id = p2.id
         WHERE (${purchaseOrderItemsTable.sourceOrderItemIds}) @> to_jsonb(oi2.id)
         LIMIT 1)
      )`,
      processStockFileUrl: sql<string | null>`COALESCE(
        ${processStockTable.fileUrl},
        (SELECT cp.file_url FROM customer_processes cp
         WHERE cp.process_stock_id = ${purchaseOrderItemsTable.processStockId}
         AND cp.file_url IS NOT NULL
         LIMIT 1)
      )`,
      customerName: sql<string | null>`(
        SELECT STRING_AGG(DISTINCT o.customer_name, ', ')
        FROM order_items oi2
        JOIN orders o ON oi2.order_id = o.id
        WHERE oi2.id = ANY(
          ARRAY(
            SELECT (elem)::int
            FROM jsonb_array_elements_text(
              COALESCE(${purchaseOrderItemsTable.sourceOrderItemIds}, '[]'::jsonb)
            ) AS t(elem)
          )
        )
      )`,
    })
    .from(purchaseOrderItemsTable)
    .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .leftJoin(processStockTable, eq(purchaseOrderItemsTable.processStockId, processStockTable.id))
    .where(and(
      eq(purchaseOrderItemsTable.poId, poId),
      // Exclude service products — they don't need purchasing
      sql`(${productsTable.isService} IS NOT TRUE OR ${productsTable.id} IS NULL)`,
    ));
  return {
    ...poRow.po,
    supplierContactName: poRow.supplierContactName ?? null,
    supplierPhone: poRow.supplierPhone ?? null,
    supplierAddress: poRow.supplierAddress ?? null,
    items: rows.map((r) => ({
      ...parsePOItem(r.item as Record<string, unknown>),
      productSku: r.productSku ?? null,
      canonicalProductName: r.canonicalProductName ?? null,
      processStockFileUrl: r.processStockFileUrl ?? null,
      customerName: r.customerName ?? null,
    })),
  };
}

async function buildPoItems(orderItemIds: number[], poId: number, qtyOverrides?: Record<string, number>) {
  const orderItems = await db
    .select({
      item: orderItemsTable,
      orderNumber: ordersTable.orderNumber,
      supplierCode: sql<string | null>`COALESCE(
        (SELECT pv.supplier_code FROM product_variants pv
         WHERE pv.product_id = ${orderItemsTable.productId}
           AND LOWER(TRIM(COALESCE(pv.colour, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.colour}, '')))
           AND LOWER(TRIM(COALESCE(pv.size, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.size}, '')))
           AND pv.supplier_code IS NOT NULL LIMIT 1),
        (SELECT pv.supplier_code FROM product_variants pv
         WHERE pv.product_id = ${orderItemsTable.productId}
           AND LOWER(TRIM(COALESCE(pv.colour, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.colour}, '')))
           AND pv.supplier_code IS NOT NULL LIMIT 1),
        ${productsTable.supplierCode}
      )`,
      supplierPrice: sql<string | null>`COALESCE(
        (SELECT pv.supplier_price FROM product_variants pv
         WHERE pv.product_id = ${orderItemsTable.productId}
           AND LOWER(TRIM(COALESCE(pv.colour, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.colour}, '')))
           AND LOWER(TRIM(COALESCE(pv.size, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.size}, '')))
           AND pv.supplier_price IS NOT NULL LIMIT 1),
        (SELECT pv.supplier_price FROM product_variants pv
         WHERE pv.product_id = ${orderItemsTable.productId}
           AND LOWER(TRIM(COALESCE(pv.colour, ''))) = LOWER(TRIM(COALESCE(${orderItemsTable.colour}, '')))
           AND pv.supplier_price IS NOT NULL LIMIT 1),
        ${productsTable.supplierPrice}
      )`,
    })
    .from(orderItemsTable)
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
    .where(inArray(orderItemsTable.id, orderItemIds));

  // Consolidate lines by SKU: same product + colour + size + supplierCode → one PO line.
  // The supplier only needs to know total qty per SKU, not which internal order each unit came from.
  const groups = new Map<string, typeof orderItems>();
  for (const row of orderItems) {
    const key = [
      row.item.productName,
      row.item.colour ?? "",
      row.item.size ?? "",
      row.supplierCode ?? "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  return [...groups.values()].map((rows) => {
    const first = rows[0];
    const sourceIds = rows.map((r) => r.item.id);
    const cellKey = [first.item.productName, first.item.colour ?? "", first.item.size ?? "", first.supplierCode ?? ""].join("|");
    const totalQty = (qtyOverrides && cellKey in qtyOverrides)
      ? qtyOverrides[cellKey]
      : rows.reduce((sum, r) => sum + (r.item.purchaseQuantity ?? 1), 0);
    // Summarise contributing order numbers (e.g. "P23, P26, P29")
    const orderNums = [...new Set(rows.map((r) => r.orderNumber).filter(Boolean))];
    return {
      poId,
      // orderItemId: null for multi-order lines; single-order lines keep the FK for legacy allocation
      orderItemId: sourceIds.length === 1 ? sourceIds[0] : null,
      sourceOrderItemIds: sourceIds,
      orderId: sourceIds.length === 1 ? first.item.orderId : null,
      orderNumber: orderNums.length === 1 ? orderNums[0] : orderNums.length > 1 ? orderNums.join(", ") : null,
      productName: first.item.productName,
      colour: first.item.colour ?? null,
      size: first.item.size ?? null,
      supplierCode: first.supplierCode ?? null,
      supplierPrice: first.supplierPrice ?? null,
      quantityOrdered: totalQty,
      quantityDelivered: 0,
    };
  });
}

router.get("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const poAlias = alias(suppliersTable, "po_supplier");
  const posRaw = await db
    .select({ po: purchaseOrdersTable, supplierCurrency: poAlias.currency })
    .from(purchaseOrdersTable)
    .leftJoin(poAlias, eq(purchaseOrdersTable.supplierId, poAlias.id))
    .orderBy(desc(purchaseOrdersTable.createdAt));
  const poIds = posRaw.map((p) => p.po.id);
  const allRows = poIds.length > 0
    ? await db
        .select({
          item: purchaseOrderItemsTable,
          productSku: productsTable.sku,
          canonicalProductName: productsTable.name,
          processStockFileUrl: sql<string | null>`COALESCE(
            ${processStockTable.fileUrl},
            (SELECT cp.file_url FROM customer_processes cp
             WHERE cp.process_stock_id = ${purchaseOrderItemsTable.processStockId}
             AND cp.file_url IS NOT NULL
             LIMIT 1)
          )`,
          customerName: sql<string | null>`(
            SELECT STRING_AGG(DISTINCT o.customer_name, ', ')
            FROM order_items oi2
            JOIN orders o ON oi2.order_id = o.id
            WHERE oi2.id = ANY(
              ARRAY(
                SELECT (elem)::int
                FROM jsonb_array_elements_text(
                  COALESCE(${purchaseOrderItemsTable.sourceOrderItemIds}, '[]'::jsonb)
                ) AS t(elem)
              )
            )
          )`,
        })
        .from(purchaseOrderItemsTable)
        .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
        .leftJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .leftJoin(processStockTable, eq(purchaseOrderItemsTable.processStockId, processStockTable.id))
        .where(inArray(purchaseOrderItemsTable.poId, poIds))
    : [];
  const result = posRaw.map(({ po, supplierCurrency }) => ({
    ...po,
    supplierCurrency: supplierCurrency ?? "GBP",
    items: allRows
      .filter((r) => r.item.poId === po.id)
      .map((r) => ({
        ...parsePOItem(r.item as Record<string, unknown>),
        productSku: r.productSku ?? null,
        canonicalProductName: r.canonicalProductName ?? null,
        processStockFileUrl: r.processStockFileUrl ?? null,
        customerName: r.customerName ?? null,
      })),
  }));
  res.json(result);
});

router.get("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const po = await getPoWithItems(parsed.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.json(po);
});

router.post("/purchasing/purchase-orders/manual", async (req, res): Promise<void> => {
  const parsed = z.object({
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().min(1),
    supplierEmail: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    items: z.array(z.object({
      productName: z.string().min(1),
      colour: z.string().optional().nullable(),
      size: z.string().optional().nullable(),
      supplierCode: z.string().optional().nullable(),
      supplierPrice: z.number().optional().nullable(),
      quantityOrdered: z.number().int().min(1),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const now = new Date();
  const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;

  const [po] = await db.insert(purchaseOrdersTable).values({
    poNumber,
    supplierId: parsed.data.supplierId ?? null,
    supplierName: parsed.data.supplierName,
    supplierEmail: parsed.data.supplierEmail ?? null,
    status: "draft",
    notes: parsed.data.notes ?? null,
  }).returning();

  const poItems = parsed.data.items.map(item => ({
    poId: po.id,
    productName: item.productName,
    colour: item.colour ?? null,
    size: item.size ?? null,
    supplierCode: item.supplierCode ?? null,
    supplierPrice: item.supplierPrice != null ? String(item.supplierPrice) : null,
    quantityOrdered: item.quantityOrdered,
    quantityDelivered: 0,
  }));
  await db.insert(purchaseOrderItemsTable).values(poItems);

  const result = await getPoWithItems(po.id);
  res.status(201).json(result);
});

router.post("/purchasing/purchase-orders/for-process-stock", async (req, res): Promise<void> => {
  const parsed = z.object({
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().min(1),
    supplierEmail: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    items: z.array(z.object({
      processStockId: z.number().int().positive().optional().nullable(),
      productName: z.string().min(1),
      supplierCode: z.string().optional().nullable(),
      supplierPrice: z.number().optional().nullable(),
      quantityOrdered: z.number().int().min(1),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const now = new Date();
  const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;

  const [po] = await db.insert(purchaseOrdersTable).values({
    poNumber,
    supplierId: parsed.data.supplierId ?? null,
    supplierName: parsed.data.supplierName,
    supplierEmail: parsed.data.supplierEmail ?? null,
    status: "draft",
    notes: parsed.data.notes ?? null,
  }).returning();

  const poItems = parsed.data.items.map(item => ({
    poId: po.id,
    processStockId: item.processStockId ?? null,
    productName: item.productName,
    supplierCode: item.supplierCode ?? null,
    supplierPrice: item.supplierPrice != null ? String(item.supplierPrice) : null,
    quantityOrdered: item.quantityOrdered,
    quantityDelivered: 0,
  }));
  await db.insert(purchaseOrderItemsTable).values(poItems);

  // Collect PDF print files from linked process stock items and attach to PO
  const psIds = parsed.data.items
    .map(i => i.processStockId)
    .filter((id): id is number => id != null);
  if (psIds.length > 0) {
    const psRows = await db
      .select({ id: processStockTable.id, name: processStockTable.name, fileUrl: processStockTable.fileUrl })
      .from(processStockTable)
      .where(inArray(processStockTable.id, psIds));
    const attachments = psRows
      .filter(ps => ps.fileUrl)
      .map(ps => ({ name: `${ps.name} - Print File`, objectPath: ps.fileUrl! }));
    if (attachments.length > 0) {
      await db.update(purchaseOrdersTable)
        .set({ attachments })
        .where(eq(purchaseOrdersTable.id, po.id));
    }
  }

  const result = await getPoWithItems(po.id);
  res.status(201).json(result);
});

router.post("/purchasing/purchase-orders", async (req, res): Promise<void> => {
  const parsed = z.object({
    supplierId: z.number().int().positive().optional().nullable(),
    supplierName: z.string().nullable().optional(),
    supplierEmail: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    itemIds: z.array(z.number().int().positive()),
    qtyOverrides: z.record(z.string(), z.number().int().nonnegative()).optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const now = new Date();
  const poNumber = `PO-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${Math.floor(Math.random() * 9000) + 1000}`;

  const [po] = await db.insert(purchaseOrdersTable).values({
    poNumber,
    supplierId: parsed.data.supplierId ?? null,
    supplierName: parsed.data.supplierName ?? "Unknown Supplier",
    supplierEmail: parsed.data.supplierEmail ?? null,
    status: "draft",
    notes: parsed.data.notes ?? null,
  }).returning();

  if (parsed.data.itemIds.length > 0) {
    // Guard: ensure all items belong to confirmed (active) orders — never create
    // POs from draft, portal_pending, or other non-active orders.
    const inactiveCheck = await db.execute(sql`
      SELECT oi.id, o.order_number, o.status
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.id IN (${sql.join(parsed.data.itemIds.map(id => sql`${id}`), sql`, `)})
        AND COALESCE(o.status, '') IN (
          'draft', 'portal_draft', 'portal_pending',
          'cancelled', 'archived', 'shipped', 'completed', 'delivered', 'invoiced'
        )
    `);
    if (inactiveCheck.rows.length > 0) {
      const offenders = (inactiveCheck.rows as Array<{ order_number: string; status: string }>)
        .map(r => `${r.order_number} (${r.status})`).join(", ");
      await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, po.id));
      res.status(400).json({ error: `Cannot create PO: items belong to inactive/unconfirmed orders: ${offenders}` });
      return;
    }

    const poItems = await buildPoItems(parsed.data.itemIds, po.id, parsed.data.qtyOverrides);
    await db.insert(purchaseOrderItemsTable).values(poItems);
    // Remove items from requirements now that they are on a PO
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(inArray(orderItemsTable.id, parsed.data.itemIds));
  }

  const result = await getPoWithItems(po.id);
  res.status(201).json(result);
});

router.patch("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    status: z.enum(["draft", "ordered", "delivered"]).optional(),
    notes: z.string().optional().nullable(),
    supplierEmail: z.string().optional().nullable(),
    estimatedDeliveryDate: z.string().optional().nullable(),
    // When status="delivered": optional snapshot of current book-in quantities to apply atomically
    // before allocation runs, preventing race conditions with the 400ms debounce saves.
    quantities: z.array(z.object({ itemId: z.number().int().positive(), quantity: z.number().int().min(0) })).optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.supplierEmail !== undefined) updateData.supplierEmail = parsed.data.supplierEmail;
  if (parsed.data.estimatedDeliveryDate !== undefined) {
    updateData.estimatedDeliveryDate = parsed.data.estimatedDeliveryDate ? new Date(parsed.data.estimatedDeliveryDate) : null;
  }
  if (parsed.data.status === "ordered") updateData.sentAt = new Date();

  const [po] = await db.update(purchaseOrdersTable).set(updateData).where(eq(purchaseOrdersTable.id, params.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  // When a PO is marked delivered, mark all linked order items as fulfilled and run allocation
  if (parsed.data.status === "delivered") {
    // Apply any quantity snapshot sent by the frontend (prevents race conditions with debounced saves)
    if (parsed.data.quantities && parsed.data.quantities.length > 0) {
      for (const { itemId, quantity } of parsed.data.quantities) {
        await db.update(purchaseOrderItemsTable)
          .set({ quantityDelivered: quantity, updatedAt: new Date() })
          .where(and(eq(purchaseOrderItemsTable.id, itemId), eq(purchaseOrderItemsTable.poId, po.id)));
      }
    }

    const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, po.id));
    // Collect order item IDs from both the legacy orderItemId column and the
    // consolidated sourceOrderItemIds array — whichever the PO line uses.
    const linkedOrderItemIds = [
      ...new Set([
        ...poItems.map((i) => i.orderItemId).filter((id): id is number => id != null),
        ...poItems.flatMap((i) => (i.sourceOrderItemIds as number[] | null) ?? []),
      ]),
    ];
    if (linkedOrderItemIds.length > 0) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null })
        .where(inArray(orderItemsTable.id, linkedOrderItemIds));
    }

    // For process stock PO items: increment process_stock.stock_quantity on delivery
    const processStockItems = poItems.filter(i => i.processStockId != null);
    for (const item of processStockItems) {
      const qtyReceived = (item.quantityDelivered != null && item.quantityDelivered > 0)
        ? item.quantityDelivered
        : item.quantityOrdered;
      await db.execute(sql`
        UPDATE process_stock
        SET stock_quantity = stock_quantity + ${qtyReceived}, updated_at = now()
        WHERE id = ${item.processStockId}
      `);
    }

    const allocation = await allocatePODelivery(po.id);

    // Safety-net: promote any order item still stuck as purchase_required=false +
    // stock_status=null after allocation (covers cases where sourceOrderItemIds
    // was empty or the item IDs didn't match).  Only promote items that have no
    // OTHER outstanding PO line still awaiting delivery.
    await db.execute(sql`
      UPDATE order_items oi
      SET stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
          stock_allocated_at = NOW()
      FROM orders o
      WHERE oi.order_id = o.id
        AND oi.purchase_required = false
        AND oi.stock_status IS NULL
        AND o.status NOT IN (
          'shipped','completed','delivered','invoiced',
          'cancelled','archived','draft','portal_draft','portal_pending'
        )
        AND NOT EXISTS (
          SELECT 1 FROM purchase_order_items poi
          JOIN purchase_orders po2 ON po2.id = poi.po_id
          WHERE po2.status NOT IN ('cancelled', 'delivered')
            AND poi.quantity_delivered < poi.quantity_ordered
            AND (
              poi.order_item_id = oi.id
              OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
            )
        )
    `);

    const result = await getPoWithItems(po.id);
    res.json({ ...result, allocation });
    return;
  }

  const result = await getPoWithItems(po.id);
  res.json(result);
});

router.post("/purchasing/purchase-orders/:id/items", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status !== "draft") { res.status(400).json({ error: "Can only add items to a draft PO" }); return; }

  // Collect order item IDs already covered by this PO (via direct FK or sourceOrderItemIds JSON array)
  const existingLines = await db
    .select({ orderItemId: purchaseOrderItemsTable.orderItemId, sourceOrderItemIds: purchaseOrderItemsTable.sourceOrderItemIds })
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.poId, po.id));

  const alreadyCovered = new Set<number>();
  for (const line of existingLines) {
    if (line.orderItemId) alreadyCovered.add(line.orderItemId);
    const sourceIds = (line.sourceOrderItemIds as number[] | null) ?? [];
    for (const id of sourceIds) alreadyCovered.add(id);
  }

  const newItemIds = parsed.data.itemIds.filter((id) => !alreadyCovered.has(id));
  if (newItemIds.length > 0) {
    const poItems = await buildPoItems(newItemIds, po.id);
    if (poItems.length > 0) {
      await db.insert(purchaseOrderItemsTable).values(poItems);
      // Only clear purchaseRequired on items that were actually inserted into the PO.
      // Collect the order item IDs that ended up in a real PO line (via direct FK or
      // sourceOrderItemIds) so we don't silently drop items where buildPoItems returned
      // nothing (e.g. product lookup failed).
      const coveredIds = new Set<number>();
      for (const pi of poItems) {
        if (pi.orderItemId) coveredIds.add(pi.orderItemId);
        const srcIds = (pi.sourceOrderItemIds as number[] | null) ?? [];
        for (const id of srcIds) coveredIds.add(id);
      }
      const idsToClose = newItemIds.filter((id) => coveredIds.has(id));
      if (idsToClose.length > 0) {
        await db.update(orderItemsTable)
          .set({ purchaseRequired: false, purchaseQuantity: null })
          .where(inArray(orderItemsTable.id, idsToClose));
      }
    }
  }

  const result = await getPoWithItems(po.id);
  res.json(result);
});

router.post("/purchasing/purchase-orders/:id/process-stock-items", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = z.object({
    items: z.array(z.object({
      processStockId: z.number().int().positive().optional().nullable(),
      productName: z.string().min(1),
      colour: z.string().optional().nullable(),
      size: z.string().optional().nullable(),
      supplierCode: z.string().optional().nullable(),
      supplierPrice: z.number().optional().nullable(),
      quantityOrdered: z.number().int().min(1),
    })).min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status !== "draft") { res.status(400).json({ error: "Can only add items to a draft PO" }); return; }

  // Skip process stock items already on this PO (prevent duplicate lines on repeated clicks)
  const existingPsLines = await db
    .select({ processStockId: purchaseOrderItemsTable.processStockId })
    .from(purchaseOrderItemsTable)
    .where(eq(purchaseOrderItemsTable.poId, po.id));
  const alreadyPresentPsIds = new Set(existingPsLines.map((l) => l.processStockId).filter(Boolean));

  const newItems = parsed.data.items.filter(
    (item) => !item.processStockId || !alreadyPresentPsIds.has(item.processStockId),
  );

  if (newItems.length > 0) {
    const poItems = newItems.map(item => ({
      poId: po.id,
      processStockId: item.processStockId ?? null,
      productName: item.productName,
      colour: item.colour ?? null,
      size: item.size ?? null,
      supplierCode: item.supplierCode ?? null,
      supplierPrice: item.supplierPrice != null ? String(item.supplierPrice) : null,
      quantityOrdered: item.quantityOrdered,
      quantityDelivered: 0,
    }));
    await db.insert(purchaseOrderItemsTable).values(poItems);
  }

  const result = await getPoWithItems(po.id);
  res.json(result);
});

router.patch("/purchasing/purchase-orders/:id/items/:itemId", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const bodySchema = z.object({
    quantityOrdered: z.number().int().min(1).optional(),
    quantityDelivered: z.number().int().min(0).optional(),
    estimatedDueDate: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Fetch existing PO item to detect over-delivery
  const [existing] = await db
    .select()
    .from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)));
  if (!existing) { res.status(404).json({ error: "PO line not found" }); return; }

  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (parsed.data.quantityOrdered !== undefined) updateData.quantityOrdered = parsed.data.quantityOrdered;
  if (parsed.data.quantityDelivered !== undefined) updateData.quantityDelivered = parsed.data.quantityDelivered;
  if (parsed.data.estimatedDueDate !== undefined) updateData.estimatedDueDate = parsed.data.estimatedDueDate ? new Date(parsed.data.estimatedDueDate) : null;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const [poItem] = await db
    .update(purchaseOrderItemsTable)
    .set(updateData)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)))
    .returning();

  if (!poItem) { res.status(404).json({ error: "PO line not found" }); return; }

  // Over-delivery: if more received than ordered, add the surplus to product stock
  if (parsed.data.quantityDelivered !== undefined && parsed.data.quantityDelivered > existing.quantityOrdered) {
    const surplus = parsed.data.quantityDelivered - existing.quantityOrdered;
    if (existing.orderItemId) {
      const [oi] = await db.select({ productId: orderItemsTable.productId }).from(orderItemsTable).where(eq(orderItemsTable.id, existing.orderItemId));
      if (oi?.productId) {
        await db.execute(sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${surplus} WHERE id = ${oi.productId}`);
      }
    }
  }

  // Server-side auto-complete: if this PO is still "ordered" and every line is
  // now fully delivered (qty_delivered >= qty_ordered), mark it as delivered and
  // run allocation immediately.  This is more reliable than the browser useEffect
  // because it fires synchronously when the last cell is saved.
  const [currentPo] = await db.select({ status: purchaseOrdersTable.status }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (currentPo?.status === "ordered") {
    const allLines = await db
      .select({ qtyOrdered: purchaseOrderItemsTable.quantityOrdered, qtyDelivered: purchaseOrderItemsTable.quantityDelivered })
      .from(purchaseOrderItemsTable)
      .where(eq(purchaseOrderItemsTable.poId, params.data.id));

    const allDelivered = allLines.length > 0 && allLines.every(
      (l) => (l.qtyDelivered ?? 0) >= (l.qtyOrdered ?? 1)
    );

    if (allDelivered) {
      await db.execute(sql`UPDATE purchase_orders SET status = 'delivered', updated_at = now() WHERE id = ${params.data.id}`);
      await allocatePODelivery(params.data.id);
      // Safety-net: promote any remaining purchase_required=false, stock_status=null items.
      // Plain items (no finish) go straight to 'complete'; decorated items to 'allocated'.
      await db.execute(sql`
        UPDATE order_items oi
        SET stock_status       = CASE WHEN oi.finish_id IS NULL THEN 'complete' ELSE 'allocated' END,
            stock_allocated_at = NOW()
        FROM orders o
        WHERE oi.order_id = o.id
          AND oi.purchase_required = false
          AND oi.stock_status IS NULL
          AND o.status NOT IN (
            'shipped','completed','delivered','invoiced',
            'cancelled','archived','draft','portal_draft','portal_pending'
          )
          AND NOT EXISTS (
            SELECT 1 FROM purchase_order_items poi
            JOIN purchase_orders po2 ON po2.id = poi.po_id
            WHERE po2.status NOT IN ('cancelled', 'delivered')
              AND poi.quantity_delivered < poi.quantity_ordered
              AND (
                poi.order_item_id = oi.id
                OR COALESCE(poi.source_order_item_ids, '[]'::jsonb) @> to_jsonb(oi.id)
              )
          )
      `);
    }
  }

  res.json(poItem);
});

router.get("/purchasing/purchase-orders/:id/pdf", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const po = await getPoWithItems(parsed.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  const poData = {
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    supplierEmail: po.supplierEmail,
    supplierContactName: po.supplierContactName ?? null,
    supplierPhone: po.supplierPhone ?? null,
    supplierAddress: po.supplierAddress ?? null,
    createdAt: po.createdAt,
    notes: po.notes,
    items: po.items.map((i) => ({
      supplierCode: i.supplierCode,
      productSku: i.productSku ?? null,
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      supplierPrice: i.supplierPrice,
      quantityOrdered: i.quantityOrdered,
    })),
  };

  try {
    const pdf = await generatePOPdf(poData);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${po.poNumber}.pdf"`);
    res.send(pdf);
  } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` });
  }
});

router.post("/purchasing/purchase-orders/:id/send-email", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const body = z.object({
    notes: z.string().optional().default(""),
    overrideEmail: z.string().email().optional().nullable(),
    estimatedDueDate: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const po = await getPoWithItems(params.data.id);
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }

  const toEmail = body.data.overrideEmail ?? po.supplierEmail;
  if (!toEmail) { res.status(400).json({ error: "No email address on record for this supplier. Provide an email address to continue." }); return; }

  const poData = {
    poNumber: po.poNumber,
    supplierName: po.supplierName,
    supplierEmail: po.supplierEmail,
    supplierContactName: po.supplierContactName ?? null,
    supplierPhone: po.supplierPhone ?? null,
    supplierAddress: po.supplierAddress ?? null,
    createdAt: po.createdAt,
    notes: po.notes,
    items: po.items.map((i) => ({
      supplierCode: i.supplierCode,
      productSku: i.productSku ?? null,
      productName: i.productName,
      colour: i.colour,
      size: i.size,
      supplierPrice: i.supplierPrice,
      quantityOrdered: i.quantityOrdered,
    })),
  };

  const { subject, html, text } = buildPOEmail(poData, body.data.notes);
  let pdfBuffer: Buffer | undefined;
  try { pdfBuffer = await generatePOPdf(poData); } catch (e: any) {
    res.status(500).json({ error: `PDF generation failed: ${e.message}` }); return;
  }

  // Collect unique process stock print file attachments
  const attachments: Array<{ filename: string; content: Buffer; contentType: string }> = [];
  if (pdfBuffer) attachments.push({ filename: `${po.poNumber}.pdf`, content: pdfBuffer, contentType: "application/pdf" });

  // Normalise storage paths — customer_processes stores "/api/storage/objects/..." prefix,
  // process_stock stores just "/objects/..." — strip the prefix before fetching.
  const normaliseObjectPath = (url: string) =>
    url.startsWith("/api/storage") ? url.slice("/api/storage".length) : url;

  const seenFileUrls = new Set<string>();
  for (const item of po.items) {
    if (item.processStockFileUrl && !seenFileUrls.has(item.processStockFileUrl)) {
      seenFileUrls.add(item.processStockFileUrl);
      try {
        const objectPath = normaliseObjectPath(item.processStockFileUrl);
        const file = await objectStorageService.getObjectEntityFile(objectPath);
        const [content] = await file.download();
        const safeName = (item.supplierCode ?? item.productName).replace(/[^a-zA-Z0-9_\-]/g, "_");
        attachments.push({ filename: `${safeName}.pdf`, content: Buffer.from(content), contentType: "application/pdf" });
      } catch {
        // Skip files that can't be fetched — they'll show as warnings in the UI
      }
    }
  }

  const result = await sendEmail({
    to: toEmail,
    subject,
    html,
    text,
    attachments,
  });

  if (!result.sent) {
    res.status(500).json({ error: result.error ?? "Failed to send email" }); return;
  }

  // Mark the PO as ordered if it was still draft
  if (po.status === "draft") {
    await db.update(purchaseOrdersTable).set({ status: "ordered", sentAt: new Date(), updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, po.id));
  }

  // Apply estimated due date to all items if provided
  if (body.data.estimatedDueDate) {
    await db.update(purchaseOrderItemsTable)
      .set({ estimatedDueDate: new Date(body.data.estimatedDueDate), updatedAt: new Date() })
      .where(eq(purchaseOrderItemsTable.poId, po.id));
  }

  res.json({ ok: true, to: toEmail });
});

router.post("/purchasing/purchase-orders/:id/mark-ordered", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const body = z.object({
    estimatedDueDate: z.string().optional().nullable(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status === "delivered") { res.status(400).json({ error: "Cannot change a delivered PO." }); return; }

  await db.update(purchaseOrdersTable)
    .set({ status: "ordered", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, params.data.id));

  if (body.data.estimatedDueDate) {
    await db.update(purchaseOrderItemsTable)
      .set({ estimatedDueDate: new Date(body.data.estimatedDueDate), updatedAt: new Date() })
      .where(eq(purchaseOrderItemsTable.poId, params.data.id));
  }

  res.json({ ok: true });
});

// ── Cancel an outstanding (undelivered) PO line — writes off the gap, no backorder ──────────
router.post("/purchasing/purchase-orders/:id/items/:itemId/cancel-outstanding", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [item] = await db.select().from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)));
  if (!item) { res.status(404).json({ error: "PO line not found" }); return; }

  // Shrink quantity_ordered down to whatever was actually delivered — no backorder created
  await db.update(purchaseOrderItemsTable)
    .set({ quantityOrdered: item.quantityDelivered, updatedAt: new Date() })
    .where(eq(purchaseOrderItemsTable.id, params.data.itemId));

  // Clear purchase_required on all linked order items so they don't re-enter purchasing queue
  const linkedIds: number[] = [
    ...(item.orderItemId != null ? [item.orderItemId] : []),
    ...((item.sourceOrderItemIds as number[] | null) ?? []),
  ];
  if (linkedIds.length > 0) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(inArray(orderItemsTable.id, linkedIds));
  }

  // If all remaining lines are now fully delivered, auto-complete the PO and run allocation
  const allItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, params.data.id));
  const allFullyDelivered = allItems.length > 0 && allItems.every(i => i.quantityDelivered >= i.quantityOrdered);
  if (allFullyDelivered) {
    const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, params.data.id));
    if (po && po.status === "ordered") {
      await db.update(purchaseOrdersTable).set({ status: "delivered", updatedAt: new Date() }).where(eq(purchaseOrdersTable.id, params.data.id));
      const allocation = await allocatePODelivery(params.data.id);
      res.json({ ok: true, autoCompleted: true, allocation });
      return;
    }
  }

  res.json({ ok: true });
});

router.post("/purchasing/purchase-orders/:id/receive-all", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const poId = parsed.data.id;
  const [po] = await db.select().from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status !== "ordered") { res.status(400).json({ error: "Only ordered POs can be received" }); return; }

  const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, poId));

  // Mark every line as fully delivered
  for (const item of poItems) {
    await db.update(purchaseOrderItemsTable)
      .set({ quantityDelivered: item.quantityOrdered, updatedAt: new Date() })
      .where(eq(purchaseOrderItemsTable.id, item.id));
  }

  // Mark the PO as delivered
  await db.update(purchaseOrdersTable)
    .set({ status: "delivered", updatedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, poId));

  // Clear purchaseRequired on ALL linked order items — both direct FK and consolidated sourceOrderItemIds
  const linkedOrderItemIds = [
    ...new Set([
      ...poItems.map((i) => i.orderItemId).filter((id): id is number => id != null),
      ...poItems.flatMap((i) => (i.sourceOrderItemIds as number[] | null) ?? []),
    ]),
  ];
  if (linkedOrderItemIds.length > 0) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(inArray(orderItemsTable.id, linkedOrderItemIds));
  }

  // Run smart stock allocation
  const allocation = await allocatePODelivery(poId);

  const result = await getPoWithItems(poId);
  res.json({ ...result, allocation });
});

// ── Correct a book-in: set quantity_delivered to an exact value (can be 0 to undo) ────
router.patch("/purchasing/purchase-orders/:id/items/:itemId/set-delivered", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = z.object({ quantityDelivered: z.number().int().min(0) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)));
  if (!existing) { res.status(404).json({ error: "PO line not found" }); return; }

  const newDelivered = body.data.quantityDelivered;
  const wasOverDelivered = existing.quantityDelivered > existing.quantityOrdered;
  const willBeOverDelivered = newDelivered > existing.quantityOrdered;

  await db.update(purchaseOrderItemsTable)
    .set({ quantityDelivered: newDelivered, updatedAt: new Date() })
    .where(eq(purchaseOrderItemsTable.id, params.data.itemId));

  // Collect all linked order item IDs
  const linkedIds: number[] = [
    ...(existing.orderItemId != null ? [existing.orderItemId] : []),
    ...((existing.sourceOrderItemIds as number[] | null) ?? []),
  ];

  if (linkedIds.length > 0) {
    if (newDelivered >= existing.quantityOrdered) {
      // Fully received — clear purchaseRequired
      await db.update(orderItemsTable)
        .set({ purchaseRequired: false, purchaseQuantity: null })
        .where(inArray(orderItemsTable.id, linkedIds));
    } else {
      // Not fully received — restore purchaseRequired and undo allocation if still just 'allocated'
      await db.update(orderItemsTable)
        .set({ purchaseRequired: true, purchaseQuantity: sql`quantity`, stockStatus: null, stockAllocatedAt: null })
        .where(and(
          inArray(orderItemsTable.id, linkedIds),
          sql`COALESCE(${orderItemsTable.stockStatus}, 'allocated') = 'allocated'`,
        ));
    }
  }

  // Adjust surplus stock: if we previously credited surplus and are now reducing, reverse it
  if (wasOverDelivered && !willBeOverDelivered && existing.orderItemId) {
    const oldSurplus = existing.quantityDelivered - existing.quantityOrdered;
    const newSurplus = Math.max(0, newDelivered - existing.quantityOrdered);
    const stockAdjust = newSurplus - oldSurplus; // negative = deduct
    const [oi] = await db.select({ productId: orderItemsTable.productId }).from(orderItemsTable).where(eq(orderItemsTable.id, existing.orderItemId));
    if (oi?.productId) {
      await db.execute(sql`UPDATE products SET stock_quantity = GREATEST(0, COALESCE(stock_quantity, 0) + ${stockAdjust}) WHERE id = ${oi.productId}`);
    }
  }

  const allocation = await allocatePODelivery(params.data.id);
  res.json({ ok: true, quantityDelivered: newDelivered, allocation });
});

// ── Book in a backorder line: add received quantity, run allocation ────────────
router.post("/purchasing/purchase-orders/:id/items/:itemId/receive", async (req, res): Promise<void> => {
  const params = z.object({ id: z.coerce.number().int().positive(), itemId: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const body = z.object({ quantity: z.number().int().min(1) }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db.select().from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, params.data.itemId), eq(purchaseOrderItemsTable.poId, params.data.id)));
  if (!existing) { res.status(404).json({ error: "PO line not found" }); return; }

  const newDelivered = existing.quantityDelivered + body.data.quantity;

  await db.update(purchaseOrderItemsTable)
    .set({ quantityDelivered: newDelivered, updatedAt: new Date() })
    .where(eq(purchaseOrderItemsTable.id, params.data.itemId));

  // Clear purchaseRequired on linked order item once fully received
  if (newDelivered >= existing.quantityOrdered && existing.orderItemId) {
    await db.update(orderItemsTable)
      .set({ purchaseRequired: false, purchaseQuantity: null })
      .where(eq(orderItemsTable.id, existing.orderItemId));
  }

  // Over-delivery: credit surplus directly to product stock
  if (newDelivered > existing.quantityOrdered && existing.orderItemId) {
    const surplus = newDelivered - existing.quantityOrdered;
    const [oi] = await db.select({ productId: orderItemsTable.productId }).from(orderItemsTable).where(eq(orderItemsTable.id, existing.orderItemId));
    if (oi?.productId) {
      await db.execute(sql`UPDATE products SET stock_quantity = COALESCE(stock_quantity, 0) + ${surplus} WHERE id = ${oi.productId}`);
    }
  }

  const allocation = await allocatePODelivery(params.data.id);
  res.json({ ok: true, quantityDelivered: newDelivered, allocation });
});

// ── Backorders: PO lines that are either:
//    (a) manually flagged with an estimatedDueDate set on the line, OR
//    (b) more than 5 days overdue (sent > 5 days ago, still with outstanding qty)
router.get("/purchasing/backorders", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: purchaseOrderItemsTable.id,
      poId: purchaseOrderItemsTable.poId,
      poNumber: purchaseOrdersTable.poNumber,
      supplierName: purchaseOrdersTable.supplierName,
      sentAt: purchaseOrdersTable.sentAt,
      productName: purchaseOrderItemsTable.productName,
      colour: purchaseOrderItemsTable.colour,
      size: purchaseOrderItemsTable.size,
      supplierCode: purchaseOrderItemsTable.supplierCode,
      quantityOrdered: purchaseOrderItemsTable.quantityOrdered,
      quantityDelivered: purchaseOrderItemsTable.quantityDelivered,
      estimatedDueDate: purchaseOrderItemsTable.estimatedDueDate,
      orderId: ordersTable.id,
      orderNumber: ordersTable.orderNumber,
      customerName: ordersTable.customerName,
      requiredDate: ordersTable.requiredDate,
    })
    .from(purchaseOrderItemsTable)
    .innerJoin(purchaseOrdersTable, eq(purchaseOrderItemsTable.poId, purchaseOrdersTable.id))
    .leftJoin(orderItemsTable, eq(purchaseOrderItemsTable.orderItemId, orderItemsTable.id))
    .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
    .where(and(
      inArray(purchaseOrdersTable.status, ["ordered", "delivered"]),
      lt(purchaseOrderItemsTable.quantityDelivered, purchaseOrderItemsTable.quantityOrdered),
      // Manually flagged (due date set) OR overdue by more than 5 days
      sql`(${purchaseOrderItemsTable.estimatedDueDate} IS NOT NULL OR ${purchaseOrdersTable.sentAt} < NOW() - INTERVAL '5 days')`,
    ))
    .orderBy(purchaseOrderItemsTable.estimatedDueDate, purchaseOrdersTable.sentAt);

  res.json(rows.map((r) => ({
    ...r,
    remaining: r.quantityOrdered - r.quantityDelivered,
    daysOverdue: r.sentAt
      ? Math.max(0, Math.floor((Date.now() - new Date(r.sentAt).getTime()) / 86_400_000) - 5)
      : null,
  })));
});

router.delete("/purchasing/purchase-orders/:id", async (req, res): Promise<void> => {
  const parsed = z.object({ id: z.coerce.number().int().positive() }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Restore purchaseRequired + purchaseQuantity on ALL linked order items before deleting.
  // Lines can reference order items in two ways:
  //   • orderItemId  — a single direct link (un-consolidated)
  //   • sourceOrderItemIds — a JSON array of order item ids (consolidated line)
  const poItems = await db.select().from(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.poId, parsed.data.id));

  const directIds = poItems.map((i) => i.orderItemId).filter((id): id is number => id != null);
  const sourceIds = poItems.flatMap((i) => (i.sourceOrderItemIds as number[] | null) ?? []);
  const allLinkedIds = [...new Set([...directIds, ...sourceIds])];

  if (allLinkedIds.length > 0) {
    const linkedItems = await db
      .select({ id: orderItemsTable.id, quantity: orderItemsTable.quantity })
      .from(orderItemsTable)
      .where(inArray(orderItemsTable.id, allLinkedIds));
    for (const li of linkedItems) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: true, purchaseQuantity: li.quantity ?? null })
        .where(eq(orderItemsTable.id, li.id));
    }
  }

  const [po] = await db.delete(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, parsed.data.id)).returning();
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  res.sendStatus(204);
});

// ─── Delete individual PO line ────────────────────────────────────────────────

router.delete("/purchasing/purchase-orders/:poId/items/:itemId", async (req, res): Promise<void> => {
  const parsed = z.object({
    poId: z.coerce.number().int().positive(),
    itemId: z.coerce.number().int().positive(),
  }).safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { poId, itemId } = parsed.data;

  // Check PO is not delivered (prevent altering historical records)
  const [po] = await db.select({ status: purchaseOrdersTable.status }).from(purchaseOrdersTable).where(eq(purchaseOrdersTable.id, poId));
  if (!po) { res.status(404).json({ error: "Purchase order not found" }); return; }
  if (po.status === "delivered") { res.status(400).json({ error: "Cannot delete lines from a delivered PO" }); return; }

  // Fetch the line to get the linked order item id
  const [poItem] = await db.select().from(purchaseOrderItemsTable)
    .where(and(eq(purchaseOrderItemsTable.id, itemId), eq(purchaseOrderItemsTable.poId, poId)));
  if (!poItem) { res.status(404).json({ error: "PO line not found" }); return; }

  // Restore purchaseRequired AND purchaseQuantity on ALL linked order items so they
  // reappear in Requirements with the correct quantity.  We use the order item's own
  // quantity as the restored purchase quantity — the system re-derives the shortfall
  // from the live order data rather than requiring staff to manually re-flag each item.
  const linkedOrderItemIds = [
    ...(poItem.orderItemId != null ? [poItem.orderItemId] : []),
    ...((poItem.sourceOrderItemIds as number[] | null) ?? []),
  ];
  const uniqueLinkedIds = [...new Set(linkedOrderItemIds)];
  if (uniqueLinkedIds.length > 0) {
    const linkedItems = await db
      .select({ id: orderItemsTable.id, quantity: orderItemsTable.quantity })
      .from(orderItemsTable)
      .where(inArray(orderItemsTable.id, uniqueLinkedIds));
    for (const li of linkedItems) {
      await db.update(orderItemsTable)
        .set({
          purchaseRequired: true,
          purchaseQuantity: li.quantity ?? null,
          // Also clear any stale stock allocation so the item doesn't linger on
          // the picking list as if it were fulfilled while also needing a PO.
          stockStatus: null,
          stockAllocatedAt: null,
        })
        .where(eq(orderItemsTable.id, li.id));
    }
  } else if (poItem.productName) {
    // Fallback: no linked order item IDs (older consolidated PO lines).
    // Try to find matching active order items by product + colour + size and restore them.
    const fallbackItems = await db
      .select({ id: orderItemsTable.id, quantity: orderItemsTable.quantity })
      .from(orderItemsTable)
      .leftJoin(ordersTable, eq(orderItemsTable.orderId, ordersTable.id))
      .where(and(
        eq(orderItemsTable.productName, poItem.productName),
        poItem.colour
          ? eq(orderItemsTable.colour, poItem.colour)
          : sql`${orderItemsTable.colour} IS NULL`,
        poItem.size
          ? eq(orderItemsTable.size, poItem.size)
          : sql`${orderItemsTable.size} IS NULL`,
        sql`COALESCE(${ordersTable.status}, '') NOT IN ('cancelled', 'archived', 'completed', 'delivered', 'shipped', 'invoiced')`,
      ));
    for (const li of fallbackItems) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: true, purchaseQuantity: li.quantity ?? null, stockStatus: null, stockAllocatedAt: null })
        .where(eq(orderItemsTable.id, li.id));
    }
  }

  await db.delete(purchaseOrderItemsTable).where(eq(purchaseOrderItemsTable.id, itemId));
  res.sendStatus(204);
});

// ─── Re-queue stuck order items for purchasing ────────────────────────────────
// Fixes items that ended up with purchaseRequired=false + stockStatus='allocated'
// but no actual stock (e.g. after a PO line was deleted with no linked order item IDs).
router.post("/purchasing/requeue-items", async (req, res): Promise<void> => {
  const parsed = z.object({ itemIds: z.array(z.number().int().positive()) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { itemIds } = parsed.data;
  for (const itemId of itemIds) {
    const [item] = await db
      .select({ quantity: orderItemsTable.quantity })
      .from(orderItemsTable)
      .where(eq(orderItemsTable.id, itemId));
    if (item) {
      await db.update(orderItemsTable)
        .set({ purchaseRequired: true, purchaseQuantity: item.quantity ?? null, stockStatus: null, stockAllocatedAt: null })
        .where(eq(orderItemsTable.id, itemId));
    }
  }
  res.json({ ok: true, count: itemIds.length });
});

export default router;
