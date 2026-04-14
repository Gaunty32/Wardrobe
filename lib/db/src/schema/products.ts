import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productsTable = pgTable("products", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sku: text("sku"),
  category: text("category"),
  description: text("description"),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull().default("0"),
  stockQuantity: integer("stock_quantity"),
  supplierId: integer("supplier_id"),
  secondarySupplierId: integer("secondary_supplier_id"),
  supplierCode: text("supplier_code"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }),
  imageUrl: text("image_url"),
  wooCommerceId: integer("woo_commerce_id"),
  taxStatus: text("tax_status"),
  taxClass: text("tax_class"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
