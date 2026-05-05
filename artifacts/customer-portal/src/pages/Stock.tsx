import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import PortalLayout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle, Plus, ArrowUpCircle, ArrowDownCircle, History,
  Pencil, Trash2, Package, MapPin, TrendingDown, RefreshCw, Shirt,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockItem {
  id: number;
  name: string;
  product_id: number | null;
  product_name: string | null;
  product_sku: string | null;
  product_image_url: string | null;
  variant_image_url: string | null;
  colour: string | null;
  size: string | null;
  unit_price: string | null;
  stock_quantity: number;
  min_quantity: number;
  location: string | null;
  notes: string | null;
  finish_id: number | null;
  finish_name: string | null;
  movement_count: number;
  last_movement_at: string | null;
}

interface StockProcess {
  finish_id: number;
  process_id: number;
  item_finish_name: string;
  process_type: string;
  placement: string | null;
}

interface Movement {
  id: number;
  movement_type: string;
  quantity: number;
  reference: string | null;
  recipient_name: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

// ─── Card group ───────────────────────────────────────────────────────────────

interface CardGroup {
  key: string;
  displayName: string;
  productSku: string | null;
  imageUrl: string | null;
  colour: string | null;
  finishId: number | null;
  finishName: string | null;
  location: string | null;
  items: StockItem[];
}

function groupItems(items: StockItem[]): CardGroup[] {
  const map = new Map<string, CardGroup>();
  for (const item of items) {
    const key = `${item.product_id ?? item.name}|${item.colour ?? ""}|${item.finish_id ?? ""}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        displayName: item.product_name ?? item.name,
        productSku: item.product_sku ?? null,
        imageUrl: item.variant_image_url ?? item.product_image_url ?? null,
        colour: item.colour,
        finishId: item.finish_id,
        finishName: item.finish_name,
        location: item.location,
        items: [],
      });
    }
    map.get(key)!.items.push(item);
  }
  return Array.from(map.values());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function movementLabel(type: string) {
  if (type === "in") return { label: "Stock In", color: "text-green-600" };
  if (type === "out") return { label: "Stock Out", color: "text-red-500" };
  if (type === "issue") return { label: "Issued", color: "text-orange-500" };
  if (type === "adjustment") return { label: "Adjustment", color: "text-blue-500" };
  if (type === "transfer") return { label: "Transfer", color: "text-purple-500" };
  return { label: type, color: "text-muted-foreground" };
}

// ─── Process badge ────────────────────────────────────────────────────────────

function ProcessBadge({ type }: { type: string }) {
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

// ─── Product image with fallback ──────────────────────────────────────────────

function ProductImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Shirt className="w-10 h-10 text-muted-foreground/20" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className="w-full h-full object-contain p-2"
      onError={() => setFailed(true)}
    />
  );
}

// ─── Stock card ───────────────────────────────────────────────────────────────

function StockCard({
  group,
  processes,
  onAdjust,
  onHistory,
  onEdit,
  onDelete,
}: {
  group: CardGroup;
  processes: StockProcess[];
  onAdjust: (item: StockItem) => void;
  onHistory: (item: StockItem) => void;
  onEdit: (item: StockItem) => void;
  onDelete: (item: StockItem) => void;
}) {
  const groupProcesses = group.finishId != null
    ? processes.filter(p => p.finish_id === group.finishId)
    : [];

  const hasLow = group.items.some(i => i.min_quantity > 0 && i.stock_quantity <= i.min_quantity);

  return (
    <div className="rounded-xl border bg-card overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow">
      {/* Image area */}
      <div className="relative aspect-square bg-white border-b">
        <ProductImage src={group.imageUrl} alt={group.displayName} />
        {hasLow && (
          <div className="absolute top-2 right-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              <TrendingDown className="w-3 h-3" /> Low stock
            </span>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        {/* Name + colour + SKU */}
        <div>
          <p className="font-semibold text-sm leading-snug line-clamp-2">{group.displayName}</p>
          {(group.colour || group.productSku) && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {[group.colour, group.productSku].filter(Boolean).join(" · ")}
            </p>
          )}
          {group.finishName && (
            <p className="text-[11px] text-muted-foreground mt-0.5 italic">{group.finishName}</p>
          )}
        </div>

        {/* Process badges */}
        {groupProcesses.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {groupProcesses.map(p => (
              <div key={p.process_id} className="flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5">
                {p.process_type && <ProcessBadge type={p.process_type} />}
                {p.item_finish_name && (
                  <span className="text-[10px] text-foreground/70 font-medium">{p.item_finish_name}</span>
                )}
                {p.placement && (
                  <span className="text-[10px] text-muted-foreground">· {p.placement}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Location */}
        {group.location && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3 shrink-0" />
            {group.location}
          </p>
        )}

        {/* Divider */}
        <div className="border-t" />

        {/* Per-size rows */}
        <div className="flex flex-col gap-1.5">
          {group.items.map(item => {
            const isLow = item.min_quantity > 0 && item.stock_quantity <= item.min_quantity;
            return (
              <div
                key={item.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs",
                  isLow ? "bg-amber-50 border border-amber-200" : "bg-muted/40"
                )}
              >
                {/* Size chip */}
                <span className={cn(
                  "rounded-md px-2 py-0.5 text-xs font-semibold shrink-0",
                  isLow
                    ? "bg-amber-200 text-amber-800"
                    : "bg-background border text-foreground"
                )}>
                  {item.size ?? "—"}
                </span>

                {/* Quantity */}
                <span className={cn(
                  "font-bold text-sm tabular-nums",
                  isLow ? "text-amber-700" : "text-foreground"
                )}>
                  {item.stock_quantity}
                </span>
                {item.min_quantity > 0 && (
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    / {item.min_quantity} min
                  </span>
                )}
                {isLow && <TrendingDown className="w-3 h-3 text-amber-500 shrink-0" />}

                {/* Spacer */}
                <div className="flex-1" />

                {/* Actions */}
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={() => onAdjust(item)}
                    className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                    title="Adjust stock"
                  >
                    <ArrowUpCircle className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onHistory(item)}
                    className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                    title="Movement history"
                  >
                    <History className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onEdit(item)}
                    className="p-1 rounded hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDelete(item)}
                    className="p-1 rounded hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StockPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ items: StockItem[]; processes: StockProcess[] }>({
    queryKey: ["portal-stock"],
    queryFn: () => apiFetch("/portal/stock"),
  });

  const items = data?.items ?? [];
  const processes = data?.processes ?? [];

  // ── Add item dialog ─────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    name: "", colour: "", size: "", initialQuantity: "0",
    minQuantity: "0", location: "", notes: "", unitPrice: "0",
  });

  const addMutation = useMutation({
    mutationFn: (body: object) => apiFetch("/portal/stock", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setAddOpen(false);
      setAddForm({ name: "", colour: "", size: "", initialQuantity: "0", minQuantity: "0", location: "", notes: "", unitPrice: "0" });
      toast({ title: "Item added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleAdd() {
    addMutation.mutate({
      name: addForm.name.trim(),
      colour: addForm.colour.trim() || null,
      size: addForm.size.trim() || null,
      unitPrice: parseFloat(addForm.unitPrice) || 0,
      initialQuantity: parseInt(addForm.initialQuantity) || 0,
      minQuantity: parseInt(addForm.minQuantity) || 0,
      location: addForm.location.trim() || null,
      notes: addForm.notes.trim() || null,
    });
  }

  // ── Edit item dialog ────────────────────────────────────────────────────────
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [editForm, setEditForm] = useState({ name: "", colour: "", size: "", minQuantity: "0", location: "", notes: "" });

  function openEdit(item: StockItem) {
    setEditItem(item);
    setEditForm({
      name: item.name,
      colour: item.colour ?? "",
      size: item.size ?? "",
      minQuantity: String(item.min_quantity),
      location: item.location ?? "",
      notes: item.notes ?? "",
    });
  }

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/portal/stock/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setEditItem(null);
      toast({ title: "Item updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleEdit() {
    if (!editItem) return;
    editMutation.mutate({
      id: editItem.id,
      body: {
        name: editForm.name.trim(),
        colour: editForm.colour.trim() || null,
        size: editForm.size.trim() || null,
        minQuantity: parseInt(editForm.minQuantity) || 0,
        location: editForm.location.trim() || null,
        notes: editForm.notes.trim() || null,
      },
    });
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  const [deleteItem, setDeleteItem] = useState<StockItem | null>(null);
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/stock/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setDeleteItem(null);
      toast({ title: "Item removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Adjust dialog ───────────────────────────────────────────────────────────
  const [adjustItem, setAdjustItem] = useState<StockItem | null>(null);
  const [adjustForm, setAdjustForm] = useState({ type: "in" as "in" | "out" | "adjustment", quantity: "1", notes: "", recipientName: "" });

  function openAdjust(item: StockItem) {
    setAdjustItem(item);
    setAdjustForm({ type: "in", quantity: "1", notes: "", recipientName: "" });
  }

  const adjustMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiFetch(`/portal/stock/${id}/adjust`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-stock"] });
      setAdjustItem(null);
      toast({ title: "Stock adjusted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleAdjust() {
    if (!adjustItem) return;
    const qty = parseInt(adjustForm.quantity);
    if (!qty || qty < 1) { toast({ title: "Enter a valid quantity", variant: "destructive" }); return; }
    adjustMutation.mutate({
      id: adjustItem.id,
      body: {
        type: adjustForm.type,
        quantity: qty,
        notes: adjustForm.notes.trim() || null,
        recipientName: adjustForm.recipientName.trim() || null,
      },
    });
  }

  // ── Movement history sheet ──────────────────────────────────────────────────
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const { data: movements = [], isLoading: movementsLoading } = useQuery<Movement[]>({
    queryKey: ["portal-stock-movements", historyItem?.id],
    queryFn: () => apiFetch(`/portal/stock/${historyItem!.id}/movements`),
    enabled: !!historyItem,
  });

  const lowStockCount = items.filter(i => i.min_quantity > 0 && i.stock_quantity <= i.min_quantity).length;
  const cardGroups = groupItems(items);

  return (
    <PortalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Stores</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your store cupboard — items are automatically deducted when you place an order.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" /> Add Item
          </Button>
        </div>

        {/* Low stock alert */}
        {lowStockCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 font-medium">
              {lowStockCount} item{lowStockCount !== 1 ? "s are" : " is"} at or below minimum stock level.
              Consider placing a top-up order.
            </p>
          </div>
        )}

        {/* Card grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : cardGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Package className="w-12 h-12 opacity-20" />
            <p className="font-medium">No items in your stores yet</p>
            <p className="text-sm">Add your first item to start tracking your store levels.</p>
            <Button variant="outline" onClick={() => setAddOpen(true)} className="gap-2 mt-2">
              <Plus className="w-4 h-4" /> Add Item
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {cardGroups.map(group => (
              <StockCard
                key={group.key}
                group={group}
                processes={processes}
                onAdjust={openAdjust}
                onHistory={setHistoryItem}
                onEdit={openEdit}
                onDelete={setDeleteItem}
              />
            ))}
          </div>
        )}

        {/* ── Add Item Dialog ──────────────────────────────────────────────── */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Item</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Item Name *</Label>
                <Input
                  placeholder="e.g. Embroidered Polo Shirt"
                  value={addForm.name}
                  onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Colour</Label>
                  <Input placeholder="e.g. Navy Blue" value={addForm.colour} onChange={e => setAddForm(f => ({ ...f, colour: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Input placeholder="e.g. XL" value={addForm.size} onChange={e => setAddForm(f => ({ ...f, size: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Initial Quantity</Label>
                  <Input type="number" min="0" value={addForm.initialQuantity} onChange={e => setAddForm(f => ({ ...f, initialQuantity: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Min Stock Level</Label>
                  <Input type="number" min="0" value={addForm.minQuantity} onChange={e => setAddForm(f => ({ ...f, minQuantity: e.target.value }))} placeholder="0 = no alert" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Storage Location</Label>
                <Input placeholder="e.g. Warehouse A, Shelf 3" value={addForm.location} onChange={e => setAddForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} placeholder="Any additional notes…" value={addForm.notes} onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={handleAdd} disabled={!addForm.name.trim() || addMutation.isPending}>
                {addMutation.isPending ? "Adding…" : "Add Item"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Edit Item Dialog ─────────────────────────────────────────────── */}
        <Dialog open={!!editItem} onOpenChange={v => !v && setEditItem(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Edit Item</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Item Name *</Label>
                <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Colour</Label>
                  <Input value={editForm.colour} onChange={e => setEditForm(f => ({ ...f, colour: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <Label>Size</Label>
                  <Input value={editForm.size} onChange={e => setEditForm(f => ({ ...f, size: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Min Stock Level</Label>
                <Input type="number" min="0" value={editForm.minQuantity} onChange={e => setEditForm(f => ({ ...f, minQuantity: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Storage Location</Label>
                <Input value={editForm.location} onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditItem(null)}>Cancel</Button>
              <Button onClick={handleEdit} disabled={!editForm.name.trim() || editMutation.isPending}>
                {editMutation.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete Confirm Dialog ────────────────────────────────────────── */}
        <Dialog open={!!deleteItem} onOpenChange={v => !v && setDeleteItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader><DialogTitle>Remove Item</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Remove <strong>{deleteItem?.name}</strong>
              {deleteItem?.colour || deleteItem?.size
                ? ` (${[deleteItem?.colour, deleteItem?.size].filter(Boolean).join(", ")})`
                : ""}?
              This will also delete all movement history for this item.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button>
              <Button
                variant="destructive"
                onClick={() => deleteItem && deleteMutation.mutate(deleteItem.id)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Removing…" : "Remove"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Adjust Stock Dialog ──────────────────────────────────────────── */}
        <Dialog open={!!adjustItem} onOpenChange={v => !v && setAdjustItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>
                Adjust — {adjustItem?.product_name ?? adjustItem?.name}
                {adjustItem?.size ? ` (${adjustItem.size})` : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label>Movement Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["in", "out", "adjustment"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setAdjustForm(f => ({ ...f, type: t }))}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors capitalize",
                        adjustForm.type === t
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:bg-muted"
                      )}
                    >
                      {t === "in" && <ArrowUpCircle className="w-4 h-4" />}
                      {t === "out" && <ArrowDownCircle className="w-4 h-4" />}
                      {t === "adjustment" && <RefreshCw className="w-4 h-4" />}
                      {t === "in" ? "Stock In" : t === "out" ? "Stock Out" : "Adjustment"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Quantity</Label>
                <Input
                  type="number" min="1"
                  value={adjustForm.quantity}
                  onChange={e => setAdjustForm(f => ({ ...f, quantity: e.target.value }))}
                />
                {adjustItem && adjustForm.type === "out" && (
                  <p className="text-xs text-muted-foreground">
                    Current stock: <strong>{adjustItem.stock_quantity}</strong>
                    {parseInt(adjustForm.quantity) > adjustItem.stock_quantity
                      ? <span className="text-amber-600"> — this will go negative</span>
                      : null}
                  </p>
                )}
              </div>
              {adjustForm.type === "out" && (
                <div className="space-y-1.5">
                  <Label>Recipient Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    placeholder="Who is this being issued to?"
                    value={adjustForm.recipientName}
                    onChange={e => setAdjustForm(f => ({ ...f, recipientName: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder="Reason for adjustment…"
                  value={adjustForm.notes}
                  onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
              <Button onClick={handleAdjust} disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Movement History Sheet ───────────────────────────────────────── */}
        <Sheet open={!!historyItem} onOpenChange={v => !v && setHistoryItem(null)}>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader className="mb-4">
              <SheetTitle>
                Movement History — {historyItem?.product_name ?? historyItem?.name}
                {historyItem?.size ? ` (${historyItem.size})` : ""}
              </SheetTitle>
            </SheetHeader>

            {movementsLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : movements.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No movements recorded yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {movements.map(m => {
                  const { label, color } = movementLabel(m.movement_type);
                  const sign = m.movement_type === "out" || m.movement_type === "issue" ? "-" : m.movement_type === "in" ? "+" : "±";
                  return (
                    <div key={m.id} className="rounded-lg border p-3 flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs font-semibold", color)}>{label}</span>
                          <span className="text-sm font-bold tabular-nums">{sign}{Math.abs(m.quantity)}</span>
                        </div>
                        {m.recipient_name && (
                          <p className="text-xs text-muted-foreground mt-0.5">Issued to: {m.recipient_name}</p>
                        )}
                        {m.reference && (
                          <p className="text-xs text-muted-foreground mt-0.5">Ref: {m.reference}</p>
                        )}
                        {m.notes && (
                          <p className="text-xs text-muted-foreground mt-0.5 italic">{m.notes}</p>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          {fmt(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ""}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </PortalLayout>
  );
}
