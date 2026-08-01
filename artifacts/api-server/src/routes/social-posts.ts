import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import {
  generateGbpAuthUrl, handleGbpCallback, getGbpAccessToken,
  getGbpStatus, getGbpDiagnostics, listGbpLocations, publishGbpPost, disconnectGbp,
  autoGbpRedirectUri, invalidateLocationsCache,
} from "../services/google-business.js";
import {
  autoLinkedInRedirectUri, generateLinkedInAuthUrl, handleLinkedInCallback,
  getLinkedInAccessToken, getLinkedInStatus, disconnectLinkedIn,
} from "../services/linkedin-oauth.js";
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

async function getLinkedInSettings(): Promise<{ linkedin_access_token: string; linkedin_person_urn: string } | null> {
  const [token, personUrn] = await Promise.all([
    getLinkedInAccessToken(),
    getSetting("linkedin_person_urn"),
  ]);
  return token && personUrn ? { linkedin_access_token: token, linkedin_person_urn: personUrn } : null;
}

async function publishToLinkedIn(
  authorUrn: string,
  accessToken: string,
  title: string,
  commentary: string,
  articleUrl: string,
  imageUrl: string | null,
): Promise<{ ok: boolean; postUrn?: string; error?: string }> {
  try {
    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: commentary },
          shareMediaCategory: "ARTICLE",
          media: [{
            status: "READY",
            description: { text: title.slice(0, 256) },
            originalUrl: articleUrl,
            title: { text: title.slice(0, 200) },
          }],
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return { ok: false, error: `LinkedIn ${res.status}: ${errText}` };
    }
    const data: any = await res.json();
    return { ok: true, postUrn: data.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Unknown error" };
  }
}

// ── LinkedIn token checker ────────────────────────────────────────────────────
router.post("/linkedin/check-token", async (req, res): Promise<void> => {
  const parsed = z.object({ accessToken: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "accessToken required" }); return; }
  const { accessToken } = parsed.data;
  try {
    // Use the OpenID userinfo endpoint — works with both legacy and OIDC tokens
    const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!meRes.ok) {
      // Fall back to the older /v2/me endpoint
      const meRes2 = await fetch("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!meRes2.ok) {
        const err: any = await meRes2.json().catch(() => ({}));
        res.status(400).json({ error: err.message ?? `LinkedIn error ${meRes2.status}` });
        return;
      }
      const me: any = await meRes2.json();
      const personUrn = `urn:li:person:${me.id}`;
      const memberName = [me.localizedFirstName, me.localizedLastName].filter(Boolean).join(" ") || "Unknown";
      res.json({ valid: true, memberName, personUrn });
      return;
    }
    const me: any = await meRes.json();
    // userinfo returns 'sub' as the person ID
    const personUrn = `urn:li:person:${me.sub}`;
    const memberName = [me.given_name, me.family_name].filter(Boolean).join(" ") || me.name || "Unknown";
    res.json({ valid: true, memberName, personUrn });
  } catch (e: any) {
    res.status(500).json({ error: e?.message ?? "Request failed" });
  }
});

// ── LinkedIn OAuth routes ─────────────────────────────────────────────────────

// Save Client ID + Secret (write-only; secret never returned to frontend)
router.post("/linkedin/credentials", async (req, res): Promise<void> => {
  const parsed = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setSetting("linkedin_client_id", parsed.data.clientId);
  await setSetting("linkedin_client_secret", parsed.data.clientSecret);
  res.json({ ok: true });
});

// Return the redirect URI the user must add to LinkedIn Developer Portal
router.get("/linkedin/redirect-uri", (req, res): void => {
  res.json({ redirectUri: autoLinkedInRedirectUri(req) });
});

// Start the OAuth flow (browser redirect)
router.get("/linkedin/connect", async (req, res): Promise<void> => {
  try {
    const redirectUri = autoLinkedInRedirectUri(req);
    const url = await generateLinkedInAuthUrl(redirectUri);
    res.redirect(url);
  } catch (err) {
    res.status(400).send(`<h2>LinkedIn Connect Error</h2><p>${err instanceof Error ? err.message : "Unknown error"}</p>`);
  }
});

// OAuth callback — exchange code, fetch profile + orgs, redirect back to Settings
router.get("/linkedin/oauth/callback", async (req, res): Promise<void> => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  if (error) {
    const msg = error_description ?? error;
    res.redirect(`/order-system/settings?li=error&msg=${encodeURIComponent(msg)}`);
    return;
  }
  if (!code || !state) { res.redirect("/order-system/settings?li=error&msg=Missing+code"); return; }
  try {
    const redirectUri = autoLinkedInRedirectUri(req);
    await handleLinkedInCallback(code, state, redirectUri);
    res.redirect("/order-system/settings?li=connected");
  } catch (err) {
    res.redirect(`/order-system/settings?li=error&msg=${encodeURIComponent(err instanceof Error ? err.message : "Unknown error")}`);
  }
});

// Connection status
router.get("/linkedin/status", async (_req, res): Promise<void> => {
  res.json(await getLinkedInStatus());
});

// Select / update the organisation to post to
router.post("/linkedin/org", async (req, res): Promise<void> => {
  const parsed = z.object({ urn: z.string().min(1), name: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setSetting("linkedin_org_urn", parsed.data.urn);
  await setSetting("linkedin_org_name", parsed.data.name);
  res.json({ ok: true });
});

// Update post-to-profile / post-to-page toggles
router.post("/linkedin/preferences", async (req, res): Promise<void> => {
  const parsed = z.object({
    postToProfile: z.boolean().optional(),
    postToPage: z.boolean().optional(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  if (parsed.data.postToProfile !== undefined) await setSetting("linkedin_post_to_profile", String(parsed.data.postToProfile));
  if (parsed.data.postToPage    !== undefined) await setSetting("linkedin_post_to_page",    String(parsed.data.postToPage));
  res.json({ ok: true });
});

// Disconnect
router.post("/linkedin/disconnect", async (_req, res): Promise<void> => {
  await disconnectLinkedIn();
  res.json({ ok: true });
});

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
 *   - No post on the same calendar day or immediately adjacent day (every-other-day cadence)
 *   - No post with the same product category within 7 days either side
 */
async function isDateConflict(dayStart: Date, dayEnd: Date, productCategory: string | null): Promise<boolean> {
  // Check ±1 day for any post (enforces every-other-day minimum cadence)
  const windowStart = new Date(dayStart.getTime() - 86_400_000);
  const windowEnd   = new Date(dayEnd.getTime()   + 86_400_000);
  const nearbyRes = await db.execute(sql`
    SELECT sp.id FROM social_posts sp
    WHERE sp.status IN ('scheduled', 'publishing')
      AND sp.scheduled_at BETWEEN ${windowStart.toISOString()} AND ${windowEnd.toISOString()}
    LIMIT 1
  `);
  if ((nearbyRes.rows ?? nearbyRes as any[]).length > 0) return true;

  // No same category within 7 days either side (no two hi-vis posts in the same week, etc.)
  if (productCategory) {
    const weekStart = new Date(dayStart.getTime() - 7 * 86_400_000);
    const weekEnd   = new Date(dayEnd.getTime()   + 7 * 86_400_000);
    const catRes = await db.execute(sql`
      SELECT sp.id FROM social_posts sp
      LEFT JOIN products p ON p.id = sp.product_id
      WHERE sp.status IN ('scheduled', 'publishing')
        AND sp.scheduled_at BETWEEN ${weekStart.toISOString()} AND ${weekEnd.toISOString()}
        AND p.category = ${productCategory}
      LIMIT 1
    `);
    if ((catRes.rows ?? catRes as any[]).length > 0) return true;
  }

  return false;
}

/** Find the earliest available publish slot starting from tomorrow.
 *  Respects every-other-day cadence and no same-category within 7 days. */
async function pickNextPublishSlot(productId: number): Promise<Date> {
  const [prod] = (await db.execute(sql`SELECT category FROM products WHERE id = ${productId}`)).rows as any[];
  const productCategory: string | null = prod?.category ?? null;

  for (let daysAhead = 1; daysAhead <= 60; daysAhead++) {
    const candidate = new Date(Date.now() + daysAhead * 86_400_000);
    const dayStart = new Date(candidate); dayStart.setHours(9, 0, 0, 0);  // post at 9am
    const dayEnd   = new Date(candidate); dayEnd.setHours(23, 59, 59, 999);
    if (!(await isDateConflict(dayStart, dayEnd, productCategory))) return dayStart;
  }
  // Fallback
  const fb = new Date(Date.now() + 2 * 86_400_000); fb.setHours(9, 0, 0, 0);
  return fb;
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

type SeasonName = "spring" | "summer" | "autumn" | "winter";
const SEASON_MONTHS: Record<SeasonName, number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  autumn: [9, 10, 11],
  winter: [12, 1, 2],
};

/**
 * Finds the next calendar window for the given season that starts at least 30 days from now.
 * Returns startOffsetDays (days from now to window start) and withinDays (length of window).
 */
function nextSeasonWindow(season: SeasonName): { startOffsetDays: number; withinDays: number } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const minDate = new Date(today.getTime() + 30 * 86_400_000); // at least 30 days from now
  const months = SEASON_MONTHS[season];

  // Scan forward month by month (up to 25 months ahead) to find the first season month >= minDate
  for (let m = 0; m < 25; m++) {
    const probe = new Date(minDate.getFullYear(), minDate.getMonth() + m, 1);
    if (!months.includes(probe.getMonth() + 1)) continue;

    // Found the first season month — now extend to the full contiguous season block
    const seasonStart = probe < minDate ? new Date(minDate) : new Date(probe);
    let seasonEnd = new Date(probe.getFullYear(), probe.getMonth() + 1, 0); // last day of this month
    let next = new Date(probe.getFullYear(), probe.getMonth() + 1, 1);
    while (months.includes(next.getMonth() + 1)) {
      seasonEnd = new Date(next.getFullYear(), next.getMonth() + 1, 0);
      next = new Date(next.getFullYear(), next.getMonth() + 1, 1);
    }

    const startOffsetDays = Math.ceil((seasonStart.getTime() - today.getTime()) / 86_400_000);
    const withinDays = Math.max(Math.ceil((seasonEnd.getTime() - seasonStart.getTime()) / 86_400_000), 14);
    return { startOffsetDays, withinDays };
  }

  // Fallback: ~4 months with 42-day window
  return { startOffsetDays: Math.round(3.5 * 30.44) - 21, withinDays: 42 };
}

/** Returns the season for a given date (UK convention). */
function seasonFromDate(date: Date): SeasonName {
  const m = date.getMonth() + 1; // 1–12
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  if (m >= 9 && m <= 11) return "autumn";
  return "winter";
}

/** Pick a smart reschedule date applying scheduling rules.
 *  If a season is provided the date is confined to the next occurrence of that season;
 *  otherwise it targets ~4 months (±3 weeks) from now. */
async function pickRescheduleDate(productId?: number, season?: string | null): Promise<Date> {
  if (season && season in SEASON_MONTHS) {
    const { startOffsetDays, withinDays } = nextSeasonWindow(season as SeasonName);
    return pickAvailableDate(withinDays, productId, startOffsetDays);
  }
  const targetDays = Math.round(3.5 * 30.44 + Math.random() * 30.44); // 3.5–4.5 months
  return pickAvailableDate(42, productId, targetDays - 21);
}

// ── Google Business Profile OAuth routes ──────────────────────────────────────

router.get("/gbp/status", async (_req, res): Promise<void> => {
  const status = await getGbpStatus();
  const diag = await getGbpDiagnostics();
  res.json({ ...status, ...diag });
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
  if (error) { res.redirect(`/order-system/settings?gbp=error&msg=${encodeURIComponent(error)}`); return; }
  if (!code) { res.redirect("/order-system/settings?gbp=error&msg=Missing+code"); return; }
  try {
    const redirectUri = autoGbpRedirectUri(req);
    await handleGbpCallback(code, redirectUri);
    res.redirect("/order-system/settings?gbp=connected");
  } catch (err) {
    res.redirect(`/order-system/settings?gbp=error&msg=${encodeURIComponent(err instanceof Error ? err.message : "Unknown error")}`);
  }
});

// In-memory cache: survives within a process lifetime; DB cache survives restarts
let gbpLocationsCache: { locations: { name: string; title: string }[]; fetchedAt: number } | null = null;
const GBP_LOCATIONS_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory TTL
const GBP_RATE_LIMIT_COOLDOWN_MS = 65_000; // 65 seconds between retries after a rate limit hit
let gbpRateLimitHitAt: number | null = null;

function isGbpRateLimit(msg: string): boolean {
  return msg.includes("Quota exceeded") || msg.includes("RATE_LIMIT") || msg.includes("429") || msg.includes("rateLimitExceeded");
}

async function getDbCachedLocations(): Promise<{ name: string; title: string }[] | null> {
  try {
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, "gbp_locations_cache"));
    if (!row?.value) return null;
    return JSON.parse(row.value) as { name: string; title: string }[];
  } catch { return null; }
}

async function setDbCachedLocations(locations: { name: string; title: string }[]): Promise<void> {
  try {
    await db.insert(settingsTable).values({ key: "gbp_locations_cache", value: JSON.stringify(locations) })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(locations), updatedAt: new Date() } });
  } catch { /* non-fatal */ }
}

router.get("/gbp/locations", async (req, res): Promise<void> => {
  const forceRefresh = req.query.refresh === "1";
  const now = Date.now();

  // Always check cache first — even on forceRefresh if we're in a rate-limit cooldown
  const inCooldown = gbpRateLimitHitAt !== null && (now - gbpRateLimitHitAt) < GBP_RATE_LIMIT_COOLDOWN_MS;
  const retryAfterSec = inCooldown ? Math.ceil((GBP_RATE_LIMIT_COOLDOWN_MS - (now - gbpRateLimitHitAt!)) / 1000) : 0;

  if (inCooldown) {
    // Serve whatever cache we have; if none, return a cooldown error with retryAfter
    const cached = gbpLocationsCache?.locations ?? await getDbCachedLocations();
    if (cached && cached.length > 0) {
      console.log(`[GBP] In rate-limit cooldown (${retryAfterSec}s left) — serving cached locations`);
      res.json(cached);
      return;
    }
    console.log(`[GBP] In rate-limit cooldown (${retryAfterSec}s left) — no cache available`);
    res.status(429).json({ error: "RATE_LIMIT_EXCEEDED: Google API rate limit hit. Please wait before retrying.", retryAfter: retryAfterSec });
    return;
  }

  // Serve in-memory cache if fresh and not forcing refresh
  if (!forceRefresh && gbpLocationsCache && (now - gbpLocationsCache.fetchedAt) < GBP_LOCATIONS_TTL_MS) {
    res.json(gbpLocationsCache.locations);
    return;
  }

  try {
    let token: string | null;
    try {
      token = await getGbpAccessToken();
    } catch (tokenErr: any) {
      res.status(401).json({ error: tokenErr.message ?? "Could not obtain access token" });
      return;
    }
    if (!token) { res.status(401).json({ error: "Not connected to Google Business Profile" }); return; }

    const locations = await listGbpLocations(token);

    // Success — clear any rate limit tracker, persist to memory + DB
    gbpRateLimitHitAt = null;
    gbpLocationsCache = { locations, fetchedAt: now };
    await setDbCachedLocations(locations);
    res.json(locations);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[GBP] /gbp/locations error:", msg);

    if (isGbpRateLimit(msg)) {
      gbpRateLimitHitAt = now;
      // Fall back to DB-persisted cache rather than erroring if we have one
      const cached = gbpLocationsCache?.locations ?? await getDbCachedLocations();
      if (cached && cached.length > 0) {
        console.log("[GBP] Serving DB-cached locations due to quota limit");
        res.json(cached);
        return;
      }
      // No cache — return rate limit error with retryAfter so the UI can count down
      res.status(429).json({ error: `RATE_LIMIT_EXCEEDED: ${msg}`, retryAfter: Math.ceil(GBP_RATE_LIMIT_COOLDOWN_MS / 1000) });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

router.post("/gbp/location", async (req, res): Promise<void> => {
  const parsed = z.object({ name: z.string().min(1), title: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  await setSetting("gbp_location_name", parsed.data.name);
  await setSetting("gbp_location_title", parsed.data.title);
  // Also cache the account name if the location name is a full path
  if (parsed.data.name.includes("/locations/")) {
    const accountName = parsed.data.name.split("/locations/")[0];
    await setSetting("gbp_account_name", accountName);
  }
  // Clear backoff and invalidate locations cache so next review refresh uses the new location
  await setSetting("gbp_location_resolve_retry_after", "0");
  invalidateLocationsCache();
  res.json({ ok: true });
});

// POST /gbp/fix-location
// Calls the Account Management API once to discover the correct
// accounts/{accountId}/locations/{locationId} path, verifies it against the Reviews
// API, and persists the result so every subsequent refresh works without another lookup.
router.post("/gbp/fix-location", async (_req, res): Promise<void> => {
  let token: string | null;
  try { token = await getGbpAccessToken(); } catch { token = null; }
  if (!token) { res.status(400).json({ error: "Not authenticated with Google" }); return; }

  const storedValue = await getSetting("gbp_location_name");
  if (!storedValue) { res.status(400).json({ error: "No location ID stored" }); return; }

  // Already the correct full path — verify it still works, then return
  if (storedValue.startsWith("accounts/") && storedValue.includes("/locations/")) {
    const probe = await fetch(
      `https://mybusinessreviews.googleapis.com/v1/${storedValue}/reviews?pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (probe.ok) {
      res.json({ ok: true, locationName: storedValue, alreadyResolved: true });
      return;
    }
    // Path stored but no longer working — fall through to re-discover
  }

  try {
    // Extract the bare numeric location ID from whatever format is stored
    const bareId = storedValue.includes("/locations/")
      ? storedValue.split("/locations/")[1]
      : storedValue.replace(/^locations\//, "");

    // ── Strategy 1: Business Information API ─────────────────────────────────
    // Uses a completely separate quota from the Account Management API.
    // GET /v1/locations/{id} returns the full canonical resource name which
    // includes the account ID (e.g. accounts/123/locations/456).
    let resolvedName: string | null = null;
    const infoRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${bareId}?readMask=name`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (infoRes.ok) {
      const infoData: any = await infoRes.json();
      const candidateName: string = infoData?.name ?? "";
      // Expect "accounts/{accountId}/locations/{locationId}" form
      if (candidateName.startsWith("accounts/") && candidateName.includes("/locations/")) {
        resolvedName = candidateName;
        console.log(`[GBP] fix-location: resolved via Business Information API → ${resolvedName}`);
      }
    } else {
      console.warn(`[GBP] fix-location: Business Information API returned ${infoRes.status} — will try Account Management API`);
    }

    // ── Strategy 2: Account Management API ─────────────────────────────────
    // Fallback when Business Information API is quota-limited (429).
    // Only called on manual button click, not automatically, so it won't
    // burn the quota shared with auto-post scheduling.
    if (!resolvedName) {
      console.log("[GBP] fix-location: Business Info API unavailable — trying Account Management API...");
      const acctRes = await fetch(
        "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
        { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (acctRes.ok) {
        const acctData: any = await acctRes.json();
        const accounts: any[] = acctData?.accounts ?? [];
        for (const acct of accounts) {
          const acctName: string = acct.name ?? "";
          if (!acctName.startsWith("accounts/")) continue;
          const candidate = `${acctName}/locations/${bareId}`;
          const probe = await fetch(
            `https://mybusinessreviews.googleapis.com/v1/${candidate}/reviews?pageSize=1`,
            { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) },
          );
          if (probe.ok) {
            resolvedName = candidate;
            console.log(`[GBP] fix-location: resolved via Account Management API → ${resolvedName}`);
            break;
          }
        }
        if (!resolvedName) {
          console.warn(`[GBP] fix-location: checked ${accounts.length} accounts, none matched location ${bareId}`);
        }
      } else {
        const acctErr = await acctRes.text();
        console.warn(`[GBP] fix-location: Account Management API returned ${acctRes.status}: ${acctErr.slice(0, 200)}`);
      }
    }
    if (!resolvedName) {
      res.status(400).json({
        error: "Could not resolve location — both APIs are currently unavailable. Please wait a minute and try again.",
      });
      return;
    }

    // ── Verify against the Reviews API ───────────────────────────────────────
    const reviewsRes = await fetch(
      `https://mybusinessreviews.googleapis.com/v1/${resolvedName}/reviews?pageSize=1`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!reviewsRes.ok) {
      const err = await reviewsRes.text();
      res.status(400).json({ error: `Reviews API returned ${reviewsRes.status} for "${resolvedName}": ${err.slice(0, 300)}` });
      return;
    }

    const accountPart = resolvedName.split("/locations/")[0];
    await Promise.all([
      setSetting("gbp_location_name", resolvedName),
      setSetting("gbp_account_name", accountPart),
      setSetting("gbp_location_resolve_retry_after", "0"),
    ]);
    invalidateLocationsCache();
    console.log(`[GBP] fix-location: saved "${storedValue}" → ${resolvedName}`);
    res.json({ ok: true, locationName: resolvedName });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
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
  let token: string | null;
  try { token = await getGbpAccessToken(); } catch (e: any) { token = null; results.google = { ok: false, skipped: true, error: e.message }; }
  if (token === null && !results.google) {
    results.google = { ok: false, skipped: true, error: "Not connected — connect Google Business Profile in Settings → Social Media" };
  } else if (token && !gbpStatus.locationName) {
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

const SEASON_LABELS: Record<SeasonName, string> = {
  spring: "Spring (March–May)",
  summer: "Summer (June–August)",
  autumn: "Autumn (September–November)",
  winter: "Winter (December–February)",
};

/**
 * Core AI generation helper. Returns generated post content for a product,
 * optionally angled for a specific season. Falls back to null on AI failure.
 */
async function generatePostsForProduct(
  productId: number,
  season?: SeasonName | null,
): Promise<{ facebookContent: string; googleContent: string; hashtags: string } | null> {
  const [product] = (await db.execute(sql`
    SELECT p.name, p.sku, p.description, p.unit_price, p.category, p.image_url, p.permalink,
           p.guidance_best_for, p.guidance_not_ideal_for, p.guidance_staff_quotes,
           p.guidance_badges, p.guidance_tags
    FROM products p WHERE p.id = ${productId}
  `)).rows as any[];
  if (!product) return null;

  const bestFor = product.guidance_best_for || null;
  const notIdeal = product.guidance_not_ideal_for || null;
  const badges = Array.isArray(product.guidance_badges) ? product.guidance_badges : (typeof product.guidance_badges === "string" ? JSON.parse(product.guidance_badges || "[]") : []);
  const tags = Array.isArray(product.guidance_tags) ? product.guidance_tags : (typeof product.guidance_tags === "string" ? JSON.parse(product.guidance_tags || "[]") : []);
  const staffQuotes = Array.isArray(product.guidance_staff_quotes) ? product.guidance_staff_quotes : (typeof product.guidance_staff_quotes === "string" ? JSON.parse(product.guidance_staff_quotes || "[]") : []);

  const seasonLine = season
    ? `\nSEASON CONTEXT: This post will go out in ${SEASON_LABELS[season]}. Angle the content to reflect seasonal relevance — e.g. summer workwear considerations, winter warmth and layering, spring uniform refreshes, or autumn team kit updates. Keep it educational and avoid sounding promotional.`
    : "";

  const prompt = `You are a content strategist for Select Branding Solutions (SBS), a UK-based branded promotional garments and merchandise company. Your goal is to build a helpful knowledgebase — posts that genuinely answer the questions people search for on Google, Facebook, and ChatGPT.

GUIDING PRINCIPLES:
- Be educational and genuinely helpful. Answer real questions people ask.
- Never mention price, never sell, never push people to buy.
- Write like an expert sharing knowledge, not a brand promoting itself.
- Think: "What would someone type into Google or ChatGPT about this product type?"
- Examples of the RIGHT angle: "What to look for when choosing branded workwear", "How long does embroidery last on polo shirts", "What's the difference between screen print and embroidery for logos"
- The content should be so useful that people save it, share it, or come back to it.${seasonLine}

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

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0].type === "text" ? message.content[0].text : "";
    const cleaned = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const result = JSON.parse(cleaned);
    return {
      facebookContent: result.facebook || "",
      googleContent: result.google || "",
      hashtags: result.hashtags || "",
    };
  } catch (err) {
    console.error("[social] generatePostsForProduct failed:", err);
    return null;
  }
}

router.post("/products/:productId/social-posts/generate", async (req, res): Promise<void> => {
  const pid = parseInt(req.params.productId, 10);
  if (!pid) { res.status(400).json({ error: "Invalid productId" }); return; }

  // Fetch variant colour images for image picker
  const variantImgRows = (await db.execute(sql`
    SELECT DISTINCT ON (colour) colour, image_url
    FROM product_variants
    WHERE product_id = ${pid} AND image_url IS NOT NULL AND image_url != ''
    ORDER BY colour, id
  `)).rows as any[];

  const [prodMeta] = (await db.execute(sql`SELECT image_url, permalink FROM products WHERE id = ${pid}`)).rows as any[];

  const generated = await generatePostsForProduct(pid);
  if (!generated) { res.status(404).json({ error: "Product not found or AI generation failed" }); return; }

  res.json({
    facebookContent: generated.facebookContent,
    googleContent: generated.googleContent,
    hashtags: generated.hashtags,
    productImageUrl: prodMeta?.image_url || null,
    websiteUrl: prodMeta?.permalink || null,
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
    productImageUrl: z.preprocess(v => (!v || v === "" ? null : v), z.string().url().optional().nullable()),
    websiteUrl: z.preprocess(v => (!v || v === "" ? null : v), z.string().url().optional().nullable()),
    season: z.enum(["spring", "summer", "autumn", "winter"]).optional().nullable(),
  }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { facebookContent, googleContent, hashtags, platforms, autoReschedule, scheduledAt, productImageUrl, websiteUrl, season } = parsed.data;

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
    INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule, product_image_url, website_url, season)
    VALUES (${pid}, ${facebookContent}, ${googleContent}, ${hashtags}, ${platformsSql}, ${status}, ${scheduledAt ?? null}, ${autoReschedule}, ${imageUrl ?? null}, ${siteUrl ?? null}, ${season ?? null})
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
    productImageUrl: z.preprocess(v => (!v || v === "" ? null : v), z.string().url().optional().nullable()),
    websiteUrl: z.preprocess(v => (!v || v === "" ? null : v), z.string().url().optional().nullable()),
    season: z.enum(["spring", "summer", "autumn", "winter"]).optional().nullable(),
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
  if ("season" in d) sets.push(`season = ${d.season ? `'${d.season}'` : "NULL"}`);

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

  // Queue the post for the next available slot (every-other-day cadence, no same-category
  // within 7 days). The scheduler handles the actual publish when the time comes.
  const slotDate = await pickNextPublishSlot(post.product_id);
  await db.execute(sql`
    UPDATE social_posts
    SET status = 'scheduled', scheduled_at = ${slotDate.toISOString()},
        new_activity = FALSE, updated_at = NOW()
    WHERE id = ${id}
  `);

  res.json({ ok: true, queued: true, scheduledAt: slotDate.toISOString() });
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
      // Rate-limit: never publish if something was already published in the last 48 hours.
      // This enforces the every-other-day cadence at the actual publish moment.
      const recentRes = await db.execute(sql`
        SELECT id FROM social_posts
        WHERE status = 'published' AND published_at >= NOW() - INTERVAL '48 hours'
        LIMIT 1
      `);
      if ((recentRes.rows ?? recentRes as any[]).length > 0) return;

      // Pick just one due post — the earliest scheduled
      const due = await db.execute(sql`
        SELECT * FROM social_posts
        WHERE status = 'scheduled' AND scheduled_at <= NOW()
        ORDER BY scheduled_at ASC
        LIMIT 1
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
          let gbpToken: string | null = null;
          try { gbpToken = await getGbpAccessToken(); } catch (e: any) { console.warn(`[social] GBP token error: ${e.message}`); }
          const token = gbpToken;
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
          const nextDate = await pickRescheduleDate(post.product_id); // standard ~4-month cadence
          const nextSeason = seasonFromDate(nextDate);
          const pArr = platforms.map((p: string) => `'${p}'`).join(",");
          // Generate content relevant to the season the new post will land in
          const fresh = await generatePostsForProduct(post.product_id, nextSeason);
          const fbContent = (fresh?.facebookContent || post.facebook_content).replace(/'/g, "''");
          const ggContent = (fresh?.googleContent || post.google_content).replace(/'/g, "''");
          const htContent = (fresh?.hashtags || post.hashtags).replace(/'/g, "''");
          await db.execute(sql.raw(`
            INSERT INTO social_posts (product_id, facebook_content, google_content, hashtags, platforms, status, scheduled_at, auto_reschedule, product_image_url, website_url, season)
            VALUES (${post.product_id}, '${fbContent}', '${ggContent}', '${htContent}', ARRAY[${pArr}]::text[], 'scheduled', '${nextDate.toISOString()}', true, ${post.product_image_url ? `'${post.product_image_url}'` : "NULL"}, ${post.website_url ? `'${post.website_url.replace(/'/g, "''")}'` : "NULL"}, '${nextSeason}')
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

// ── WordPress → LinkedIn scheduler ───────────────────────────────────────────
// Polls WordPress every hour for new posts and shares unshared ones to LinkedIn.
// Shares at most ONE new post per run to avoid spamming the feed.
export function startWordPressLinkedInScheduler(): void {
  const WP_POSTS_URL =
    "https://www.selectuniforms.co.uk/wp-json/wp/v2/posts" +
    "?per_page=10&_fields=id,title,excerpt,link,_embedded&_embed=wp:featuredmedia";

  const run = async () => {
    try {
      const liSettings = await getLinkedInSettings();
      if (!liSettings) return; // LinkedIn not configured — skip silently

      const wpRes = await fetch(WP_POSTS_URL, { signal: AbortSignal.timeout(15_000) });
      if (!wpRes.ok) {
        console.warn(`[linkedin] WordPress fetch failed: HTTP ${wpRes.status}`);
        return;
      }
      const posts: any[] = await wpRes.json();

      for (const post of posts) {
        // Skip if already shared
        const existing = await db.execute(
          sql`SELECT id FROM linkedin_shared_posts WHERE wp_post_id = ${post.id}`,
        );
        if (((existing.rows ?? existing) as any[]).length > 0) continue;

        const title = (post.title?.rendered ?? "")
          .replace(/&#8217;/g, "'").replace(/&#8211;/g, "–")
          .replace(/&amp;/g, "&").replace(/<[^>]+>/g, "").trim();

        const rawExcerpt: string = post.excerpt?.rendered ?? "";
        const excerpt = rawExcerpt
          .replace(/<[^>]+>/g, "")
          .replace(/\[&hellip;\]/g, "…").replace(/&#8230;/g, "…")
          .trim();

        const articleUrl: string = post.link;
        const imageUrl: string | null =
          post._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null;

        // Build commentary: title + excerpt (truncated to LinkedIn's 3000-char limit)
        const commentary = `${title}\n\n${excerpt}`.slice(0, 3000);

        // Get posting preferences
      const liStatusNow = await getLinkedInStatus();
      const token = liSettings.linkedin_access_token;
      let anyOk = false;

      // Post to personal profile
      if (liStatusNow.postToProfile && liSettings.linkedin_person_urn) {
        const r = await publishToLinkedIn(liSettings.linkedin_person_urn, token, title, commentary, articleUrl, imageUrl);
        if (r.ok) {
          anyOk = true;
          console.log(`[linkedin] Shared WP post ${post.id} to personal profile: "${title}"`);
        } else {
          console.warn(`[linkedin] Personal profile post failed for WP post ${post.id}: ${r.error}`);
        }
      }

      // Post to company page
      const orgUrn = await getSetting("linkedin_org_urn");
      if (liStatusNow.postToPage && orgUrn) {
        const r = await publishToLinkedIn(orgUrn, token, title, commentary, articleUrl, imageUrl);
        if (r.ok) {
          anyOk = true;
          console.log(`[linkedin] Shared WP post ${post.id} to company page (${orgUrn}): "${title}"`);
        } else {
          console.warn(`[linkedin] Company page post failed for WP post ${post.id}: ${r.error}`);
        }
      }

      const result = { ok: anyOk };

        if (result.ok) {
          await db.execute(sql`
            INSERT INTO linkedin_shared_posts (wp_post_id, wp_title, linkedin_post_urn)
            VALUES (${post.id}, ${title}, NULL)
            ON CONFLICT (wp_post_id) DO NOTHING
          `);
          console.log(`[linkedin] Marked WP post ${post.id} as shared`);
        } else {
          console.warn(`[linkedin] All targets failed for WP post ${post.id}: "${title}"`);
        }

        // Share only one new post per run
        break;
      }
    } catch (err) {
      console.error("[linkedin] Scheduler error:", err);
    }
  };

  run();
  setInterval(run, 60 * 60 * 1000); // every hour
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
