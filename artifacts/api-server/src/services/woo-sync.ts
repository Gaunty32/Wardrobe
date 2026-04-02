import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { db, productsTable, productAttributesTable, productVariantsTable, settingsTable, syncLogsTable } from "@workspace/db";

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
}

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
  images: { id: number; src: string; alt: string; position: number }[];
  attributes: { id: number; name: string; options: string[]; variation: boolean }[];
  variations: number[];
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
  return /^size$|^pa_size$/i.test(name);
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
    // Fetch products — incremental uses modified_after to get only changed products
    const products = await fetchAllProducts(baseUrl, ck, cs, since);

    // Mark 5% once we know how many products to process
    await db.update(syncLogsTable).set({ progressPct: 5 }).where(eq(syncLogsTable.id, log.id));

    for (const [index, wooProduct] of products.entries()) {
      try {
        const wooId = wooProduct.id;
        const category = pickBestCategory(wooProduct.categories ?? [], allCategories);
        const priceStr = wooProduct.regular_price || wooProduct.price || "0";
        const price = parseFloat(priceStr) || 0;
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

        if (existing.length > 0) {
          productId = existing[0].id;
          await db.update(productsTable).set({
            name: wooProduct.name,
            sku: wooProduct.sku || null,
            category,
            imageUrl,
            description: stripHtml(wooProduct.short_description || wooProduct.description),
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
            imageUrl,
            description: stripHtml(wooProduct.short_description || wooProduct.description),
            unitPrice: String(price),
            stockQuantity: stockQty,
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
