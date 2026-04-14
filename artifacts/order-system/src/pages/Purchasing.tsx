import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Package, AlertTriangle, CheckCircle, Mail, ChevronDown, ChevronRight,
  RefreshCw, Plus, FileText, Truck, Clock, TriangleAlert, Trash2, ArrowRight,
  CalendarDays, PackageCheck, Send, Loader2, ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface PurchaseRequirement {
  itemId: number; orderId: number; orderNumber: string | null; customerName: string | null;
  productId: number | null; productName: string; colour: string | null; size: string | null;
  purchaseQuantity: number | null; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  supplierCode: string | null; productSku: string | null; canonicalProductName: string | null;
}
interface SupplierGroup {
  supplierId: number | null; supplierName: string; supplierEmail: string | null; items: PurchaseRequirement[];
}

interface POItem {
  id: number; poId: number; orderItemId: number | null; orderId: number | null; orderNumber: string | null;
  productName: string; colour: string | null; size: string | null; quantityOrdered: number;
  quantityDelivered: number; estimatedDueDate: string | null; notes: string | null;
}

interface PurchaseOrder {
  id: number; poNumber: string; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  status: "draft" | "ordered" | "delivered"; notes: string | null; sentAt: string | null;
  createdAt: string; updatedAt: string; items: POItem[];
}

const STATUS_CFG = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700 border-slate-300", icon: FileText },
  ordered: { label: "Ordered", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Send },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-800 border-green-300", icon: PackageCheck },
};

function lineStatus(item: POItem) {
  if (item.quantityDelivered >= item.quantityOrdered) return "delivered";
  if (item.quantityDelivered > 0) return "partial";
  return "pending";
}

function buildEmailBody(group: SupplierGroup, notes: string): string {
  const productMap = new Map<string, Map<string, number>>();
  for (const item of group.items) {
    const key = item.productName;
    if (!productMap.has(key)) productMap.set(key, new Map());
    const sizeKey = [item.colour, item.size].filter(Boolean).join(" / ") || "N/A";
    const existing = productMap.get(key)!.get(sizeKey) ?? 0;
    productMap.get(key)!.set(sizeKey, existing + (item.purchaseQuantity ?? 0));
  }
  const lines: string[] = [];
  lines.push(`Dear ${group.supplierName},`, ``, `Please supply the following items:`, ``);
  for (const [product, sizes] of productMap.entries()) {
    lines.push(`${product}:`);
    for (const [size, qty] of sizes.entries()) lines.push(`  ${size}: ${qty}`);
    lines.push(``);
  }
  const orders = [...new Set(group.items.map((i) => i.orderNumber).filter(Boolean))];
  lines.push(`These are required for orders: ${orders.join(", ")}`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``, `Kind regards,`, `Select Branding Solutions`);
  return lines.join("\n");
}

function productDisplayName(item: PurchaseRequirement): string {
  return item.canonicalProductName ?? item.productName;
}

function productLabel(item: PurchaseRequirement): string {
  const name = productDisplayName(item);
  const code = item.supplierCode ?? item.productSku;
  return code ? `${code} — ${name}` : name;
}

function MatrixTable({ items }: { items: PurchaseRequirement[] }) {
  const productKeys = [...new Map(items.map((i) => [productDisplayName(i), i])).values()];
  const sizeKeys = [...new Set(items.map((i) => [i.colour, i.size].filter(Boolean).join(" / ") || "N/A"))];
  if (productKeys.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Product</TableHead>
            {sizeKeys.map((s) => <TableHead key={s} className="text-center font-semibold min-w-[80px]">{s}</TableHead>)}
            <TableHead className="text-center font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {productKeys.map((rep) => {
            const pName = productDisplayName(rep);
            const productItems = items.filter((i) => productDisplayName(i) === pName);
            const totalQty = productItems.reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
            return (
              <TableRow key={pName}>
                <TableCell>
                  <div className="font-medium text-sm">{pName}</div>
                  {(rep.supplierCode || rep.productSku) && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {rep.supplierCode && <span className="mr-2">Supplier Code: {rep.supplierCode}</span>}
                      {rep.productSku && <span>SKU: {rep.productSku}</span>}
                    </div>
                  )}
                </TableCell>
                {sizeKeys.map((sizeKey) => {
                  const qty = productItems.filter((i) => ([i.colour, i.size].filter(Boolean).join(" / ") || "N/A") === sizeKey).reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
                  return <TableCell key={sizeKey} className="text-center">{qty > 0 ? <span className="font-semibold text-primary">{qty}</span> : <span className="text-muted-foreground">—</span>}</TableCell>;
                })}
                <TableCell className="text-center font-bold">{totalQty}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function EmailDialog({ group, open, onClose, onSent }: { group: SupplierGroup; open: boolean; onClose: () => void; onSent: (ids: number[]) => void }) {
  const [notes, setNotes] = useState("");
  const emailBody = buildEmailBody(group, notes);
  const subject = encodeURIComponent(`Purchase Order — Select Branding Solutions`);
  const mailto = `mailto:${group.supplierEmail ?? ""}?subject=${subject}&body=${encodeURIComponent(emailBody)}`;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" />Purchase Order — {group.supplierName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Additional Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes for this supplier..." rows={2} /></div>
          <div className="space-y-1"><Label>Email Preview</Label><pre className="text-xs bg-muted/50 border border-border rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">{emailBody}</pre></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { window.open(mailto, "_blank"); onSent(group.items.map((i) => i.itemId)); }} className="gap-2"><Mail className="w-4 h-4" />Open Email Client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function POLineRow({ po, line, onSave }: {
  po: PurchaseOrder;
  line: POItem;
  onSave: (itemId: number, data: { quantityDelivered?: number; estimatedDueDate?: string | null; notes?: string | null }) => void;
}) {
  const [qtyDel, setQtyDel] = useState(String(line.quantityDelivered));
  const [dueDate, setDueDate] = useState(line.estimatedDueDate ? line.estimatedDueDate.split("T")[0] : "");
  const [notes, setNotes] = useState(line.notes ?? "");
  const [dirty, setDirty] = useState(false);
  const status = lineStatus(line);

  const statusConfig = {
    pending: { label: "Pending", color: "bg-slate-100 text-slate-600 border-slate-200" },
    partial: { label: "Partial", color: "bg-amber-100 text-amber-700 border-amber-300" },
    delivered: { label: "Delivered", color: "bg-green-100 text-green-700 border-green-300" },
  };

  const isDraft = po.status === "draft";
  const isEditable = po.status === "ordered" || isDraft;

  return (
    <div className="rounded-lg border border-border bg-background p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{line.productName}</div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {line.colour && <Badge variant="outline" className="text-xs py-0">{line.colour}</Badge>}
            {line.size && <Badge variant="outline" className="text-xs py-0">{line.size}</Badge>}
            {line.orderNumber && <span className="text-xs text-muted-foreground">Order {line.orderNumber}</span>}
          </div>
        </div>
        <Badge className={`text-xs flex-shrink-0 ${statusConfig[status].color}`}>{statusConfig[status].label}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 items-end">
        <div>
          <div className="text-xs text-muted-foreground mb-1">Ordered</div>
          <div className="h-9 flex items-center px-3 rounded-md border border-transparent bg-muted/30 text-sm font-semibold">{line.quantityOrdered}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">Delivered</div>
          {isEditable ? (
            <Input
              type="number" min={0} max={line.quantityOrdered} value={qtyDel}
              onChange={(e) => { setQtyDel(e.target.value); setDirty(true); }}
              className="h-9 text-sm"
            />
          ) : (
            <div className="h-9 flex items-center px-3 rounded-md border border-transparent bg-muted/30 text-sm font-semibold">{line.quantityDelivered}</div>
          )}
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><CalendarDays className="w-3 h-3" />Est. Due</div>
          {isEditable ? (
            <Input type="date" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setDirty(true); }} className="h-9 text-sm" />
          ) : (
            <div className="h-9 flex items-center px-3 rounded-md border border-transparent bg-muted/30 text-xs text-muted-foreground">
              {line.estimatedDueDate ? formatDate(line.estimatedDueDate) : "—"}
            </div>
          )}
        </div>
      </div>

      {isEditable && (
        <div className="space-y-1">
          <Input placeholder="Line notes..." value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} className="h-8 text-xs" />
        </div>
      )}

      {isEditable && dirty && (
        <div className="flex justify-end">
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => {
            const parsed = parseInt(qtyDel);
            onSave(line.id, {
              quantityDelivered: isNaN(parsed) ? line.quantityDelivered : Math.max(0, Math.min(parsed, line.quantityOrdered)),
              estimatedDueDate: dueDate || null,
              notes: notes || null,
            });
            setDirty(false);
          }}>
            <CheckCircle className="w-3 h-3" /> Save
          </Button>
        </div>
      )}
    </div>
  );
}

function POCard({
  po, onStatusChange, onDelete, onLineUpdate,
}: {
  po: PurchaseOrder;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onLineUpdate: (poId: number, itemId: number, data: Record<string, unknown>) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CFG[po.status];
  const StatusIcon = cfg.icon;

  const totalOrdered = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalDelivered = po.items.reduce((s, i) => s + i.quantityDelivered, 0);
  const allDelivered = po.items.length > 0 && po.items.every((i) => i.quantityDelivered >= i.quantityOrdered);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded((e) => !e)}>
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold">{po.poNumber}</span>
              <Badge className={`text-xs gap-1 ${cfg.color}`}><StatusIcon className="w-3 h-3" />{cfg.label}</Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium">{po.supplierName}</span>
              <span className="mx-1">·</span>
              <span>{po.items.length} line{po.items.length !== 1 ? "s" : ""}</span>
              <span className="mx-1">·</span>
              <span>{totalDelivered}/{totalOrdered} units</span>
              <span className="mx-1">·</span>
              <span>{formatDate(po.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {po.status === "draft" && (
            <Button size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onStatusChange(po.id, "ordered")}>
              <Send className="w-3.5 h-3.5" /> Mark Ordered
            </Button>
          )}
          {po.status === "ordered" && allDelivered && (
            <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onStatusChange(po.id, "delivered")}>
              <PackageCheck className="w-3.5 h-3.5" /> Mark Delivered
            </Button>
          )}
          {po.status === "draft" && (
            <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => onDelete(po.id)}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {po.notes && <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{po.notes}</div>}
          {po.items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No lines on this PO yet.</div>
          ) : (
            <div className="space-y-2">
              {po.items.map((line) => (
                <POLineRow
                  key={line.id}
                  po={po}
                  line={line}
                  onSave={(lineId, data) => onLineUpdate(po.id, lineId, data)}
                />
              ))}
            </div>
          )}
          {po.status === "ordered" && !allDelivered && (
            <div className="text-xs text-muted-foreground text-center pt-1">
              Update delivered quantities above, then "Mark Delivered" will appear when all lines are complete.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Purchasing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [emailGroup, setEmailGroup] = useState<SupplierGroup | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createPoGroup, setCreatePoGroup] = useState<SupplierGroup | null>(null);
  const [createPoNotes, setCreatePoNotes] = useState("");

  const { data: groups = [], isLoading: reqLoading, refetch: refetchReqs } = useQuery<SupplierGroup[]>({
    queryKey: ["purchasing-requirements"],
    queryFn: () => apiFetch("/purchasing/requirements"),
  });

  const { data: purchaseOrders = [], isLoading: posLoading, refetch: refetchPos } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders"],
    queryFn: () => apiFetch("/purchasing/purchase-orders"),
  });

  const fulfillMutation = useMutation({
    mutationFn: (itemIds: number[]) => apiFetch("/purchasing/mark-fulfilled", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] }); setSelectedItems({}); toast({ title: "Marked as fulfilled" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const createPoMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/purchasing/purchase-orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      setCreatePoGroup(null); setCreatePoNotes("");
      toast({ title: "Draft PO created", description: "Switch to Purchase Orders tab to manage it." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addToPoMutation = useMutation({
    mutationFn: ({ poId, itemIds }: { poId: number; itemIds: number[] }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items`, { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); toast({ title: "Items added to draft PO" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/purchasing/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); toast({ title: "Status updated" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/purchasing/purchase-orders/${id}`, { method: "DELETE" }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); toast({ title: "PO deleted" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const lineUpdateMutation = useMutation({
    mutationFn: ({ poId, itemId, data }: { poId: number; itemId: number; data: Record<string, unknown> }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchase-orders"] }); queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] }); toast({ title: "Line updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleGroup = (name: string) => setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  const toggleItem = (id: number) => setSelectedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleGroupItems = (group: SupplierGroup) => {
    const allSel = group.items.every((i) => selectedItems[i.itemId]);
    const upd = { ...selectedItems };
    group.items.forEach((i) => { upd[i.itemId] = !allSel; });
    setSelectedItems(upd);
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;
  const selectedIds = Object.entries(selectedItems).filter(([, v]) => v).map(([k]) => parseInt(k));
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const filteredPos = purchaseOrders.filter((po) => statusFilter === "all" || po.status === statusFilter);
  const draftCount = purchaseOrders.filter((p) => p.status === "draft").length;
  const orderedCount = purchaseOrders.filter((p) => p.status === "ordered").length;

  const getDraftPoForSupplier = (supplierId: number | null, supplierName: string) =>
    purchaseOrders.find((po) => po.status === "draft" && (supplierId ? po.supplierId === supplierId : po.supplierName === supplierName));

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="w-7 h-7 text-primary" /> Purchasing
            </h1>
            <p className="text-muted-foreground mt-1">Manage purchase requirements and supplier orders.</p>
          </div>
        </div>

        <Tabs defaultValue="requirements">
          <TabsList className="mb-4">
            <TabsTrigger value="requirements" className="gap-2">
              <AlertTriangle className="w-4 h-4" /> Requirements
              {totalItems > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalItems}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <FileText className="w-4 h-4" /> Purchase Orders
              {(draftCount + orderedCount) > 0 && <Badge variant="secondary" className="ml-1 text-xs">{draftCount + orderedCount}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Requirements Tab ── */}
          <TabsContent value="requirements">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedCount > 0 && (
                    <Button variant="outline" onClick={() => fulfillMutation.mutate(selectedIds)} disabled={fulfillMutation.isPending} className="gap-2 border-green-500 text-green-700 hover:bg-green-50">
                      <CheckCircle className="w-4 h-4" /> Mark {selectedCount} Fulfilled
                    </Button>
                  )}
                </div>
                <Button variant="ghost" size="icon" onClick={() => refetchReqs()}><RefreshCw className="w-4 h-4" /></Button>
              </div>

              {reqLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : groups.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <CheckCircle className="w-12 h-12 text-green-400" />
                  <p className="text-lg font-medium">No purchasing required</p>
                  <p className="text-sm">All order items are in stock or fulfilled.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>{totalItems} item{totalItems !== 1 ? "s" : ""} across {groups.length} supplier{groups.length !== 1 ? "s" : ""} need purchasing</span>
                  </div>

                  {groups.map((group) => {
                    const isExpanded = expandedGroups[group.supplierName] !== false;
                    const allGroupSelected = group.items.every((i) => selectedItems[i.itemId]);
                    const someGroupSelected = group.items.some((i) => selectedItems[i.itemId]);
                    const totalQty = group.items.reduce((s, i) => s + (i.purchaseQuantity ?? 0), 0);
                    const existingDraft = getDraftPoForSupplier(group.supplierId, group.supplierName);

                    return (
                      <div key={group.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggleGroup(group.supplierName)}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div onClick={(e) => { e.stopPropagation(); toggleGroupItems(group); }}>
                              <Checkbox checked={allGroupSelected} className={someGroupSelected && !allGroupSelected ? "data-[state=unchecked]:bg-primary/20" : ""} />
                            </div>
                            <div>
                              <div className="font-semibold text-base flex items-center gap-2">
                                {group.supplierName}
                                {group.supplierId === null && (
                                  <span className="text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                    Set supplier on the product to assign
                                  </span>
                                )}
                              </div>
                              {group.supplierEmail && <div className="text-xs text-muted-foreground">{group.supplierEmail}</div>}
                            </div>
                            <Badge variant="secondary">{group.items.length} line{group.items.length !== 1 ? "s" : ""}</Badge>
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{totalQty} units needed</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {existingDraft ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                onClick={() => addToPoMutation.mutate({ poId: existingDraft.id, itemIds: group.items.map((i) => i.itemId) })}
                                disabled={addToPoMutation.isPending}>
                                <Plus className="w-3.5 h-3.5" /> Add to Draft PO ({existingDraft.poNumber})
                              </Button>
                            ) : null}
                            <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90" onClick={() => setCreatePoGroup(group)}>
                              <FileText className="w-3.5 h-3.5" /> Create Draft PO
                            </Button>
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setEmailGroup(group)}>
                              <Mail className="w-3.5 h-3.5" /> Email
                            </Button>
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border px-5 py-4 space-y-5">
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Purchase Matrix</h4>
                              <MatrixTable items={group.items} />
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Line Details</h4>
                              <div className="space-y-2">
                                {group.items.map((item) => (
                                  <div key={item.itemId} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                    <Checkbox checked={!!selectedItems[item.itemId]} onCheckedChange={() => toggleItem(item.itemId)} />
                                    <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium text-sm">{productDisplayName(item)}</div>
                                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                        {item.supplierCode && <span className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0">Supplier Code: {item.supplierCode}</span>}
                                        {item.productSku && !item.supplierCode && <span className="text-xs font-mono text-muted-foreground">SKU: {item.productSku}</span>}
                                        {item.colour && <Badge variant="outline" className="text-xs py-0">{item.colour}</Badge>}
                                        {item.size && <Badge variant="outline" className="text-xs py-0">{item.size}</Badge>}
                                        <span className="text-xs text-muted-foreground">Order: <a href={`/orders/${item.orderId}`} className="text-primary hover:underline">{item.orderNumber}</a>{item.customerName && ` · ${item.customerName}`}</span>
                                      </div>
                                    </div>
                                    <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm font-semibold">× {item.purchaseQuantity ?? 0}</Badge>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Purchase Orders Tab ── */}
          <TabsContent value="orders">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    {(["draft", "ordered", "delivered"] as const).map((s) => {
                      const count = purchaseOrders.filter((p) => p.status === s).length;
                      const c = STATUS_CFG[s];
                      const Icon = c.icon;
                      return (
                        <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${statusFilter === s ? `${c.color} shadow-sm` : "border-border text-muted-foreground hover:border-primary/40"}`}>
                          <Icon className="w-3.5 h-3.5" />{c.label} <span className="font-bold">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => refetchPos()}><RefreshCw className="w-4 h-4" /></Button>
              </div>

              {posLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : filteredPos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <FileText className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-lg font-medium">{statusFilter === "all" ? "No purchase orders yet" : `No ${STATUS_CFG[statusFilter as keyof typeof STATUS_CFG]?.label} orders`}</p>
                  <p className="text-sm">Create a draft PO from the Requirements tab.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPos.map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      onStatusChange={(id, status) => statusMutation.mutate({ id, status })}
                      onDelete={(id) => { if (confirm("Delete this draft PO?")) deleteMutation.mutate(id); }}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {/* ── Create PO dialog ── */}
        {createPoGroup && (
          <Dialog open={!!createPoGroup} onOpenChange={() => setCreatePoGroup(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Create Draft PO — {createPoGroup.supplierName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-border divide-y text-sm">
                  {createPoGroup.items.map((item) => (
                    <div key={item.itemId} className="flex justify-between px-3 py-2">
                      <span className="font-medium">{item.productName}</span>
                      <span className="text-muted-foreground">{[item.colour, item.size].filter(Boolean).join(" / ")} <strong>× {item.purchaseQuantity}</strong></span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea placeholder="Any notes for this purchase order..." value={createPoNotes} onChange={(e) => setCreatePoNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreatePoGroup(null)}>Cancel</Button>
                <Button
                  onClick={() => createPoMutation.mutate({
                    supplierId: createPoGroup.supplierId,
                    supplierName: createPoGroup.supplierName,
                    supplierEmail: createPoGroup.supplierEmail,
                    notes: createPoNotes || null,
                    itemIds: createPoGroup.items.map((i) => i.itemId),
                  })}
                  disabled={createPoMutation.isPending}
                  className="gap-1.5"
                >
                  {createPoMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><FileText className="w-4 h-4" />Create Draft PO</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {emailGroup && (
          <EmailDialog group={emailGroup} open={!!emailGroup} onClose={() => setEmailGroup(null)} onSent={(ids) => { setEmailGroup(null); fulfillMutation.mutate(ids); }} />
        )}
      </div>
    </Layout>
  );
}
