import { Router } from "express";
import { eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  customerFinishedItemsTable,
  productVariantsTable,
  productsTable,
  customersTable,
  stockBinsTable,
} from "@workspace/db";

const router = Router();

// ─── GET /stock/plain — all product variants with full stock info ──────────────

router.get("/stock/plain", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      variantId: productVariantsTable.id,
      productId: productsTable.id,
      productName: productsTable.name,
      productSku: productsTable.sku,
      productImageUrl: productsTable.imageUrl,
      colour: productVariantsTable.colour,
      size: productVariantsTable.size,
      sku: productVariantsTable.sku,
      supplierCode: productVariantsTable.supplierCode,
      stockQuantity: productVariantsTable.stockQuantity,
      minStockQty: productVariantsTable.minStockQty,
      binLocation: productVariantsTable.binLocation,
      updatedAt: productVariantsTable.updatedAt,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .orderBy(asc(productsTable.name), asc(productVariantsTable.colour), asc(productVariantsTable.size));
  res.json(rows);
});

// ─── PATCH /stock/plain/:id — update qty, bin location, min stock level ───────

router.patch("/stock/plain/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    stockQuantity: z.number().int().min(0).optional(),
    binLocation: z.string().nullable().optional(),
    minStockQty: z.number().int().min(0).optional(),
  });
  const parsed = schema.parse(req.body);

  const updateData: Partial<typeof productVariantsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.stockQuantity !== undefined) updateData.stockQuantity = parsed.stockQuantity;
  if (parsed.binLocation !== undefined) updateData.binLocation = parsed.binLocation;
  if (parsed.minStockQty !== undefined) updateData.minStockQty = parsed.minStockQty;

  const [row] = await db
    .update(productVariantsTable)
    .set(updateData)
    .where(eq(productVariantsTable.id, id))
    .returning({
      id: productVariantsTable.id,
      stockQuantity: productVariantsTable.stockQuantity,
      minStockQty: productVariantsTable.minStockQty,
      binLocation: productVariantsTable.binLocation,
      productId: productVariantsTable.productId,
    });
  if (!row) { res.status(404).json({ error: "Variant not found" }); return; }

  if (parsed.stockQuantity !== undefined) {
    await db.execute(sql`
      UPDATE products
      SET stock_quantity = (
        SELECT COALESCE(SUM(stock_quantity), 0)
        FROM product_variants
        WHERE product_id = ${row.productId}
      )
      WHERE id = ${row.productId}
    `);
  }

  res.json(row);
});

// ─── GET /stock/plain/:id/label — printable garment/stock label HTML ──────────

router.get("/stock/plain/:id/label", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const rows = await db
    .select({
      variantId: productVariantsTable.id,
      productName: productsTable.name,
      productSku: productsTable.sku,
      colour: productVariantsTable.colour,
      size: productVariantsTable.size,
      supplierCode: productVariantsTable.supplierCode,
      stockQuantity: productVariantsTable.stockQuantity,
      binLocation: productVariantsTable.binLocation,
      updatedAt: productVariantsTable.updatedAt,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(eq(productVariantsTable.id, id));

  if (!rows[0]) { res.status(404).send("Variant not found"); return; }
  const v = rows[0];

  const dateStr = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(
    v.updatedAt ? new Date(v.updatedAt) : new Date()
  );

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Stock Label — ${v.productSku ?? ""} ${v.colour ?? ""} ${v.size ?? ""}</title>
  <style>
    @page{size:4in 3in landscape;margin:0mm}
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:4in}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;display:flex;flex-direction:column;align-items:flex-start;padding:16px;gap:12px}
    #toolbar{width:4in;display:flex;align-items:center;gap:10px;padding:8px 12px;background:#1e3a5f;color:white;border-radius:6px}
    #toolbar span{flex:1;font-size:11px;font-weight:700}
    #toolbar button{padding:5px 14px;border:none;border-radius:4px;font-size:11px;font-weight:700;cursor:pointer;background:#22c55e;color:white}
    #page{width:4in;height:3in;background:white;border:1px solid #aaa;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);padding:0.18in 0.22in;display:flex;flex-direction:column;gap:0}
    .header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2pt solid #000;padding-bottom:0.07in;margin-bottom:0.07in}
    .fcc{font-size:18pt;font-weight:900;color:#000;letter-spacing:-.02em;line-height:1}
    .bin-badge{background:#1e3a5f;color:white;font-size:8.5pt;font-weight:900;padding:3px 9px;border-radius:3px;letter-spacing:.04em;white-space:nowrap}
    .product-name{font-size:11pt;font-weight:700;color:#000;line-height:1.2;margin-bottom:0.05in}
    .row{display:flex;gap:0.22in;align-items:baseline;margin-bottom:0.05in}
    .field{display:flex;flex-direction:column}
    .field-label{font-size:5pt;color:#555;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:1px}
    .field-value{font-size:9.5pt;font-weight:700;color:#000}
    .divider{border-top:1px solid #ccc;margin:0.06in 0}
    .footer-row{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:0.06in;border-top:1px solid #ccc}
    .footer-label{font-size:5.5pt;color:#555;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
    .footer-value{font-size:7.5pt;font-weight:600;color:#000}
    .type-badge{font-size:7pt;font-weight:900;color:white;background:#1e3a5f;padding:2px 7px;border-radius:3px;letter-spacing:.06em;text-transform:uppercase}
    @media print{
      @page{size:4in 3in landscape;margin:0mm}
      html,body{width:4in;background:white;padding:0}
      #toolbar{display:none}
      #page{box-shadow:none;border:none;border-radius:0;width:4in;height:3in}
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <span>Stock Label — ${v.productSku ?? ""} ${v.colour ?? ""} ${v.size ?? ""}</span>
    <button onclick="window.print()">Print</button>
  </div>
  <div id="page">
    <div class="header">
      <div class="fcc">${v.productSku ?? "—"}</div>
      ${v.binLocation ? `<div class="bin-badge">BIN ${v.binLocation}</div>` : ""}
    </div>
    <div class="product-name">${v.productName}</div>
    <div class="row">
      <div class="field">
        <div class="field-label">Colour</div>
        <div class="field-value">${v.colour ?? "—"}</div>
      </div>
      <div class="field">
        <div class="field-label">Size</div>
        <div class="field-value">${v.size ?? "—"}</div>
      </div>
      <div class="field">
        <div class="field-label">Supplier Code</div>
        <div class="field-value">${v.supplierCode ?? "—"}</div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="row">
      <div class="field">
        <div class="field-label">Quantity in Stock</div>
        <div class="field-value" style="font-size:14pt">${v.stockQuantity}</div>
      </div>
      <div class="field" style="margin-left:auto">
        <div class="field-label">Stock Type</div>
        <div class="type-badge">Plain Stock</div>
      </div>
    </div>
    <div class="footer-row">
      <div>
        <div class="footer-label">Bin</div>
        <div class="footer-value">${v.binLocation ?? "—"}</div>
      </div>
      <div>
        <div class="footer-label">Date Amended</div>
        <div class="footer-value">${dateStr}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// ─── GET /stock/finished — all finished items across all customers ────────────

router.get("/stock/finished", async (req, res): Promise<void> => {
  const rows = await db
    .select({
      id: customerFinishedItemsTable.id,
      customerId: customerFinishedItemsTable.customerId,
      customerName: customersTable.name,
      name: customerFinishedItemsTable.name,
      productName: productsTable.name,
      colour: customerFinishedItemsTable.colour,
      size: customerFinishedItemsTable.size,
      unitPrice: customerFinishedItemsTable.unitPrice,
      stockQuantity: customerFinishedItemsTable.stockQuantity,
      notes: customerFinishedItemsTable.notes,
    })
    .from(customerFinishedItemsTable)
    .innerJoin(customersTable, eq(customerFinishedItemsTable.customerId, customersTable.id))
    .leftJoin(productsTable, eq(customerFinishedItemsTable.productId, productsTable.id))
    .orderBy(asc(customersTable.name), asc(customerFinishedItemsTable.name));
  res.json(rows.map(r => ({ ...r, unitPrice: r.unitPrice != null ? parseFloat(r.unitPrice) : 0 })));
});

// ─── PATCH /stock/finished/:id — update a finished item's stock quantity ──────

router.patch("/stock/finished/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { stockQuantity } = z.object({ stockQuantity: z.number().int().min(0) }).parse(req.body);
  const [row] = await db
    .update(customerFinishedItemsTable)
    .set({ stockQuantity, updatedAt: new Date() })
    .where(eq(customerFinishedItemsTable.id, id))
    .returning({ id: customerFinishedItemsTable.id, stockQuantity: customerFinishedItemsTable.stockQuantity });
  if (!row) { res.status(404).json({ error: "Item not found" }); return; }
  res.json(row);
});

// ─── GET /stock/bins — all bins with stock summary ────────────────────────────

router.get("/stock/bins", async (req, res): Promise<void> => {
  const bins = await db.select().from(stockBinsTable).orderBy(asc(stockBinsTable.binNumber));

  const totals = await db.execute(sql`
    SELECT
      bin_location,
      SUM(stock_quantity)::integer AS total_qty,
      COUNT(*)::integer            AS variant_count
    FROM product_variants
    WHERE bin_location IS NOT NULL AND bin_location <> ''
    GROUP BY bin_location
  `);

  const totalsMap = new Map<string, { totalQty: number; variantCount: number }>(
    (totals.rows as any[]).map(r => [
      r.bin_location,
      { totalQty: Number(r.total_qty), variantCount: Number(r.variant_count) },
    ])
  );

  res.json(
    bins.map(b => ({
      ...b,
      totalQty: totalsMap.get(b.binNumber)?.totalQty ?? 0,
      variantCount: totalsMap.get(b.binNumber)?.variantCount ?? 0,
      isOverCapacity: (totalsMap.get(b.binNumber)?.totalQty ?? 0) > b.maxQty,
    }))
  );
});

// ─── GET /stock/bins/suggest — suggest best bin for putting stock away ────────

router.get("/stock/bins/suggest", async (req, res): Promise<void> => {
  const variantId = req.query.variantId ? parseInt(req.query.variantId as string, 10) : null;
  const addQty = req.query.qty ? parseInt(req.query.qty as string, 10) : 1;

  const bins = await db.select().from(stockBinsTable).orderBy(asc(stockBinsTable.binNumber));

  const totals = await db.execute(sql`
    SELECT bin_location, SUM(stock_quantity)::integer AS total_qty
    FROM product_variants
    WHERE bin_location IS NOT NULL AND bin_location <> ''
    GROUP BY bin_location
  `);
  const totalsByBin = new Map<string, number>(
    (totals.rows as any[]).map(r => [r.bin_location, Number(r.total_qty)])
  );

  let currentBin: string | null = null;
  if (variantId) {
    const [v] = await db
      .select({ binLocation: productVariantsTable.binLocation })
      .from(productVariantsTable)
      .where(eq(productVariantsTable.id, variantId));
    currentBin = v?.binLocation ?? null;
  }

  const suggestions = bins
    .map(b => {
      const currentQty = totalsByBin.get(b.binNumber) ?? 0;
      const afterQty = currentQty + addQty;
      const available = b.maxQty - currentQty;
      const isCurrent = b.binNumber === currentBin;
      const wouldOverflow = afterQty > b.maxQty;
      return {
        ...b,
        currentQty,
        afterQty,
        available,
        isCurrent,
        wouldOverflow,
        score: (isCurrent ? 1000 : 0) + available,
      };
    })
    .filter(b => !b.wouldOverflow || b.isCurrent)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  res.json(suggestions);
});

// ─── GET /stock/bins/:id — single bin with full contents ──────────────────────

router.get("/stock/bins/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [bin] = await db.select().from(stockBinsTable).where(eq(stockBinsTable.id, id));
  if (!bin) { res.status(404).json({ error: "Bin not found" }); return; }

  const contents = await db
    .select({
      variantId: productVariantsTable.id,
      productId: productsTable.id,
      productName: productsTable.name,
      productSku: productsTable.sku,
      productImageUrl: productsTable.imageUrl,
      colour: productVariantsTable.colour,
      size: productVariantsTable.size,
      supplierCode: productVariantsTable.supplierCode,
      stockQuantity: productVariantsTable.stockQuantity,
      minStockQty: productVariantsTable.minStockQty,
      updatedAt: productVariantsTable.updatedAt,
    })
    .from(productVariantsTable)
    .innerJoin(productsTable, eq(productVariantsTable.productId, productsTable.id))
    .where(eq(productVariantsTable.binLocation, bin.binNumber))
    .orderBy(asc(productsTable.name), asc(productVariantsTable.colour), asc(productVariantsTable.size));

  const totalQty = contents.reduce((s, v) => s + v.stockQuantity, 0);

  res.json({ ...bin, totalQty, isOverCapacity: totalQty > bin.maxQty, contents });
});

// ─── POST /stock/bins — create a new bin ─────────────────────────────────────

router.post("/stock/bins", async (req, res): Promise<void> => {
  const schema = z.object({
    binNumber: z.string().min(1).max(20).trim(),
    notes: z.string().optional(),
    maxQty: z.number().int().min(1).default(15),
  });
  const parsed = schema.parse(req.body);

  const [existing] = await db
    .select({ id: stockBinsTable.id })
    .from(stockBinsTable)
    .where(eq(stockBinsTable.binNumber, parsed.binNumber));
  if (existing) { res.status(409).json({ error: `Bin "${parsed.binNumber}" already exists` }); return; }

  const [bin] = await db.insert(stockBinsTable).values(parsed).returning();
  res.status(201).json(bin);
});

// ─── PATCH /stock/bins/:id — update bin metadata ─────────────────────────────

router.patch("/stock/bins/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const schema = z.object({
    notes: z.string().nullable().optional(),
    maxQty: z.number().int().min(1).optional(),
  });
  const parsed = schema.parse(req.body);
  const [bin] = await db
    .update(stockBinsTable)
    .set(parsed)
    .where(eq(stockBinsTable.id, id))
    .returning();
  if (!bin) { res.status(404).json({ error: "Bin not found" }); return; }
  res.json(bin);
});

// ─── DELETE /stock/bins/:id — delete empty bin ───────────────────────────────

router.delete("/stock/bins/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [bin] = await db.select().from(stockBinsTable).where(eq(stockBinsTable.id, id));
  if (!bin) { res.status(404).json({ error: "Bin not found" }); return; }

  const occupied = await db.execute(sql`
    SELECT COUNT(*)::integer AS cnt FROM product_variants
    WHERE bin_location = ${bin.binNumber} AND stock_quantity > 0
  `);
  const cnt = Number((occupied.rows[0] as any)?.cnt ?? 0);
  if (cnt > 0) {
    res.status(409).json({ error: "Cannot delete a bin that still contains stock" });
    return;
  }
  await db.delete(stockBinsTable).where(eq(stockBinsTable.id, id));
  res.json({ ok: true });
});

// ─── GET /stock/bins/:id/label — printable bin label HTML ────────────────────

router.get("/stock/bins/:id/label", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [bin] = await db.select().from(stockBinsTable).where(eq(stockBinsTable.id, id));
  if (!bin) { res.status(404).send("Bin not found"); return; }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bin Label — ${bin.binNumber}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;background:#e5e7eb;display:flex;flex-direction:column;align-items:center;padding:20px;gap:16px}
    #toolbar{width:6in;display:flex;align-items:center;gap:12px;padding:10px 16px;background:#1e3a5f;color:white;border-radius:6px}
    #toolbar span{flex:1;font-size:13px;font-weight:700}
    #toolbar button{padding:6px 18px;border:none;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;background:#22c55e;color:white}
    .label{width:6in;height:4in;background:white;border:1px solid #aaa;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0.2in}
    .bin-label{font-size:7pt;font-weight:900;text-transform:uppercase;letter-spacing:.25em;color:#555}
    .bin-number{font-size:72pt;font-weight:900;color:#000;line-height:1;letter-spacing:-.02em}
    .bin-notes{font-size:12pt;color:#555;font-weight:400;margin-top:0.1in}
    @media print{body{background:white;padding:0}#toolbar{display:none}.label{box-shadow:none;border:none;page-break-after:always}}
  </style>
</head>
<body>
  <div id="toolbar">
    <span>Bin Label — ${bin.binNumber}</span>
    <button onclick="window.print()">Print</button>
  </div>
  <div class="label">
    <div class="bin-label">Bin</div>
    <div class="bin-number">${bin.binNumber}</div>
    ${bin.notes ? `<div class="bin-notes">${bin.notes}</div>` : ""}
  </div>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export default router;
