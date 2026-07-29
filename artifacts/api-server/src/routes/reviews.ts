/**
 * /shop/reviews — fetches reviews from Google Business Profile and Facebook,
 * normalises them to a common shape, and caches for 6 hours.
 */

import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getGbpAccessToken } from "../services/google-business.js";

const router = Router();

// ── types ────────────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  source: "google" | "facebook";
  author: string;
  authorPhoto?: string;
  rating: number;   // 1-5
  text: string;
  date: string;     // ISO date string
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

const GBP_STAR: Record<string, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5,
};

// ── Google Business Profile reviews ───────────────────────────────────────────

async function fetchGoogleReviews(): Promise<Review[]> {
  const token = await getGbpAccessToken();
  const locationName = await getSetting("gbp_location_name");
  if (!token || !locationName) return [];

  try {
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews?pageSize=50`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) },
    );
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[reviews] GBP reviews fetch failed (${res.status}): ${err.slice(0, 200)}`);
      return [];
    }
    const data: any = await res.json();
    const reviews: Review[] = [];
    for (const r of (data.reviews ?? [])) {
      if (!r.comment?.trim()) continue;   // skip no-text reviews
      reviews.push({
        id:          `google-${r.reviewId}`,
        source:      "google",
        author:      r.reviewer?.displayName ?? "Google User",
        authorPhoto: r.reviewer?.profilePhotoUrl,
        rating:      GBP_STAR[r.starRating] ?? 5,
        text:        r.comment.trim(),
        date:        r.createTime ?? r.updateTime ?? new Date().toISOString(),
      });
    }
    return reviews;
  } catch (err) {
    console.warn("[reviews] GBP reviews error:", err);
    return [];
  }
}

// ── Facebook ratings ──────────────────────────────────────────────────────────

async function fetchFacebookReviews(): Promise<Review[]> {
  const [pageId, token] = await Promise.all([
    getSetting("facebook_page_id"),
    getSetting("facebook_page_access_token"),
  ]);
  if (!pageId || !token) return [];

  try {
    // Exchange for a permanent page access token first (handles both user + page tokens)
    const pageTokenRes = await fetch(
      `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${encodeURIComponent(token)}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const pageTokenData: any = await pageTokenRes.json();
    const pageToken: string = pageTokenData.access_token ?? token;

    const url = `https://graph.facebook.com/v20.0/${pageId}/ratings`
      + `?fields=reviewer{name,pic_square},rating,review_text,created_time`
      + `&limit=50&access_token=${encodeURIComponent(pageToken)}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const err = await res.text();
      console.warn(`[reviews] Facebook ratings fetch failed (${res.status}): ${err.slice(0, 200)}`);
      return [];
    }
    const data: any = await res.json();
    if (data.error) {
      console.warn(`[reviews] Facebook ratings error: ${data.error.message}`);
      return [];
    }
    const reviews: Review[] = [];
    for (const r of (data.data ?? [])) {
      if (!r.review_text?.trim()) continue;
      reviews.push({
        id:          `facebook-${r.created_time ?? Math.random()}`,
        source:      "facebook",
        author:      r.reviewer?.name ?? "Facebook User",
        authorPhoto: r.reviewer?.pic_square,
        rating:      typeof r.rating === "number" ? r.rating : 5,
        text:        r.review_text.trim(),
        date:        r.created_time ?? new Date().toISOString(),
      });
    }
    return reviews;
  } catch (err) {
    console.warn("[reviews] Facebook reviews error:", err);
    return [];
  }
}

// ── In-memory cache ────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let memCache: { reviews: Review[]; fetchedAt: number } | null = null;

async function getReviews(): Promise<Review[]> {
  const now = Date.now();

  // 1. In-memory hit
  if (memCache && now - memCache.fetchedAt < CACHE_TTL_MS) {
    return memCache.reviews;
  }

  // 2. DB-persisted cache (survives restarts)
  if (!memCache) {
    try {
      const cached = await getSetting("shop_reviews_cache");
      const cachedAt = parseInt(await getSetting("shop_reviews_cache_at") ?? "0");
      if (cached && now - cachedAt < CACHE_TTL_MS) {
        const parsed: Review[] = JSON.parse(cached);
        memCache = { reviews: parsed, fetchedAt: cachedAt };
        return parsed;
      }
    } catch { /* ignore */ }
  }

  // 3. Fresh fetch
  const [google, facebook] = await Promise.all([
    fetchGoogleReviews(),
    fetchFacebookReviews(),
  ]);

  // Interleave sources so the carousel mixes them, sort newest first
  const all = [...google, ...facebook]
    .filter(r => r.text.length >= 20)         // skip very short reviews
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Persist to DB
  try {
    await setSetting("shop_reviews_cache", JSON.stringify(all));
    await setSetting("shop_reviews_cache_at", String(now));
  } catch { /* non-fatal */ }

  memCache = { reviews: all, fetchedAt: now };
  return all;
}

// ── Route ─────────────────────────────────────────────────────────────────────

router.get("/shop/reviews", async (_req, res): Promise<void> => {
  try {
    const reviews = await getReviews();
    res.json({ reviews });
  } catch (err) {
    console.error("[reviews] Route error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// Force-refresh (used by the weekly SEO check or manual refresh)
router.post("/shop/reviews/refresh", async (_req, res): Promise<void> => {
  memCache = null;
  await setSetting("shop_reviews_cache_at", "0");
  try {
    const reviews = await getReviews();
    res.json({ ok: true, count: reviews.length });
  } catch (err) {
    res.status(500).json({ error: "Refresh failed" });
  }
});

export default router;
