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
  Shirt, ShoppingBag, CheckCircle2, Search,
  User, Package, History, Tag, Sparkles, Heart, X, Mail,
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

// Standard garment size order for dropdown sorting
const SIZE_ORDER = [
  "XXXS","XXS","XS","S","M","L","XL","2XL","3XL","4XL","5XL",
  "6XL","XXL","XXXL","X-Small","X Small","Small","Medium","Large",
  "X-Large","X Large","XX-Large","XX Large",
  "4","6","8","10","12","14","16","18","20","22","24","26","28","30",
];
function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ai = SIZE_ORDER.findIndex(s => s.toLowerCase() === a.toLowerCase());
    const bi = SIZE_ORDER.findIndex(s => s.toLowerCase() === b.toLowerCase());
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

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

  // ── Wardrobe items ─────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">My Wardrobe</h2>
      <p className="text-muted-foreground text-sm mb-5">
        Order for named individuals (packed &amp; labelled per person) or add as bulk stock — your choice per item.
      </p>

      <div className="flex flex-col gap-8">
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
                          <img
                            src={p.process_image_url}
                            alt={p.item_finish_name}
                            className="h-10 w-10 rounded object-contain bg-white border shrink-0"
                          />
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
                  const price = parseFloat(wi.special_price ?? wi.unit_price ?? "0");
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
                    setItemState(key, { sel: null, size: "", qty: 1 });
                  };

                  return (
                    <Card key={i} className="overflow-hidden">
                      <div className="flex gap-0">
                        {/* Product image — prefer variant colour image */}
                        <div className="shrink-0 w-20 sm:w-24 bg-muted/30 border-r flex items-center justify-center">
                          {(wi.variant_image_url ?? wi.product_image_url) ? (
                            <img
                              src={wi.variant_image_url ?? wi.product_image_url}
                              alt={wi.product_name ?? wi.name}
                              className="w-full h-full object-cover aspect-square"
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
                            {price > 0 && (
                              <span className="text-sm font-bold text-primary shrink-0">{formatCurrency(price)}</span>
                            )}
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
                                  const FALLBACK_SIZES = ["XS","S","M","L","XL","2XL","3XL","4XL","One Size"];
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
                                <div className="flex items-center border rounded-md h-8">
                                  <button
                                    className="px-2 h-full text-muted-foreground hover:text-foreground transition-colors"
                                    onClick={() => setItemState(key, { qty: Math.max(1, state.qty - 1) })}
                                  >
                                    <Minus className="w-3 h-3" />
                                  </button>
                                  <span className="w-8 text-center text-sm font-medium">{state.qty}</span>
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
  const [wishlist, setWishlist] = useState<EnquiryItem[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<{ id: number; orderNumber: string } | null>(null);
  const [confirmedEnquiry, setConfirmedEnquiry] = useState<{ enquiryRef: string } | null>(null);

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
          processes={wardrobe?.processes ?? []}
          lastSizes={wardrobe?.lastSizes ?? {}}
          sizesMap={wardrobe?.sizesMap ?? {}}
          basket={basket}
          setBasket={setBasket}
          onNext={() => setStep(2)}
        />
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
