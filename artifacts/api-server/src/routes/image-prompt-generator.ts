import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const router: IRouter = Router();

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || "dummy",
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

// ─── Standalone Select Uniforms catalogue image prompt generator ─────────────
// Not tied to a specific product record — a general-purpose tool for staff to
// build the agreed Select Uniforms composite catalogue prompt from scratch.

router.post("/image-prompt-generator/generate", async (req: Request, res: Response): Promise<void> => {
  const bodyParse = z.object({
    productName: z.string().min(1),
    garmentType: z.string().min(1),
    genderFit: z.enum(["Male", "Female", "Unisex"]),
    category: z.enum(["Trade", "Corporate", "Hospitality", "Outerwear"]),
    heroColourway: z.string().min(1),
    availableColourways: z.array(z.string()).min(1),
    logoText: z.string().min(1).default("YOUR LOGO HERE"),
    imageSize: z.string().default("1000px x 1000px"),
    notes: z.string().optional(),
  }).safeParse(req.body);

  if (!bodyParse.success) { res.status(400).json({ error: bodyParse.error.message }); return; }
  const { productName, garmentType, genderFit, category, heroColourway, availableColourways, logoText, imageSize, notes } = bodyParse.data;

  const categoryEnvs: Record<string, string> = {
    Trade: "commercial vans, workshops, warehouses, construction sites, landscaping yards, delivery depots",
    Corporate: "modern offices, hotel reception desks, conference rooms, golf days, business meetings",
    Hospitality: "hotel lobbies, café counters, restaurant floors, event venues, customer-facing hospitality settings",
    Outerwear: "outdoor construction sites, delivery routes, facilities management sites, spring and autumn site visits",
  };

  const genderRules: Record<string, string> = {
    Male: "ALL models must be male. No female models. Varied ages (20s–50s), ethnicities, body types and hairstyles.",
    Female: "ALL models must be female. No male models. Varied ages (20s–50s), ethnicities, body types and hairstyles.",
    Unisex: "Mix of male and female models. Varied ages (20s–50s), ethnicities, body types and hairstyles.",
  };

  // Thumbnail colourways excluding the hero (used in surrounding panels)
  const thumbColours = availableColourways.filter(c => c.toLowerCase() !== heroColourway.toLowerCase());
  const thumbColourList = thumbColours.length > 0 ? thumbColours.join(", ") : availableColourways.join(", ");

  const metaPrompt = `You are a commercial catalogue photography art director for Select Uniforms, a UK branded workwear company. Your task is to write a single precise image generation prompt (for Midjourney or DALL-E) that will produce a composite catalogue hero image for the product described below.

PRODUCT:
- Name: ${productName}
- Garment type: ${garmentType}
- Gender fit: ${genderFit}
- Category: ${category}
- Hero (centre) colourway: ${heroColourway}
- All available colourways: ${availableColourways.join(", ")}
- Thumbnail colourways (exclude hero): ${thumbColourList}
- Logo: a distinctive small circular multi-coloured logo emblem with the text "${logoText}" in bold clean sans-serif lettering directly beneath/beside it, embroidered/printed on LEFT CHEST of every garment
- Output size: ${imageSize}
${notes ? `- Special instructions: ${notes}` : ""}

LAYOUT YOU MUST DESCRIBE:
The image is a single ${imageSize} PHOTO COLLAGE composite, styled like a modern editorial mood-board — NOT a uniform grid. Panels vary in size and orientation (mix of portrait and landscape rectangles plus some squares), arranged tightly together collage-style with a large hero panel positioned centrally among the smaller panels.

1. LARGE HERO PANEL (~50–60% of image area, positioned centrally, larger than every other panel):
   - ${genderRules[genderFit]}
   - 4–6 people wearing the ${heroColourway} ${garmentType}, standing together as a group
   - No cloned or duplicated faces or people — every person is unique in face, hair, and build
   - Realistic ${category} workplace environment: ${categoryEnvs[category]}
   - Logo emblem + "${logoText}" text clearly visible on LEFT CHEST of each garment
   - Commercial catalogue photography: natural lighting, professional poses, product clearly visible
   - People are standing or lightly interacting, not obscuring each other's garments

2. SURROUNDING THUMBNAIL PANELS (8–10 panels of varying sizes and portrait/landscape orientations, tightly collaged around the hero panel):
   - One person per thumbnail, one unique colourway per thumbnail from: ${thumbColourList}
   - Do NOT invent any colour not in the above list
   - Each thumbnail shows a different realistic candid moment or activity within the ${category} environment (e.g. greeting someone, on the phone, at a laptop, writing notes, holding a coffee, in conversation) — natural, documentary-style candid framing, not static posed headshots
   - No text labels, no colour names overlaid on images
   - Same commercial photography style, lighting and colour grading as hero — product remains the hero of every panel
   - Logo emblem + "${logoText}" text on LEFT CHEST visible in each thumbnail

3. TECHNICAL REQUIREMENTS:
   - ${imageSize} total output
   - Rounded corners on every panel
   - Clean white gutters/spacing between all panels (like a professional garment catalogue collage page)
   - Panels are NOT uniform in size — deliberate variety of portrait, landscape and square panels collaged together
   - No cloned faces anywhere in the image
   - Only use the colourways listed — no invented extras
   - Ultra-realistic commercial catalogue photography quality throughout, consistent warm natural colour grading across every panel

Write ONLY the image generation prompt text — no preamble, no explanation, no headings. Just the prompt, ready to paste directly into gpt-image-1 / ChatGPT image generation.`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 1500,
    messages: [{ role: "user", content: metaPrompt }],
  });

  const content = message.content[0];
  const generatedPrompt = content.type === "text" ? content.text.trim() : "";

  // Generate the actual image via OpenAI gpt-image-1
  const { generateImageBuffer } = await import("@workspace/integrations-openai-ai-server/image");
  const sizeMap: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
    "1000px x 1000px": "1024x1024",
    "1200px x 1200px": "1024x1024",
    "800px x 800px": "1024x1024",
  };
  const gpSize = sizeMap[imageSize] ?? "1024x1024";
  const imageBuffer = await generateImageBuffer(generatedPrompt, gpSize);

  res.json({ prompt: generatedPrompt, image: imageBuffer.toString("base64") });
});

export default router;
