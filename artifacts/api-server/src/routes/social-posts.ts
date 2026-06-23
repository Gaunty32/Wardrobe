import { Router, type IRouter } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

async function getFbSettings() {
  const rows = await db.execute(sql`SELECT key, value FROM settings WHERE key IN ('facebook_page_id','facebook_page_access_token')`);
  const map: Record<string, string> = {};
  for (const r of (rows.rows ?? rows) as any[]) map[r.key] = r.value;
  return map.facebook_page_id && map.facebook_page_access_token ? map : null;
}

async function publishToFacebook(pageId: string, token: string, message: string, link?: string | null): Promise<{ ok: boolean; postId?: string; error?: string }> {
  const body: any = { message, access_token: token };
  if (link) body.link = link;
  const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    return { ok: false, error: `Facebook returned ${res.status}: ${text}` };
  }
  const data: any = await res.json();
  return { ok: true, postId: data.id };
}

/** Returns a random Date between minMonths and maxMonths from now. */
function randomFutureDate(minMonths: number, maxMonths: number): Date {
  const minMs = minMonths * 30.44 * 24 * 60 * 60 * 1000;
  const maxMs = maxMonths * 30.44 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + minMs + Math.random() * (maxMs - minMs));
}

// ── List posts for a product ──────────────────────────────────────────────────
router.get("/products/:productId/social-posts", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }
  const rows = await db.execute(sql`
    SELECT id, product_id, facebook_content, google_content, hashtags,
           platforms, status, scheduled_at, published_at, auto_reschedule, error_message, created_at
    FROM social_posts WHERE product_id = ${pid}
    ORDER BY created_at DESC
  `);
  res.json((rows.rows ?? rows) as any[]);
});

// ── AI generate post content ──────────────────────────────────────────────────
router.post("/products/:productId/social-posts/generate", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  const [product] = (await db.execute(sql`
    SELECT p.name, p.sku, p.description, p.unit_price, p.category,
           p.guidance_best_for, p.guidance_not_ideal_for, p.guidance_staff_quotes,
           p.guidance_badges, p.guidance_tags, p.guidance_value_rating,
           p.guidance_durability_rating, p.guidance_smart_rating, p.image_url,
           s.name AS supplier_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = ${pid}
  `)).rows as any[];

  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const price = product.unit_price ? `£${parseFloat(product.unit_price).toFixed(2)}` : null;
  const bestFor = product.guidance_best_for || null;
  const notIdeal = product.guidance_not_ideal_for || null;
  const badges = Array.isArray(product.guidance_badges) ? product.guidance_badges : (typeof product.guidance_badges === "string" ? JSON.parse(product.guidance_badges || "[]") : []);
  const tags = Array.isArray(product.guidance_tags) ? product.guidance_tags : (typeof product.guidance_tags === "string" ? JSON.parse(product.guidance_tags || "[]") : []);
  const staffQuotes = Array.isArray(product.guidance_staff_quotes) ? product.guidance_staff_quotes : (typeof product.guidance_staff_quotes === "string" ? JSON.parse(product.guidance_staff_quotes || "[]") : []);

  const prompt = `You are a social media expert for Select Branding Solutions (SBS), a UK-based branded promotional garments and merchandise company. Create social media posts for this product.

PRODUCT DETAILS:
Name: ${product.name}
SKU: ${product.sku || "N/A"}
Category: ${product.category || "Branded merchandise"}
Price: ${price || "Contact us for pricing"}
Description: ${product.description || "A quality branded product"}
${bestFor ? `Best for: ${bestFor}` : ""}
${notIdeal ? `Not ideal for: ${notIdeal}` : ""}
${badges.length > 0 ? `Badges: ${badges.join(", ")}` : ""}
${tags.length > 0 ? `Tags: ${tags.join(", ")}` : ""}
${staffQuotes.length > 0 ? `Staff say: "${staffQuotes[0]}"` : ""}
Supplier: ${product.supplier_name || "Quality supplier"}

Generate TWO posts in JSON format:

1. FACEBOOK POST: Engaging, warm, conversational. Use 2-4 relevant emojis. Include a call to action. 150-300 words. Mention "Select Branding Solutions" or "SBS". Optimised for Facebook engagement.

2. GOOGLE BUSINESS POST: Professional, keyword-rich, great for local SEO. Mention branded merchandise, corporate gifts, customisation. 150-250 words. Clear call to action. Good for Google Business Profile visibility.

3. HASHTAGS: 8-12 relevant hashtags (no # symbol, comma separated) targeting: branded merchandise, corporate gifts, UK business, the product category, and SBS brand.

Respond ONLY with valid JSON in this exact format:
{
  "facebook": "...",
  "google": "...",
  "hashtags": "..."
}`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    res.status(500).json({ error: "AI returned invalid JSON", raw: text });
    return;
  }

  res.json({
    facebookContent: parsed.facebook || "",
    googleContent: parsed.google || "",
    hashtags: parsed.hashtags || "",
  });
});

// ── Create a social post ──────────────────────────────────────────────────────
router.post("/products/:productId/social-posts", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  const parsed = z.object({
    facebookContent: z.string().default(""),
    googleContent: z.string().default(""),
    hashtags: z.string().default(""),
    platforms: z.array(z.string()).default(["facebook", "google"]),
    autoReschedule: z.boolean().default(false),
    scheduledAt: z.string().datetime().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { facebookContent, googleContent, hashtags, platforms, autoReschedule, scheduledAt } = parsed.data;
  const status = scheduledAt ? "scheduled" : "draft";

  const result = await db.execute(sql`
    INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule)
    VALUES (${pid}, ${facebookContent}, ${googleContent}, ${hashtags}, ${sql.raw(`ARRAY[${platforms.map(p => `'${p.replace(/'/g, "")}'`).join(",")}]::text[]`)}, ${status}, ${scheduledAt ?? null}, ${autoReschedule})
    RETURNING *
  `);
  res.status(201).json((result.rows[0] ?? result) as any);
});

// ── Update a social post ──────────────────────────────────────────────────────
router.patch("/social-posts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    facebookContent: z.string().optional(),
    googleContent: z.string().optional(),
    hashtags: z.string().optional(),
    platforms: z.array(z.string()).optional(),
    autoReschedule: z.boolean().optional(),
    status: z.enum(["draft", "scheduled", "published", "failed"]).optional(),
    scheduledAt: z.string().datetime().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const d = parsed.data;
  const sets: string[] = ["updated_at = NOW()"];
  if (d.facebookContent !== undefined) sets.push(`facebook_content = '${d.facebookContent.replace(/'/g, "''")}'`);
  if (d.googleContent !== undefined) sets.push(`google_content = '${d.googleContent.replace(/'/g, "''")}'`);
  if (d.hashtags !== undefined) sets.push(`hashtags = '${d.hashtags.replace(/'/g, "''")}'`);
  if (d.platforms !== undefined) sets.push(`platforms = ARRAY[${d.platforms.map(p => `'${p.replace(/'/g, "")}'`).join(",")}]::text[]`);
  if (d.autoReschedule !== undefined) sets.push(`auto_reschedule = ${d.autoReschedule}`);
  if (d.status !== undefined) sets.push(`status = '${d.status}'`);
  if (d.scheduledAt !== undefined) sets.push(`scheduled_at = ${d.scheduledAt ? `'${d.scheduledAt}'` : "NULL"}`);

  await db.execute(sql.raw(`UPDATE social_posts SET ${sets.join(", ")} WHERE id = ${id}`));
  const rows = await db.execute(sql`SELECT * FROM social_posts WHERE id = ${id}`);
  res.json((rows.rows[0] ?? rows) as any);
});

// ── Delete a social post ──────────────────────────────────────────────────────
router.delete("/social-posts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM social_posts WHERE id = ${id}`);
  res.sendStatus(204);
});

// ── Publish a post immediately ────────────────────────────────────────────────
router.post("/social-posts/:id/publish", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.execute(sql`SELECT * FROM social_posts WHERE id = ${id}`);
  const post = (rows.rows[0] ?? rows) as any;
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  const fbSettings = await getFbSettings();
  const platforms: string[] = post.platforms ?? ["facebook"];

  const results: Record<string, any> = {};
  let anyFailed = false;
  let message = post.facebook_content;
  if (post.hashtags) message += `\n\n${post.hashtags.split(",").map((h: string) => `#${h.trim()}`).join(" ")}`;

  if (platforms.includes("facebook")) {
    if (!fbSettings) {
      results.facebook = { ok: false, error: "Facebook not configured — add Page ID and Access Token in Settings → Social" };
      anyFailed = true;
    } else {
      const fbResult = await publishToFacebook(fbSettings.facebook_page_id, fbSettings.facebook_page_access_token, message);
      results.facebook = fbResult;
      if (!fbResult.ok) anyFailed = true;
    }
  }

  if (platforms.includes("google")) {
    results.google = { ok: false, note: "Google Business Profile posts must be published manually — copy the Google post content from the Social Post tab." };
  }

  const newStatus = anyFailed ? "failed" : "published";
  const errMsg = anyFailed ? Object.values(results).filter((r: any) => !r.ok).map((r: any) => r.error || r.note).join("; ") : null;

  await db.execute(sql`
    UPDATE social_posts
    SET status = ${newStatus}, published_at = ${anyFailed ? null : new Date().toISOString()},
        error_message = ${errMsg}, updated_at = NOW()
    WHERE id = ${id}
  `);

  // If auto-reschedule, create a new draft post scheduled for ~6 months from now
  if (!anyFailed && post.auto_reschedule) {
    const nextDate = randomFutureDate(5.5, 6.5);
    await db.execute(sql`
      INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule)
      VALUES (${post.product_id}, ${post.facebook_content}, ${post.google_content}, ${post.hashtags}, ${sql.raw(`ARRAY[${platforms.map((p: string) => `'${p}'`).join(",")}]::text[]`)}, 'scheduled', ${nextDate.toISOString()}, true)
    `);
  }

  res.json({ ok: !anyFailed, results });
});

// ── Schedule a post for a random date ~6 months from now ─────────────────────
router.post("/social-posts/:id/schedule", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    scheduledAt: z.string().datetime().optional(),
    autoReschedule: z.boolean().default(true),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const scheduledAt = parsed.data.scheduledAt
    ? new Date(parsed.data.scheduledAt)
    : randomFutureDate(5.5, 6.5);

  await db.execute(sql`
    UPDATE social_posts
    SET status = 'scheduled', scheduled_at = ${scheduledAt.toISOString()},
        auto_reschedule = ${parsed.data.autoReschedule}, updated_at = NOW()
    WHERE id = ${id}
  `);
  res.json({ ok: true, scheduledAt: scheduledAt.toISOString() });
});

// ── Scheduler: check for due posts every 5 minutes ───────────────────────────
export function startSocialPostScheduler(): void {
  const checkDuePosts = async () => {
    try {
      const due = await db.execute(sql`
        SELECT * FROM social_posts
        WHERE status = 'scheduled' AND scheduled_at <= NOW()
        LIMIT 10
      `);
      const posts = (due.rows ?? due) as any[];
      for (const post of posts) {
        // Mark as publishing to prevent double-fire
        await db.execute(sql`UPDATE social_posts SET status = 'publishing', updated_at = NOW() WHERE id = ${post.id} AND status = 'scheduled'`);

        const fbSettings = await getFbSettings();
        const platforms: string[] = post.platforms ?? ["facebook"];
        let failed = false;
        let errMsg = "";

        if (platforms.includes("facebook") && fbSettings) {
          let message = post.facebook_content;
          if (post.hashtags) message += `\n\n${post.hashtags.split(",").map((h: string) => `#${h.trim()}`).join(" ")}`;
          const fbResult = await publishToFacebook(fbSettings.facebook_page_id, fbSettings.facebook_page_access_token, message);
          if (!fbResult.ok) { failed = true; errMsg = fbResult.error || "Facebook error"; }
        }

        const newStatus = failed ? "failed" : "published";
        await db.execute(sql`
          UPDATE social_posts
          SET status = ${newStatus}, published_at = ${failed ? null : new Date().toISOString()},
              error_message = ${failed ? errMsg : null}, updated_at = NOW()
          WHERE id = ${post.id}
        `);

        if (!failed && post.auto_reschedule) {
          const nextDate = randomFutureDate(5.5, 6.5);
          await db.execute(sql`
            INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule)
            VALUES (${post.product_id}, ${post.facebook_content}, ${post.google_content}, ${post.hashtags}, ${sql.raw(`ARRAY[${platforms.map((p: string) => `'${p}'`).join(",")}]::text[]`)}, 'scheduled', ${nextDate.toISOString()}, true)
          `);
        }
        console.log(`[social] Post ${post.id} → ${newStatus}`);
      }
    } catch (err) {
      console.error("[social] Scheduler error:", err);
    }
  };

  // Run on startup and then every 5 minutes
  checkDuePosts();
  setInterval(checkDuePosts, 5 * 60 * 1000);
}

export default router;
