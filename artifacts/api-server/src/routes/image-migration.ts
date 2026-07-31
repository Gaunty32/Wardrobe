/**
 * POST /image-migration/run
 *
 * One-shot route: accepts a multipart upload of the WordPress wp-content/uploads
 * zip, unpacks it, uploads every image to object storage under
 *   public/product-images/<filename>
 * then rewrites every matching image_url in:
 *   - products.image_url
 *   - products.gallery_images (jsonb array)
 *   - product_variants.image_url
 *   - product_categories.image_url
 * to the new public object-storage URL.
 *
 * Returns a summary { uploaded, updated, skipped, errors }.
 */
import { Router, Request, Response } from "express";
import multer from "multer";
import AdmZip from "adm-zip";
import path from "path";
import os from "os";
import fs from "fs";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";

const router = Router();
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
const storage = new ObjectStorageService();

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp", ".tiff", ".tif"]);
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".bmp": "image/bmp", ".tiff": "image/tiff", ".tif": "image/tiff",
};

// ── helpers ──────────────────────────────────────────────────────────────────

/** Derive the public serving URL for a stored object. */
function publicUrl(req: Request, objectPath: string): string {
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  // Strip bucket prefix — storage.ts serves GET /storage/public-objects/<rest>
  const rest = objectPath.replace(/^[^/]+\/public\//, "");
  return `${proto}://${host}/api/storage/public-objects/${rest}`;
}

/** Upload a Buffer to object storage and return the object path. */
async function uploadImage(buf: Buffer, filename: string): Promise<string> {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
  const ext = path.extname(filename).toLowerCase();
  const destName = `product-images/${filename}`;
  const objectPath = `${bucketId}/public/${destName}`;
  const { Storage } = await import("@google-cloud/storage");
  const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
  const gcs = new Storage({
    credentials: {
      audience: "replit",
      subject_token_type: "access_token",
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: "external_account",
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: { type: "json", subject_token_field_name: "access_token" },
      },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  const bucket = gcs.bucket(bucketId);
  const file = bucket.file(`public/${destName}`);
  await file.save(buf, { contentType: MIME[ext] ?? "image/jpeg", resumable: false });
  return objectPath;
}

// ── route ────────────────────────────────────────────────────────────────────

router.post(
  "/image-migration/run",
  upload.single("zip"),
  async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "No zip file uploaded (field name: zip)" });
      return;
    }

    const tmpZip = req.file.path;
    let zip: AdmZip;
    try {
      zip = new AdmZip(tmpZip);
    } catch (e: any) {
      fs.unlinkSync(tmpZip);
      res.status(400).json({ error: "Could not open zip: " + e.message });
      return;
    }

    const entries = zip.getEntries().filter((e) => {
      if (e.isDirectory) return false;
      const ext = path.extname(e.name).toLowerCase();
      return IMAGE_EXTS.has(ext);
    });

    console.log(`[image-migration] Zip contains ${entries.length} image files`);

    // Build a map: basename → object-storage URL
    const urlMap = new Map<string, string>(); // WP filename → new public URL
    let uploaded = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Stream and upload in batches of 10 to avoid overwhelming memory
    const BATCH = 10;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (entry) => {
          try {
            const filename = path.basename(entry.entryName);
            const buf = entry.getData();
            const objectPath = await uploadImage(buf, filename);
            urlMap.set(filename, objectPath);
            uploaded++;
            if (uploaded % 50 === 0) console.log(`[image-migration] Uploaded ${uploaded}/${entries.length}`);
          } catch (err: any) {
            errors.push(`${entry.name}: ${err.message}`);
          }
        })
      );
    }

    fs.unlinkSync(tmpZip);
    console.log(`[image-migration] Upload phase done: ${uploaded} uploaded, ${errors.length} errors`);

    // Build reverse map: WP URL basename → new public URL
    // Products store full URLs like https://www.selectuniforms.co.uk/wp-content/uploads/FILE.jpg
    // We match on basename so year/month subfolders don't matter.
    function resolveNewUrl(oldUrl: string | null): string | null {
      if (!oldUrl) return null;
      const basename = path.basename(oldUrl.split("?")[0]);
      const objectPath = urlMap.get(basename);
      if (!objectPath) return null;
      const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!;
      const rest = objectPath.replace(`${bucketId}/public/`, "");
      // Build URL from request context (forwarded headers)
      const proto = (req.headers["x-forwarded-proto"] as string) ?? "https";
      const host = (req.headers["x-forwarded-host"] as string) ?? (req.headers.host as string);
      return `${proto}://${host}/api/storage/public-objects/${rest}`;
    }

    let dbUpdated = 0;

    // ── products.image_url ───────────────────────────────────────────────────
    const products = await db.execute(sql`SELECT id, image_url FROM products WHERE image_url LIKE '%wp-content%'`);
    for (const row of products.rows as any[]) {
      const newUrl = resolveNewUrl(row.image_url);
      if (!newUrl) { skipped++; continue; }
      await db.execute(sql`UPDATE products SET image_url = ${newUrl} WHERE id = ${row.id}`);
      dbUpdated++;
    }

    // ── products.gallery_images ──────────────────────────────────────────────
    const galleries = await db.execute(sql`
      SELECT id, gallery_images FROM products
      WHERE gallery_images IS NOT NULL AND gallery_images::text LIKE '%wp-content%'
    `);
    for (const row of galleries.rows as any[]) {
      const arr: string[] = Array.isArray(row.gallery_images) ? row.gallery_images : JSON.parse(row.gallery_images);
      const updated = arr.map((u) => resolveNewUrl(u) ?? u);
      if (JSON.stringify(updated) !== JSON.stringify(arr)) {
        await db.execute(sql`UPDATE products SET gallery_images = ${JSON.stringify(updated)}::jsonb WHERE id = ${row.id}`);
        dbUpdated++;
      }
    }

    // ── product_variants.image_url ───────────────────────────────────────────
    const variants = await db.execute(sql`SELECT id, image_url FROM product_variants WHERE image_url LIKE '%wp-content%'`);
    for (const row of variants.rows as any[]) {
      const newUrl = resolveNewUrl(row.image_url);
      if (!newUrl) { skipped++; continue; }
      await db.execute(sql`UPDATE product_variants SET image_url = ${newUrl} WHERE id = ${row.id}`);
      dbUpdated++;
    }

    // ── product_categories.image_url ─────────────────────────────────────────
    const cats = await db.execute(sql`SELECT id, image_url FROM product_categories WHERE image_url LIKE '%wp-content%'`);
    for (const row of cats.rows as any[]) {
      const newUrl = resolveNewUrl(row.image_url);
      if (!newUrl) { skipped++; continue; }
      await db.execute(sql`UPDATE product_categories SET image_url = ${newUrl} WHERE id = ${row.id}`);
      dbUpdated++;
    }

    console.log(`[image-migration] DB update phase done: ${dbUpdated} rows updated`);

    res.json({
      uploaded,
      dbUpdated,
      skipped,
      errors: errors.slice(0, 20),
      totalErrors: errors.length,
      message: `Migration complete. ${uploaded} images uploaded to object storage, ${dbUpdated} database rows updated.`,
    });
  }
);

// ── POST /image-migration/download-from-wp ───────────────────────────────────
// Server-side: reads all WP image URLs from the DB, fetches each one,
// uploads to object storage, and rewrites DB rows.
// Safe to re-run — skips URLs that are already non-WP.
router.post("/image-migration/download-from-wp", async (req: Request, res: Response): Promise<void> => {
  const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
  if (!bucketId) { res.status(500).json({ error: "DEFAULT_OBJECT_STORAGE_BUCKET_ID not set" }); return; }

  // Optional: bypass DNS by fetching via the WP server's direct IP.
  // Useful after the domain has been pointed away from the old WP host.
  const wpDirectIp: string | undefined = req.body?.wpDirectIp?.trim() || undefined;

  // Collect all unique WP image URLs across products, variants, categories
  const [prodRows, varRows, catRows] = await Promise.all([
    db.execute(sql`SELECT id, image_url, gallery_images FROM products WHERE image_url LIKE '%wp-content%' OR (gallery_images::text LIKE '%wp-content%')`),
    db.execute(sql`SELECT id, image_url FROM product_variants WHERE image_url LIKE '%wp-content%'`),
    db.execute(sql`SELECT id, image_url FROM product_categories WHERE image_url LIKE '%wp-content%'`),
  ]);

  // Build set of unique URLs to fetch
  const urlSet = new Set<string>();
  for (const r of prodRows.rows as any[]) {
    if (r.image_url?.includes("wp-content")) urlSet.add(r.image_url);
    const gallery: string[] = Array.isArray(r.gallery_images) ? r.gallery_images : (r.gallery_images ? JSON.parse(r.gallery_images) : []);
    for (const u of gallery) if (u?.includes("wp-content")) urlSet.add(u);
  }
  for (const r of [...(varRows.rows as any[]), ...(catRows.rows as any[])]) {
    if (r.image_url?.includes("wp-content")) urlSet.add(r.image_url);
  }

  const urls = [...urlSet];
  console.log(`[image-migration] ${urls.length} unique WP URLs to download`);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  const { Storage } = await import("@google-cloud/storage");
  const SIDECAR = "http://127.0.0.1:1106";
  const gcs = new Storage({
    credentials: {
      audience: "replit", subject_token_type: "access_token",
      token_url: `${SIDECAR}/token`, type: "external_account",
      credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
      universe_domain: "googleapis.com",
    },
    projectId: "",
  });
  const bucket = gcs.bucket(bucketId);

  // url → new public-serving URL
  const urlMap = new Map<string, string>();
  let downloaded = 0, skipped = 0;
  const errors: string[] = [];

  const MIME_MAP: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".bmp": "image/bmp",
  };

  function newPublicUrl(filename: string): string {
    return `/api/storage/public-objects/product-images/${filename}`;
  }

  const BATCH = 8;
  for (let i = 0; i < urls.length; i += BATCH) {
    const batch = urls.slice(i, i + BATCH);
    await Promise.all(batch.map(async (wpUrl) => {
      try {
        const filename = path.basename(wpUrl.split("?")[0]);
        const ext = path.extname(filename).toLowerCase();
        // Skip if already uploaded (check object exists)
        const file = bucket.file(`public/product-images/${filename}`);
        const [exists] = await file.exists();
        if (exists) { urlMap.set(wpUrl, newPublicUrl(filename)); skipped++; return; }

        // Build the fetch URL — use direct IP + http:// to bypass DNS & cert issues
        let fetchUrl = wpUrl;
        const fetchHeaders: Record<string, string> = {};
        if (wpDirectIp) {
          try {
            const parsed = new URL(wpUrl);
            fetchHeaders["Host"] = parsed.hostname;   // tell WP which vhost we want
            parsed.protocol = "http:";                // avoid SSL cert mismatch on raw IP
            parsed.hostname = wpDirectIp;
            parsed.port = "80";
            fetchUrl = parsed.toString();
          } catch { /* keep original URL */ }
        }

        const res2 = await fetch(fetchUrl, { headers: fetchHeaders, signal: AbortSignal.timeout(15000) });
        if (!res2.ok) { errors.push(`${filename}: HTTP ${res2.status}`); return; }
        const ct = res2.headers.get("content-type") ?? "";
        if (!ct.startsWith("image/") && !ct.startsWith("application/octet-stream")) {
          errors.push(`${filename}: not an image (${ct})`); return;
        }
        const buf = Buffer.from(await res2.arrayBuffer());
        await file.save(buf, { contentType: MIME_MAP[ext] ?? "image/jpeg", resumable: false });
        urlMap.set(wpUrl, newPublicUrl(filename));
        downloaded++;
        if ((downloaded + skipped) % 50 === 0) {
          console.log(`[image-migration] ${downloaded} downloaded, ${skipped} cached, ${errors.length} errors (${i + batch.length}/${urls.length})`);
        }
      } catch (err: any) {
        errors.push(`${wpUrl.split("/").pop()}: ${err.message}`);
      }
    }));
  }

  console.log(`[image-migration] Download done: ${downloaded} new, ${skipped} cached, ${errors.length} errors`);

  // Rewrite DB URLs
  let dbUpdated = 0;

  function resolveUrl(old: string | null): string | null {
    if (!old) return null;
    return urlMap.get(old) ?? null;
  }

  for (const r of prodRows.rows as any[]) {
    const newPrimary = resolveUrl(r.image_url);
    const gallery: string[] = Array.isArray(r.gallery_images) ? r.gallery_images : (r.gallery_images ? JSON.parse(r.gallery_images) : []);
    const newGallery = gallery.map((u) => resolveUrl(u) ?? u);
    const galleryChanged = JSON.stringify(newGallery) !== JSON.stringify(gallery);
    if (newPrimary) {
      await db.execute(sql`UPDATE products SET image_url = ${newPrimary} WHERE id = ${r.id}`);
      dbUpdated++;
    }
    if (galleryChanged) {
      await db.execute(sql`UPDATE products SET gallery_images = ${JSON.stringify(newGallery)}::jsonb WHERE id = ${r.id}`);
      if (!newPrimary) dbUpdated++;
    }
  }
  for (const r of varRows.rows as any[]) {
    const n = resolveUrl(r.image_url); if (!n) continue;
    await db.execute(sql`UPDATE product_variants SET image_url = ${n} WHERE id = ${r.id}`);
    dbUpdated++;
  }
  for (const r of catRows.rows as any[]) {
    const n = resolveUrl(r.image_url); if (!n) continue;
    await db.execute(sql`UPDATE product_categories SET image_url = ${n} WHERE id = ${r.id}`);
    dbUpdated++;
  }

  console.log(`[image-migration] DB updated: ${dbUpdated} rows`);
  res.end(JSON.stringify({
    totalUrls: urls.length, downloaded, skipped, dbUpdated,
    errors: errors.slice(0, 30), totalErrors: errors.length,
    message: `Done. ${downloaded} images downloaded, ${skipped} already cached, ${dbUpdated} DB rows updated.`,
  }));
});

export default router;
