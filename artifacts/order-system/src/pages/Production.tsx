import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ClipboardList, CheckCircle2, Clock, Printer, ArrowRight,
  RefreshCw, Trash2, ChevronDown, ChevronRight, Sparkles, User, Archive, Ruler, Palette,
  ShoppingCart, ExternalLink, ListChecks, CheckSquare, Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProcessStep {
  id: number;
  name: string;
  type: string | null;
  placement: string | null;
  price: number | null;
  notes: string | null;
}

interface WorksheetItem {
  id: number;
  worksheetId: number;
  orderItemId: number | null;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  finishId: number | null;
  finishName: string | null;
  processes: ProcessStep[];
  notes: string | null;
}

interface Worksheet {
  id: number;
  worksheetNumber: string;
  status: "pre_wip" | "wip" | "complete";
  orderId: number | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string | null;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: WorksheetItem[];
}

interface PendingItem {
  id: number;
  productName: string;
  colour: string | null;
  size: string | null;
  purchaseQuantity: number;
  supplierName: string | null;
}

interface PendingOrder {
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  items: PendingItem[];
}

interface PickingItem {
  itemId: number;
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  stockStatus: string;
  stockAllocatedAt: string | null;
}

interface PickingOrder {
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  items: PickingItem[];
}

const STATUS_CONFIG = {
  pre_wip: { label: "Pre-WIP", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Clock },
  wip: { label: "Work in Progress", color: "bg-amber-100 text-amber-800 border-amber-200", icon: ClipboardList },
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
};

function PrintWorksheet({ ws }: { ws: Worksheet }) {
  const allProcesses = ws.items.flatMap((item) => item.processes);
  const uniqueProcesses = Array.from(
    new Map(allProcesses.map((p) => [p.id, p])).values()
  );

  return (
    <div className="print-only bg-white text-black font-sans text-sm" style={{ width: "210mm", minHeight: "297mm", padding: "12mm 15mm", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6mm", borderBottom: "2px solid #1e3a5f", paddingBottom: "4mm" }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1e3a5f" }}>PRODUCTION WORKSHEET</div>
          <div style={{ fontSize: "24px", fontWeight: "900", letterSpacing: "2px", color: "#1e3a5f", marginTop: "2px" }}>{ws.worksheetNumber}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "11px", color: "#555" }}>
          <div style={{ fontWeight: "bold", fontSize: "14px" }}>Select Branding Solutions</div>
          <div>Date: {formatDate(ws.createdAt)}</div>
          <div>Order: <strong>{ws.orderNumber ?? "—"}</strong></div>
          <div>Customer: <strong>{ws.customerName ?? "—"}</strong></div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6mm", fontSize: "11px" }}>
        <thead>
          <tr style={{ backgroundColor: "#1e3a5f", color: "white" }}>
            <th style={{ padding: "4px 8px", textAlign: "left" }}>Product</th>
            <th style={{ padding: "4px 8px", textAlign: "left" }}>Colour</th>
            <th style={{ padding: "4px 8px", textAlign: "left" }}>Size</th>
            <th style={{ padding: "4px 8px", textAlign: "center" }}>Qty</th>
            <th style={{ padding: "4px 8px", textAlign: "left" }}>Recipient</th>
            <th style={{ padding: "4px 8px", textAlign: "left" }}>Finish</th>
          </tr>
        </thead>
        <tbody>
          {ws.items.map((item, i) => (
            <tr key={item.id} style={{ backgroundColor: i % 2 === 0 ? "#f9fafb" : "white" }}>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb" }}>{item.productName}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb" }}>{item.colour ?? "—"}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb" }}>{item.size ?? "—"}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb", textAlign: "center", fontWeight: "bold" }}>{item.quantity}</td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb" }}>
                {item.recipientType === "person" ? item.recipientName : "Stock"}
              </td>
              <td style={{ padding: "4px 8px", borderBottom: "1px solid #e5e7eb" }}>{item.finishName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {uniqueProcesses.length > 0 && (
        <div style={{ marginBottom: "6mm" }}>
          <div style={{ fontSize: "13px", fontWeight: "bold", color: "#1e3a5f", borderBottom: "1px solid #1e3a5f", paddingBottom: "2px", marginBottom: "4px" }}>
            Decoration Processes
          </div>
          {uniqueProcesses.map((p) => (
            <div key={p.id} style={{ fontSize: "11px", marginBottom: "2px" }}>
              <strong>{p.name}</strong>
              {p.type && ` · ${p.type}`}
              {p.placement && ` · ${p.placement}`}
              {p.notes && <span style={{ color: "#666" }}> — {p.notes}</span>}
            </div>
          ))}
        </div>
      )}

      {ws.notes && (
        <div style={{ marginTop: "4mm", padding: "3mm", backgroundColor: "#fff9c4", border: "1px solid #f59e0b", borderRadius: "4px", fontSize: "11px" }}>
          <strong>Notes:</strong> {ws.notes}
        </div>
      )}

      <div style={{ marginTop: "auto", paddingTop: "6mm", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#888" }}>
        <span>Printed: {new Date().toLocaleDateString("en-GB")}</span>
        <span>Select Branding Solutions — Internal Use Only</span>
      </div>
    </div>
  );
}

function WorksheetCard({ ws, onStatusChange, onDelete }: {
  ws: Worksheet;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[ws.status];
  const StatusIcon = cfg.icon;

  const handlePrint = () => {
    const el = document.getElementById(`ws-print-${ws.id}`);
    if (!el) return;
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    win.document.write(`<html><head><title>Worksheet ${ws.worksheetNumber}</title>
      <style>body{margin:0;padding:0;font-family:sans-serif}@media print{.no-print{display:none}}</style>
    </head><body>${el.innerHTML}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base">{ws.worksheetNumber}</span>
              <Badge className={`text-xs ${cfg.color} gap-1`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {ws.orderNumber && <span>Order {ws.orderNumber} · </span>}
              {ws.customerName && <span>{ws.customerName} · </span>}
              <span>{ws.items.length} item{ws.items.length !== 1 ? "s" : ""}</span>
              <span className="ml-2 text-xs">{formatDate(ws.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {ws.status === "pre_wip" && (
            <Button size="sm" className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={() => onStatusChange(ws.id, "wip")}>
              <ArrowRight className="w-3.5 h-3.5" /> Move to WIP
            </Button>
          )}
          {ws.status === "wip" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
              <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onStatusChange(ws.id, "complete")}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
              </Button>
            </>
          )}
          {ws.status === "complete" && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => onDelete(ws.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {ws.items.map((item) => (
            <div key={item.id} className="rounded-lg bg-muted/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{item.productName}</div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {item.colour && <Badge variant="outline" className="text-xs gap-1"><Palette className="w-3 h-3" />{item.colour}</Badge>}
                  {item.size && <Badge variant="outline" className="text-xs gap-1"><Ruler className="w-3 h-3" />{item.size}</Badge>}
                  <Badge variant="secondary" className="text-xs font-semibold">× {item.quantity}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {item.recipientType === "person" ? <><User className="w-3 h-3" />{item.recipientName}</> : <><Archive className="w-3 h-3" />Stock</>}
                </span>
                {item.finishName && (
                  <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{item.finishName}</span>
                )}
              </div>
              {item.processes.length > 0 && (
                <div className="space-y-1">
                  {item.processes.map((p) => (
                    <div key={p.id} className="text-xs text-muted-foreground flex gap-2 pl-2 border-l-2 border-amber-300">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {p.type && <span>· {p.type}</span>}
                      {p.placement && <span>· {p.placement}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {ws.notes && (
            <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{ws.notes}</div>
          )}
        </div>
      )}

      <div id={`ws-print-${ws.id}`} style={{ display: "none" }}>
        <PrintWorksheet ws={ws} />
      </div>
    </div>
  );
}

function PendingOrderCard({ order }: { order: PendingOrder }) {
  const [expanded, setExpanded] = useState(true);

  const totalUnits = order.items.reduce((s, i) => s + i.purchaseQuantity, 0);
  const suppliers = [...new Set(order.items.map((i) => i.supplierName).filter(Boolean))];

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-amber-50 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-amber-600 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-amber-600 flex-shrink-0" />}
          <ShoppingCart className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <a
                href={`/orders/${order.orderId}`}
                className="font-mono font-bold text-base hover:underline text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                {order.orderNumber}
              </a>
              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1">
                <ShoppingCart className="w-3 h-3" /> Awaiting Stock
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
              {order.customerName && <span>{order.customerName}</span>}
              {order.requiredDate && <span>· Due {formatDate(order.requiredDate)}</span>}
              <span>· {order.items.length} line{order.items.length !== 1 ? "s" : ""} · {totalUnits} unit{totalUnits !== 1 ? "s" : ""} to purchase</span>
              {suppliers.length > 0 && <span>· from {suppliers.join(", ")}</span>}
            </div>
          </div>
        </div>
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <a href={`/orders/${order.orderId}`}>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
              <ExternalLink className="w-3.5 h-3.5" /> View Order
            </Button>
          </a>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-amber-200 px-5 py-4">
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white/70 border border-amber-100">
                <Package className="w-4 h-4 text-amber-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{item.productName}</div>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    {item.colour && <Badge variant="outline" className="text-xs py-0">{item.colour}</Badge>}
                    {item.size && <Badge variant="outline" className="text-xs py-0">{item.size}</Badge>}
                    {item.supplierName && (
                      <span className="text-xs text-muted-foreground">Supplier: {item.supplierName}</span>
                    )}
                  </div>
                </div>
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm font-semibold flex-shrink-0">
                  × {item.purchaseQuantity}
                </Badge>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-700 mt-3 flex items-center gap-1.5">
            <ShoppingCart className="w-3.5 h-3.5" />
            Stock must be received in Purchasing before this order can move to production.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Picking List Tab Component ───────────────────────────────────────────────

function PickingListTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const { data: pickingOrders = [], isLoading } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 30000,
  });

  const pickMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/picking-list/pick", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      setChecked(new Set());
      toast({ title: "Items marked as picked" });
    },
    onError: () => toast({ title: "Error marking items", variant: "destructive" }),
  });

  const allItemIds = pickingOrders.flatMap((o) => o.items.map((i) => i.itemId));

  function toggleItem(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleOrder(order: PickingOrder) {
    const ids = order.items.map((i) => i.itemId);
    const allChecked = ids.every((id) => checked.has(id));
    setChecked((prev) => {
      const next = new Set(prev);
      if (allChecked) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  }

  function toggleAll() {
    if (checked.size === allItemIds.length) setChecked(new Set());
    else setChecked(new Set(allItemIds));
  }

  const totalItems = pickingOrders.reduce((s, o) => s + o.items.length, 0);

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
    </div>
  );

  if (totalItems === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <ListChecks className="w-12 h-12 text-purple-300" />
      <p className="text-lg font-medium">No items to pick</p>
      <p className="text-sm text-center max-w-xs">Items allocated from delivered stock will appear here for warehouse picking.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground transition-colors">
            {checked.size === allItemIds.length && allItemIds.length > 0
              ? <CheckSquare className="w-5 h-5 text-primary" />
              : <Square className="w-5 h-5" />}
          </button>
          <span className="text-sm text-muted-foreground">
            {checked.size} of {totalItems} selected
          </span>
        </div>
        {checked.size > 0 && (
          <Button
            size="sm"
            onClick={() => pickMutation.mutate([...checked])}
            disabled={pickMutation.isPending}
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark {checked.size} Picked
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {pickingOrders.map((order) => {
          const orderChecked = order.items.every((i) => checked.has(i.itemId));
          const orderPartial = order.items.some((i) => checked.has(i.itemId)) && !orderChecked;
          return (
            <div key={order.orderId} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Order header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/30 border-b border-border">
                <button onClick={() => toggleOrder(order)} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                  {orderChecked
                    ? <CheckSquare className="w-5 h-5 text-primary" />
                    : orderPartial
                    ? <CheckSquare className="w-5 h-5 text-primary/50" />
                    : <Square className="w-5 h-5" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{order.orderNumber}</span>
                    {order.customerName && (
                      <span className="text-muted-foreground text-sm">{order.customerName}</span>
                    )}
                    {order.requiredDate && (
                      <Badge variant="outline" className="text-xs border-orange-300 text-orange-700 bg-orange-50">
                        Due {new Date(order.requiredDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                      </Badge>
                    )}
                  </div>
                </div>
                <Badge variant="secondary" className="text-xs">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</Badge>
              </div>

              {/* Items */}
              <div className="divide-y divide-border">
                {order.items.map((item) => (
                  <div
                    key={item.itemId}
                    className={`flex items-center gap-3 px-4 py-3 transition-colors ${checked.has(item.itemId) ? "bg-green-50/50" : ""}`}
                  >
                    <button onClick={() => toggleItem(item.itemId)} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                      {checked.has(item.itemId)
                        ? <CheckSquare className="w-4 h-4 text-green-600" />
                        : <Square className="w-4 h-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-sm">{item.productName}</span>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {item.colour && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Palette className="w-3 h-3" />{item.colour}
                          </span>
                        )}
                        {item.size && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Ruler className="w-3 h-3" />{item.size}
                          </span>
                        )}
                        {item.recipientName && (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="w-3 h-3" />{item.recipientName}
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-sm font-bold min-w-[2rem] justify-center">
                      {item.quantity}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Production() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pre_wip");

  const { data: allWorksheets = [], isLoading: wsLoading } = useQuery<Worksheet[]>({
    queryKey: ["worksheets"],
    queryFn: () => apiFetch("/worksheets"),
  });

  const { data: pendingOrders = [], isLoading: pendingLoading } = useQuery<PendingOrder[]>({
    queryKey: ["production-pending"],
    queryFn: () => apiFetch("/production/pending"),
  });

  const { data: pickingOrders = [] } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 30000,
  });

  const pickingCount = pickingOrders.reduce((s, o) => s + o.items.length, 0);

  const isLoading = wsLoading || pendingLoading;

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/worksheets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/worksheets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      toast({ title: "Worksheet deleted" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const handleDelete = (id: number) => {
    if (!confirm("Delete this worksheet?")) return;
    deleteMutation.mutate(id);
  };

  const preWipWorksheets = allWorksheets.filter((w) => w.status === "pre_wip");
  const wip = allWorksheets.filter((w) => w.status === "wip");
  const complete = allWorksheets.filter((w) => w.status === "complete");

  const preWipTotal = preWipWorksheets.length + pendingOrders.length;

  const TAB_COUNTS = [
    { key: "pre_wip", label: "Pre-WIP", count: preWipTotal, icon: Clock, color: "text-blue-600" },
    { key: "picking_list", label: "Picking List", count: pickingCount, icon: ListChecks, color: "text-purple-600" },
    { key: "wip", label: "Work in Progress", count: wip.length, icon: ClipboardList, color: "text-amber-600" },
    { key: "complete", label: "Complete", count: complete.length, icon: CheckCircle2, color: "text-green-600" },
  ];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["worksheets"] });
    queryClient.invalidateQueries({ queryKey: ["production-pending"] });
    queryClient.invalidateQueries({ queryKey: ["picking-list"] });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="w-7 h-7 text-primary" />
              Production
            </h1>
            <p className="text-muted-foreground mt-1">Manage worksheets and track work in progress.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-4">
          {TAB_COUNTS.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.key}
                className={`rounded-xl border bg-card p-4 cursor-pointer transition-all ${activeTab === t.key ? "border-primary shadow-md" : "border-border hover:border-primary/40"}`}
                onClick={() => setActiveTab(t.key)}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${t.color}`} />
                  <span className="font-medium text-sm">{t.label}</span>
                </div>
                <div className={`text-3xl font-bold mt-1 ${t.color}`}>{t.count}</div>
              </div>
            );
          })}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            {TAB_COUNTS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                {t.label}
                {t.count > 0 && <Badge variant="secondary" className="ml-1 text-xs">{t.count}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ── Pre-WIP Tab ── */}
          <TabsContent value="pre_wip">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : preWipTotal === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Clock className="w-12 h-12 text-blue-300" />
                <p className="text-lg font-medium">Nothing in pre-production</p>
                <p className="text-sm text-center max-w-xs">
                  Confirmed orders awaiting stock will appear here. Use 'Send to Production' on order line items to create worksheets.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {pendingOrders.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                      <ShoppingCart className="w-4 h-4" />
                      Awaiting Stock ({pendingOrders.length} order{pendingOrders.length !== 1 ? "s" : ""})
                    </div>
                    {pendingOrders.map((order) => (
                      <PendingOrderCard key={order.orderId} order={order} />
                    ))}
                  </>
                )}
                {preWipWorksheets.length > 0 && (
                  <>
                    {pendingOrders.length > 0 && (
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-700 pt-2">
                        <Clock className="w-4 h-4" />
                        Worksheets Ready ({preWipWorksheets.length})
                      </div>
                    )}
                    {preWipWorksheets.map((ws) => (
                      <WorksheetCard
                        key={ws.id}
                        ws={ws}
                        onStatusChange={(id, s) => statusMutation.mutate({ id, status: s })}
                        onDelete={handleDelete}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </TabsContent>

          {/* ── WIP Tab ── */}
          <TabsContent value="wip">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : wip.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <ClipboardList className="w-12 h-12 text-amber-300" />
                <p className="text-lg font-medium">No active worksheets</p>
                <p className="text-sm text-center max-w-xs">Move pre-WIP items here when goods arrive and decoration begins.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {wip.map((ws) => (
                  <WorksheetCard
                    key={ws.id}
                    ws={ws}
                    onStatusChange={(id, s) => statusMutation.mutate({ id, status: s })}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Picking List Tab ── */}
          <TabsContent value="picking_list">
            <PickingListTab />
          </TabsContent>

          {/* ── Complete Tab ── */}
          <TabsContent value="complete">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : complete.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <CheckCircle2 className="w-12 h-12 text-green-300" />
                <p className="text-lg font-medium">No completed worksheets yet</p>
                <p className="text-sm text-center max-w-xs">Completed worksheets will appear here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {complete.map((ws) => (
                  <WorksheetCard
                    key={ws.id}
                    ws={ws}
                    onStatusChange={(id, s) => statusMutation.mutate({ id, status: s })}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
