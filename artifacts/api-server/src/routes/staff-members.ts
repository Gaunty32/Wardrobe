import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, staffMembersTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

router.get("/staff", async (_req, res): Promise<void> => {
  const members = await db.select().from(staffMembersTable).orderBy(staffMembersTable.name);
  res.json(members);
});

router.post("/staff", async (req, res): Promise<void> => {
  const body = z.object({
    name: z.string().min(1),
    role: z.string().nullish(),
    profileImageUrl: z.string().nullish(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const [member] = await db.insert(staffMembersTable).values({
    name: body.data.name,
    role: body.data.role ?? null,
    profileImageUrl: body.data.profileImageUrl ?? null,
  }).returning();
  res.json(member);
});

router.patch("/staff/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const body = z.object({
    name: z.string().min(1).optional(),
    role: z.string().nullish(),
    profileImageUrl: z.string().nullish(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }
  const update: Record<string, unknown> = {};
  if (body.data.name !== undefined) update.name = body.data.name;
  if ("role" in req.body) update.role = body.data.role ?? null;
  if ("profileImageUrl" in req.body) update.profileImageUrl = body.data.profileImageUrl ?? null;
  const [member] = await db.update(staffMembersTable).set(update).where(eq(staffMembersTable.id, id)).returning();
  if (!member) { res.status(404).json({ error: "Not found" }); return; }
  res.json(member);
});

router.delete("/staff/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(staffMembersTable).where(eq(staffMembersTable.id, id));
  res.status(204).end();
});

router.post("/staff/rewrite-quote", async (req, res): Promise<void> => {
  const body = z.object({
    draft: z.string().min(1),
    staffName: z.string(),
    productName: z.string().optional(),
  }).safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const baseUrl = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseUrl || !apiKey) { res.status(503).json({ error: "AI not configured" }); return; }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-5-mini",
      messages: [
        {
          role: "system",
          content: `You are writing in the voice of ${body.data.staffName}, a member of staff at Select Branding Solutions (SBS), a UK workwear and uniform supplier. Rewrite the draft as a genuine, warm, first-person recommendation — friendly and natural, 2–3 sentences max. Return only the quote text itself, with no quotation marks and no preamble.`,
        },
        {
          role: "user",
          content: `${body.data.productName ? `Product: ${body.data.productName}\n\n` : ""}Draft: ${body.data.draft}`,
        },
      ],
      max_tokens: 200,
    }),
  });

  if (!response.ok) { res.status(502).json({ error: "AI request failed" }); return; }
  const data = await response.json() as any;
  const rewritten = (data.choices?.[0]?.message?.content ?? "").trim() || body.data.draft;
  res.json({ rewritten });
});

export default router;
