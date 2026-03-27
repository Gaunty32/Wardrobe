import { pgTable, text, serial, timestamp, integer, boolean, numeric } from "drizzle-orm/pg-core";
import { customersTable } from "./customers";

export const customerDeliveryAddressesTable = pgTable("customer_delivery_addresses", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  label: text("label"),
  line1: text("line1"),
  line2: text("line2"),
  city: text("city"),
  county: text("county"),
  postcode: text("postcode"),
  country: text("country").default("United Kingdom"),
  isDefault: boolean("is_default").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerContactsTable = pgTable("customer_contacts", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  jobTitle: text("job_title"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerProcessesTable = pgTable("customer_processes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type"),
  placement: text("placement"),
  price: numeric("price", { precision: 10, scale: 2 }),
  processStockId: integer("process_stock_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerFinishesTable = pgTable("customer_finishes", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerFinishProcessesTable = pgTable("customer_finish_processes", {
  id: serial("id").primaryKey(),
  finishId: integer("finish_id").notNull().references(() => customerFinishesTable.id, { onDelete: "cascade" }),
  processId: integer("process_id").notNull().references(() => customerProcessesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerFinishProductsTable = pgTable("customer_finish_products", {
  id: serial("id").primaryKey(),
  finishId: integer("finish_id").notNull().references(() => customerFinishesTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const customerFinishedItemsTable = pgTable("customer_finished_items", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  productId: integer("product_id").notNull(),
  finishId: integer("finish_id"),
  colour: text("colour"),
  size: text("size"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const customerEmployeesTable = pgTable("customer_employees", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customersTable.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  email: text("email"),
  phone: text("phone"),
  department: text("department"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
