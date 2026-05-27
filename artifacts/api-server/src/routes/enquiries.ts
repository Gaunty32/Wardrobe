import { Router, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

const TARGET_TAGS = ["telephone enquiry", "website lead", "showroom contact"];

// ─── List cached enquiries ────────────────────────────────────────────────────
router.get("/enquiries", async (_req, res: Response): Promise<void> => {
  const rows = await db.execute(sql`
    SELECT id, hl_contact_id, name, email, phone, source_tag, last_synced_at, created_at
    FROM enquiries
    ORDER BY name ASC
  `);
  res.json(rows.rows);
});

// ─── Sync from High Level ─────────────────────────────────────────────────────
router.post("/enquiries/sync", async (_req, res: Response): Promise<void> => {
  const settingsRows = await db.execute(sql`
    SELECT key, value FROM settings
    WHERE key IN ('high_level_api_key', 'high_level_location_id')
  `);

  const settingsMap = Object.fromEntries(
    (settingsRows.rows as any[]).map((r) => [r.key, r.value])
  );

  const apiKey: string | undefined = settingsMap["high_level_api_key"];
  const locationId: string | undefined = settingsMap["high_level_location_id"];

  if (!apiKey) {
    res.status(400).json({ error: "High Level API key not configured — go to Settings → High Level to add it." });
    return;
  }
  if (!locationId) {
    res.status(400).json({ error: "High Level Location ID not configured — go to Settings → High Level to add it." });
    return;
  }

  const contactMap = new Map<string, {
    id: string; name: string; email: string | null; phone: string | null; sourceTag: string;
  }>();

  let nextUrl: string | null =
    `https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(locationId)}&limit=100`;
  let pages = 0;
  const MAX_PAGES = 20;

  while (nextUrl && pages < MAX_PAGES) {
    const hlRes = await fetch(nextUrl, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Version": "2021-07-28",
      },
    });

    if (!hlRes.ok) {
      const text = await hlRes.text().catch(() => "");
      res.status(502).json({ error: `High Level API error ${hlRes.status}: ${text.slice(0, 300)}` });
      return;
    }

    const data = await hlRes.json();
    const contacts: any[] = data.contacts ?? [];

    for (const c of contacts) {
      const contactTags: string[] = (c.tags ?? []).map((t: string) => t.toLowerCase().trim());
      const matchingTag = TARGET_TAGS.find((t) => contactTags.includes(t));
      if (matchingTag && !contactMap.has(c.id)) {
        const nameParts = [c.firstName, c.lastName].filter(Boolean);
        const name =
          nameParts.length > 0 ? nameParts.join(" ") : (c.email ?? c.phone ?? "Unknown");
        contactMap.set(c.id, {
          id: c.id,
          name,
          email: c.email ?? null,
          phone: c.phone ?? null,
          sourceTag: matchingTag,
        });
      }
    }

    nextUrl = data.meta?.nextPageUrl ?? null;
    pages++;
  }

  let synced = 0;
  for (const contact of contactMap.values()) {
    await db.execute(sql`
      INSERT INTO enquiries (hl_contact_id, name, email, phone, source_tag, last_synced_at)
      VALUES (
        ${contact.id},
        ${contact.name},
        ${contact.email},
        ${contact.phone},
        ${contact.sourceTag},
        now()
      )
      ON CONFLICT (hl_contact_id) DO UPDATE SET
        name           = EXCLUDED.name,
        email          = EXCLUDED.email,
        phone          = EXCLUDED.phone,
        source_tag     = EXCLUDED.source_tag,
        last_synced_at = now()
    `);
    synced++;
  }

  res.json({ synced, pages });
});

export default router;
