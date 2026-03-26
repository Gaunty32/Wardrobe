import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  customerDeliveryAddressesTable,
  customerContactsTable,
  customerProcessesTable,
  customerFinishesTable,
  customerFinishProcessesTable,
  customerEmployeesTable,
  customersTable,
  ordersTable,
} from "@workspace/db";

const router: IRouter = Router();

const customerIdParam = z.object({ customerId: z.coerce.number().int().positive() });
const subIdParam = z.object({ customerId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });
const finishProcessParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
  processId: z.coerce.number().int().positive(),
});
const finishIdParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
});

// ── Helper: verify customer exists ──────────────────────────────────────────
async function getCustomer(id: number) {
  const [c] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  return c;
}

// ─── Delivery Addresses ──────────────────────────────────────────────────────

const addressBody = z.object({
  label: z.string().optional().nullable(),
  line1: z.string().optional().nullable(),
  line2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  county: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  isDefault: z.boolean().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerDeliveryAddressesTable)
    .where(eq(customerDeliveryAddressesTable.customerId, p.data.customerId))
    .orderBy(customerDeliveryAddressesTable.createdAt);
  res.json(rows);
});

router.post("/customers/:customerId/addresses", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = addressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerDeliveryAddressesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = addressBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerDeliveryAddressesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerDeliveryAddressesTable.id, p.data.id), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Address not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/addresses/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerDeliveryAddressesTable)
    .where(and(eq(customerDeliveryAddressesTable.id, p.data.id), eq(customerDeliveryAddressesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Address not found" }); return; }
  res.sendStatus(204);
});

// ─── Contacts ────────────────────────────────────────────────────────────────

const contactBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/contacts", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerContactsTable)
    .where(eq(customerContactsTable.customerId, p.data.customerId))
    .orderBy(customerContactsTable.lastName);
  res.json(rows);
});

router.post("/customers/:customerId/contacts", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = contactBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerContactsTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/contacts/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = contactBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerContactsTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerContactsTable.id, p.data.id), eq(customerContactsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/contacts/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerContactsTable)
    .where(and(eq(customerContactsTable.id, p.data.id), eq(customerContactsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Contact not found" }); return; }
  res.sendStatus(204);
});

// ─── Processes ───────────────────────────────────────────────────────────────

const processBody = z.object({
  name: z.string().min(1),
  type: z.string().optional().nullable(),
  placement: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerProcessesTable)
    .where(eq(customerProcessesTable.customerId, p.data.customerId))
    .orderBy(customerProcessesTable.name);
  res.json(rows);
});

router.post("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = processBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerProcessesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/processes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = processBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerProcessesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerProcessesTable.id, p.data.id), eq(customerProcessesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Process not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/processes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerProcessesTable)
    .where(and(eq(customerProcessesTable.id, p.data.id), eq(customerProcessesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Process not found" }); return; }
  res.sendStatus(204);
});

// ─── Finishes ────────────────────────────────────────────────────────────────

const finishBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/finishes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const finishes = await db.select().from(customerFinishesTable)
    .where(eq(customerFinishesTable.customerId, p.data.customerId))
    .orderBy(customerFinishesTable.name);

  const result = await Promise.all(finishes.map(async (finish) => {
    const fps = await db.select({
      id: customerFinishProcessesTable.id,
      processId: customerFinishProcessesTable.processId,
      name: customerProcessesTable.name,
      type: customerProcessesTable.type,
      placement: customerProcessesTable.placement,
    })
      .from(customerFinishProcessesTable)
      .innerJoin(customerProcessesTable, eq(customerFinishProcessesTable.processId, customerProcessesTable.id))
      .where(eq(customerFinishProcessesTable.finishId, finish.id));
    return { ...finish, processes: fps };
  }));

  res.json(result);
});

router.post("/customers/:customerId/finishes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = finishBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerFinishesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json({ ...row, processes: [] });
});

router.patch("/customers/:customerId/finishes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerFinishesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerFinishesTable.id, p.data.id), eq(customerFinishesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finish not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/finishes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerFinishesTable)
    .where(and(eq(customerFinishesTable.id, p.data.id), eq(customerFinishesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finish not found" }); return; }
  res.sendStatus(204);
});

router.post("/customers/:customerId/finishes/:finishId/processes/:processId", async (req, res): Promise<void> => {
  const p = finishProcessParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.insert(customerFinishProcessesTable)
    .values({ finishId: p.data.finishId, processId: p.data.processId })
    .returning();
  res.status(201).json(row);
});

router.delete("/customers/:customerId/finishes/:finishId/processes/:processId", async (req, res): Promise<void> => {
  const p = finishProcessParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProcessesTable)
    .where(and(
      eq(customerFinishProcessesTable.finishId, p.data.finishId),
      eq(customerFinishProcessesTable.processId, p.data.processId)
    ));
  res.sendStatus(204);
});

// ─── Employees ───────────────────────────────────────────────────────────────

const employeeBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerEmployeesTable)
    .where(eq(customerEmployeesTable.customerId, p.data.customerId))
    .orderBy(customerEmployeesTable.lastName);
  res.json(rows);
});

router.post("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = employeeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerEmployeesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/employees/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = employeeBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerEmployeesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerEmployeesTable.id, p.data.id), eq(customerEmployeesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/employees/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerEmployeesTable)
    .where(and(eq(customerEmployeesTable.id, p.data.id), eq(customerEmployeesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Employee not found" }); return; }
  res.sendStatus(204);
});

// ─── Order History ───────────────────────────────────────────────────────────

router.get("/customers/:customerId/orders", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(ordersTable)
    .where(eq(ordersTable.customerId, p.data.customerId))
    .orderBy(ordersTable.createdAt);
  res.json(rows.map(o => ({ ...o, totalAmount: o.totalAmount ? parseFloat(o.totalAmount) : 0 })));
});

export default router;
