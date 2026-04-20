import { pgTable, text, serial, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { customersTable } from "./customers";
import { productsTable } from "./products";
import { suppliersTable } from "./suppliers";

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  customerId: integer("customer_id").references(() => customersTable.id, { onDelete: "set null" }),
  customerName: text("customer_name"),
  status: text("status").notNull().default("draft"),
  totalAmount: numeric("total_amount", { precision: 10, scale: 2 }).notNull().default("0"),
  notes: text("notes"),
  orderDate: timestamp("order_date", { withTimezone: true }).notNull().defaultNow(),
  requiredDate: timestamp("required_date", { withTimezone: true }),
  shippingMethod: text("shipping_method"),
  deliveryAddressId: integer("delivery_address_id"),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  xeroInvoiceId: text("xero_invoice_id"),
  xeroInvoiceStatus: text("xero_invoice_status"),
  trackingNumber: text("tracking_number"),
  invoiceEmailSentAt: timestamp("invoice_email_sent_at", { withTimezone: true }),
  invoiceEmailSentTo: text("invoice_email_sent_to"),
  source: text("source").notNull().default("internal"),
  portalStatus: text("portal_status"),
  portalNotes: text("portal_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const orderItemsTable = pgTable("order_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => ordersTable.id, { onDelete: "cascade" }),
  productId: integer("product_id").references(() => productsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  finishId: integer("finish_id"),
  finishName: text("finish_name"),
  recipientType: text("recipient_type").notNull().default("stock"),
  recipientName: text("recipient_name"),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  lineTotal: numeric("line_total", { precision: 10, scale: 2 }).notNull().default("0"),
  recipientEmployeeId: integer("recipient_employee_id"),
  purchaseRequired: boolean("purchase_required").notNull().default(false),
  purchaseQuantity: integer("purchase_quantity"),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name"),
  // Stock allocation tracking: null=pending, allocated=plain stock picked, in_production=worksheet created, complete=done
  stockStatus: text("stock_status"),
  stockAllocatedAt: timestamp("stock_allocated_at", { withTimezone: true }),
});

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull().unique(),
  supplierId: integer("supplier_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  supplierName: text("supplier_name").notNull(),
  supplierEmail: text("supplier_email"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  estimatedDeliveryDate: timestamp("estimated_delivery_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const purchaseOrderItemsTable = pgTable("purchase_order_items", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull().references(() => purchaseOrdersTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id").references(() => orderItemsTable.id, { onDelete: "set null" }),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  supplierCode: text("supplier_code"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }),
  quantityOrdered: integer("quantity_ordered").notNull().default(1),
  quantityDelivered: integer("quantity_delivered").notNull().default(0),
  estimatedDueDate: timestamp("estimated_due_date", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const worksheetsTable = pgTable("worksheets", {
  id: serial("id").primaryKey(),
  worksheetNumber: text("worksheet_number").notNull().unique(),
  status: text("status").notNull().default("pre_wip"),
  orderId: integer("order_id").references(() => ordersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  customerId: integer("customer_id"),
  customerName: text("customer_name"),
  notes: text("notes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const worksheetItemsTable = pgTable("worksheet_items", {
  id: serial("id").primaryKey(),
  worksheetId: integer("worksheet_id").notNull().references(() => worksheetsTable.id, { onDelete: "cascade" }),
  orderItemId: integer("order_item_id").references(() => orderItemsTable.id, { onDelete: "set null" }),
  productName: text("product_name").notNull(),
  colour: text("colour"),
  size: text("size"),
  quantity: integer("quantity").notNull().default(1),
  recipientType: text("recipient_type").notNull().default("stock"),
  recipientName: text("recipient_name"),
  finishId: integer("finish_id"),
  finishName: text("finish_name"),
  processesSnapshot: text("processes_snapshot"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({ id: true });
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
