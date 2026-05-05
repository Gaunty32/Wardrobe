import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import PortalLayout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertTriangle, Plus, ArrowUpCircle, ArrowDownCircle, History,
  Pencil, Trash2, Package, MapPin, TrendingDown, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface StockItem {
  id: number;
  name: string;
  product_id: number | null;
  product_name: string | null;
  colour: string | null;
  size: string | null;
  unit_price: string | null;
  stock_quantity: number;
  min_quantity: number;
  location: string | null;
  notes: string | null;
  movement_count: number;
  last_movement_at: string | null;
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

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtQty(q: number) {
  const abs = Math.abs(q);
  return q > 0 ? `+${abs}` : `${q}`;
}

function movementLabel(type: string) {
  if (type === "in") return { label: "Stock In", color: "text-green-600" };
  if (type === "out") return { label: "Stock Out", color: "text-red-500" };
  if (type === "issue") return { label: "Issued", color: "text-orange-500" };
  if (type === "adjustment") return { label: "Adjustment", color: "text-blue-500" };
  if (type === "transfer") return { label: "Transfer", color: "text-purple-500" };
  return { label: type, color: "text-muted-foreground" };
}

export default function StockPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery<StockItem[]>({
    queryKey: ["portal-stock"],
    queryFn: () => apiFetch("/portal/stock"),
  });

  // ── Add item dialog ────────────────────────────────────────────────────────
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
      toast({ title: "Stock item added" });
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

  // ── Edit item dialog ───────────────────────────────────────────────────────
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

  // ── Delete ─────────────────────────────────────────────────────────────────
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

  // ── Adjust dialog ──────────────────────────────────────────────────────────
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

  // ── Movement history sheet ─────────────────────────────────────────────────
  const [historyItem, setHistoryItem] = useState<StockItem | null>(null);
  const { data: movements = [], isLoading: movementsLoading } = useQuery<Movement[]>({
    queryKey: ["portal-stock-movements", historyItem?.id],
    queryFn: () => apiFetch(`/portal/stock/${historyItem!.id}/movements`),
    enabled: !!historyItem,
  });

  const lowStockCount = items.filter(i => i.min_quantity > 0 && i.stock_quantity <= i.min_quantity).length;

  return (
    <PortalLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Stock Management</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Manage your branded garment stock — items are automatically deducted when you place orders.
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

        {/* Stock table */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading stock…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <Package className="w-12 h-12 opacity-20" />
            <p className="font-medium">No stock items yet</p>
            <p className="text-sm">Add your first item to start tracking your stock levels.</p>
            <Button variant="outline" onClick={() => setAddOpen(true)} className="gap-2 mt-2">
              <Plus className="w-4 h-4" /> Add Stock Item
            </Button>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold">Item</th>
                  <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Colour / Size</th>
                  <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Location</th>
                  <th className="text-right px-4 py-3 font-semibold">Qty</th>
                  <th className="text-right px-4 py-3 font-semibold hidden sm:table-cell">Min</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map(item => {
                  const isLow = item.min_quantity > 0 && item.stock_quantity <= item.min_quantity;
                  return (
                    <tr key={item.id} className={cn("hover:bg-muted/30 transition-colors", isLow && "bg-amber-50/60 hover:bg-amber-50")}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{item.name}</div>
                        {item.product_name && (
                          <div className="text-xs text-muted-foreground">{item.product_name}</div>
                        )}
                        <div className="sm:hidden text-xs text-muted-foreground mt-0.5">
                          {[item.colour, item.size].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground">
                        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                        {item.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" /> {item.location}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={cn("font-semibold text-base", isLow ? "text-amber-700" : "text-foreground")}>
                          {item.stock_quantity}
                        </span>
                        {isLow && <TrendingDown className="w-3.5 h-3.5 text-amber-500 inline ml-1" />}
                      </td>
                      <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground">
                        {item.min_quantity > 0 ? item.min_quantity : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => openAdjust(item)}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Adjust stock"
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setHistoryItem(item)}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Movement history"
                          >
                            <History className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="Edit"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteItem(item)}
                            className="p-1.5 rounded-md hover:bg-red-50 transition-colors text-muted-foreground hover:text-red-600"
                            title="Remove"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Add Item Dialog ──────────────────────────────────────────────── */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add Stock Item</DialogTitle></DialogHeader>
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
            <DialogHeader><DialogTitle>Edit Stock Item</DialogTitle></DialogHeader>
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
            <DialogHeader><DialogTitle>Remove Stock Item</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Remove <strong>{deleteItem?.name}</strong>
              {deleteItem?.colour || deleteItem?.size ? ` (${[deleteItem?.colour, deleteItem?.size].filter(Boolean).join(", ")})` : ""}?
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
                Adjust Stock — {adjustItem?.name}
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
                      ? <span className="text-red-500 ml-1">— exceeds available stock</span>
                      : null}
                  </p>
                )}
              </div>
              {(adjustForm.type === "out" || adjustForm.type === "in") && (
                <div className="space-y-1.5">
                  <Label>{adjustForm.type === "out" ? "Recipient Name" : "Supplier / Source"}</Label>
                  <Input
                    placeholder={adjustForm.type === "out" ? "Who is receiving these items?" : "Where are these items from?"}
                    value={adjustForm.recipientName}
                    onChange={e => setAdjustForm(f => ({ ...f, recipientName: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} placeholder="Optional notes…" value={adjustForm.notes} onChange={e => setAdjustForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustItem(null)}>Cancel</Button>
              <Button onClick={handleAdjust} disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? "Saving…" : "Record Movement"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Movement History Sheet ───────────────────────────────────────── */}
        <Sheet open={!!historyItem} onOpenChange={v => !v && setHistoryItem(null)}>
          <SheetContent className="w-full sm:max-w-md overflow-y-auto">
            <SheetHeader className="mb-4">
              <SheetTitle>
                Movement History
                {historyItem && (
                  <span className="block text-sm font-normal text-muted-foreground mt-0.5">
                    {historyItem.name}
                    {historyItem.size ? ` · ${historyItem.size}` : ""}
                    {historyItem.colour ? ` · ${historyItem.colour}` : ""}
                  </span>
                )}
              </SheetTitle>
            </SheetHeader>
            {movementsLoading ? (
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : movements.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <History className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No movements recorded yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {movements.map(m => {
                  const { label, color } = movementLabel(m.movement_type);
                  return (
                    <div key={m.id} className="rounded-lg border bg-card px-4 py-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-sm font-semibold", color)}>{label}</span>
                        <span className={cn("text-sm font-bold tabular-nums", m.quantity > 0 ? "text-green-600" : "text-red-500")}>
                          {fmtQty(m.quantity)}
                        </span>
                      </div>
                      {m.recipient_name && (
                        <p className="text-xs text-muted-foreground">Recipient: {m.recipient_name}</p>
                      )}
                      {m.reference && (
                        <p className="text-xs text-muted-foreground">Ref: {m.reference}</p>
                      )}
                      {m.notes && <p className="text-xs text-muted-foreground">{m.notes}</p>}
                      <p className="text-xs text-muted-foreground">
                        {fmt(m.created_at)}{m.created_by_name ? ` · ${m.created_by_name}` : ""}
                      </p>
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
