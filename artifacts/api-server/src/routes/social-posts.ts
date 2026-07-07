import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import {
  generateGbpAuthUrl, handleGbpCallback, getGbpAccessToken,
  getGbpStatus, listGbpLocations, publishGbpPost, disconnectGbp,
  autoGbpRedirectUri,
} from "../services/google-business.js";
import { db as _db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendEmail } from "../services/email.js";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

async function notifySocialPostFailure(postId: number, productName: string, platform: string, error: string): Promise<void> {
  try {
    const toEmail = await getSetting("smtp_user");
    if (!toEmail) return;
    const subject = `⚠️ Social post failed — ${productName} (${platform})`;
    const html = `
      <div style="font-family:sans-serif;max-width:520px">
        <h2 style="color:#dc2626">Social post failed</h2>
        <p><strong>Product:</strong> ${productName}</p>
        <p><strong>Platform:</strong> ${platform}</p>
        <p><strong>Post ID:</strong> ${postId}</p>
        <p><strong>Error:</strong></p>
        <pre style="background:#f3f4f6;padding:12px;border-radius:6px;font-size:12px;white-space:pre-wrap">${error}</pre>
        <p style="margin-top:16px">
          <a href="https://ordersystem.replit.app/social-posts" style="color:#7c3aed">View social posts →</a>
        </p>
        <p style="color:#6b7280;font-size:12px">The post has been marked as failed. You can retry it from the social posts page.</p>
      </div>`;
    const text = `Social post failed\n\nProduct: ${productName}\nPlatform: ${platform}\nPost ID: ${postId}\nError: ${error}\n\nView social posts: https://ordersystem.replit.app/social-posts`;
    await sendEmail({ to: toEmail, subject, html, text });
  } catch (err) {
    console.warn("[social] Failed to send failure notification:", err);
  }
}

async function getFbSettings() {
  const rows = await db.execute(sql`SELECT key, value FROM settings WHERE key IN ('facebook_page_id','facebook_page_access_token')`);
  const map: Record<string, string> = {};
  for (const r of (rows.rows ?? rows) as any[]) map[r.key] = r.value;
  return map.facebook_page_id && map.facebook_page_access_token ? map : null;
}

// ── Facebook token checker — returns pages the token can manage ────────────
router.post("/facebook/check-token", async (req, res): Promise<void> => {
  const parsed = z.object({ accessToken: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "accessToken required" }); return; }
  const { accessToken } = parsed.data;
  try {
    const url = `https://graph.facebook.com/v20.0/me/accounts?fields=id,name,category,access_token&access_token=${encodeURIComponent(accessToken)}`;
    const fbRes = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const fbData: any = await fbRes.json();
    if (!fbRes.ok || fbData.error) {
      const msg = fbData.error?.message ?? `Facebook error ${fbRes.status}`;
      const isExpired = msg.includes("Session has expired") || msg.includes("Error validating access token") || msg.includes("OAuthException") || (fbData.error?.code === 190);
      res.status(400).json({ error: msg, isExpired, isUserToken: false });
      return;
    }
    const pages: { id: string; name: string; category: string; pageToken: string }[] = (fbData.data ?? []).map((p: any) => {
      console.log(`[check-token] page ${p.id} (${p.name}): access_token present=${!!p.access_token}, len=${p.access_token?.length ?? 0}`);
      return { id: p.id, name: p.name, category: p.category ?? "", pageToken: p.access_token ?? "" };
    });
    if (pages.length === 0) {
      // Token is valid but it's a User token with no managed pages, or a Page token
      // Try fetching /me to confirm it's a page token
      const meRes = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,category&access_token=${encodeURIComponent(accessToken)}`, { signal: AbortSignal.timeout(8_000) });
      const meData: any = await meRes.json();
      if (meData.category) {
        // /me returned a page — this IS a page token
        res.json({ isPageToken: true, pages: [{ id: meData.id, name: meData.name, category: meData.category, pageToken: accessToken }] });
      } else {
        res.json({ isPageToken: false, pages: [], noPages: true });
      }
      return;
    }
    res.json({ isPageToken: false, pages });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
});

/** Try to exchange a user/system-user token for a proper page access token. */
async function getFreshPageToken(pageId: string, token: string): Promise<string> {
  try {
    const url = `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return token;
    const data: any = await res.json();
    if (data.access_token && typeof data.access_token === "string") {
      console.log(`[fb] exchanged token for page ${pageId}: fresh len=${data.access_token.length}`);
      return data.access_token;
    }
  } catch { /* fall through */ }
  return token;
}

/** Post with image via /{page}/photos (shows image prominently). Falls back to /feed if no image.
 *  websiteUrl is appended to the caption/message so Facebook renders it as a clickable link. */
async function publishToFacebook(
  pageId: string, token: string, message: string, imageUrl?: string | null, websiteUrl?: string | null
): Promise<{ ok: boolean; postId?: string; error?: string }> {
  // Always get a fresh page access token in case the stored one is a user/system-user token
  const pageToken = await getFreshPageToken(pageId, token);
  console.log(`[fb] publishing to page ${pageId}, stored len=${token.length}, using len=${pageToken.length}`);

  // Append website URL to the message text so Facebook renders it as a tappable link
  const fullMessage = websiteUrl ? `${message}\n\n${websiteUrl}` : message;

  if (imageUrl) {
    // Use photos endpoint — creates a photo post with caption (including the URL)
    const body = new URLSearchParams({ url: imageUrl, caption: fullMessage, access_token: pageToken });
    const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/photos`, {
      method: "POST",
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.status.toString());
      return { ok: false, error: `Facebook photo post error ${res.status}: ${text}` };
    }
    const data: any = await res.json();
    // photos endpoint returns { id, post_id } — post_id is the feed post for insights
    return { ok: true, postId: data.post_id ?? data.id };
  }

  // Plain text / link post via /feed
  const feedBody = new URLSearchParams({ message: fullMessage, access_token: pageToken });
  const res = await fetch(`https://graph.facebook.com/v20.0/${pageId}/feed`, {
    method: "POST",
    body: feedBody,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.status.toString());
    return { ok: false, error: `Facebook feed error ${res.status}: ${text}` };
  }
  const data: any = await res.json();
  return { ok: true, postId: data.id };
}

/** Fetch engagement stats for a Facebook post. */
async function fetchFbInsights(postId: string, token: string): Promise<{
  reactions: number; comments: number; shares: number; lastComments: any[];
} | null> {
  const fields = "reactions.summary(true),comments.summary(true){message,from,created_time},shares";
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${postId}?fields=${fields}&access_token=${encodeURIComponent(token)}`
  );
  if (!res.ok) return null;
  const d: any = await res.json();
  return {
    reactions: d.reactions?.summary?.total_count ?? 0,
    comments: d.comments?.summary?.total_count ?? 0,
    shares: d.shares?.count ?? 0,
    lastComments: (d.comments?.data ?? []).slice(0, 5).map((c: any) => ({
      message: c.message,
      from: c.from?.name ?? "Unknown",
      time: c.created_time,
    })),
  };
}

/** Check if a candidate date (its day window) conflicts with existing scheduled posts.
 *  Rules:
 *   - No post on the same calendar day
 *   - No post on the immediately preceding or following calendar day (no consecutive days)
 *   - No post with the same product category as the nearest scheduled post before or after
 */
async function isDateConflict(dayStart: Date, dayEnd: Date, productCategory: string | null): Promise<boolean> {
  // Check ±1 day window for any post (covers same-day AND consecutive-day rules)
  const windowStart = new Date(dayStart.getTime() - 86_400_000);
  const windowEnd   = new Date(dayEnd.getTime()   + 86_400_000);
  const nearbyRes = await db.execute(sql`
    SELECT sp.id FROM social_posts sp
    WHERE sp.status IN ('scheduled', 'publishing')
      AND sp.scheduled_at BETWEEN ${windowStart.toISOString()} AND ${windowEnd.toISOString()}
    LIMIT 1
  `);
  if ((nearbyRes.rows ?? nearbyRes as any[]).length > 0) return true;  // consecutive or same day

  // Category check: nearest post before this day
  if (productCategory) {
    const beforeRes = await db.execute(sql`
      SELECT p.category FROM social_posts sp
      LEFT JOIN products p ON p.id = sp.product_id
      WHERE sp.status IN ('scheduled', 'publishing')
        AND sp.scheduled_at < ${dayStart.toISOString()}
      ORDER BY sp.scheduled_at DESC LIMIT 1
    `);
    const before = ((beforeRes.rows ?? beforeRes) as any[])[0];
    if (before?.category && before.category === productCategory) return true;

    const afterRes = await db.execute(sql`
      SELECT p.category FROM social_posts sp
      LEFT JOIN products p ON p.id = sp.product_id
      WHERE sp.status IN ('scheduled', 'publishing')
        AND sp.scheduled_at > ${dayEnd.toISOString()}
      ORDER BY sp.scheduled_at ASC LIMIT 1
    `);
    const after = ((afterRes.rows ?? afterRes) as any[])[0];
    if (after?.category && after.category === productCategory) return true;
  }

  return false;
}

/** Pick a random date within [startOffsetDays, startOffsetDays + withinDays) that satisfies:
 *  no same/consecutive days, no same category as nearest neighbours.
 *  Falls back to same-day-only guard if constraints can't be satisfied in 60 attempts. */
async function pickAvailableDate(withinDays: number, productId?: number, startOffsetDays = 0): Promise<Date> {
  let productCategory: string | null = null;
  if (productId) {
    const [prod] = (await db.execute(sql`SELECT category FROM products WHERE id = ${productId}`)).rows as any[];
    productCategory = prod?.category ?? null;
  }

  const origin = Date.now() + startOffsetDays * 86_400_000;

  // Phase 1: apply all constraints (60 attempts)
  for (let attempt = 0; attempt < 60; attempt++) {
    const daysAhead = 1 + Math.random() * Math.max(withinDays - 2, 1);
    const candidate = new Date(origin + daysAhead * 86_400_000);
    const dayStart  = new Date(candidate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd    = new Date(candidate); dayEnd.setHours(23, 59, 59, 999);
    if (!(await isDateConflict(dayStart, dayEnd, productCategory))) return candidate;
  }

  // Phase 2: relax category constraint — just no same/consecutive day
  for (let attempt = 0; attempt < 30; attempt++) {
    const daysAhead = 1 + Math.random() * Math.max(withinDays - 2, 1);
    const candidate = new Date(origin + daysAhead * 86_400_000);
    const dayStart  = new Date(candidate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd    = new Date(candidate); dayEnd.setHours(23, 59, 59, 999);
    if (!(await isDateConflict(dayStart, dayEnd, null))) return candidate;
  }

  // Phase 3: last resort — just avoid same day
  for (let attempt = 0; attempt < 30; attempt++) {
    const daysAhead = 1 + Math.random() * withinDays;
    const candidate = new Date(origin + daysAhead * 86_400_000);
    const dayStart  = new Date(candidate); dayStart.setHours(0, 0, 0, 0);
    const dayEnd    = new Date(candidate); dayEnd.setHours(23, 59, 59, 999);
    const existing  = await db.execute(sql`
      SELECT id FROM social_posts
      WHERE status IN ('scheduled', 'publishing')
        AND scheduled_at BETWEEN ${dayStart.toISOString()} AND ${dayEnd.toISOString()}
      LIMIT 1
    `);
    if (!(existing.rows ?? existing as any[]).length) return candidate;
  }

  return new Date(origin + (withinDays + 2) * 86_400_000);
}

/** Pick a smart reschedule date ~4 months (±3 weeks) from now applying the same scheduling rules. */
async function pickRescheduleDate(productId?: number): Promise<Date> {
  const targetDays = Math.round(3.5 * 30.44 + Math.random() * (30.44));  // 3.5–4.5 months in days
  // Search in a ±21-day window centred on the target, starting 3 weeks before it
  return pickAvailableDate(42, productId, targetDays - 21);
}

// ── Google Business Profile OAuth routes ──────────────────────────────────────

router.get("/gbp/status", async (_req, res): Promise<void> => {
  res.json(await getGbpStatus());
});

router.post("/gbp/credentials", async (req, res): Promise<void> => {
  const parsed = z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setSetting("gbp_client_id", parsed.data.clientId);
  await setSetting("gbp_client_secret", parsed.data.clientSecret);
  res.json({ ok: true });
});

router.get("/gbp/redirect-uri", (req, res): void => {
  res.json({ redirectUri: autoGbpRedirectUri(req) });
});

router.get("/gbp/connect", async (req, res): Promise<void> => {
  try {
    const redirectUri = autoGbpRedirectUri(req);
    const url = await generateGbpAuthUrl(redirectUri);
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`<h2>Google Connect Error</h2><p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
  }
});

router.get("/gbp/callback", async (req, res): Promise<void> => {
  const { code, error } = req.query as Record<string, string>;
  if (error) { res.redirect(`/settings?gbp=error&msg=${encodeURIComponent(error)}`); return; }
  if (!code) { res.redirect("/settings?gbp=error&msg=Missing+code"); return; }
  try {
    const redirectUri = autoGbpRedirectUri(req);
    await handleGbpCallback(code, redirectUri);
    res.redirect("/settings?gbp=connected");
  } catch (err) {
    res.redirect(`/settings?gbp=error&msg=${encodeURIComponent(err instanceof Error ? err.message : "Unknown error")}`);
  }
});

router.get("/gbp/locations", async (_req, res): Promise<void> => {
  try {
    const token = await getGbpAccessToken();
    if (!token) { res.status(401).json({ error: "Not connected to Google Business Profile" }); return; }
    res.json(await listGbpLocations(token));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GBP] /gbp/locations error:", msg);
    res.status(500).json({ error: msg });
  }
});

router.post("/gbp/location", async (req, res): Promise<void> => {
  const parsed = z.object({ name: z.string().min(1), title: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setSetting("gbp_location_name", parsed.data.name);
  await setSetting("gbp_location_title", parsed.data.title);
  res.json({ ok: true });
});

router.post("/gbp/disconnect", async (_req, res): Promise<void> => {
  await disconnectGbp();
  res.json({ ok: true });
});

// ── Send a test post to verify connections ────────────────────────────────────

router.post("/social-posts/test", async (req, res): Promise<void> => {
  const fbSettings = await getFbSettings();
  const gbpStatus = await getGbpStatus();

  const testMessage = `🧪 Test post from Select Branding Solutions — ${new Date().toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}. If you can see this, the connection is working!`;

  const results: Record<string, any> = {};

  // Facebook
  if (!fbSettings) {
    results.facebook = { ok: false, skipped: true, error: "Not configured — add Page ID and Access Token in Settings" };
  } else {
    console.log("[test-post] FB pageId:", fbSettings.facebook_page_id, "token len:", fbSettings.facebook_page_access_token?.length);
    results.facebook = await publishToFacebook(fbSettings.facebook_page_id, fbSettings.facebook_page_access_token, testMessage, null);
    console.log("[test-post] FB result:", JSON.stringify(results.facebook));
  }

  // Google Business Profile
  const token = await getGbpAccessToken();
  if (!token) {
    results.google = { ok: false, skipped: true, error: "Not connected — connect Google Business Profile in Settings → Social Media" };
  } else if (!gbpStatus.locationName) {
    results.google = { ok: false, skipped: true, error: "Connected but no business location selected — open Settings → Social Media and choose a location from the dropdown, then click Save Location" };
  } else {
    results.google = await publishGbpPost(gbpStatus.locationName, token, testMessage, null);
  }

  res.json(results);
});

// ── List posts for a product ──────────────────────────────────────────────────

router.get("/products/:productId/social-posts", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }
  const rows = await db.execute(sql`
    SELECT id, product_id, facebook_content, google_content, hashtags, platforms,
           status, scheduled_at, published_at, auto_reschedule, error_message,
           fb_post_id, gbp_post_name, product_image_url,
           fb_reactions, fb_comments, fb_shares, fb_stats_at, last_comments, new_activity,
           created_at
    FROM social_posts WHERE product_id = ${pid}
    ORDER BY created_at DESC
  `);
  res.json((rows.rows ?? rows) as any[]);
});

// ── Product image data for social post composer ───────────────────────────────

router.get("/products/:productId/social-images", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  const [prod] = (await db.execute(sql`SELECT image_url, permalink FROM products WHERE id = ${pid}`)).rows as any[];
  const variantRows = (await db.execute(sql`
    SELECT DISTINCT ON (colour) colour, image_url
    FROM product_variants
    WHERE product_id = ${pid} AND image_url IS NOT NULL AND image_url != ''
    ORDER BY colour, id
  `)).rows as any[];

  res.json({
    productImageUrl: prod?.image_url ?? null,
    websiteUrl: prod?.permalink ?? null,
    variantImages: variantRows.map((r: any) => ({ colour: r.colour, imageUrl: r.image_url })),
  });
});

// ── AI generate post content ──────────────────────────────────────────────────

router.post("/products/:productId/social-posts/generate", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  const [product] = (await db.execute(sql`
    SELECT p.name, p.sku, p.description, p.unit_price, p.category, p.image_url, p.permalink,
           p.guidance_best_for, p.guidance_not_ideal_for, p.guidance_staff_quotes,
           p.guidance_badges, p.guidance_tags, p.guidance_value_rating,
           p.guidance_durability_rating, p.guidance_smart_rating,
           s.name AS supplier_name
    FROM products p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.id = ${pid}
  `)).rows as any[];

  // Fetch variant colour images for image picker
  const variantImgRows = (await db.execute(sql`
    SELECT DISTINCT ON (colour) colour, image_url
    FROM product_variants
    WHERE product_id = ${pid} AND image_url IS NOT NULL AND image_url != ''
    ORDER BY colour, id
  `)).rows as any[];

  if (!product) { res.status(404).json({ error: "Product not found" }); return; }

  const bestFor = product.guidance_best_for || null;
  const notIdeal = product.guidance_not_ideal_for || null;
  const badges = Array.isArray(product.guidance_badges) ? product.guidance_badges : (typeof product.guidance_badges === "string" ? JSON.parse(product.guidance_badges || "[]") : []);
  const tags = Array.isArray(product.guidance_tags) ? product.guidance_tags : (typeof product.guidance_tags === "string" ? JSON.parse(product.guidance_tags || "[]") : []);
  const staffQuotes = Array.isArray(product.guidance_staff_quotes) ? product.guidance_staff_quotes : (typeof product.guidance_staff_quotes === "string" ? JSON.parse(product.guidance_staff_quotes || "[]") : []);

  const prompt = `You are a content strategist for Select Branding Solutions (SBS), a UK-based branded promotional garments and merchandise company. Your goal is to build a helpful knowledgebase — posts that genuinely answer the questions people search for on Google, Facebook, and ChatGPT.

GUIDING PRINCIPLES:
- Be educational and genuinely helpful. Answer real questions people ask.
- Never mention price, never sell, never push people to buy.
- Write like an expert sharing knowledge, not a brand promoting itself.
- Think: "What would someone type into Google or ChatGPT about this product type?"
- Examples of the RIGHT angle: "What to look for when choosing branded workwear", "How long does embroidery last on polo shirts", "What's the difference between screen print and embroidery for logos"
- The content should be so useful that people save it, share it, or come back to it.

PRODUCT DETAILS:
Name: ${product.name}
SKU: ${product.sku || "N/A"}
Category: ${product.category || "Branded merchandise"}
Description: ${product.description || "A quality branded product"}
${bestFor ? `Best for: ${bestFor}` : ""}
${notIdeal ? `Not ideal for: ${notIdeal}` : ""}
${badges.length > 0 ? `Badges: ${badges.join(", ")}` : ""}
${tags.length > 0 ? `Tags: ${tags.join(", ")}` : ""}
${staffQuotes.length > 0 ? `Staff knowledge: "${staffQuotes[0]}"` : ""}

Generate TWO posts in JSON format:

1. FACEBOOK POST: Conversational and genuinely helpful. Pick ONE specific question someone would ask about this product category and answer it thoroughly. Use 2-3 emojis naturally (not forced). 150-250 words. End with exactly this call to action on its own line: "Want to know more? Send us a WhatsApp 0113 2552694 or leave a comment." Do NOT mention price or encourage purchasing.

2. GOOGLE BUSINESS POST: Educational and keyword-rich for local SEO and AI search. Answer a practical question about this type of product — suitable for someone researching their options. 150-200 words. Rich in the kind of language people use when searching. Do NOT mention price or encourage purchasing.

3. HASHTAGS: 8-12 relevant hashtags (no # symbol, comma separated) focused on: the product topic, the industry, helpful/educational content themes, UK business context, and branded merchandise knowledge.

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
  const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch {
    res.status(500).json({ error: "AI returned invalid JSON", raw: text }); return;
  }

  res.json({
    facebookContent: parsed.facebook || "",
    googleContent: parsed.google || "",
    hashtags: parsed.hashtags || "",
    productImageUrl: product.image_url || null,
    websiteUrl: product.permalink || null,
    variantImages: variantImgRows.map((r: any) => ({ colour: r.colour, imageUrl: r.image_url })),
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
    autoReschedule: z.boolean().default(true),
    scheduledAt: z.string().datetime().optional().nullable(),
    productImageUrl: z.string().url().optional().nullable(),
    websiteUrl: z.string().url().optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { facebookContent, googleContent, hashtags, platforms, autoReschedule, scheduledAt, productImageUrl, websiteUrl } = parsed.data;

  // If no image provided, fetch from product
  let imageUrl = productImageUrl;
  let siteUrl = websiteUrl;
  if (!imageUrl || !siteUrl) {
    const [prod] = (await db.execute(sql`SELECT image_url, permalink FROM products WHERE id = ${pid}`)).rows as any[];
    if (!imageUrl) imageUrl = prod?.image_url ?? null;
    if (!siteUrl) siteUrl = prod?.permalink ?? null;
  }

  const status = scheduledAt ? "scheduled" : "draft";
  const platformsSql = sql.raw(`ARRAY[${platforms.map(p => `'${p.replace(/'/g, "")}'`).join(",")}]::text[]`);

  const result = await db.execute(sql`
    INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule, product_image_url, website_url)
    VALUES (${pid}, ${facebookContent}, ${googleContent}, ${hashtags}, ${platformsSql}, ${status}, ${scheduledAt ?? null}, ${autoReschedule}, ${imageUrl ?? null}, ${siteUrl ?? null})
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
    newActivity: z.boolean().optional(),
    productImageUrl: z.string().url().optional().nullable(),
    websiteUrl: z.string().url().optional().nullable(),
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
  if (d.newActivity !== undefined) sets.push(`new_activity = ${d.newActivity}`);
  if (d.productImageUrl !== undefined) sets.push(`product_image_url = ${d.productImageUrl ? `'${d.productImageUrl.replace(/'/g, "''")}'` : "NULL"}`);
  if (d.websiteUrl !== undefined) sets.push(`website_url = ${d.websiteUrl ? `'${d.websiteUrl.replace(/'/g, "''")}'` : "NULL"}`);

  await db.execute(sql.raw(`UPDATE social_posts SET ${sets.join(", ")} WHERE id = ${id}`));
  const rows = await db.execute(sql`SELECT * FROM social_posts WHERE id = ${id}`);
  res.json((rows.rows[0] ?? rows) as any);
});

// ── Delete ────────────────────────────────────────────────────────────────────

router.delete("/social-posts/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM social_posts WHERE id = ${id}`);
  res.sendStatus(204);
});

// ── Get live engagement stats from Facebook ───────────────────────────────────

router.get("/social-posts/:id/insights", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const rows = await db.execute(sql`SELECT fb_post_id FROM social_posts WHERE id = ${id}`);
  const post = (rows.rows[0] ?? rows) as any;
  if (!post?.fb_post_id) { res.status(404).json({ error: "No Facebook post ID stored" }); return; }

  const fb = await getFbSettings();
  if (!fb) { res.status(400).json({ error: "Facebook not configured" }); return; }

  const stats = await fetchFbInsights(post.fb_post_id, fb.facebook_page_access_token);
  if (!stats) { res.status(502).json({ error: "Could not fetch stats from Facebook" }); return; }

  // Store updated stats
  await db.execute(sql.raw(`
    UPDATE social_posts SET
      fb_reactions = ${stats.reactions},
      fb_comments = ${stats.comments},
      fb_shares = ${stats.shares},
      fb_stats_at = NOW(),
      last_comments = '${JSON.stringify(stats.lastComments).replace(/'/g, "''")}',
      new_activity = (${stats.comments} > COALESCE(fb_comments, 0)),
      updated_at = NOW()
    WHERE id = ${id}
  `));
  res.json(stats);
});

// ── Publish a post immediately ────────────────────────────────────────────────

router.post("/social-posts/:id/publish", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const rows = await db.execute(sql`SELECT * FROM social_posts WHERE id = ${id}`);
  const post = (rows.rows[0] ?? rows) as any;
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  const fbSettings = await getFbSettings();
  const gbpStatus = await getGbpStatus();
  const platforms: string[] = post.platforms ?? ["facebook", "google"];
  const imageUrl: string | null = post.product_image_url ?? null;
  const websiteUrl: string | null = post.website_url ?? null;

  const results: Record<string, any> = {};
  let anyFailed = false;
  let fbPostId: string | null = null;
  let gbpPostName: string | null = null;

  let message = post.facebook_content;
  if (post.hashtags) message += `\n\n${post.hashtags.split(",").map((h: string) => `#${h.trim()}`).join(" ")}`;

  // ── Facebook
  if (platforms.includes("facebook")) {
    if (!fbSettings) {
      results.facebook = { ok: false, error: "Facebook not configured — add Page ID and Access Token in Settings → Social Media" };
      anyFailed = true;
    } else {
      const fbResult = await publishToFacebook(fbSettings.facebook_page_id, fbSettings.facebook_page_access_token, message, imageUrl, websiteUrl);
      results.facebook = fbResult;
      if (fbResult.ok) fbPostId = fbResult.postId ?? null;
      else anyFailed = true;
    }
  }

  // ── Google Business Profile
  if (platforms.includes("google")) {
    const token = await getGbpAccessToken();
    const locationName = gbpStatus.locationName;
    if (!token || !locationName) {
      results.google = { ok: false, note: "Google Business Profile not connected — configure it in Settings → Social Media. Copy the Google post content manually for now." };
    } else {
      const googleMessage = post.google_content || message;
      const gbpResult = await publishGbpPost(locationName, token, googleMessage, imageUrl);
      results.google = gbpResult;
      if (gbpResult.ok) gbpPostName = gbpResult.postName ?? null;
      else { results.google.note = "GBP post failed — you can still copy the content manually"; }
    }
  }

  const newStatus = anyFailed ? "failed" : "published";
  const errMsg = anyFailed ? Object.values(results).filter((r: any) => !r.ok && r.error).map((r: any) => r.error).join("; ") : null;

  const updateParts = [
    `status = '${newStatus}'`,
    `published_at = ${anyFailed ? "NULL" : `'${new Date().toISOString()}'`}`,
    `error_message = ${errMsg ? `'${errMsg.replace(/'/g, "''")}'` : "NULL"}`,
    `fb_post_id = ${fbPostId ? `'${fbPostId}'` : "NULL"}`,
    `gbp_post_name = ${gbpPostName ? `'${gbpPostName}'` : "NULL"}`,
    "new_activity = FALSE",
    "updated_at = NOW()",
  ];
  await db.execute(sql.raw(`UPDATE social_posts SET ${updateParts.join(", ")} WHERE id = ${id}`));

  // Auto-reschedule ~6 months from now with smart date picking
  if (!anyFailed && post.auto_reschedule) {
    const nextDate = await pickRescheduleDate(post.product_id);
    const pArr = platforms.map((p: string) => `'${p}'`).join(",");
    await db.execute(sql.raw(`
      INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule, product_image_url, website_url)
      VALUES (${post.product_id}, '${post.facebook_content.replace(/'/g, "''")}', '${post.google_content.replace(/'/g, "''")}', '${post.hashtags.replace(/'/g, "''")}', ARRAY[${pArr}]::text[], 'scheduled', '${nextDate.toISOString()}', true, ${post.product_image_url ? `'${post.product_image_url}'` : "NULL"}, ${post.website_url ? `'${post.website_url.replace(/'/g, "''")}'` : "NULL"})
    `));
  }

  res.json({ ok: !anyFailed, results });
});

// ── Schedule a post (random within 30 days) ───────────────────────────────────

router.post("/social-posts/:id/schedule", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = z.object({
    scheduledAt: z.string().datetime().optional(),
    autoReschedule: z.boolean().default(true),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Fetch post so we know product_id for category-aware scheduling
  const postRows = await db.execute(sql`SELECT product_id FROM social_posts WHERE id = ${id}`);
  const productId: number | undefined = ((postRows.rows ?? postRows) as any[])[0]?.product_id;

  const scheduledAt = parsed.data.scheduledAt
    ? new Date(parsed.data.scheduledAt)
    : await pickAvailableDate(30, productId);  // no consecutive days, no same-category neighbours

  await db.execute(sql.raw(`
    UPDATE social_posts
    SET status = 'scheduled', scheduled_at = '${scheduledAt.toISOString()}',
        auto_reschedule = ${parsed.data.autoReschedule}, updated_at = NOW()
    WHERE id = ${id}
  `));
  res.json({ ok: true, scheduledAt: scheduledAt.toISOString() });
});

// ── Mark activity as seen ─────────────────────────────────────────────────────

router.post("/social-posts/:id/seen", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.execute(sql`UPDATE social_posts SET new_activity = FALSE, updated_at = NOW() WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── Scheduler ─────────────────────────────────────────────────────────────────

export function startSocialPostScheduler(): void {
  const publish = async () => {
    try {
      const due = await db.execute(sql`
        SELECT * FROM social_posts
        WHERE status = 'scheduled' AND scheduled_at <= NOW()
        LIMIT 10
      `);
      for (const post of (due.rows ?? due) as any[]) {
        await db.execute(sql.raw(`UPDATE social_posts SET status = 'publishing', updated_at = NOW() WHERE id = ${post.id} AND status = 'scheduled'`));
        const fbSettings = await getFbSettings();
        const gbpStatus = await getGbpStatus();
        const platforms: string[] = post.platforms ?? ["facebook", "google"];
        const imageUrl: string | null = post.product_image_url ?? null;
        const postWebsiteUrl: string | null = post.website_url ?? null;
        let failed = false; let errMsg = "";
        let fbPostId: string | null = null; let gbpPostName: string | null = null;

        // Look up product name for notifications
        const [productRow] = (await db.execute(sql`SELECT name FROM products WHERE id = ${post.product_id}`)).rows as any[];
        const productName = productRow?.name ?? `Product #${post.product_id}`;

        if (platforms.includes("facebook") && fbSettings) {
          let message = post.facebook_content;
          if (post.hashtags) message += `\n\n${post.hashtags.split(",").map((h: string) => `#${h.trim()}`).join(" ")}`;
          const fbResult = await publishToFacebook(fbSettings.facebook_page_id, fbSettings.facebook_page_access_token, message, imageUrl, postWebsiteUrl);
          if (fbResult.ok) fbPostId = fbResult.postId ?? null;
          else {
            failed = true; errMsg = fbResult.error ?? "Facebook error";
            await notifySocialPostFailure(post.id, productName, "Facebook", errMsg);
          }
        }

        if (platforms.includes("google") && gbpStatus.locationName) {
          const token = await getGbpAccessToken();
          if (token) {
            const googleMessage = post.google_content || post.facebook_content;
            const gbpResult = await publishGbpPost(gbpStatus.locationName, token, googleMessage, imageUrl);
            if (gbpResult.ok) gbpPostName = gbpResult.postName ?? null;
            else {
              console.warn(`[social] GBP post ${post.id} failed: ${gbpResult.error}`);
              await notifySocialPostFailure(post.id, productName, "Google Business", gbpResult.error ?? "GBP error");
            }
          }
        }

        const newStatus = failed ? "failed" : "published";
        await db.execute(sql.raw(`
          UPDATE social_posts SET
            status = '${newStatus}',
            published_at = ${failed ? "NULL" : `'${new Date().toISOString()}'`},
            error_message = ${failed ? `'${errMsg.replace(/'/g, "''")}'` : "NULL"},
            fb_post_id = ${fbPostId ? `'${fbPostId}'` : "NULL"},
            gbp_post_name = ${gbpPostName ? `'${gbpPostName}'` : "NULL"},
            updated_at = NOW()
          WHERE id = ${post.id}
        `));

        if (!failed && post.auto_reschedule) {
          const nextDate = await pickRescheduleDate(post.product_id);
          const pArr = platforms.map((p: string) => `'${p}'`).join(",");
          await db.execute(sql.raw(`
            INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule, product_image_url, website_url)
            VALUES (${post.product_id}, '${post.facebook_content.replace(/'/g, "''")}', '${post.google_content.replace(/'/g, "''")}', '${post.hashtags.replace(/'/g, "''")}', ARRAY[${pArr}]::text[], 'scheduled', '${nextDate.toISOString()}', true, ${post.product_image_url ? `'${post.product_image_url}'` : "NULL"}, ${post.website_url ? `'${post.website_url.replace(/'/g, "''")}'` : "NULL"})
          `));
        }
        console.log(`[social] Post ${post.id} → ${newStatus}`);
      }
    } catch (err) {
      console.error("[social] Scheduler error:", err);
    }
  };

  // Refresh engagement stats for recently published posts (~every 30 min)
  const refreshStats = async () => {
    try {
      const fb = await getFbSettings();
      if (!fb) return;
      // Published in last 30 days with a FB post ID, stats not refreshed in last 30 min
      const recent = await db.execute(sql`
        SELECT id, fb_post_id, fb_comments FROM social_posts
        WHERE status = 'published'
          AND fb_post_id IS NOT NULL
          AND published_at >= NOW() - INTERVAL '30 days'
          AND (fb_stats_at IS NULL OR fb_stats_at < NOW() - INTERVAL '29 minutes')
        LIMIT 20
      `);
      for (const post of (recent.rows ?? recent) as any[]) {
        const stats = await fetchFbInsights(post.fb_post_id, fb.facebook_page_access_token);
        if (!stats) continue;
        const hasNew = stats.comments > (post.fb_comments ?? 0);
        await db.execute(sql.raw(`
          UPDATE social_posts SET
            fb_reactions = ${stats.reactions},
            fb_comments = ${stats.comments},
            fb_shares = ${stats.shares},
            fb_stats_at = NOW(),
            last_comments = '${JSON.stringify(stats.lastComments).replace(/'/g, "''")}',
            new_activity = (new_activity OR ${hasNew}),
            updated_at = NOW()
          WHERE id = ${post.id}
        `));
      }
    } catch (err) {
      console.error("[social] Stats refresh error:", err);
    }
  };

  publish();
  setInterval(publish, 5 * 60 * 1000);
  setTimeout(() => {
    refreshStats();
    setInterval(refreshStats, 30 * 60 * 1000);
  }, 10_000); // slight delay so it doesn't pile up at startup
}

// ── Generate hero image prompt ────────────────────────────────────────────────

router.post("/products/:productId/generate-image-prompt", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  const bodyParse = z.object({
    productName: z.string().min(1),
    garmentType: z.string().min(1),
    genderFit: z.enum(["Male", "Female", "Unisex"]),
    category: z.enum(["Trade", "Corporate", "Hospitality", "Hi-Vis", "Healthcare", "Outerwear"]),
    heroColourway: z.string().min(1),
    availableColourways: z.array(z.string()).min(1),
    numThumbnails: z.number().int().min(8).max(10).default(9),
    logoText: z.string().default("YOUR LOGO HERE"),
    imageSize: z.string().default("1000px x 1000px"),
    notes: z.string().optional(),
    generateAnimation: z.boolean().default(false),
  }).safeParse(req.body);

  if (!bodyParse.success) { res.status(400).json({ error: bodyParse.error.message }); return; }
  const { productName, garmentType, genderFit, category, heroColourway, availableColourways, numThumbnails, logoText, imageSize, notes, generateAnimation } = bodyParse.data;

  const categoryEnvs: Record<string, string> = {
    Trade: "vans, workshops, warehouses, construction, landscaping, delivery, engineering, plumbing, electrical and site environments",
    Corporate: "offices, hotel reception, meetings, conferences, golf days, networking, front of house and business environments",
    Hospitality: "cafés, restaurants, hotels, bars, catering, reception and events",
    "Hi-Vis": "roads, rail, utilities, construction, civil engineering, traffic management and site work",
    Healthcare: "care homes, clinics, reception, cleaning, support work and healthcare environments",
    Outerwear: "spring, autumn, outdoor work, site visits, logistics, deliveries and facilities management",
  };

  const categoryAnimBg: Record<string, string> = {
    Trade: "a vehicle in the background moves slightly, tools rest nearby",
    Corporate: "people in background pass through a lobby or corridor",
    Hospitality: "coffee steam rises, background guests move gently",
    "Hi-Vis": "an amber beacon may flash softly in the background",
    Healthcare: "a door opens gently in the background",
    Outerwear: "leaves drift slightly in a breeze in the background",
  };

  const hiVisNote = category === "Hi-Vis"
    ? "\n- IMPORTANT: railway workers must wear orange hi-vis only, never yellow. Hero image may include both orange and yellow unless the whole scene is railway-based."
    : "";

  const genderDesc: Record<string, string> = {
    Male: "all male",
    Female: "all female",
    Unisex: "mixed male and female",
  };

  const thumbColours = availableColourways.filter(c => c.toLowerCase() !== heroColourway.toLowerCase());
  const thumbColourList = thumbColours.length > 0 ? thumbColours.join(", ") : availableColourways.join(", ");

  const stillTemplate = `Commercial UK workwear catalogue composite layout, 1000px x 1000px square format, clean white gutters between all panels, rounded corners throughout, professional product catalogue photography.

Centre hero panel occupying around 60% of image area: 4–6 ${genderDesc[genderFit]} workers, varied ages (20s, 30s, 40s, 50s), ethnicities, body types, hairstyles and facial features, all unique individuals with no duplicated faces, all wearing ${heroColourway} ${productName} (${garmentType}), each garment displaying "${logoText}" embroidered placeholder text on the left chest. Realistic ${category} environment — ${categoryEnvs[category]} — natural light, relaxed confident poses, product clearly visible.${hiVisNote}

Surrounding the centre panel: ${numThumbnails} smaller thumbnail panels arranged around the outside edge, each with rounded corners, one individual per panel, different role and work activity in every panel, using only these available colourways: ${thumbColourList}. Each garment must show "${logoText}" embroidery on the left chest. No text overlays, no colour labels, no fake logos, no invented colours, no duplicated people, no clothing layers covering the product.

Style: ultra-realistic commercial catalogue photography, UK workplace feel, clean product-focused compositions, premium workwear brochure quality. Not Midjourney-style or fashion editorial. No random badges, circular logos, crests or fake brand marks. No cloned faces. No stock-photo collage feel.${notes ? `\n\nAdditional instructions: ${notes}` : ""}`;

  const metaPrompt = `You are a commercial catalogue photography art director for Select Uniforms, a UK branded workwear company. Your task is to refine and enhance the following image generation prompt for a composite catalogue hero image. Keep strictly to the template structure and rules — do not add cinematic, fantasy or fashion-editorial language. Improve the scene specifics, environment details and model variety descriptions only.

BASE PROMPT TO REFINE:
${stillTemplate}

Write ONLY the refined prompt text — no preamble, no explanation, no headings. Just the prompt, ready to paste directly into gpt-image-1 / ChatGPT image generation.`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: metaPrompt }],
  });

  const content = message.content[0];
  const generatedPrompt = content.type === "text" ? content.text.trim() : stillTemplate;

  // Animation prompt — built from template, no extra AI call needed
  let animationPrompt: string | null = null;
  if (generateAnimation) {
    animationPrompt = `Create a subtle 8–12 second seamless looping hero video from the centre hero panel only of this catalogue image for the ${heroColourway} ${productName}.

The surrounding thumbnail panels remain completely static.

Animate only the centre hero scene:
- Workers naturally chatting among themselves
- Small natural head turns and glances
- Natural blinking
- One person gestures lightly while speaking
- Someone smiles or laughs briefly
- Gentle breeze on clothing fabric
- Subtle background movement: ${categoryAnimBg[category] ?? "background elements shift slightly"}
- Camera remains mostly static with very slight natural movement

Do not change the clothing or colourway.
Do not change colours.
Do not change the "${logoText}" logo text.
Do not add new people.
Do not distort faces.
Do not make the scene cinematic or dramatic.
Keep it realistic, subtle and catalogue-safe.`;
  }

  res.json({ prompt: generatedPrompt, animationPrompt });
});

export default router;
