import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { AlertTriangle, Search, Loader2, Package, Shirt } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const API_BASE = "/api";
async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as any).error || res.statusText);
  }
  return res.json();
}

// ─── Plain stock ──────────────────────────────────────────────────────────────

interface PlainVariant {
  variantId: number;
  productId: number;
  productName: string;
  productSku: string | null;
  colour: string | null;
  size: string | null;
  sku: string | null;
  stockQuantity: number;
}

function InlineQty({ value, onSave }: { value: number; onSave: (qty: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const num = parseInt(draft, 10);
    if (!isNaN(num) && num >= 0 && num !== value) onSave(num);
    else setDraft(String(value));
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={0}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        className="w-20 text-right border rounded px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
    );
  }

  const low = value <= 5;
  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className={cn(
        "tabular-nums font-mono text-sm px-2 py-0.5 rounded hover:bg-muted transition-colors cursor-pointer",
        low ? "text-amber-700 font-semibold" : "text-foreground"
      )}
      title="Click to edit"
    >
      {low && <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-500" />}
      {value}
    </button>
  );
}

function PlainStockTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: variants = [], isLoading } = useQuery<PlainVariant[]>({
    queryKey: ["stock-plain"],
    queryFn: () => apiFetch("/stock/plain"),
  });

  const updateMut = useMutation({
    mutationFn: ({ variantId, stockQuantity }: { variantId: number; stockQuantity: number }) =>
      apiFetch(`/stock/plain/${variantId}`, { method: "PATCH", body: JSON.stringify({ stockQuantity }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock-plain"] }),
    onError: () => toast({ title: "Failed to update stock", variant: "destructive" }),
  });

  const filtered = variants.filter(v => {
    const q = search.toLowerCase();
    return !q || [v.productName, v.colour, v.size, v.sku, v.productSku].some(s => s?.toLowerCase().includes(q));
  });

  const grouped = filtered.reduce<Record<string, PlainVariant[]>>((acc, v) => {
    const key = `${v.productId}__${v.productName}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(v);
    return acc;
  }, {});

  const lowCount = variants.filter(v => v.stockQuantity <= 5).length;
  const totalUnits = variants.reduce((s, v) => s + v.stockQuantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search product, colour, size, SKU…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center text-sm text-muted-foreground shrink-0">
          <span>{totalUnits.toLocaleString()} units total</span>
          {lowCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1">
              <AlertTriangle className="w-3 h-3" />{lowCount} low stock
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Package className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground">{search ? "No variants match your search." : "No product variants found."}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([key, items]) => {
            const [, productName] = key.split("__");
            const firstItem = items[0];
            const productTotal = items.reduce((s, v) => s + v.stockQuantity, 0);
            const hasLow = items.some(v => v.stockQuantity <= 5);
            return (
              <Card key={key} className="shadow-sm">
                <CardHeader className="py-3 px-5 border-b bg-muted/20">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="font-semibold">{productName}</span>
                      {firstItem.productSku && (
                        <span className="text-xs text-muted-foreground font-mono">{firstItem.productSku}</span>
                      )}
                      {hasLow && (
                        <Badge variant="outline" className="border-amber-300 text-amber-600 bg-amber-50 text-xs gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> Low
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">{productTotal} total</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Variant SKU</TableHead>
                        <TableHead>Colour</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead className="text-right">Stock Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.map(v => (
                        <TableRow key={v.variantId} className="group">
                          <TableCell className="font-mono text-xs text-muted-foreground">{v.sku || "—"}</TableCell>
                          <TableCell className="text-sm">{v.colour || "—"}</TableCell>
                          <TableCell className="text-sm">{v.size || "—"}</TableCell>
                          <TableCell className="text-right">
                            <InlineQty
                              value={v.stockQuantity}
                              onSave={(qty) => updateMut.mutate({ variantId: v.variantId, stockQuantity: qty })}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Finish stock ─────────────────────────────────────────────────────────────

interface FinishedItem {
  id: number;
  customerId: number;
  customerName: string;
  name: string;
  productName: string | null;
  colour: string | null;
  size: string | null;
  unitPrice: number;
  stockQuantity: number;
  notes: string | null;
}

function FinishStockTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: items = [], isLoading } = useQuery<FinishedItem[]>({
    queryKey: ["stock-finished"],
    queryFn: () => apiFetch("/stock/finished"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, stockQuantity }: { id: number; stockQuantity: number }) =>
      apiFetch(`/stock/finished/${id}`, { method: "PATCH", body: JSON.stringify({ stockQuantity }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stock-finished"] }),
    onError: () => toast({ title: "Failed to update stock", variant: "destructive" }),
  });

  const filtered = items.filter(item => {
    const q = search.toLowerCase();
    return !q || [item.name, item.customerName, item.productName, item.colour, item.size].some(s => s?.toLowerCase().includes(q));
  });

  const grouped = filtered.reduce<Record<string, FinishedItem[]>>((acc, item) => {
    const key = `${item.customerId}__${item.customerName}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const lowCount = items.filter(i => i.stockQuantity <= 5).length;
  const totalUnits = items.reduce((s, i) => s + i.stockQuantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search customer, item, colour, size…"
            className="pl-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 items-center text-sm text-muted-foreground shrink-0">
          <span>{totalUnits.toLocaleString()} units total</span>
          {lowCount > 0 && (
            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1">
              <AlertTriangle className="w-3 h-3" />{lowCount} low stock
            </Badge>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <Shirt className="w-12 h-12 text-muted-foreground/30 mb-3" />
          <p className="text-muted-foreground text-sm text-center max-w-sm">
            {search
              ? "No items match your search."
              : "No finished stock items yet. Add items to customer wardrobes and set a stock quantity."}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([key, customerItems]) => {
            const [, customerName] = key.split("__");
            const customerTotal = customerItems.reduce((s, i) => s + i.stockQuantity, 0);
            const hasLow = customerItems.some(i => i.stockQuantity <= 5);
            return (
              <Card key={key} className="shadow-sm">
                <CardHeader className="py-3 px-5 border-b bg-muted/20">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="font-semibold">{customerName}</span>
                      {hasLow && (
                        <Badge variant="outline" className="border-amber-300 text-amber-600 bg-amber-50 text-xs gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> Low
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">{customerTotal} total</span>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Item</TableHead>
                        <TableHead className="hidden md:table-cell">Base Product</TableHead>
                        <TableHead className="hidden sm:table-cell">Colour / Size</TableHead>
                        <TableHead className="text-right">Stock Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customerItems.map(item => (
                        <TableRow key={item.id} className="group">
                          <TableCell className="font-medium text-sm">{item.name}</TableCell>
                          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{item.productName || "—"}</TableCell>
                          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                            {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <InlineQty
                              value={item.stockQuantity}
                              onSave={(qty) => updateMut.mutate({ id: item.id, stockQuantity: qty })}
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Stock() {
  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Stock</h1>
          <p className="text-muted-foreground mt-1">
            Manage stock levels for plain garments and finished (branded) goods.
          </p>
        </div>

        <Tabs defaultValue="plain">
          <TabsList className="mb-2">
            <TabsTrigger value="plain" className="gap-1.5">
              <Package className="w-4 h-4" /> Plain Stock
            </TabsTrigger>
            <TabsTrigger value="finish" className="gap-1.5">
              <Shirt className="w-4 h-4" /> Finish Stock
            </TabsTrigger>
          </TabsList>
          <TabsContent value="plain"><PlainStockTab /></TabsContent>
          <TabsContent value="finish"><FinishStockTab /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
