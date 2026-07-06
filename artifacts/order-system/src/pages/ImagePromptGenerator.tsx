import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, X, Plus, Wand2, Copy, ImageIcon, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

export default function ImagePromptGenerator() {
  const { toast } = useToast();

  const [form, setForm] = useState({
    productName: "",
    garmentType: "",
    genderFit: "Unisex" as "Male" | "Female" | "Unisex",
    category: "Corporate" as "Trade" | "Corporate" | "Hospitality" | "Outerwear",
    heroColourway: "",
    availableColourways: [] as string[],
    logoText: "YOUR LOGO HERE",
    imageSize: "1000px x 1000px",
    notes: "",
  });
  const [newColour, setNewColour] = useState("");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<string | null>(null);

  const generateMut = useMutation({
    mutationFn: () => apiFetch<any>(`/image-prompt-generator/generate`, {
      method: "POST",
      body: JSON.stringify(form),
    }),
    onSuccess: (data: any) => {
      setPrompt(data.prompt || "");
      setImage(data.image ? `data:image/png;base64,${data.image}` : null);
      toast({ title: data.image ? "Image generated!" : "Prompt generated" });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to generate image", variant: "destructive" }),
  });

  const addColour = () => {
    const c = newColour.trim();
    if (!c) return;
    if (form.availableColourways.includes(c)) { setNewColour(""); return; }
    setForm(p => ({
      ...p,
      availableColourways: [...p.availableColourways, c],
      heroColourway: p.heroColourway || c,
    }));
    setNewColour("");
  };

  const canGenerate = !!form.productName && !!form.garmentType && !!form.heroColourway && form.availableColourways.length > 0;

  return (
    <Layout>
      <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-6 h-6 text-violet-500" /> Product Image Prompt Generator
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Build a Select Uniforms catalogue collage image — a large hero panel plus 8–10 candid thumbnails, tailored to your product's category and colourways.
          </p>
        </div>

        {/* Form card */}
        <div className="bg-card border border-border/50 rounded-lg p-6 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-500" /> Catalogue Collage Generator
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">Generate a catalogue collage image using AI — takes ~30 seconds</p>
            </div>
            <Button
              onClick={() => generateMut.mutate()}
              disabled={generateMut.isPending || !canGenerate}
              className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
            >
              {generateMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {generateMut.isPending ? "Generating image…" : "Generate Image"}
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Product Name */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Product Name *</Label>
              <Input value={form.productName} onChange={e => setForm(p => ({ ...p, productName: e.target.value }))} placeholder="e.g. Active Ladies Smash Polo" />
            </div>

            {/* Garment Type */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Garment Type *</Label>
              <Input value={form.garmentType} onChange={e => setForm(p => ({ ...p, garmentType: e.target.value }))} placeholder="e.g. polo shirt, fleece jacket, hi-vis vest" />
            </div>

            {/* Gender Fit */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Gender Fit</Label>
              <div className="flex gap-2">
                {(["Male", "Female", "Unisex"] as const).map(g => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, genderFit: g }))}
                    className={cn(
                      "flex-1 py-2 text-sm font-medium rounded-md border transition-colors",
                      form.genderFit === g
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {g === "Male" ? "👨 Male" : g === "Female" ? "👩 Female" : "👥 Unisex"}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Product Category</Label>
              <div className="grid grid-cols-2 gap-2">
                {(["Trade", "Corporate", "Hospitality", "Outerwear"] as const).map(cat => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setForm(p => ({ ...p, category: cat }))}
                    className={cn(
                      "py-2 text-sm font-medium rounded-md border transition-colors text-left px-3",
                      form.category === cat
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-background text-foreground border-border hover:bg-muted"
                    )}
                  >
                    {cat === "Trade" ? "🔧 Trade" : cat === "Corporate" ? "💼 Corporate" : cat === "Hospitality" ? "🏨 Hospitality" : "🧥 Outerwear"}
                  </button>
                ))}
              </div>
            </div>

            {/* Hero Colourway */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Hero Colourway * <span className="text-muted-foreground font-normal">(centre panel)</span></Label>
              <div className="flex gap-2">
                <Input value={form.heroColourway} onChange={e => setForm(p => ({ ...p, heroColourway: e.target.value }))} placeholder="e.g. Navy" className="flex-1" />
                {form.availableColourways.length > 0 && (
                  <Button type="button" variant="outline" size="sm" className="shrink-0 text-xs"
                    onClick={() => {
                      const others = form.availableColourways.filter(c => c !== form.heroColourway);
                      const pool = others.length > 0 ? others : form.availableColourways;
                      setForm(p => ({ ...p, heroColourway: pool[Math.floor(Math.random() * pool.length)] }));
                    }}>
                    🎲 Random
                  </Button>
                )}
              </div>
              {form.availableColourways.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {form.availableColourways.map(c => (
                    <button key={c} type="button" onClick={() => setForm(p => ({ ...p, heroColourway: c }))}
                      className={cn("text-xs px-2 py-0.5 rounded-full border transition-colors",
                        form.heroColourway === c ? "bg-violet-600 text-white border-violet-600" : "bg-muted text-muted-foreground border-border hover:bg-muted/80")}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Available Colourways */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Available Colourways *</Label>
              <div className="flex gap-2">
                <Input
                  value={newColour}
                  onChange={e => setNewColour(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addColour(); } }}
                  placeholder="Type a colour and press Enter"
                  className="flex-1"
                />
                <Button type="button" variant="outline" size="sm" onClick={addColour} className="shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 min-h-[36px] rounded-md border border-border bg-muted/30 px-3 py-2">
                {form.availableColourways.length === 0 && (
                  <span className="text-xs text-muted-foreground italic">Add all colourways this product is available in</span>
                )}
                {form.availableColourways.map(c => (
                  <span key={c} className="inline-flex items-center gap-1 text-xs bg-violet-100 text-violet-800 border border-violet-200 rounded-full px-2 py-0.5">
                    {c}
                    <button type="button" onClick={() => setForm(p => ({ ...p, availableColourways: p.availableColourways.filter(x => x !== c), heroColourway: p.heroColourway === c ? (p.availableColourways.filter(x => x !== c)[0] ?? "") : p.heroColourway }))} className="hover:text-red-600">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* Logo Text */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Logo Text <span className="text-muted-foreground font-normal">(left chest)</span></Label>
              <Input value={form.logoText} onChange={e => setForm(p => ({ ...p, logoText: e.target.value }))} placeholder="YOUR LOGO HERE" />
            </div>

            {/* Image Size */}
            <div className="grid gap-2">
              <Label className="text-sm font-medium">Image Size</Label>
              <div className="flex gap-2">
                {["1000px x 1000px", "1200px x 1200px", "800px x 800px"].map(sz => (
                  <button key={sz} type="button" onClick={() => setForm(p => ({ ...p, imageSize: sz }))}
                    className={cn("flex-1 py-2 text-xs font-medium rounded-md border transition-colors",
                      form.imageSize === sz ? "bg-violet-600 text-white border-violet-600" : "bg-background text-foreground border-border hover:bg-muted")}>
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="grid gap-2 md:col-span-2">
              <Label className="text-sm font-medium">Notes / Special Instructions</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="e.g. include a dog, outdoor summer setting, avoid construction helmets…" />
            </div>
          </div>
        </div>

        {/* Category environment preview */}
        <div className="bg-muted/40 border border-border/40 rounded-lg px-4 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">
              {form.category === "Trade" ? "🔧 Trade" : form.category === "Corporate" ? "💼 Corporate" : form.category === "Hospitality" ? "🏨 Hospitality" : "🧥 Outerwear"} environment:
            </span>{" "}
            {form.category === "Trade" && "Commercial vans, workshops, warehouses, construction sites, landscaping yards, delivery depots"}
            {form.category === "Corporate" && "Modern offices, hotel reception desks, conference rooms, golf days, business meetings"}
            {form.category === "Hospitality" && "Hotel lobbies, café counters, restaurant floors, event venues, customer-facing hospitality roles"}
            {form.category === "Outerwear" && "Outdoor construction sites, delivery routes, facilities management, spring and autumn site visits"}
          </p>
        </div>

        {/* Loading state */}
        {generateMut.isPending && (
          <div className="bg-card border border-violet-200 rounded-lg p-8 shadow-sm flex flex-col items-center gap-3 text-violet-700">
            <Loader2 className="w-8 h-8 animate-spin" />
            <p className="text-sm font-medium">Generating your catalogue image…</p>
            <p className="text-xs text-muted-foreground">This usually takes 20–40 seconds</p>
          </div>
        )}

        {/* Generated image output */}
        {image && !generateMut.isPending && (
          <div className="bg-card border border-violet-200 rounded-lg p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold flex items-center gap-2 text-violet-700">
                <Wand2 className="w-4 h-4" /> Generated Image
              </h4>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = image;
                    a.download = `${form.productName.replace(/\s+/g, "-") || "catalogue"}-collage.png`;
                    a.click();
                  }}>
                  ⬇ Download
                </Button>
              </div>
            </div>
            <img src={image} alt="Generated catalogue collage" className="w-full rounded-lg border border-violet-100 shadow-sm" />
            {prompt && (
              <details className="group">
                <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground select-none list-none flex items-center gap-1">
                  <span className="group-open:hidden">▶</span><span className="hidden group-open:inline">▼</span> View / copy prompt (for Midjourney, DALL-E, or ChatGPT image gen)
                </summary>
                <div className="mt-2 space-y-2">
                  <Textarea rows={8} value={prompt} onChange={e => setPrompt(e.target.value)} className="font-mono text-xs leading-relaxed bg-muted/30 resize-y" />
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs border-violet-300 text-violet-700 hover:bg-violet-50"
                    onClick={() => { navigator.clipboard.writeText(prompt); toast({ title: "Copied to clipboard" }); }}>
                    <Copy className="w-3.5 h-3.5" /> Copy prompt
                  </Button>
                </div>
              </details>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
