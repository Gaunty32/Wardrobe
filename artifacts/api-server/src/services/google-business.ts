import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GBP_ACCOUNT_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GBP_POST_API = "https://mybusiness.googleapis.com/v4"; // local posts still on v4
const SCOPE = "https://www.googleapis.com/auth/business.manage";

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string | null): Promise<void> {
  await db.insert(settingsTable).values({ key, value })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
}

export function autoGbpRedirectUri(req: import("express").Request): string {
  const replitDomains = process.env.REPLIT_DOMAINS;
  if (replitDomains) {
    const domain = replitDomains.split(",")[0].trim();
    return `https://${domain}/api/gbp/callback`;
  }
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  return `${proto}://${host}/api/gbp/callback`;
}

export async function generateGbpAuthUrl(redirectUri: string): Promise<string> {
  const clientId = await getSetting("gbp_client_id");
  if (!clientId) throw new Error("Google Client ID not configured — add it in Settings → Social Media");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export async function handleGbpCallback(code: string, redirectUri: string): Promise<void> {
  const clientId = await getSetting("gbp_client_id");
  const clientSecret = await getSetting("gbp_client_secret");
  if (!clientId || !clientSecret) throw new Error("Google credentials not configured");
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || "Token exchange failed");
  if (data.refresh_token) await setSetting("gbp_refresh_token", data.refresh_token);
  await setSetting("gbp_access_token", data.access_token);
  await setSetting("gbp_token_expires_at", String(Date.now() + (data.expires_in ?? 3600) * 1000));
}

export async function getGbpAccessToken(): Promise<string | null> {
  const clientId = await getSetting("gbp_client_id");
  const clientSecret = await getSetting("gbp_client_secret");
  const refreshToken = await getSetting("gbp_refresh_token");
  if (!refreshToken) return null;
  if (!clientId || !clientSecret) throw new Error("MISSING_CREDENTIALS: Google Client ID and Secret must be entered in Settings → Social Media → Google Business Profile before the connection can be used.");

  const expiresAt = parseInt(await getSetting("gbp_token_expires_at") ?? "0");
  if (Date.now() < expiresAt - 60_000) {
    return getSetting("gbp_access_token");
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data: any = await res.json();
  if (!res.ok) {
    const reason = data?.error_description ?? data?.error ?? `HTTP ${res.status}`;
    if (data?.error === "invalid_client") throw new Error("INVALID_CLIENT: The Google Client ID or Secret is incorrect. Re-enter your credentials in Settings → Social Media and reconnect.");
    if (data?.error === "invalid_grant") throw new Error("TOKEN_EXPIRED: The Google authorisation has expired or been revoked. Click Disconnect and reconnect to Google.");
    throw new Error(`TOKEN_REFRESH_FAILED: ${reason}`);
  }
  await setSetting("gbp_access_token", data.access_token);
  await setSetting("gbp_token_expires_at", String(Date.now() + (data.expires_in ?? 3600) * 1000));
  return data.access_token;
}

/** Structured diagnostic info for the settings UI */
export async function getGbpDiagnostics(): Promise<{ hasClientId: boolean; hasClientSecret: boolean; hasRefreshToken: boolean }> {
  return {
    hasClientId: !!(await getSetting("gbp_client_id")),
    hasClientSecret: !!(await getSetting("gbp_client_secret")),
    hasRefreshToken: !!(await getSetting("gbp_refresh_token")),
  };
}

export async function getGbpStatus(): Promise<{ connected: boolean; locationName?: string; locationTitle?: string }> {
  const refreshToken = await getSetting("gbp_refresh_token");
  const locationName = await getSetting("gbp_location_name");
  const locationTitle = await getSetting("gbp_location_title");
  return { connected: !!refreshToken, locationName: locationName ?? undefined, locationTitle: locationTitle ?? undefined };
}

function parseGbpError(status: number, errText: string, context: string): Error {
  try {
    const errJson = JSON.parse(errText);
    const detail = (errJson?.error?.details ?? []).find((d: any) => d.reason === "SERVICE_DISABLED");
    if (detail?.metadata?.activationUrl) {
      return new Error(`SERVICE_DISABLED:${detail.metadata.activationUrl}`);
    }
    if (errJson?.error?.message) {
      return new Error(errJson.error.message);
    }
  } catch { /* not JSON — fall through */ }
  return new Error(`${context} error ${status}: ${errText}`);
}

// ── Shared in-memory cache for location list (5-min TTL) ─────────────────────
// Prevents multiple concurrent callers (reviews, settings page, social posts)
// from each hitting the low-quota Account Management API independently.
let _locationsCache: { locations: { name: string; title: string }[]; at: number } | null = null;
const LOCATIONS_TTL = 5 * 60_000;

export async function listGbpLocations(accessToken: string): Promise<{ name: string; title: string }[]> {
  const now = Date.now();
  if (_locationsCache && now - _locationsCache.at < LOCATIONS_TTL) {
    return _locationsCache.locations;
  }

  const accRes = await fetch(`${GBP_ACCOUNT_API}/accounts`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!accRes.ok) {
    throw parseGbpError(accRes.status, await accRes.text(), "GBP accounts API");
  }
  const accData: any = await accRes.json();
  const accounts: any[] = accData.accounts ?? [];
  const locations: { name: string; title: string }[] = [];
  for (const acc of accounts) {
    const locRes = await fetch(
      `${GBP_INFO_API}/${acc.name}/locations?readMask=name,title&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!locRes.ok) {
      throw parseGbpError(locRes.status, await locRes.text(), "GBP locations API");
    }
    const locData: any = await locRes.json();
    for (const loc of locData.locations ?? []) {
      locations.push({ name: loc.name, title: loc.title ?? loc.name });
    }
  }

  _locationsCache = { locations, at: now };
  return locations;
}

/** Invalidate the in-process locations cache (call after saving a new location). */
export function invalidateLocationsCache(): void {
  _locationsCache = null;
}


export async function publishGbpPost(locationName: string, accessToken: string, text: string, imageUrl?: string | null): Promise<{ ok: boolean; postName?: string; error?: string }> {
  const body: any = { topicType: "STANDARD", summary: text };
  if (imageUrl) body.media = [{ mediaFormat: "PHOTO", sourceUrl: imageUrl }];
  const res = await fetch(`${GBP_POST_API}/${locationName}/localPosts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: any = await res.json();
  if (!res.ok) return { ok: false, error: data.error?.message ?? `GBP API error ${res.status}` };
  return { ok: true, postName: data.name };
}

export async function disconnectGbp(): Promise<void> {
  for (const key of ["gbp_refresh_token", "gbp_access_token", "gbp_token_expires_at", "gbp_location_name", "gbp_location_title"]) {
    await setSetting(key, null);
  }
}
