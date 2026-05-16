import { eq, inArray, isNotNull, and, sql } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable, settingsTable, syncLogsTable, productCategoriesTable } from "@workspace/db";

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
  image: { id: number; src: string; alt: string } | null;
}

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  on_sale: boolean;
  description: string;
  short_description: string;
  stock_quantity: number | null;
  manage_stock: boolean;
  type: "simple" | "variable" | "yith_bundle" | string;
  tax_status: "taxable" | "shipping" | "none" | string;
  tax_class: string;
  categories: { id: number; name: string; slug: string }[];
  images: { id: number; src: string; alt: string; position: number }[];
  attributes: { id: number; name: string; options: string[]; variation: boolean }[];
  variations: number[];
  meta_data: { key: string; value: unknown }[];
}

interface WooVariation {
  id: number;
  sku: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  image: { id: number; src: string; alt: string } | null;
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

async function fetchAllProducts(baseUrl: string, ck: string, cs: string, since?: Date): Promise<WooProduct[]> {
  const all: WooProduct[] = [];
  let page = 1;
  const perPage = 100;
  while (true) {
    let path = `/products?per_page=${perPage}&page=${page}&status=publish`;
    if (since) path += `&modified_after=${since.toISOString()}`;
    const batch = await wooFetch<WooProduct[]>(baseUrl, path, ck, cs);
    all.push(...batch);
    if (batch.length < perPage) break;
    page++;
  }
  return all;
}

/** Fetch only yith_bundle products (small set) with meta_data to extract price breaks */
async function fetchBundleProducts(baseUrl: string, ck: string, cs: string): Promise<WooProduct[]> {
  const all: WooProduct[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooProduct[]>(
      baseUrl,
      `/products?per_page=100&page=${page}&status=publish&type=yith_bundle`,
      ck, cs
    );
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
}

/**
 * Parse YITH bundle products and return price breaks to apply to their parent products.
 * A bundle like "24 x Baseball Cap @ £144 sale" → priceBreak { qty: 24, price: 6.00 }
 */
function extractBundlePriceBreaks(products: WooProduct[]): Map<number, { qty: number; price: number }[]> {
  // wooCommerceId → array of price breaks
  const result = new Map<number, { qty: number; price: number }[]>();

  for (const p of products) {
    if (p.type !== "yith_bundle") continue;

    const bundleDataMeta = p.meta_data?.find(m => m.key === "_yith_wcpb_bundle_data");
    if (!bundleDataMeta) continue;

    const bundleData = bundleDataMeta.value as Record<string, {
      product_id?: string;
      bp_min_qty?: string;
      bp_max_qty?: string;
      bp_discount?: string;
    }> | null;
    if (!bundleData || typeof bundleData !== "object") continue;

    // Bundle price: prefer sale_price when on_sale, else price
    const bundlePrice = parseFloat(
      (p.on_sale && p.sale_price) ? p.sale_price : (p.price || p.regular_price || "0")
    );
    if (!bundlePrice || bundlePrice <= 0) continue;

    for (const item of Object.values(bundleData)) {
      const wooProductId = item.product_id ? parseInt(item.product_id, 10) : null;
      const minQty = item.bp_min_qty ? parseInt(item.bp_min_qty, 10) : null;

      if (!wooProductId || !minQty || minQty <= 1) continue;

      // Compute effective per-unit price from the bundle total
      const perUnitPrice = Math.round((bundlePrice / minQty) * 100) / 100;

      const existing = result.get(wooProductId) ?? [];
      // Avoid duplicate qty entries
      if (!existing.some(b => b.qty === minQty)) {
        existing.push({ qty: minQty, price: perUnitPrice });
      }
      result.set(wooProductId, existing);
    }
  }

  // Sort each product's breaks by qty ascending
  for (const [id, breaks] of result) {
    result.set(id, breaks.sort((a, b) => a.qty - b.qty));
  }

  return result;
}

async function fetchAllCategories(baseUrl: string, ck: string, cs: string): Promise<Map<number, WooCategory>> {
  const all: WooCategory[] = [];
  let page = 1;
  while (true) {
    const batch = await wooFetch<WooCategory[]>(baseUrl, `/products/categories?per_page=100&page=${page}`, ck, cs);
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return new Map(all.map((c) => [c.id, c]));
}

/**
 * Given a product's assigned categories, return the most specific (deepest) one.
 * WooCommerce assigns both parent and child categories to products — we want the leaf.
 */
function pickBestCategory(
  productCats: { id: number; name: string; slug: string }[],
  allCats: Map<number, WooCategory>
): string | null {
  if (!productCats.length) return null;
  if (productCats.length === 1) return productCats[0].name;

  // Find leaf categories — ones that are not a parent of any other product category
  const productCatIds = new Set(productCats.map((c) => c.id));
  const leaves = productCats.filter((cat) => {
    const isParentOfAnother = productCats.some((other) => {
      const full = allCats.get(other.id);
      return full && full.parent === cat.id;
    });
    return !isParentOfAnother;
  });

  // If we found leaves, return the first (or only) leaf name
  if (leaves.length > 0) return leaves[0].name;

  // Fallback: return deepest by traversing parent chain
  let deepest = productCats[0];
  let maxDepth = 0;
  for (const cat of productCats) {
    let depth = 0;
    let current = allCats.get(cat.id);
    while (current && current.parent !== 0) {
      depth++;
      current = allCats.get(current.parent);
      if (depth > 20) break; // safety
    }
    if (depth > maxDepth) { maxDepth = depth; deepest = cat; }
  }
  return deepest.name;
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
  // Match any attribute that contains "size" (pa_size, clothing-size, dress-size, etc.)
  // but exclude colour-related names just in case
  return /size/i.test(name) && !/colou?r/i.test(name);
}

/** Strip HTML tags and normalise whitespace */
function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const stripped = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripped || null;
}

export async function runWooSync(options?: { full?: boolean }): Promise<{ created: number; updated: number; errors: string[]; mode: string }> {
  const settings = await getSettings();
  const baseUrl = settings["woo_url"];
  const ck = settings["woo_consumer_key"];
  const cs = settings["woo_consumer_secret"];

  if (!baseUrl || !ck || !cs) throw new Error("WooCommerce credentials not configured.");

  // Record start time before fetching — used as the next sync's cutoff
  const syncStartedAt = new Date();

  // Determine sync mode
  let since: Date | undefined;
  if (!options?.full && settings["woo_last_sync_at"]) {
    since = new Date(settings["woo_last_sync_at"]);
  }
  const mode = since ? "incremental" : "full";

  const [log] = await db.insert(syncLogsTable).values({ type: "woocommerce", status: "running", startedAt: syncStartedAt }).returning();

  let created = 0;
  let updated = 0;
  const errors: string[] = [];

  /** Write progress to the log row, throttled to at most one DB write per 5% step */
  let lastReportedPct = 0;
  async function reportProgress(done: number, total: number): Promise<void> {
    if (total === 0) return;
    const pct = Math.min(99, Math.floor((done / total) * 100));
    if (pct >= lastReportedPct + 5) {
      lastReportedPct = pct;
      await db.update(syncLogsTable).set({ progressPct: pct }).where(eq(syncLogsTable.id, log.id));
    }
  }

  try {
    // Fetch full category hierarchy (small dataset, always refresh)
    const allCategories = await fetchAllCategories(baseUrl, ck, cs);

    // Persist categories (upsert by woo_id so images and counts stay current)
    for (const cat of allCategories.values()) {
      await db.insert(productCategoriesTable).values({
        wooId: cat.id,
        name: cat.name,
        slug: cat.slug,
        imageUrl: cat.image?.src ?? null,
        parentWooId: cat.parent || null,
        productCount: cat.count,
      }).onConflictDoUpdate({
        target: productCategoriesTable.wooId,
        set: {
          name: cat.name,
          slug: cat.slug,
          imageUrl: cat.image?.src ?? null,
          parentWooId: cat.parent || null,
          productCount: cat.count,
          updatedAt: new Date(),
        },
      });
    }

    // Fetch products — incremental uses modified_after to get only changed products
    const products = await fetchAllProducts(baseUrl, ck, cs, since);

    // Mark 5% once we know how many products to process
    await db.update(syncLogsTable).set({ progressPct: 5 }).where(eq(syncLogsTable.id, log.id));

    for (const [index, wooProduct] of products.entries()) {
      try {
        const wooId = wooProduct.id;
        const category = pickBestCategory(wooProduct.categories ?? [], allCategories);
        // Use the current active price (sale_price when on sale, otherwise price).
        // Fall back to regular_price last — it's the non-discounted price.
        const priceStr = (wooProduct.on_sale && wooProduct.sale_price)
          ? wooProduct.sale_price
          : (wooProduct.price || wooProduct.regular_price || "0");
        const price = parseFloat(priceStr) || 0;
        const regularPrice = wooProduct.regular_price ? String(parseFloat(wooProduct.regular_price) || 0) : null;
        const onSale = wooProduct.on_sale ?? false;
        const stockQty = wooProduct.manage_stock ? (wooProduct.stock_quantity ?? null) : null;
        const imageUrl = wooProduct.images?.[0]?.src ?? null;
        // Build a gallery map: alt-text (lowercased) → image src, for colour fallback
        const galleryByAlt = new Map<string, string>();
        for (const img of wooProduct.images ?? []) {
          if (img.alt) galleryByAlt.set(img.alt.toLowerCase().trim(), img.src);
        }

        const existing = await db.select({ id: productsTable.id }).from(productsTable)
          .where(eq(productsTable.wooCommerceId, wooId))
          .limit(1);

        let productId: number;

        const taxStatus = wooProduct.tax_status || null;
        // WooCommerce uses empty string for "Standard Rate" — normalise to null for clarity
        const taxClass = wooProduct.tax_class || null;

        if (existing.length > 0) {
          productId = existing[0].id;
          await db.execute(sql`
            UPDATE products SET
              name         = ${wooProduct.name},
              sku          = ${wooProduct.sku || null},
              category     = ${category},
              image_url    = ${imageUrl},
              description  = ${stripHtml(wooProduct.short_description || wooProduct.description)},
              unit_price   = ${String(price)},
              regular_price = ${regularPrice},
              on_sale      = ${onSale},
              stock_quantity = ${stockQty},
              tax_status   = ${taxStatus},
              tax_class    = ${taxClass}
            WHERE id = ${productId}
          `);
          updated++;
        } else {
          const [inserted] = await db.insert(productsTable).values({
            wooCommerceId: wooId,
            name: wooProduct.name,
            sku: wooProduct.sku || null,
            category,
            imageUrl,
            description: stripHtml(wooProduct.short_description || wooProduct.description),
            unitPrice: String(price),
            stockQuantity: stockQty,
            taxStatus,
            taxClass,
          }).returning();
          productId = inserted.id;
          created++;
        }

        const colours = new Set<string>();
        const sizes = new Set<string>();
        // Maps colour name → first variation image URL found for that colour
        const colourImages = new Map<string, string>();

        // Fetch variations for variable products and upsert product_variants
        const variantRows: {
          productId: number; wooVariationId: number; colour: string | null; size: string | null;
          sku: string | null; price: string | null; imageUrl: string | null; stockQuantity: number;
        }[] = [];

        if (wooProduct.type === "variable" && wooProduct.variations?.length > 0) {
          const variations = await fetchVariations(baseUrl, ck, cs, wooId);
          const mainImageSrc = wooProduct.images?.[0]?.src ?? null;

          for (const v of variations) {
            let vColour: string | null = null;
            let vSize: string | null = null;
            for (const attr of v.attributes) {
              if (isColourAttr(attr.name)) vColour = attr.option;
              else if (isSizeAttr(attr.name)) vSize = attr.option;
            }

            // Resolve variation image
            let vImageUrl: string | null = null;
            const varImg = v.image?.src;
            if (varImg && varImg !== mainImageSrc) {
              vImageUrl = varImg;
            } else if (vColour) {
              const colourKey = vColour.toLowerCase().trim();
              vImageUrl = galleryByAlt.get(colourKey) ??
                [...galleryByAlt.entries()].find(([alt]) => alt.includes(colourKey) || colourKey.includes(alt))?.[1] ?? null;
            }

            if (vColour) colours.add(vColour);
            if (vSize) sizes.add(vSize);
            if (vColour && vImageUrl && !colourImages.has(vColour)) colourImages.set(vColour, vImageUrl);

            const vPrice = v.price || v.regular_price || null;
            variantRows.push({
              productId,
              wooVariationId: v.id,
              colour: vColour,
              size: vSize,
              sku: v.sku || null,
              price: vPrice ? String(parseFloat(vPrice)) : null,
              imageUrl: vImageUrl,
              stockQuantity: v.manage_stock ? (v.stock_quantity ?? 0) : 0,
            });
          }
        } else {
          for (const attr of wooProduct.attributes) {
            if (isColourAttr(attr.name)) attr.options.forEach((o) => colours.add(o));
            else if (isSizeAttr(attr.name)) attr.options.forEach((o) => sizes.add(o));
          }
        }

        // Always also scan product-level attributes for sizes — variable products that
        // vary only by colour won't have sizes in the variation attributes, but the
        // product itself may declare a Size attribute with all available options.
        for (const attr of (wooProduct.attributes ?? [])) {
          if (isSizeAttr(attr.name)) (attr.options ?? []).forEach((o: string) => sizes.add(o));
        }

        // Replace WooCommerce-managed variants; keep any manually created ones (no wooVariationId)
        await db.delete(productVariantsTable).where(
          and(
            eq(productVariantsTable.productId, productId),
            isNotNull(productVariantsTable.wooVariationId)
          )
        );
        if (variantRows.length > 0) {
          await db.insert(productVariantsTable).values(variantRows);
        }

        // Update product_attributes colour/size palette from synced data
        await db.delete(productAttributesTable).where(eq(productAttributesTable.productId, productId));
        const attrValues: { productId: number; type: string; value: string; imageUrl: string | null; sortOrder: number }[] = [];
        let i = 0;
        for (const c of colours) attrValues.push({ productId, type: "colour", value: c, imageUrl: colourImages.get(c) ?? null, sortOrder: i++ });
        for (const s of sizes) attrValues.push({ productId, type: "size", value: s, imageUrl: null, sortOrder: i++ });
        if (attrValues.length > 0) await db.insert(productAttributesTable).values(attrValues);

      } catch (err) {
        errors.push(`Product ${wooProduct.id} (${wooProduct.name}): ${err instanceof Error ? err.message : String(err)}`);
      }

      await reportProgress(index + 1, products.length);
    }

    // Apply price breaks derived from YITH bundle products (fetched separately — small set)
    const bundleProducts = await fetchBundleProducts(baseUrl, ck, cs);
    const bundlePriceBreaks = extractBundlePriceBreaks(bundleProducts);
    for (const [wooProductId, breaks] of bundlePriceBreaks) {
      try {
        await db.execute(sql`
          UPDATE products SET price_breaks = ${JSON.stringify(breaks)}::jsonb
          WHERE woo_commerce_id = ${wooProductId}
        `);
      } catch (err) {
        errors.push(`Price breaks for woo_id=${wooProductId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Save sync start time so next incremental sync can use it as its cutoff
    await db.insert(settingsTable)
      .values({ key: "woo_last_sync_at", value: syncStartedAt.toISOString() })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: syncStartedAt.toISOString(), updatedAt: new Date() } });

    const modeLabel = mode === "incremental" ? `Incremental — ${products.length} changed` : `Full — ${products.length} total`;
    await db.update(syncLogsTable).set({
      status: errors.length > 0 ? "completed_with_errors" : "completed",
      message: `${modeLabel} across ${allCategories.size} categories`,
      itemsCreated: String(created),
      itemsUpdated: String(updated),
      errors: errors.length > 0 ? errors.slice(0, 20).join("\n") : null,
      completedAt: new Date(),
    }).where(eq(syncLogsTable.id, log.id));

    return { created, updated, errors, mode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.update(syncLogsTable).set({ status: "failed", message: msg, completedAt: new Date() }).where(eq(syncLogsTable.id, log.id));
    throw err;
  }
}

export async function runWooSyncFull(): Promise<ReturnType<typeof runWooSync>> {
  return runWooSync({ full: true });
}
