import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
      <p className="text-muted-foreground text-sm mb-6">Choose from your wardrobe or browse our full catalogue.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("wardrobe")}
        >
          <CardContent className="py-8 px-6 text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Shirt className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">My Wardrobe</h3>
              <p className="text-muted-foreground text-sm mt-1">Order from your pre-configured garments and branded items</p>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("catalogue")}
        >
          <CardContent className="py-8 px-6 text-center flex flex-col items-center gap-3">
            <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <ShoppingBag className="w-7 h-7 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Catalogue</h3>
              <p className="text-muted-foreground text-sm mt-1">Browse our full range of products and create a custom order</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Step 2a: Wardrobe ───────────────────────────────────────────────────────

function WardrobeStep({ items, employees, basket, setBasket, onNext }: {
  items: any[];
  employees: any[];
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onNext: () => void;
}) {
  const [expandedFinish, setExpandedFinish] = useState<number | null>(null);

  const finishGroups = Object.values(
    items.reduce((acc: any, item: any) => {
      const fid = item.finish_id ?? 0;
      if (!acc[fid]) acc[fid] = { finish_id: fid, finish_name: item.finish_name ?? "Standard", items: [] };
      acc[fid].items.push(item);
      return acc;
    }, {})
  ) as Array<{ finish_id: number; finish_name: string; items: any[] }>;

  const addItem = (wi: any, recipientType: "stock" | "person", employee?: any) => {
    const price = parseFloat(wi.special_price ?? wi.unit_price ?? "0");
    setBasket(b => [...b, {
      productId: wi.product_id ?? null,
      productName: wi.product_name ?? wi.name,
      colour: wi.colour ?? "",
      size: wi.size ?? "",
      finishId: wi.finish_id ?? null,
      finishName: wi.finish_name ?? "",
      recipientType,
      recipientName: employee ? `${employee.first_name} ${employee.last_name}` : "",
      recipientEmployeeId: employee?.id ?? null,
      quantity: 1,
      unitPrice: price,
    }]);
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Select from your wardrobe</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Click an item to add it to your order. You can assign to an employee or add as stock.
      </p>

      {finishGroups.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">No wardrobe items found for your account.</CardContent></Card>
      ) : (
        <div className="flex flex-col gap-3">
          {finishGroups.map((group) => (
            <Card key={group.finish_id}>
              <CardHeader
                className="py-3 px-5 flex flex-row items-center justify-between cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedFinish(expandedFinish === group.finish_id ? null : group.finish_id)}
              >
                <CardTitle className="text-sm font-semibold">{group.finish_name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{group.items.length} items</Badge>
                  {expandedFinish === group.finish_id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </div>
              </CardHeader>
              {expandedFinish === group.finish_id && (
                <CardContent className="pt-0 pb-3 px-5">
                  <div className="flex flex-col gap-2">
                    {group.items.map((wi: any, i: number) => (
                      <div key={i} className="border rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{wi.product_name ?? wi.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {[wi.colour, wi.size].filter(Boolean).join(" / ")}
                              {wi.role_name ? ` · ${wi.role_name}` : ""}
                            </p>
                            <p className="text-xs font-medium text-primary mt-0.5">
                              {formatCurrency(wi.special_price ?? wi.unit_price ?? 0)}
                            </p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addItem(wi, "stock")}>
                              <Plus className="w-3 h-3" /> Add to stock
                            </Button>
                            {employees.map((emp: any) => (
                              <Button key={emp.id} size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => addItem(wi, "person", emp)}>
                                <Plus className="w-3 h-3" /> {emp.first_name} {emp.last_name}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}

      {basket.length > 0 && (
        <div className="sticky bottom-0 mt-6 bg-background border-t pt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{basket.length} item{basket.length !== 1 ? "s" : ""} in order</span>
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

function ReviewStep({ basket, setBasket, onSubmit, submitting }: {
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onSubmit: (data: { requiredDate: string; notes: string }) => void;
  submitting: boolean;
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

      <Button onClick={() => onSubmit({ requiredDate, notes })} disabled={submitting || basket.length === 0} className="w-full sm:w-auto">
        {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Submit order
      </Button>
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

  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<"wardrobe" | "catalogue" | null>(null);
  const [basket, setBasket] = useState<OrderItem[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<{ id: number; orderNumber: string } | null>(null);

  const { data: wardrobe } = useQuery<{ items: any[]; employees: any[] }>({
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
