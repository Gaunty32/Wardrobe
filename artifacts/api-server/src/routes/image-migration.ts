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

export default router;
