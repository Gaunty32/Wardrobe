import { eq, inArray } from "drizzle-orm";
import { db, productsTable, productAttributesTable, settingsTable, syncLogsTable } from "@workspace/db";

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  regular_price: string;
  description: string;
  short_description: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  type: "simple" | "variable" | string;
  categories: { id: number; name: string; slug: string }[];
  attributes: { id: number; name: string; options: string[]; variation: boolean }[];
  variations: number[];
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  stock_quantity: number | null;
  attributes: { id: number; name: string; option: string }[];
}

async function getSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settingsTable);
  return Object.fromEntries(rows.filter((r) => r.value != null).map((r) => [r.key, r.value as string]));
}

async function wooFetch<T>(baseUrl: string, path: string, consumerKey: string, consumerSecret: string): Promise<T> {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`);
  url.searchParams.set("consumer_key", consumerKey);
  url.searchParams.set("consumer_secret", consumerSecret);
  const res = await fetch(url.toString(), { headers: { "Accept": "application/json" } });
  if (!res.ok) throw new Error(`WooCommerce API error ${res.status}: ${await res.text()}`);
  return res.json() as T;
}

async function fetchAllProducts(baseUrl: string, ck: string, cs: string): Promise<WooProduct[]> {
  const all: WooProduct[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    const batch = await wooFetch<WooProduct[]>(baseUrl, `/products?per_page=${perPage}&page=${page}&status=publish`, ck, cs);
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

async function fetchVariations(baseUrl: string, ck: string, cs: string, productId: number): Promise<WooVariation[]> {
  const all: WooVariation[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooVariation[]>(baseUrl, `/products/${productId}/variations?per_page=100&page=${page}`, ck, cs);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

function isColourAttr(name: string): boolean {
  return /colou?r|pa_colou?r/i.test(name);
}
function isSizeAttr(name: string): boolean {
  return /^size$|^pa_size$/i.test(name);
}

export async function runWooSync(): Promise<{ created: number; updated: number; errors: string[] }> {
  const settings = await getSettings();
  const baseUrl = settings["woo_url"];
  const ck = settings["woo_consumer_key"];
  const cs = settings["woo_consumer_secret"];

  if (!baseUrl || !ck || !cs) throw new Error("WooCommerce credentials not configured.");

  const [log] = await db.insert(syncLogsTable).values({ type: "woocommerce", status: "running", startedAt: new Date() }).returning();

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  try {
    const products = await fetchAllProducts(baseUrl, ck, cs);

    for (const wooProduct of products) {
      try {
        const wooId = wooProduct.id;
        const category = wooProduct.categories?.[0]?.name ?? null;
        const priceStr = wooProduct.regular_price || wooProduct.price || "0";
        const price = parseFloat(priceStr) || 0;
        const stockQty = wooProduct.manage_stock ? (wooProduct.stock_quantity ?? null) : null;

        const existing = await db.select({ id: productsTable.id }).from(productsTable)
          .where(eq(productsTable.wooCommerceId, wooId))
          .limit(1);

        let productId: number;

        if (existing.length > 0) {
          productId = existing[0].id;
          await db.update(productsTable).set({
            name: wooProduct.name,
            sku: wooProduct.sku || null,
            category,
            description: wooProduct.short_description || wooProduct.description || null,
            unitPrice: String(price),
            stockQuantity: stockQty,
          }).where(eq(productsTable.id, productId));
          updated++;
        } else {
          const [inserted] = await db.insert(productsTable).values({
            wooCommerceId: wooId,
            name: wooProduct.name,
            sku: wooProduct.sku || null,
            category,
            description: wooProduct.short_description || wooProduct.description || null,
            unitPrice: String(price),
            stockQuantity: stockQty,
          }).returning();
          productId = inserted.id;
          created++;
        }

        const colours = new Set<string>();
        const sizes = new Set<string>();

        if (wooProduct.type === "variable" && wooProduct.variations?.length > 0) {
          const variations = await fetchVariations(baseUrl, ck, cs, wooId);
          for (const v of variations) {
            for (const attr of v.attributes) {
              if (isColourAttr(attr.name)) colours.add(attr.option);
              else if (isSizeAttr(attr.name)) sizes.add(attr.option);
            }
          }
        } else {
          for (const attr of wooProduct.attributes) {
            if (isColourAttr(attr.name)) attr.options.forEach((o) => colours.add(o));
            else if (isSizeAttr(attr.name)) attr.options.forEach((o) => sizes.add(o));
          }
        }

        await db.delete(productAttributesTable).where(eq(productAttributesTable.productId, productId));
        const attrValues: { productId: number; type: string; value: string; sortOrder: number }[] = [];
        let i = 0;
        for (const c of colours) attrValues.push({ productId, type: "colour", value: c, sortOrder: i++ });
        for (const s of sizes) attrValues.push({ productId, type: "size", value: s, sortOrder: i++ });
        if (attrValues.length > 0) await db.insert(productAttributesTable).values(attrValues);

      } catch (err) {
        errors.push(`Product ${wooProduct.id} (${wooProduct.name}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    await db.update(syncLogsTable).set({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      message: `Synced ${products.length} products`,
      itemsCreated: String(created),
      itemsUpdated: String(updated),
      errors: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
      completedAt: new Date(),
    }).where(eq(syncLogsTable.id, log.id));

    return { created, updated, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(syncLogsTable).set({ status: "failed", message: msg, completedAt: new Date() }).where(eq(syncLogsTable.id, log.id));
    throw err;
  }
}
