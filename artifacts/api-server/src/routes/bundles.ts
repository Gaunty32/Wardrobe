import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { z } from "zod";
import { randomUUID } from "crypto";

const router = Router();

// ── List all bundles ──────────────────────────────────────────────────────────
router.get("/bundles", async (_req, res): Promise<void> => {
  try {
    const rows = await db.execute(sql`
      SELECT b.id, b.name, b.sku, b.description, b.price, b.is_active, b.notes, b.created_at,
        COUNT(bc.id)::int AS component_count
      FROM bundles b
      LEFT JOIN bundle_components bc ON bc.bundle_id = b.id
      GROUP BY b.id
      ORDER BY b.name
    `);
    res.json(rows.rows ?? rows);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Get single bundle with components ─────────────────────────────────────────
router.get("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const bundleRows = await db.execute(sql`SELECT * FROM bundles WHERE id = ${id}`);
    const bundle = (bundleRows.rows ?? bundleRows)[0];
    if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }
    const compRows = await db.execute(sql`
      SELECT bc.*, COALESCE(p.name, bc.product_name) AS resolved_name, p.sku AS product_sku
      FROM bundle_components bc
      LEFT JOIN products p ON p.id = bc.product_id
      WHERE bc.bundle_id = ${id}
      ORDER BY bc.id
    `);
    res.json({ ...bundle, components: compRows.rows ?? compRows });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Create bundle ─────────────────────────────────────────────────────────────
const BundleSchema = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  price: z.number().min(0),
  notes: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

router.post("/bundles", async (req, res): Promise<void> => {
  const parsed = BundleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, sku, description, price, notes, isActive } = parsed.data;
  try {
    const rows = await db.execute(sql`
      INSERT INTO bundles (name, sku, description, price, notes, is_active)
      VALUES (${name}, ${sku ?? null}, ${description ?? null}, ${price}, ${notes ?? null}, ${isActive})
      RETURNING *
    `);
    res.status(201).json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update bundle ─────────────────────────────────────────────────────────────
router.put("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = BundleSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { name, sku, description, price, notes, isActive } = parsed.data;
  try {
    const rows = await db.execute(sql`
      UPDATE bundles
      SET name = ${name}, sku = ${sku ?? null}, description = ${description ?? null},
          price = ${price}, notes = ${notes ?? null}, is_active = ${isActive}
      WHERE id = ${id}
      RETURNING *
    `);
    res.json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete bundle ─────────────────────────────────────────────────────────────
router.delete("/bundles/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.execute(sql`DELETE FROM bundles WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Add component ─────────────────────────────────────────────────────────────
const ComponentSchema = z.object({
  productId: z.number().int().positive().optional().nullable(),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  finishId: z.number().int().positive().optional().nullable(),
  finishName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.post("/bundles/:id/components", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  if (isNaN(bundleId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ComponentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { productId, productName, quantity, finishId, finishName, notes } = parsed.data;
  try {
    const rows = await db.execute(sql`
      INSERT INTO bundle_components (bundle_id, product_id, product_name, quantity, finish_id, finish_name, notes)
      VALUES (${bundleId}, ${productId ?? null}, ${productName}, ${quantity}, ${finishId ?? null}, ${finishName ?? null}, ${notes ?? null})
      RETURNING *
    `);
    const comp = (rows.rows ?? rows)[0] as any;
    if (productId) {
      const pRows = await db.execute(sql`SELECT name, sku FROM products WHERE id = ${productId}`);
      const p = (pRows.rows ?? pRows)[0] as any;
      if (p) { comp.resolved_name = p.name; comp.product_sku = p.sku; }
    }
    if (!comp.resolved_name) comp.resolved_name = productName;
    res.status(201).json(comp);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Update component ──────────────────────────────────────────────────────────
router.put("/bundles/:id/components/:compId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  const compId = parseInt(req.params.compId);
  if (isNaN(bundleId) || isNaN(compId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = ComponentSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { productId, productName, quantity, finishId, finishName, notes } = parsed.data;
  try {
    const rows = await db.execute(sql`
      UPDATE bundle_components
      SET product_id = ${productId ?? null}, product_name = ${productName}, quantity = ${quantity},
          finish_id = ${finishId ?? null}, finish_name = ${finishName ?? null}, notes = ${notes ?? null}
      WHERE id = ${compId} AND bundle_id = ${bundleId}
      RETURNING *
    `);
    res.json((rows.rows ?? rows)[0]);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Delete component ──────────────────────────────────────────────────────────
router.delete("/bundles/:id/components/:compId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.id);
  const compId = parseInt(req.params.compId);
  if (isNaN(bundleId) || isNaN(compId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.execute(sql`DELETE FROM bundle_components WHERE id = ${compId} AND bundle_id = ${bundleId}`);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ── Expand bundle into an order ───────────────────────────────────────────────
// Creates one header row (with the bundle price) and one component row per
// bundle component (price £0 — cost is captured by the header).
router.post("/bundles/:bundleId/add-to-order/:orderId", async (req, res): Promise<void> => {
  const bundleId = parseInt(req.params.bundleId);
  const orderId  = parseInt(req.params.orderId);
  if (isNaN(bundleId) || isNaN(orderId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = z.object({ quantity: z.number().int().positive() }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const qty = body.data.quantity;

  try {
    const bundleRows = await db.execute(sql`SELECT * FROM bundles WHERE id = ${bundleId}`);
    const bundle = (bundleRows.rows ?? bundleRows)[0] as any;
    if (!bundle) { res.status(404).json({ error: "Bundle not found" }); return; }

    const compRows = await db.execute(sql`
      SELECT bc.*,
        COALESCE(p.name, bc.product_name) AS resolved_name,
        p.vat_rate  AS p_vat_rate,
        p.is_service AS p_is_service
      FROM bundle_components bc
      LEFT JOIN products p ON p.id = bc.product_id
      WHERE bc.bundle_id = ${bundleId}
      ORDER BY bc.id
    `);
    const components = (compRows.rows ?? compRows) as any[];

    const orderRows = await db.execute(sql`
      SELECT o.id, c.zero_vat
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = ${orderId}
    `);
    const order = (orderRows.rows ?? orderRows)[0] as any;
    if (!order) { res.status(404).json({ error: "Order not found" }); return; }
    const zeroVat = order.zero_vat === true;

    const bundleRef  = `bundle-${randomUUID()}`;
    const unitPrice  = parseFloat(String(bundle.price));
    const lineTotal  = unitPrice * qty;

    // Header row — pricing container only; not a physical item, so no stock_status
    await db.execute(sql`
      INSERT INTO order_items
        (order_id, product_id, product_name, quantity, unit_price, line_total, vat_rate,
         purchase_required, stock_status, bundle_ref, is_bundle_header, bundle_def_id, recipient_type)
      VALUES
        (${orderId}, NULL, ${bundle.name}, ${qty}, ${unitPrice}, ${lineTotal},
         ${zeroVat ? 0 : 0.20}, false, NULL, ${bundleRef}, true, ${bundleId}, 'stock')
    `);

    // Component rows — price £0
    // Physical stock items: stock_status='allocated' so they appear in the picking list
    // Service items: stock_status=NULL — nothing to pick, no purchase needed
    for (const comp of components) {
      const compQty      = qty * (parseInt(String(comp.quantity)) || 1);
      const compVat      = zeroVat ? 0 : parseFloat(String(comp.p_vat_rate ?? 0.20));
      const isService    = comp.p_is_service === true;
      const stockStatus  = isService ? null : "allocated";
      const recipType    = isService ? "service" : "stock";
      await db.execute(sql`
        INSERT INTO order_items
          (order_id, product_id, product_name, quantity, unit_price, line_total, vat_rate,
           purchase_required, stock_status, bundle_ref, is_bundle_header, bundle_def_id, recipient_type,
           finish_id, finish_name)
        VALUES
          (${orderId}, ${comp.product_id ?? null}, ${comp.resolved_name}, ${compQty},
           0, 0, ${compVat},
           false, ${stockStatus}, ${bundleRef}, false, ${bundleId}, ${recipType},
           ${comp.finish_id ?? null}, ${comp.finish_name ?? null})
      `);
    }

    // Recalculate order total from all line items
    await db.execute(sql`
      UPDATE orders
      SET total_amount = (SELECT COALESCE(SUM(line_total), 0) FROM order_items WHERE order_id = ${orderId})
      WHERE id = ${orderId}
    `);

    res.json({ ok: true, bundleRef });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
