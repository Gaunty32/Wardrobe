import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, ArrowRight, Plus, Minus, Trash2, Loader2,
  Shirt, ShoppingBag, CheckCircle2, Search, ChevronDown, ChevronUp,
  User, Package, History, Tag, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type OrderItem = {
  productId: number | null;
  productName: string;
  colour: string;
  size: string;
  finishId: number | null;
  finishName: string;
  recipientType: "stock" | "person";
  recipientName: string;
  recipientEmployeeId: number | null;
  quantity: number;
  unitPrice: number;
};

const EMPTY_ITEM: OrderItem = {
  productId: null,
  productName: "",
  colour: "",
  size: "",
  finishId: null,
  finishName: "",
  recipientType: "stock",
  recipientName: "",
  recipientEmployeeId: null,
  quantity: 1,
  unitPrice: 0,
};

// ─── Step indicator ──────────────────────────────────────────────────────────

function Steps({ current, steps }: { current: number; steps: string[] }) {
  return (
    <ol className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {steps.map((label, i) => (
        <li key={i} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors",
              i < current ? "bg-primary text-primary-foreground" :
              i === current ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
              "bg-muted text-muted-foreground"
            )}>
              {i < current ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={cn(
              "text-sm font-medium whitespace-nowrap",
              i === current ? "text-foreground" : "text-muted-foreground"
            )}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("h-px w-8 mx-2 shrink-0", i < current ? "bg-primary" : "bg-border")} />
          )}
        </li>
      ))}
    </ol>
  );
}

// ─── Step 1: Mode ────────────────────────────────────────────────────────────

function ModeStep({ onSelect }: { onSelect: (mode: "wardrobe" | "catalogue") => void }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">How would you like to order?</h2>
      <p className="text-muted-foreground text-sm mb-6">Order from your preset wardrobe for named individuals, or place a bulk stock order.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("wardrobe")}
        >
          <CardContent className="py-6 px-6 flex flex-col gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Shirt className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">My Wardrobe</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-3">
                Order from your pre-configured branded garments — assign to named individuals or order as bulk stock.
              </p>
              <ul className="space-y-1.5">
                {[
                  { icon: User, text: "Each order packed & labelled per person" },
                  { icon: History, text: "Smart size suggestions from past orders" },
                  { icon: Tag, text: "Full order history per employee" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("catalogue")}
        >
          <CardContent className="py-6 px-6 flex flex-col gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Package className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Bulk / General Order</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-3">
                Browse the full product range and order by size and quantity — ideal for topping up stock.
              </p>
              <ul className="space-y-1.5">
                {[
                  { icon: Package, text: "e.g. 10 × Medium polo shirts to stock" },
                  { icon: ShoppingBag, text: "No individual name allocation" },
                  { icon: Tag, text: "Full product catalogue available" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Inspiration nudge */}
      <div className="mt-5 flex items-center gap-2.5 text-sm text-muted-foreground">
        <Sparkles className="w-4 h-4 text-primary/60 shrink-0" />
        <span>
          Looking for inspiration or a refresh?{" "}
          <Link href="/products" className="text-primary font-medium hover:underline underline-offset-2">
            Browse our products
          </Link>{" "}
          and see if something catches your eye.
        </span>
      </div>
    </div>
  );
}

// ─── Step 2a: Wardrobe ───────────────────────────────────────────────────────

function BulkRow({ onAdd }: { onAdd: (qty: number, size: string) => void }) {
  const [size, setSize] = useState("");
  const [qty, setQty] = useState(1);
  return (
    <div className="flex items-center gap-2 mt-2">
      <Input
        className="h-8 text-sm w-24"
        placeholder="Size (e.g. M)"
        value={size}
        onChange={e => setSize(e.target.value)}
      />
      <div className="flex items-center border rounded-md h-8">
        <button
          className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setQty(q => Math.max(1, q - 1))}
        >
          <Minus className="w-3 h-3" />
        </button>
        <span className="w-8 text-center text-sm font-medium">{qty}</span>
        <button
          className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setQty(q => q + 1)}
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <Button
        size="sm"
        className="h-8 text-xs"
        disabled={!size.trim()}
        onClick={() => { onAdd(qty, size.trim()); setSize(""); setQty(1); }}
      >
        Add to order
      </Button>
    </div>
  );
}

function WardrobeStep({ items, employees, lastSizes, basket, setBasket, onNext }: {
  items: any[];
  employees: any[];
  lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onNext: () => void;
}) {
  const [, setLocation] = useLocation();

  const finishGroups = Object.values(
    items.reduce((acc: any, item: any) => {
      const fid = item.finish_id ?? 0;
      if (!acc[fid]) acc[fid] = { finish_id: fid, finish_name: item.finish_name ?? "Standard", items: [] };
      acc[fid].items.push(item);
      return acc;
    }, {})
  ) as Array<{ finish_id: number; finish_name: string; items: any[] }>;

  const getLastSize = (wi: any, employeeId: number): string | null => {
    const empSizes = lastSizes[String(employeeId)];
    if (!empSizes) return null;
    if (wi.product_id && empSizes[String(wi.product_id)]) return empSizes[String(wi.product_id)].size;
    const name = wi.product_name ?? wi.name;
    if (name && empSizes[name]) return empSizes[name].size;
    return null;
  };

  const makeItem = (wi: any, recipientType: "stock" | "person", employee?: any, qty = 1, sizeOverride?: string): OrderItem => ({
    productId: wi.product_id ?? null,
    productName: wi.product_name ?? wi.name,
    colour: wi.colour ?? "",
    size: sizeOverride ?? (employee ? (getLastSize(wi, employee.id) ?? wi.size ?? "") : (wi.size ?? "")),
    finishId: wi.finish_id ?? null,
    finishName: wi.finish_name ?? "",
    recipientType,
    recipientName: employee ? `${employee.first_name} ${employee.last_name}` : "",
    recipientEmployeeId: employee?.id ?? null,
    quantity: qty,
    unitPrice: parseFloat(wi.special_price ?? wi.unit_price ?? "0"),
  });

  // ── Empty state ────────────────────────────────────────────────────────────
  if (finishGroups.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-2">My Wardrobe</h2>
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Shirt className="w-7 h-7 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Your wardrobe isn't set up yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
              Contact Select Branding Solutions to get your branded garments configured.
              Once set up, your wardrobe unlocks some powerful features:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-left max-w-xl mx-auto">
              {[
                { icon: User, title: "Named packing", desc: "Every order comes back in individual packs labelled for each team member — ready to hand out." },
                { icon: History, title: "Size memory", desc: "The system remembers each person's last ordered size and suggests it automatically next time." },
                { icon: Tag, title: "Usage reports", desc: "Full order history per employee so you can track spend, sizes and reorder dates at a glance." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">{title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={() => setLocation("/wardrobe")}>View My Wardrobe</Button>
              <Button asChild>
                <a href="mailto:hello@selectbranding.co.uk">Contact SBS to set up</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Wardrobe items ─────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">My Wardrobe</h2>
      <p className="text-muted-foreground text-sm mb-5">
        Order for named individuals (packed &amp; labelled per person) or add as bulk stock — your choice per item.
      </p>

      <div className="flex flex-col gap-5">
        {finishGroups.map((group) => (
          <div key={group.finish_id}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
              <Shirt className="w-3.5 h-3.5" /> {group.finish_name}
            </p>
            <div className="flex flex-col gap-3">
              {group.items.map((wi: any, i: number) => {
                const price = parseFloat(wi.special_price ?? wi.unit_price ?? "0");
                return (
                  <Card key={i} className="overflow-hidden">
                    {/* Item header */}
                    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-muted/30 border-b">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{wi.product_name ?? wi.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {[wi.colour, wi.role_name].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      {price > 0 && (
                        <span className="text-sm font-bold text-primary shrink-0">{formatCurrency(price)}</span>
                      )}
                    </div>

                    <div className="divide-y">
                      {/* ── Named individual section ── */}
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <User className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground">Order for a named individual</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">
                          Packed and labelled for each person — builds their size history automatically.
                        </p>
                        {employees.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic">
                            No employees set up yet.{" "}
                            <button className="underline underline-offset-2 hover:text-foreground" onClick={() => setLocation("/team")}>
                              Add team members
                            </button>{" "}
                            to order for individuals.
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {employees.map((emp: any) => {
                              const lastSize = getLastSize(wi, emp.id);
                              return (
                                <button
                                  key={emp.id}
                                  onClick={() => setBasket(b => [...b, makeItem(wi, "person", emp)])}
                                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:border-primary hover:bg-primary/5 transition-all group"
                                >
                                  <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-[9px] font-bold text-primary shrink-0 group-hover:bg-primary/20">
                                    {emp.first_name?.[0]}{emp.last_name?.[0]}
                                  </div>
                                  <span className="font-medium">{emp.first_name} {emp.last_name}</span>
                                  {lastSize ? (
                                    <span className="ml-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">
                                      Last: {lastSize}
                                    </span>
                                  ) : (
                                    <span className="ml-0.5 text-[10px] text-muted-foreground/60 italic">no history</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* ── Bulk / stock section ── */}
                      <div className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Package className="w-3.5 h-3.5 text-muted-foreground" />
                          <span className="text-xs font-semibold text-foreground">Bulk / Stock order</span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">
                          No name allocation — items go straight to stock. Enter size and quantity.
                        </p>
                        <BulkRow onAdd={(qty, size) => setBasket(b => [...b, makeItem(wi, "stock", undefined, qty, size)])} />
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {basket.length > 0 && (
        <div className="sticky bottom-0 mt-6 bg-background border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{basket.length} item{basket.length !== 1 ? "s" : ""} added</span>
            <Button onClick={onNext}>Review order <ArrowRight className="w-4 h-4 ml-1.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 2b: Catalogue ──────────────────────────────────────────────────────

function CatalogueStep({ basket, setBasket, onNext }: {
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onNext: () => void;
}) {
  const [search, setSearch] = useState("");
  const [draftItem, setDraftItem] = useState<Partial<OrderItem>>({ ...EMPTY_ITEM });
  const [showAdd, setShowAdd] = useState(false);

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-products", search],
    queryFn: () => apiFetch(`/portal/products?search=${encodeURIComponent(search)}`),
  });

  const handleAddProduct = (p: any) => {
    setDraftItem({ ...EMPTY_ITEM, productId: p.id, productName: p.name, unitPrice: parseFloat(p.unit_price ?? "0") });
    setShowAdd(true);
  };

  const addToBasket = () => {
    if (!draftItem.productName) return;
    setBasket(b => [...b, { ...EMPTY_ITEM, ...draftItem, quantity: draftItem.quantity ?? 1 } as OrderItem]);
    setShowAdd(false);
    setDraftItem({ ...EMPTY_ITEM });
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Browse catalogue</h2>
      <p className="text-muted-foreground text-sm mb-4">Search and add products to your order.</p>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {products.map((p: any) => (
            <Card key={p.id} className="hover:border-primary/40 transition-colors">
              <CardContent className="py-3 px-4 flex items-center gap-3">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-10 h-10 rounded object-cover shrink-0 bg-muted" />
                ) : (
                  <div className="w-10 h-10 rounded bg-muted shrink-0 flex items-center justify-center">
                    <ShoppingBag className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.sku}</p>
                  <p className="text-xs font-medium text-primary">{formatCurrency(p.unit_price)}</p>
                </div>
                <Button size="sm" variant="outline" className="shrink-0 gap-1 h-7 text-xs" onClick={() => handleAddProduct(p)}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add item panel */}
      {showAdd && (
        <Card className="mb-4 border-primary/30">
          <CardHeader className="py-3 px-5 border-b">
            <CardTitle className="text-sm">Configure: {draftItem.productName}</CardTitle>
          </CardHeader>
          <CardContent className="py-4 px-5 grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Colour</Label>
              <Input value={draftItem.colour ?? ""} onChange={e => setDraftItem(d => ({ ...d, colour: e.target.value }))} placeholder="e.g. Navy" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Size</Label>
              <Input value={draftItem.size ?? ""} onChange={e => setDraftItem(d => ({ ...d, size: e.target.value }))} placeholder="e.g. M" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Unit price (£)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={draftItem.unitPrice ?? 0}
                onChange={e => setDraftItem(d => ({ ...d, unitPrice: parseFloat(e.target.value) || 0 }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number" min="1"
                value={draftItem.quantity ?? 1}
                onChange={e => setDraftItem(d => ({ ...d, quantity: parseInt(e.target.value) || 1 }))}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">For</Label>
              <Select value={draftItem.recipientType ?? "stock"} onValueChange={v => setDraftItem(d => ({ ...d, recipientType: v as "stock" | "person", recipientName: v === "stock" ? "" : d.recipientName }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="person">Named person</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draftItem.recipientType === "person" && (
              <div className="space-y-1">
                <Label className="text-xs">Person name</Label>
                <Input value={draftItem.recipientName ?? ""} onChange={e => setDraftItem(d => ({ ...d, recipientName: e.target.value }))} placeholder="Full name" className="h-8 text-sm" />
              </div>
            )}
            <div className="col-span-2 flex gap-2 justify-end pt-1">
              <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" onClick={addToBasket} disabled={!draftItem.productName}>Add to order</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {basket.length > 0 && (
        <div className="sticky bottom-0 bg-background border-t pt-4 mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{basket.length} item{basket.length !== 1 ? "s" : ""} in order</span>
            <Button onClick={onNext}>Review order <ArrowRight className="w-4 h-4 ml-1.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Review & Submit ─────────────────────────────────────────────────

function ReviewStep({ basket, setBasket, onSubmit, submitting, portalRole }: {
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onSubmit: (data: { requiredDate: string; notes: string }) => void;
  submitting: boolean;
  portalRole: string;
}) {
  const [requiredDate, setRequiredDate] = useState("");
  const [notes, setNotes] = useState("");

  const total = basket.reduce((s, i) => s + i.quantity * i.unitPrice, 0);

  const updateQty = (idx: number, delta: number) => {
    setBasket(b => b.map((item, i) => i === idx ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
  };
  const removeItem = (idx: number) => setBasket(b => b.filter((_, i) => i !== idx));

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Review your order</h2>
      <p className="text-muted-foreground text-sm mb-6">Check everything looks right before submitting.</p>

      <Card className="mb-5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {basket.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium text-sm">{item.productName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.recipientName || (item.recipientType === "stock" ? "Stock" : "—")}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => updateQty(idx, -1)}><Minus className="w-3 h-3" /></button>
                        <span className="w-6 text-center text-sm font-medium">{item.quantity}</span>
                        <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => updateQty(idx, 1)}><Plus className="w-3 h-3" /></button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-sm">{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">{formatCurrency(item.quantity * item.unitPrice)}</TableCell>
                    <TableCell>
                      <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t px-5 py-3 flex justify-end gap-6">
            <span className="text-muted-foreground text-sm">Order total</span>
            <span className="font-bold">{formatCurrency(total)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="reqdate">Required by (optional)</Label>
          <Input id="reqdate" type="date" value={requiredDate} onChange={e => setRequiredDate(e.target.value)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes for our team (optional)</Label>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions, delivery notes, etc." rows={3} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Button onClick={() => onSubmit({ requiredDate, notes })} disabled={submitting || basket.length === 0} className="w-full sm:w-auto">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {portalRole === "manager" ? "Submit order to SBS" : "Save for manager review"}
        </Button>
        {portalRole !== "manager" && (
          <p className="text-xs text-muted-foreground">Your manager will review and submit this order to SBS.</p>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Confirmation ────────────────────────────────────────────────────

function ConfirmStep({ orderNumber, onViewOrder }: { orderNumber: string; onViewOrder: () => void }) {
  return (
    <div className="text-center py-10">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <CheckCircle2 className="w-8 h-8 text-green-600" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Order submitted!</h2>
      <p className="text-muted-foreground mb-1">Your order <span className="font-semibold text-foreground">{orderNumber}</span> has been submitted for review.</p>
      <p className="text-sm text-muted-foreground mb-8">We'll be in touch shortly to confirm your order.</p>
      <Button onClick={onViewOrder}>View order details <ArrowRight className="w-4 h-4 ml-1.5" /></Button>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function NewOrder() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { portalRole } = useAuth();

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"wardrobe" | "catalogue" | null>(null);
  const [basket, setBasket] = useState<OrderItem[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<{ id: number; orderNumber: string } | null>(null);

  const { data: wardrobe } = useQuery<{
    items: any[];
    employees: any[];
    lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
  }>({
    queryKey: ["portal-wardrobe"],
    queryFn: () => apiFetch("/portal/wardrobe"),
    enabled: mode === "wardrobe",
  });

  const submitMutation = useMutation({
    mutationFn: (data: { requiredDate: string; notes: string }) =>
      apiFetch("/portal/orders", {
        method: "POST",
        body: JSON.stringify({
          requiredDate: data.requiredDate || undefined,
          portalNotes: data.notes || undefined,
          items: basket.map(i => ({
            productId: i.productId,
            productName: i.productName,
            colour: i.colour || undefined,
            size: i.size || undefined,
            finishId: i.finishId || undefined,
            finishName: i.finishName || undefined,
            recipientType: i.recipientType,
            recipientName: i.recipientName || undefined,
            recipientEmployeeId: i.recipientEmployeeId || undefined,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        }),
      }),
    onSuccess: (data) => {
      setConfirmedOrder(data);
      setStep(3);
    },
    onError: () => {
      toast({ title: "Failed to submit order", description: "Please try again.", variant: "destructive" });
    },
  });

  const STEPS = ["Choose type", mode === "wardrobe" ? "Wardrobe" : "Catalogue", "Review", "Done"];

  const handleModeSelect = (m: "wardrobe" | "catalogue") => {
    setMode(m);
    setStep(1);
  };

  return (
    <PortalLayout>
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to orders
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New Order</h1>
      </div>

      <Steps current={step} steps={STEPS} />

      {step === 0 && <ModeStep onSelect={handleModeSelect} />}

      {step === 1 && mode === "wardrobe" && (
        <WardrobeStep
          items={wardrobe?.items ?? []}
          employees={wardrobe?.employees ?? []}
          lastSizes={wardrobe?.lastSizes ?? {}}
          basket={basket}
          setBasket={setBasket}
          onNext={() => setStep(2)}
        />
      )}

      {step === 1 && mode === "catalogue" && (
        <CatalogueStep basket={basket} setBasket={setBasket} onNext={() => setStep(2)} />
      )}

      {step === 2 && (
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground" onClick={() => setStep(1)}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <ReviewStep
            basket={basket}
            setBasket={setBasket}
            onSubmit={(d) => submitMutation.mutate(d)}
            submitting={submitMutation.isPending}
            portalRole={portalRole}
          />
        </div>
      )}

      {step === 3 && confirmedOrder && (
        <ConfirmStep
          orderNumber={confirmedOrder.orderNumber}
          onViewOrder={() => setLocation(`/orders/${confirmedOrder.id}`)}
        />
      )}
    </PortalLayout>
  );
}
