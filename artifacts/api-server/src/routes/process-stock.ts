import { Router, type IRouter } from "express";
import { eq, ilike, or, sql } from "drizzle-orm";
import { db, processStockTable, suppliersTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const processStockBody = z.object({
  name: z.string().min(1),
  sku: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  unitCost: z.number().min(0).default(0),
  stockQuantity: z.number().int().default(0),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierCode: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const idParam = z.object({ id: z.coerce.number().int().positive() });

function toFloat(val: string | null | undefined): number {
  if (val == null) return 0;
  return parseFloat(val);
}

router.get("/process-stock", async (req, res): Promise<void> => {
  const search = typeof req.query.search === "string" ? req.query.search : null;

  let rows;
  if (search) {
    const term = `%${search}%`;
    rows = await db
      .select({ ps: processStockTable, supplierName: suppliersTable.name })
      .from(processStockTable)
      .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
      .where(or(ilike(processStockTable.name, term), ilike(processStockTable.sku, term)))
      .orderBy(processStockTable.name);
  } else {
    rows = await db
      .select({ ps: processStockTable, supplierName: suppliersTable.name })
      .from(processStockTable)
      .leftJoin(suppliersTable, eq(processStockTable.supplierId, suppliersTable.id))
      .orderBy(processStockTable.name);
  }

  res.json(rows.map(r => ({
    ...r.ps,
    unitCost: toFloat(r.ps.unitCost),
    supplierName: r.supplierName ?? null,
  })));
});

router.post("/process-stock", async (req, res): Promise<void> => {
  const parsed = processStockBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(processStockTable)
    .values({ ...parsed.data, unitCost: String(parsed.data.unitCost) })
    .returning();
  res.status(201).json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.get("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.select().from(processStockTable).where(eq(processStockTable.id, parsed.data.id));
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.patch("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const body = processStockBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.unitCost !== undefined) updateData.unitCost = String(body.data.unitCost);
  const [row] = await db
    .update(processStockTable)
    .set(updateData)
    .where(eq(processStockTable.id, parsed.data.id))
    .returning();
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.json({ ...row, unitCost: toFloat(row.unitCost) });
});

router.delete("/process-stock/:id", async (req, res): Promise<void> => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.delete(processStockTable).where(eq(processStockTable.id, parsed.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Process stock item not found" }); return; }
  res.sendStatus(204);
});

export default router;
