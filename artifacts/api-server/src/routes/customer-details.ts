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
  customerFinishProductsTable,
  customerFinishedItemsTable,
  customerRolesTable,
  customerEmployeesTable,
  customerEmployeeSizesTable,
  customersTable,
  ordersTable,
  productsTable,
} from "@workspace/db";

const router: IRouter = Router();

const customerIdParam = z.object({ customerId: z.coerce.number().int().positive() });
const subIdParam = z.object({ customerId: z.coerce.number().int().positive(), id: z.coerce.number().int().positive() });
const finishProcessParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
  processId: z.coerce.number().int().positive(),
});
const finishProductParam = z.object({
  customerId: z.coerce.number().int().positive(),
  finishId: z.coerce.number().int().positive(),
  productId: z.coerce.number().int().positive(),
});
const employeeSizeParam = z.object({
  customerId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive(),
  sizeId: z.coerce.number().int().positive(),
});
const employeeSubParam = z.object({
  customerId: z.coerce.number().int().positive(),
  employeeId: z.coerce.number().int().positive(),
});

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
  price: z.number().min(0).optional().nullable(),
  processStockId: z.number().int().positive().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function processToJson(row: Record<string, unknown>) {
  return { ...row, price: row.price != null ? parseFloat(row.price as string) : null };
}

router.get("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerProcessesTable)
    .where(eq(customerProcessesTable.customerId, p.data.customerId))
    .orderBy(customerProcessesTable.name);
  res.json(rows.map(processToJson));
});

router.post("/customers/:customerId/processes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = processBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const insertData: Record<string, unknown> = { ...body.data, customerId: p.data.customerId };
  if (body.data.price != null) insertData.price = String(body.data.price);
  const [inserted] = await db.insert(customerProcessesTable).values(insertData).returning();
  const code = `P${String(inserted.id).padStart(3, "0")}`;
  const [row] = await db.update(customerProcessesTable).set({ code }).where(eq(customerProcessesTable.id, inserted.id)).returning();
  res.status(201).json(processToJson(row as Record<string, unknown>));
});

router.patch("/customers/:customerId/processes/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = processBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.price != null) updateData.price = String(body.data.price);
  const [row] = await db.update(customerProcessesTable)
    .set(updateData)
    .where(and(eq(customerProcessesTable.id, p.data.id), eq(customerProcessesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Process not found" }); return; }
  res.json(processToJson(row as Record<string, unknown>));
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
      price: customerProcessesTable.price,
    })
      .from(customerFinishProcessesTable)
      .innerJoin(customerProcessesTable, eq(customerFinishProcessesTable.processId, customerProcessesTable.id))
      .where(eq(customerFinishProcessesTable.finishId, finish.id));

    const processes = fps.map(fp => ({ ...fp, price: fp.price != null ? parseFloat(fp.price) : null }));
    const totalCost = processes.reduce((sum, fp) => sum + (fp.price ?? 0), 0);

    const garmentRows = await db.select({
      id: customerFinishProductsTable.id,
      productId: customerFinishProductsTable.productId,
      colour: customerFinishProductsTable.colour,
      name: productsTable.name,
      sku: productsTable.sku,
    })
      .from(customerFinishProductsTable)
      .innerJoin(productsTable, eq(customerFinishProductsTable.productId, productsTable.id))
      .where(eq(customerFinishProductsTable.finishId, finish.id));

    return { ...finish, processes, totalCost, garments: garmentRows };
  }));

  res.json(result);
});

router.post("/customers/:customerId/finishes", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = finishBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [inserted] = await db.insert(customerFinishesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  const code = `F${String(inserted.id).padStart(3, "0")}`;
  const [row] = await db.update(customerFinishesTable).set({ code }).where(eq(customerFinishesTable.id, inserted.id)).returning();
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

router.post("/customers/:customerId/finishes/:finishId/products/:productId", async (req, res): Promise<void> => {
  const p = finishProductParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const colour: string | null = req.body?.colour ?? null;
  const conditions = [
    eq(customerFinishProductsTable.finishId, p.data.finishId),
    eq(customerFinishProductsTable.productId, p.data.productId),
    colour ? eq(customerFinishProductsTable.colour, colour) : sql`${customerFinishProductsTable.colour} IS NULL`,
  ];
  const existing = await db.select().from(customerFinishProductsTable).where(and(...conditions));
  if (existing.length > 0) { res.status(409).json({ error: "This colour is already assigned to this finish" }); return; }
  const [row] = await db.insert(customerFinishProductsTable)
    .values({ finishId: p.data.finishId, productId: p.data.productId, colour })
    .returning();
  res.status(201).json(row);
});

router.delete("/customers/:customerId/finishes/:finishId/products/:productId", async (req, res): Promise<void> => {
  const p = finishProductParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProductsTable)
    .where(and(
      eq(customerFinishProductsTable.finishId, p.data.finishId),
      eq(customerFinishProductsTable.productId, p.data.productId)
    ));
  res.sendStatus(204);
});

router.delete("/customers/:customerId/finishes/:finishId/garments/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerFinishProductsTable).where(eq(customerFinishProductsTable.id, p.data.id));
  res.sendStatus(204);
});

// ─── Roles ────────────────────────────────────────────────────────────────────

const roleBody = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
});

router.get("/customers/:customerId/roles", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const rows = await db.select().from(customerRolesTable)
    .where(eq(customerRolesTable.customerId, p.data.customerId))
    .orderBy(customerRolesTable.name);
  res.json(rows);
});

router.post("/customers/:customerId/roles", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = roleBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerRolesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/roles/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = roleBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerRolesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(and(eq(customerRolesTable.id, p.data.id), eq(customerRolesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Role not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/roles/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerRolesTable)
    .where(and(eq(customerRolesTable.id, p.data.id), eq(customerRolesTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Role not found" }); return; }
  res.sendStatus(204);
});

// ─── Employees ───────────────────────────────────────────────────────────────

const employeeBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().nullable(),
  jobTitle: z.string().optional().nullable(),
  roleId: z.number().int().positive().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const showInactive = req.query.showInactive === "true";

  const allEmployees = await db.select({
    id: customerEmployeesTable.id,
    customerId: customerEmployeesTable.customerId,
    firstName: customerEmployeesTable.firstName,
    lastName: customerEmployeesTable.lastName,
    jobTitle: customerEmployeesTable.jobTitle,
    roleId: customerEmployeesTable.roleId,
    email: customerEmployeesTable.email,
    phone: customerEmployeesTable.phone,
    department: customerEmployeesTable.department,
    isActive: customerEmployeesTable.isActive,
    notes: customerEmployeesTable.notes,
    createdAt: customerEmployeesTable.createdAt,
    updatedAt: customerEmployeesTable.updatedAt,
  })
    .from(customerEmployeesTable)
    .where(eq(customerEmployeesTable.customerId, p.data.customerId))
    .orderBy(customerEmployeesTable.lastName);

  const roles = await db.select().from(customerRolesTable)
    .where(eq(customerRolesTable.customerId, p.data.customerId));
  const roleMap = new Map(roles.map(r => [r.id, r.name]));

  const filtered = showInactive ? allEmployees : allEmployees.filter(e => e.isActive);

  const withRoles = await Promise.all(filtered.map(async (emp) => {
    const sizes = await db.select().from(customerEmployeeSizesTable)
      .where(eq(customerEmployeeSizesTable.employeeId, emp.id))
      .orderBy(customerEmployeeSizesTable.label);
    return {
      ...emp,
      roleName: emp.roleId ? (roleMap.get(emp.roleId) ?? null) : null,
      sizes,
    };
  }));

  res.json(withRoles);
});

router.post("/customers/:customerId/employees", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = employeeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerEmployeesTable).values({ ...body.data, customerId: p.data.customerId }).returning();
  res.status(201).json({ ...row, roleName: null, sizes: [] });
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

// ─── Employee Sizes ───────────────────────────────────────────────────────────

const sizeBody = z.object({
  label: z.string().min(1),
  size: z.string().min(1),
});

router.get("/customers/:customerId/employees/:employeeId/sizes", async (req, res): Promise<void> => {
  const p = employeeSubParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const rows = await db.select().from(customerEmployeeSizesTable)
    .where(eq(customerEmployeeSizesTable.employeeId, p.data.employeeId))
    .orderBy(customerEmployeeSizesTable.label);
  res.json(rows);
});

router.post("/customers/:customerId/employees/:employeeId/sizes", async (req, res): Promise<void> => {
  const p = employeeSubParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = sizeBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerEmployeeSizesTable)
    .values({ ...body.data, employeeId: p.data.employeeId })
    .returning();
  res.status(201).json(row);
});

router.patch("/customers/:customerId/employees/:employeeId/sizes/:sizeId", async (req, res): Promise<void> => {
  const p = employeeSizeParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = sizeBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.update(customerEmployeeSizesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(customerEmployeeSizesTable.id, p.data.sizeId))
    .returning();
  if (!row) { res.status(404).json({ error: "Size not found" }); return; }
  res.json(row);
});

router.delete("/customers/:customerId/employees/:employeeId/sizes/:sizeId", async (req, res): Promise<void> => {
  const p = employeeSizeParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  await db.delete(customerEmployeeSizesTable).where(eq(customerEmployeeSizesTable.id, p.data.sizeId));
  res.sendStatus(204);
});

// ─── Finished Items (Wardrobe) ────────────────────────────────────────────────

const finishedItemBody = z.object({
  name: z.string().min(1),
  roleId: z.number().int().positive().optional().nullable(),
  productId: z.number().int().positive(),
  finishId: z.number().int().positive().optional().nullable(),
  colour: z.string().optional().nullable(),
  size: z.string().optional().nullable(),
  unitPrice: z.number().min(0),
  specialPrice: z.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
});

router.get("/customers/:customerId/finished-items", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }

  const rows = await db.select({
    id: customerFinishedItemsTable.id,
    customerId: customerFinishedItemsTable.customerId,
    roleId: customerFinishedItemsTable.roleId,
    name: customerFinishedItemsTable.name,
    productId: customerFinishedItemsTable.productId,
    productName: productsTable.name,
    productSku: productsTable.sku,
    finishId: customerFinishedItemsTable.finishId,
    colour: customerFinishedItemsTable.colour,
    size: customerFinishedItemsTable.size,
    unitPrice: customerFinishedItemsTable.unitPrice,
    specialPrice: customerFinishedItemsTable.specialPrice,
    notes: customerFinishedItemsTable.notes,
    createdAt: customerFinishedItemsTable.createdAt,
  })
    .from(customerFinishedItemsTable)
    .leftJoin(productsTable, eq(customerFinishedItemsTable.productId, productsTable.id))
    .where(eq(customerFinishedItemsTable.customerId, p.data.customerId))
    .orderBy(customerFinishedItemsTable.name);

  const finishes = await db.select({ id: customerFinishesTable.id, name: customerFinishesTable.name })
    .from(customerFinishesTable)
    .where(eq(customerFinishesTable.customerId, p.data.customerId));
  const finishMap = new Map(finishes.map(f => [f.id, f.name]));

  const roles = await db.select({ id: customerRolesTable.id, name: customerRolesTable.name })
    .from(customerRolesTable)
    .where(eq(customerRolesTable.customerId, p.data.customerId));
  const roleMap = new Map(roles.map(r => [r.id, r.name]));

  res.json(rows.map(r => ({
    ...r,
    unitPrice: r.unitPrice != null ? parseFloat(r.unitPrice) : 0,
    specialPrice: r.specialPrice != null ? parseFloat(r.specialPrice) : null,
    finishName: r.finishId ? (finishMap.get(r.finishId) ?? null) : null,
    roleName: r.roleId ? (roleMap.get(r.roleId) ?? null) : null,
  })));
});

router.post("/customers/:customerId/finished-items", async (req, res): Promise<void> => {
  const p = customerIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  if (!await getCustomer(p.data.customerId)) { res.status(404).json({ error: "Customer not found" }); return; }
  const body = finishedItemBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [row] = await db.insert(customerFinishedItemsTable)
    .values({
      ...body.data,
      customerId: p.data.customerId,
      unitPrice: String(body.data.unitPrice),
      specialPrice: body.data.specialPrice != null ? String(body.data.specialPrice) : null,
    })
    .returning();
  res.status(201).json({ ...row, unitPrice: parseFloat(row.unitPrice!), specialPrice: row.specialPrice != null ? parseFloat(row.specialPrice) : null });
});

router.patch("/customers/:customerId/finished-items/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const body = finishedItemBody.partial().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const updateData: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  if (body.data.unitPrice != null) updateData.unitPrice = String(body.data.unitPrice);
  if ("specialPrice" in body.data) updateData.specialPrice = body.data.specialPrice != null ? String(body.data.specialPrice) : null;
  const [row] = await db.update(customerFinishedItemsTable)
    .set(updateData)
    .where(and(eq(customerFinishedItemsTable.id, p.data.id), eq(customerFinishedItemsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finished item not found" }); return; }
  res.json({ ...row, unitPrice: parseFloat(row.unitPrice!), specialPrice: row.specialPrice != null ? parseFloat(row.specialPrice) : null });
});

router.delete("/customers/:customerId/finished-items/:id", async (req, res): Promise<void> => {
  const p = subIdParam.safeParse(req.params);
  if (!p.success) { res.status(400).json({ error: p.error.message }); return; }
  const [row] = await db.delete(customerFinishedItemsTable)
    .where(and(eq(customerFinishedItemsTable.id, p.data.id), eq(customerFinishedItemsTable.customerId, p.data.customerId)))
    .returning();
  if (!row) { res.status(404).json({ error: "Finished item not found" }); return; }
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
