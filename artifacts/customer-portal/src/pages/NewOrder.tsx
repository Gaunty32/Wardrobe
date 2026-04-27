import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { sortSizes } from "@/lib/sizeUtils";
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
  Shirt, ShoppingBag, CheckCircle2, Search,
  User, Package, History, Tag, Sparkles, Heart, X, Mail,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function ProcessImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
        <Shirt className="w-5 h-5 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="h-10 w-10 rounded object-contain bg-white border shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

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
      <p className="text-muted-foreground text-sm mb-6">
        Place an order from your pre-configured wardrobe, or send us a wishlist and we'll turn it into a quote.
      </p>
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
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Looking for Inspiration</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-3">
                Browse our range, pick what catches your eye, and tell us the colours and decoration styles you'd love.
                We'll review your wishlist and build a wardrobe quote.
              </p>
              <ul className="space-y-1.5">
                {[
                  { icon: Heart, text: "Add products to a wishlist — no sizes needed" },
                  { icon: Tag, text: "Tell us your preferred colours & decoration" },
                  { icon: Mail, text: "We'll come back with a tailored quote" },
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
    </div>
  );
}

// ─── Step 2a: Wardrobe ───────────────────────────────────────────────────────


function ProcessBadgeInline({ type }: { type: string }) {
  const colours: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700 border-purple-200",
    print: "bg-blue-100 text-blue-700 border-blue-200",
    dtf: "bg-cyan-100 text-cyan-700 border-cyan-200",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    heat_transfer: "bg-orange-100 text-orange-700 border-orange-200",
  };
  const cls = colours[type?.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>
      {type?.replace(/_/g, " ")}
    </span>
  );
}

type ItemState = { sel: string | null; size: string; qty: number };

function WardrobeStep({ items, employees, lastSizes, sizesMap, basket, setBasket, onNext, processes }: {
  items: any[];
  employees: any[];
  lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
  sizesMap: Record<string, Record<string, string[]>>;
  processes: any[];
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onNext: () => void;
}) {
  const [, setLocation] = useLocation();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});

  const getItemState = (key: string): ItemState =>
    itemStates[key] ?? { sel: null, size: "", qty: 1 };
  const setItemState = (key: string, patch: Partial<ItemState>) =>
    setItemStates(s => ({ ...s, [key]: { ...getItemState(key), ...patch } }));

  // Group items by finish
  const finishGroups = Object.values(
    items.reduce((acc: any, item: any) => {
      const fid = item.finish_id ?? 0;
      if (!acc[fid]) acc[fid] = {
        finish_id: fid,
        finish_name: item.finish_name ?? null,
        finish_code: item.finish_code ?? null,
        items: [],
      };
      acc[fid].items.push(item);
      return acc;
    }, {})
  ) as Array<{ finish_id: number; finish_name: string | null; finish_code: string | null; items: any[] }>;

  // Attach processes to each group
  const groupProcesses = (finishId: number) =>
    processes.filter(p => p.finish_id === finishId);

  const getLastSize = (wi: any, employeeId: number): string | null => {
    const empSizes = lastSizes[String(employeeId)];
    if (!empSizes) return null;
    if (wi.product_id && empSizes[String(wi.product_id)]) return empSizes[String(wi.product_id)].size;
    const name = wi.product_name ?? wi.name;
    if (name && empSizes[name]) return empSizes[name].size;
    return null;
  };

  const getAvailableSizes = (wi: any): string[] => {
    if (!sizesMap || !wi.product_id) return [];
    const byColour = sizesMap[String(wi.product_id)];
    if (!byColour) return [];
    const colour = wi.colour?.trim();
    // Try exact colour match, then case-insensitive, then all sizes for product
    const exactMatch = colour ? byColour[colour] : null;
    if (exactMatch?.length) return sortSizes(exactMatch);
    if (colour) {
      const ciMatch = Object.entries(byColour).find(([k]) => k.toLowerCase() === colour.toLowerCase());
      if (ciMatch?.[1]?.length) return sortSizes(ciMatch[1]);
    }
    // fallback: all sizes for this product
    const all = [...new Set(Object.values(byColour).flat())];
    return sortSizes(all);
  };

  // Returns the unit price after applying quantity-based price breaks and finish process costs.
  // Formula: WooCommerce garment price + (sum of all process prices - cheapest process price)
  // WooCommerce price already includes the cheapest/first logo; extra logos are additive.
  // If special_price is set for this customer, that takes precedence.
  const resolveUnitPrice = (wi: any, qty: number): number => {
    if (wi.special_price != null && wi.special_price !== "") {
      return parseFloat(wi.special_price);
    }
    // Use the WooCommerce base garment price (woo_price) for the calculation.
    // Fall back to unit_price if woo_price is not available.
    const wooBase = parseFloat(wi.woo_price ?? wi.unit_price ?? "0");
    const breaks: { qty: number; price: number }[] = Array.isArray(wi.price_breaks) ? wi.price_breaks : [];
    const sorted = [...breaks].sort((a, b) => b.qty - a.qty);
    const garmentPrice = breaks.length > 0
      ? (sorted.find(pb => qty >= pb.qty)?.price ?? wooBase)
      : wooBase;

    // Add finish decoration costs (all processes in the finish minus the cheapest one,
    // because the cheapest is already baked into the WooCommerce garment price).
    const finishProcs = processes.filter((p: any) => p.finish_id === wi.finish_id);
    if (finishProcs.length > 0) {
      const prices = finishProcs.map((p: any) => parseFloat(p.price ?? "0")).filter(v => !isNaN(v));
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const totalExtra = prices.reduce((s, p) => s + p, 0) - minPrice;
      return garmentPrice + totalExtra;
    }
    return garmentPrice;
  };

  const makeItem = (wi: any, recipientType: "stock" | "person", size: string, qty: number, employee?: any): OrderItem => ({
    productId: wi.product_id ?? null,
    productName: wi.product_name ?? wi.name,
    colour: wi.colour ?? "",
    size,
    finishId: wi.finish_id ?? null,
    finishName: wi.finish_name ?? "",
    recipientType,
    recipientName: employee ? `${employee.first_name} ${employee.last_name}` : "",
    recipientEmployeeId: employee?.id ?? null,
    quantity: qty,
    unitPrice: resolveUnitPrice(wi, qty),
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
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-left max-w-xl mx-auto">
              {[
                { icon: User, title: "Named packing", desc: "Every order packed & labelled per person — ready to hand out." },
                { icon: History, title: "Size memory", desc: "Remembers each person's last size and suggests it automatically." },
                { icon: Tag, title: "Usage reports", desc: "Full order history per employee so you can track spend and reorder dates." },
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

  // ── Order summary grouped by recipient ─────────────────────────────────────
  const summaryGroups = basket.reduce((acc: Record<string, OrderItem[]>, item) => {
    const key = item.recipientType === "stock" ? "__stock__" : (item.recipientName || "__stock__");
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
  const summaryTotal = basket.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // ── Wardrobe items ─────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">My Wardrobe</h2>
      <p className="text-muted-foreground text-sm mb-5">
        Order for named individuals (packed &amp; labelled per person) or add as bulk stock — your choice per item.
      </p>

      <div className="flex gap-6 items-start">
        {/* ── Left: finish groups ─────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col gap-8">
        {finishGroups.map((group) => {
          const procs = groupProcesses(group.finish_id);
          return (
            <div key={group.finish_id}>
              {/* ── Finish group header ─────────────────────────────────── */}
              <div className="mb-3">
                <h3 className="font-bold text-base mb-2">
                  {group.finish_name ?? "Standard Garments"}
                </h3>
                {procs.length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-2">
                    {procs.map((p: any) => (
                      <div key={p.process_id} className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2 shadow-sm">
                        {p.process_image_url ? (
                          <ProcessImage url={p.process_image_url} alt={p.item_finish_name} />
                        ) : (
                          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                            <Shirt className="w-5 h-5 text-muted-foreground/40" />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            {p.process_type && <ProcessBadgeInline type={p.process_type} />}
                          </div>
                          <p className="text-xs font-medium leading-tight">{p.item_finish_name}</p>
                          {p.placement && (
                            <p className="text-[10px] text-muted-foreground">{p.placement}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="h-px bg-border" />
              </div>

              {/* ── Item cards ─────────────────────────────────────────── */}
              <div className="flex flex-col gap-3">
                {group.items.map((wi: any, i: number) => {
                  const key = `${group.finish_id}-${i}`;
                  const state = getItemState(key);
                  const availSizes = getAvailableSizes(wi);
                  const selectedEmployee = state.sel && state.sel !== "stock"
                    ? employees.find((e: any) => String(e.id) === state.sel)
                    : null;
                  const lastSize = selectedEmployee ? getLastSize(wi, selectedEmployee.id) : null;

                  // Auto-fill size from last order when employee is chosen
                  const handleSelChange = (val: string) => {
                    const emp = employees.find((e: any) => String(e.id) === val);
                    const suggestedSize = emp ? (getLastSize(wi, emp.id) ?? "") : "";
                    setItemState(key, { sel: val, size: suggestedSize, qty: 1 });
                  };

                  const handleAdd = () => {
                    if (!state.sel) return;
                    const isStock = state.sel === "stock";
                    const emp = isStock ? undefined : employees.find((e: any) => String(e.id) === state.sel);
                    setBasket(b => [...b, makeItem(wi, isStock ? "stock" : "person", state.size, state.qty, emp)]);
                    // Keep the same recipient so they can immediately pick another size
                    setItemState(key, { size: "", qty: 1 });
                  };
                  const handleDone = () => setItemState(key, { sel: null, size: "", qty: 1 });

                  return (
                    <Card key={i} className="overflow-hidden">
                      <div className="flex gap-0">
                        {/* Product image — prefer variant colour image */}
                        <div className="shrink-0 w-24 sm:w-28 bg-white border-r flex items-center justify-center overflow-hidden self-stretch">
                          {(wi.variant_image_url ?? wi.product_image_url) ? (
                            <img
                              src={wi.variant_image_url ?? wi.product_image_url}
                              alt={wi.product_name ?? wi.name}
                              className="w-full h-full object-contain p-1"
                            />
                          ) : (
                            <Shirt className="w-8 h-8 text-muted-foreground/30" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 p-3 sm:p-4">
                          {/* Name + price */}
                          <div className="flex items-start justify-between gap-2 mb-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm leading-snug">
                                {wi.product_name ?? wi.name}
                              </p>
                              {wi.product_sku && (
                                <p className="text-[11px] font-mono text-muted-foreground/70 leading-tight">
                                  {wi.product_sku}
                                </p>
                              )}
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[wi.colour, wi.role_name].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            {(() => {
                              const base = parseFloat(wi.unit_price ?? "0");
                              const active = resolveUnitPrice(wi, state.qty);
                              const hasBreak = active !== base && base > 0;
                              return active > 0 ? (
                                <div className="flex flex-col items-end shrink-0">
                                  <span className="text-sm font-bold text-primary">{formatCurrency(active)}</span>
                                  {hasBreak && (
                                    <span className="text-[10px] text-muted-foreground line-through">{formatCurrency(base)}</span>
                                  )}
                                </div>
                              ) : null;
                            })()}
                          </div>

                          {/* Order for dropdown */}
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2 min-w-0">
                              <Label className="text-xs font-medium text-muted-foreground shrink-0">For:</Label>
                              <Select value={state.sel ?? ""} onValueChange={handleSelChange}>
                                <SelectTrigger className="h-8 text-sm w-44 min-w-0">
                                  <SelectValue placeholder="Select…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {employees.length > 0 && employees.map((emp: any) => {
                                    const ls = getLastSize(wi, emp.id);
                                    return (
                                      <SelectItem key={emp.id} value={String(emp.id)}>
                                        <span className="flex items-center gap-1.5">
                                          <User className="w-3 h-3 shrink-0" />
                                          {emp.first_name} {emp.last_name}
                                          {ls && <span className="text-[10px] text-emerald-600 font-semibold ml-1">{ls}</span>}
                                        </span>
                                      </SelectItem>
                                    );
                                  })}
                                  <SelectItem value="stock">
                                    <span className="flex items-center gap-1.5">
                                      <Package className="w-3 h-3 shrink-0" />
                                      Stock order (bulk)
                                    </span>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            {/* Size + qty + add — shown once a recipient is chosen */}
                            {state.sel && (
                              <>
                                {/* Size */}
                                {(() => {
                                  const FALLBACK_SIZES = ["XS","S","M","L","XL","2XL","3XL","4XL"];
                                  const sizeOptions = availSizes.length > 0 ? availSizes : FALLBACK_SIZES;
                                  return (
                                    <div className="flex items-center gap-2">
                                      <Label className="text-xs font-medium text-muted-foreground shrink-0">Size:</Label>
                                      <Select value={state.size} onValueChange={v => setItemState(key, { size: v })}>
                                        <SelectTrigger className="h-8 text-sm w-28">
                                          <SelectValue placeholder="Pick size" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {sizeOptions.map(s => (
                                            <SelectItem key={s} value={s}>
                                              <span className="flex items-center gap-1.5">
                                                {s}
                                                {lastSize && s === lastSize && (
                                                  <span className="text-[10px] text-emerald-600 font-semibold">last</span>
                                                )}
                                              </span>
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  );
                                })()}

                                {/* Qty */}
                                <div className="flex items-center border rounded-md h-8 overflow-hidden">
                                  <button
                                    className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setItemState(key, { qty: Math.max(1, state.qty - 1) })}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <input
                                    type="number"
                                    min={1}
                                    value={state.qty}
                                    onChange={e => {
                                      const v = parseInt(e.target.value, 10);
                                      if (!isNaN(v) && v >= 1) setItemState(key, { qty: v });
                                    }}
                                    className="w-10 text-center text-sm font-medium bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                  />
                                  <button
                                    className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setItemState(key, { qty: state.qty + 1 })}
                                  >
                                    <Plus className="w-3 h-3" />
                                  </button>
                                </div>

                                {/* Add */}
                                <Button
                                  size="sm"
                                  className="h-8 text-xs shrink-0"
                                  disabled={!state.size.trim()}
                                  onClick={handleAdd}
                                >
                                  <Plus className="w-3 h-3 mr-1" /> Add to order
                                </Button>

                                {/* Done — dismiss the card back to recipient picker */}
                                <button
                                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
                                  onClick={handleDone}
                                >
                                  Done
                                </button>
                              </>
                            )}
                          </div>

                          {/* Last size hint */}
                          {lastSize && !state.size && (
                            <p className="text-[11px] text-emerald-600 mt-1.5">
                              Last ordered size for {selectedEmployee?.first_name}: <strong>{lastSize}</strong>
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
        </div>{/* end left column */}

        {/* ── Right: sticky order summary ─────────────────────── */}
        <div className="hidden lg:block w-72 xl:w-80 shrink-0 sticky top-4 self-start">
          <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
              <span className="font-semibold text-sm">Order Summary</span>
              {basket.length > 0 && (
                <span className="text-xs text-muted-foreground">{basket.length} item{basket.length !== 1 ? "s" : ""}</span>
              )}
            </div>

            {basket.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-xs">
                <Package className="w-6 h-6 mx-auto mb-2 opacity-30" />
                No items added yet
              </div>
            ) : (
              <div className="divide-y max-h-[60vh] overflow-y-auto">
                {Object.entries(summaryGroups).map(([key, items]) => {
                  const label = key === "__stock__" ? "Bulk Stock" : key;
                  const isStock = key === "__stock__";
                  return (
                    <div key={key} className="px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        {isStock
                          ? <Package className="w-3 h-3 text-muted-foreground shrink-0" />
                          : <User className="w-3 h-3 text-muted-foreground shrink-0" />}
                        <span className="text-xs font-semibold truncate">{label}</span>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {(items as OrderItem[]).map((item, idx) => {
                          const basketIdx = basket.findIndex((b, bi) => {
                            const groupItems = Object.values(summaryGroups).flat();
                            return b === item;
                          });
                          return (
                            <div key={idx} className="flex items-start gap-2 group">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium leading-tight truncate">{item.productName}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {[item.colour, item.size, item.quantity > 1 ? `×${item.quantity}` : null].filter(Boolean).join(" · ")}
                                </p>
                                {item.unitPrice > 0 && (
                                  <p className="text-[11px] text-primary font-semibold">{formatCurrency(item.unitPrice * item.quantity)}</p>
                                )}
                              </div>
                              <button
                                className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 text-muted-foreground hover:text-destructive"
                                onClick={() => setBasket(b => b.filter(x => x !== item))}
                                title="Remove"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {basket.length > 0 && (
              <div className="px-4 py-3 border-t bg-muted/20">
                {summaryTotal > 0 && (
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground">Estimated total</span>
                    <span className="text-sm font-bold">{formatCurrency(summaryTotal)}</span>
                  </div>
                )}
                <Button className="w-full" size="sm" onClick={onNext}>
                  Review order <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            )}
          </div>
        </div>

      </div>{/* end two-column flex */}

      {/* Mobile sticky bottom bar */}
      {basket.length > 0 && (
        <div className="lg:hidden sticky bottom-0 mt-6 bg-background border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{basket.length} item{basket.length !== 1 ? "s" : ""} added</span>
            <Button onClick={onNext}>Review order <ArrowRight className="w-4 h-4 ml-1.5" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 2b: Inspiration wishlist ───────────────────────────────────────────

type EnquiryItem = {
  productId: number | null;
  productName: string;
  imageUrl: string;
  colour: string;
  desiredProcesses: string[];
  notes: string;
};

const PROCESS_OPTIONS = [
  { id: "embroidery",    label: "Embroidery",          cls: "bg-purple-50 border-purple-200 text-purple-700 data-[active=true]:bg-purple-100 data-[active=true]:border-purple-400" },
  { id: "print",         label: "Print / DTF",          cls: "bg-blue-50 border-blue-200 text-blue-700 data-[active=true]:bg-blue-100 data-[active=true]:border-blue-400" },
  { id: "heat_transfer", label: "Heat Transfer",        cls: "bg-orange-50 border-orange-200 text-orange-700 data-[active=true]:bg-orange-100 data-[active=true]:border-orange-400" },
  { id: "badge",         label: "Badge / Woven Label",  cls: "bg-amber-50 border-amber-200 text-amber-700 data-[active=true]:bg-amber-100 data-[active=true]:border-amber-400" },
  { id: "unsure",        label: "Not sure yet",         cls: "bg-muted border-border text-muted-foreground data-[active=true]:bg-muted/80 data-[active=true]:border-foreground/30" },
];

function InspirationStep({ wishlist, setWishlist, onSubmit, submitting }: {
  wishlist: EnquiryItem[];
  setWishlist: React.Dispatch<React.SetStateAction<EnquiryItem[]>>;
  onSubmit: (data: { items: EnquiryItem[]; notes: string }) => void;
  submitting: boolean;
}) {
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ colour: "", processes: [] as string[], notes: "" });
  const [overallNotes, setOverallNotes] = useState("");

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-products"],
    queryFn: () => apiFetch("/portal/products"),
  });

  const filtered = search.trim()
    ? products.filter((p: any) =>
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase()) ||
        p.category?.toLowerCase().includes(search.toLowerCase())
      )
    : products;

  const toggleProcess = (id: string) =>
    setDraft(d => ({
      ...d,
      processes: d.processes.includes(id) ? d.processes.filter(p => p !== id) : [...d.processes, id],
    }));

  const openConfig = (productId: number) => {
    setExpandedId(productId);
    setDraft({ colour: "", processes: [], notes: "" });
  };

  const addToWishlist = (p: any) => {
    setWishlist(w => [...w, {
      productId: p.id,
      productName: p.name,
      imageUrl: p.image_url ?? "",
      colour: draft.colour,
      desiredProcesses: draft.processes,
      notes: draft.notes,
    }]);
    setExpandedId(null);
    setDraft({ colour: "", processes: [], notes: "" });
  };

  const removeFromWishlist = (idx: number) =>
    setWishlist(w => w.filter((_, i) => i !== idx));

  const alreadyAdded = (productId: number) =>
    wishlist.some(w => w.productId === productId);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Looking for Inspiration</h2>
      <p className="text-muted-foreground text-sm mb-5">
        Browse our range and add anything that catches your eye to your wishlist.
        Tell us your preferred colours and decoration style — we'll come back with a tailored wardrobe quote.
      </p>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products by name, SKU or category…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {filtered.map((p: any) => {
            const added = alreadyAdded(p.id);
            const open = expandedId === p.id;
            return (
              <div key={p.id} className="flex flex-col">
                <Card className={cn("transition-colors", open ? "border-primary/50" : "hover:border-primary/30", added && "opacity-60")}>
                  <CardContent className="py-3 px-4 flex items-center gap-3">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded object-cover shrink-0 bg-muted" />
                    ) : (
                      <div className="w-12 h-12 rounded bg-muted shrink-0 flex items-center justify-center">
                        <ShoppingBag className="w-5 h-5 text-muted-foreground/50" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{p.category || p.sku}</p>
                    </div>
                    {added ? (
                      <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 shrink-0">
                        <Heart className="w-3 h-3 fill-current" /> Added
                      </span>
                    ) : (
                      <Button
                        size="sm" variant="outline"
                        className="shrink-0 gap-1 h-7 text-xs"
                        onClick={() => open ? setExpandedId(null) : openConfig(p.id)}
                      >
                        <Heart className="w-3 h-3" /> Wishlist
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Inline config panel */}
                {open && (
                  <Card className="border-primary/40 border-t-0 rounded-t-none -mt-px">
                    <CardContent className="px-4 py-3 flex flex-col gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Preferred colour(s)</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="e.g. Navy, Black, White"
                          value={draft.colour}
                          onChange={e => setDraft(d => ({ ...d, colour: e.target.value }))}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium">Decoration style</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {PROCESS_OPTIONS.map(opt => (
                            <button
                              key={opt.id}
                              data-active={draft.processes.includes(opt.id)}
                              onClick={() => toggleProcess(opt.id)}
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                                opt.cls
                              )}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Notes (optional)</Label>
                        <Input
                          className="h-8 text-sm"
                          placeholder="Any specific requirements…"
                          value={draft.notes}
                          onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                        />
                      </div>
                      <div className="flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedId(null)}>Cancel</Button>
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => addToWishlist(p)}>
                          <Heart className="w-3 h-3" /> Add to wishlist
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Wishlist summary */}
      {wishlist.length > 0 && (
        <div className="border rounded-xl p-4 bg-muted/20 flex flex-col gap-4">
          <div>
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-primary fill-primary/20" />
              Your wishlist ({wishlist.length})
            </h3>
            <div className="flex flex-col gap-2">
              {wishlist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-background border px-3 py-2">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.productName} className="w-8 h-8 rounded object-cover shrink-0 bg-muted" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-muted shrink-0 flex items-center justify-center">
                      <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[item.colour, item.desiredProcesses.join(", ")].filter(Boolean).join(" · ") || "No preferences set"}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromWishlist(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Anything else we should know?</Label>
            <Textarea
              placeholder="Overall budget, timeline, any other requirements…"
              value={overallNotes}
              onChange={e => setOverallNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <Button
            className="w-full sm:w-auto self-end gap-1.5"
            disabled={submitting}
            onClick={() => onSubmit({ items: wishlist, notes: overallNotes })}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Send enquiry to SBS
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Enquiry confirmation ─────────────────────────────────────────────────────

function EnquiryConfirmStep({ enquiryRef }: { enquiryRef: string }) {
  return (
    <div className="text-center py-10">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Wishlist sent!</h2>
      <p className="text-muted-foreground mb-1">
        Your enquiry <span className="font-semibold text-foreground">{enquiryRef}</span> has been submitted.
      </p>
      <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
        Our team at Select Branding Solutions will review your wishlist and come back to you with a tailored wardrobe quote.
      </p>
      <Button variant="outline" onClick={() => window.location.href = "/customer-portal/orders"}>
        Back to my orders
      </Button>
    </div>
  );
}

// ─── Step 3: Review & Submit ─────────────────────────────────────────────────

const SHIPPING_OPTIONS = [
  {
    id: "free_local",
    label: "Free Local Delivery",
    sublabel: "LS & BD postcodes · delivered Tuesdays & Fridays",
    cost: 0,
  },
  {
    id: "dpd_next_day",
    label: "Next Day DPD",
    sublabel: "Tracked courier — delivered next working day",
    cost: 8.50,
  },
  {
    id: "warehouse_collection",
    label: "Warehouse Collection",
    sublabel: "Collect from our warehouse, LS13",
    cost: 0,
  },
  {
    id: "office_collection",
    label: "Office Collection",
    sublabel: "Collect from our office, BD10",
    cost: 0,
  },
] as const;

function ReviewStep({ basket, setBasket, onSubmit, submitting, portalRole, onAddMore }: {
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onSubmit: (data: { requiredDate: string; notes: string; shippingOption: string; shippingCost: number; poNumber: string }) => void;
  submitting: boolean;
  portalRole: string;
  onAddMore?: () => void;
}) {
  const [requiredDate, setRequiredDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [shippingId, setShippingId] = useState<string>("");

  const selectedShipping = SHIPPING_OPTIONS.find(o => o.id === shippingId) ?? null;
  const shippingCost = selectedShipping?.cost ?? 0;

  const itemsTotal = basket.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const orderTotal = itemsTotal + shippingCost;

  const updateQty = (idx: number, delta: number) => {
    setBasket(b => b.map((item, i) => i === idx ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
  };
  const setQty = (idx: number, val: number) => {
    if (!isNaN(val) && val >= 1) setBasket(b => b.map((item, i) => i === idx ? { ...item, quantity: val } : item));
  };
  const removeItem = (idx: number) => setBasket(b => b.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <h2 className="text-xl font-semibold">Review your order</h2>
        {onAddMore && (
          <Button variant="outline" size="sm" onClick={onAddMore}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add more items
          </Button>
        )}
      </div>
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
                      <div className="flex items-center justify-end gap-0.5">
                        <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => updateQty(idx, -1)}><Minus className="w-3 h-3" /></button>
                        <input
                          type="number"
                          min={1}
                          value={item.quantity}
                          onChange={e => setQty(idx, parseInt(e.target.value, 10))}
                          className="w-10 text-center text-sm font-medium border rounded outline-none focus:ring-1 focus:ring-primary/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none py-0.5"
                        />
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
          <div className="border-t px-5 py-3 space-y-1.5">
            <div className="flex justify-end gap-6">
              <span className="text-muted-foreground text-sm">Items subtotal</span>
              <span className="text-sm font-medium w-20 text-right">{formatCurrency(itemsTotal)}</span>
            </div>
            {shippingCost > 0 && (
              <div className="flex justify-end gap-6">
                <span className="text-muted-foreground text-sm">{selectedShipping?.label}</span>
                <span className="text-sm font-medium w-20 text-right">{formatCurrency(shippingCost)}</span>
              </div>
            )}
            <div className="flex justify-end gap-6 pt-1 border-t">
              <span className="text-muted-foreground text-sm font-semibold">Order total</span>
              <span className="font-bold w-20 text-right">{formatCurrency(orderTotal)}</span>
            </div>
            <p className="text-right text-[11px] text-muted-foreground">All prices exclude VAT</p>
          </div>
        </CardContent>
      </Card>

      {/* Shipping / Collection options */}
      <div className="mb-5">
        <Label className="text-sm font-semibold mb-3 block">Delivery / Collection</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SHIPPING_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setShippingId(opt.id)}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                shippingId === opt.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                shippingId === opt.id ? "border-primary" : "border-muted-foreground/40"
              }`}>
                {shippingId === opt.id && <div className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium leading-tight">{opt.label}</span>
                  <span className="text-sm font-semibold shrink-0 text-primary">
                    {opt.cost === 0 ? "Free" : `${formatCurrency(opt.cost)} + VAT`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.sublabel}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="reqdate">Required by</Label>
          <Input
            id="reqdate"
            type="date"
            value={requiredDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => setRequiredDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po-number">Purchase order number <span className="text-muted-foreground font-normal">(optional — can be added later)</span></Label>
          <Input
            id="po-number"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            placeholder="e.g. PO-2026-0042"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes for our team (optional)</Label>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions, delivery notes, etc." rows={3} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Button
          onClick={() => onSubmit({ requiredDate, notes, shippingOption: shippingId, shippingCost, poNumber })}
          disabled={submitting || basket.length === 0 || !shippingId}
          className="w-full sm:w-auto"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {portalRole === "manager" ? "Submit order to SBS" : "Save for manager review"}
        </Button>
        {!shippingId && (
          <p className="text-xs text-amber-600">Please select a delivery or collection option above.</p>
        )}
        {portalRole !== "manager" && shippingId && (
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

const SESSION_KEY = "portal-new-order";

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(data: object) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch {}
}

export default function NewOrder() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { portalRole } = useAuth();

  const saved = readSession();
  const [step, setStep] = useState<number>(saved?.step ?? 0);
  const [mode, setMode] = useState<"wardrobe" | "catalogue" | null>(saved?.mode ?? null);
  const [basket, setBasket] = useState<OrderItem[]>(saved?.basket ?? []);
  const [wishlist, setWishlist] = useState<EnquiryItem[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<{ id: number; orderNumber: string } | null>(null);
  const [confirmedEnquiry, setConfirmedEnquiry] = useState<{ enquiryRef: string } | null>(null);

  // Persist draft to sessionStorage whenever basket/step/mode change
  const persistedStep = step;
  const persistedMode = mode;
  const persistedBasket = basket;
  if (persistedStep > 0 && persistedMode && !confirmedOrder) {
    writeSession({ step: persistedStep, mode: persistedMode, basket: persistedBasket });
  }

  const { data: wardrobe } = useQuery<{
    items: any[];
    employees: any[];
    processes: any[];
    lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
    sizesMap: Record<string, Record<string, string[]>>;
  }>({
    queryKey: ["portal-wardrobe"],
    queryFn: () => apiFetch("/portal/wardrobe"),
    enabled: mode === "wardrobe",
  });

  const submitMutation = useMutation({
    mutationFn: (data: { requiredDate: string; notes: string; shippingOption: string; shippingCost: number; poNumber: string }) =>
      apiFetch("/portal/orders", {
        method: "POST",
        body: JSON.stringify({
          requiredDate: data.requiredDate || undefined,
          portalNotes: data.notes || undefined,
          poNumber: data.poNumber || undefined,
          shippingOption: data.shippingOption || undefined,
          shippingCost: data.shippingCost,
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
      clearSession();
      setConfirmedOrder(data);
      setStep(3);
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit order", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const submitEnquiryMutation = useMutation({
    mutationFn: (data: { items: EnquiryItem[]; notes: string }) =>
      apiFetch("/portal/enquiries", {
        method: "POST",
        body: JSON.stringify({
          notes: data.notes || undefined,
          items: data.items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            imageUrl: i.imageUrl || undefined,
            colour: i.colour || undefined,
            desiredProcesses: i.desiredProcesses,
            notes: i.notes || undefined,
          })),
        }),
      }),
    onSuccess: (data) => {
      clearSession();
      setConfirmedEnquiry({ enquiryRef: data.enquiryRef });
      setStep(2);
    },
    onError: () => {
      toast({ title: "Failed to submit enquiry", description: "Please try again.", variant: "destructive" });
    },
  });

  const STEPS = mode === "catalogue"
    ? ["Choose type", "Inspiration", "Done"]
    : ["Choose type", "Wardrobe", "Review", "Done"];

  const handleModeSelect = (m: "wardrobe" | "catalogue") => {
    if (m !== mode) {
      setBasket([]);
      setWishlist([]);
    }
    setMode(m);
    setStep(1);
  };

  const handleBackToModeStep = () => {
    setStep(0);
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
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground" onClick={handleBackToModeStep}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <WardrobeStep
            items={wardrobe?.items ?? []}
            employees={wardrobe?.employees ?? []}
            processes={wardrobe?.processes ?? []}
            lastSizes={wardrobe?.lastSizes ?? {}}
            sizesMap={wardrobe?.sizesMap ?? {}}
            basket={basket}
            setBasket={setBasket}
            onNext={() => setStep(2)}
          />
        </div>
      )}

      {step === 1 && mode === "catalogue" && (
        <InspirationStep
          wishlist={wishlist}
          setWishlist={setWishlist}
          onSubmit={(d) => submitEnquiryMutation.mutate(d)}
          submitting={submitEnquiryMutation.isPending}
        />
      )}

      {step === 2 && mode === "wardrobe" && (
        <ReviewStep
          basket={basket}
          setBasket={setBasket}
          onSubmit={(d) => submitMutation.mutate(d)}
          submitting={submitMutation.isPending}
          portalRole={portalRole}
          onAddMore={() => setStep(1)}
        />
      )}

      {step === 2 && mode === "catalogue" && confirmedEnquiry && (
        <EnquiryConfirmStep enquiryRef={confirmedEnquiry.enquiryRef} />
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
