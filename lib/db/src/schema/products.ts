import { pgTable, text, serial, timestamp, numeric, integer, boolean, jsonb } from "drizzle-orm/pg-core";
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
  secondarySupplierCode: text("secondary_supplier_code"),
  secondarySupplierPrice: numeric("secondary_supplier_price", { precision: 10, scale: 2 }),
  /** Currency used when purchasing from supplier (e.g. "USD", "GBP") */
  supplierCurrency: text("supplier_currency").notNull().default("GBP"),
  /** Minimum units that must be ordered from the supplier */
  minOrderQty: integer("min_order_qty"),
  /** Tiered pricing: [{qty: 25, price: 15.00}, {qty: 50, price: 11.00}, ...] sorted asc by qty */
  priceBreaks: jsonb("price_breaks").$type<{ qty: number; price: number }[]>(),
  imageUrl: text("image_url"),
  wooCommerceId: integer("woo_commerce_id"),
  taxStatus: text("tax_status"),
  taxClass: text("tax_class"),
  /** VAT rate as a decimal, e.g. 0.20 = standard 20%, 0 = zero-rated (children's clothing etc.) */
  vatRate: numeric("vat_rate", { precision: 5, scale: 4 }).notNull().default("0.2000"),
  /** If set, this is a bespoke product belonging exclusively to this customer */
  customerId: integer("customer_id"),
  /** Bespoke products are hidden from WooCommerce sync */
  isBespoke: boolean("is_bespoke").notNull().default(false),
  /** Service products (e.g. logo digitising) — no stock, no variants, no purchasing */
  isService: boolean("is_service").notNull().default(false),
  /** Archived products are hidden from order entry, purchasing, and WooCommerce sync */
  isArchived: boolean("is_archived").notNull().default(false),
  /** Guidance: what the product is best suited for */
  guidanceBestFor: text("guidance_best_for"),
  /** Guidance: situations where this product is not ideal */
  guidanceNotIdealFor: text("guidance_not_ideal_for"),
  /** Guidance: internal staff recommendation / selling tip */
  guidanceStaffRecommendation: text("guidance_staff_recommendation"),
  /** Guidance: promotional badge — 'Most Popular' | 'Best Value' | 'Premium Choice' | 'Staff Pick' */
  guidanceBadge: text("guidance_badge"),
  /** Guidance: value-for-money rating 1–5 */
  guidanceValueRating: integer("guidance_value_rating"),
  /** Guidance: durability rating 1–5 */
  guidanceDurabilityRating: integer("guidance_durability_rating"),
  /** Guidance: smarts/tech rating 1–5 */
  guidanceSmartRating: integer("guidance_smart_rating"),
  /** Guidance: display tags e.g. ['Everyday Workwear', 'Heavy Duty'] */
  guidanceTags: jsonb("guidance_tags").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
