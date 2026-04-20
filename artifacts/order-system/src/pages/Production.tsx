import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ClipboardList, CheckCircle2, Clock, Printer, ArrowRight,
  RefreshCw, Trash2, ChevronDown, ChevronRight, Sparkles, User, Archive, Ruler, Palette,
  ShoppingCart, ExternalLink, ListChecks, CheckSquare, Square, RotateCcw, AlertCircle,
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
  productId: number | null;
  productSku: string | null;
  supplierCode: string | null;
  supplierName: string | null;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  finishId: number | null;
  finishName: string | null;
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
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="print-only bg-white text-black font-sans text-sm" style={{ width: "210mm", minHeight: "297mm", padding: "12mm 15mm", boxSizing: "border-box" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "5mm", borderBottom: "2px solid #1e3a5f", paddingBottom: "4mm" }}>
        <div>
          {ws.customerName && <div style={{ fontSize: "26px", fontWeight: "900", color: "#1e3a5f", marginBottom: "1mm" }}>{ws.customerName}</div>}
          <div style={{ fontSize: "16px", fontWeight: "700", color: "#1e3a5f", letterSpacing: "1px" }}>PRODUCTION WORKSHEET</div>
          <div style={{ fontSize: "12px", color: "#555", marginTop: "1mm" }}>{ws.worksheetNumber} · Order {ws.orderNumber ?? "—"}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "11px", color: "#555" }}>
          <div style={{ fontWeight: "bold", fontSize: "13px" }}>Select Branding Solutions</div>
          <div>Printed: {dateStr}</div>
        </div>
      </div>

      {/* One section per item */}
      {ws.items.map((item, i) => (
        <div key={item.id} style={{ marginBottom: "5mm", pageBreakInside: "avoid", border: "1px solid #e5e7eb", borderRadius: "6px", overflow: "hidden" }}>
          {/* Item header */}
          <div style={{ backgroundColor: "#1e3a5f", color: "white", padding: "4px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: "bold", fontSize: "12px" }}>Item {i + 1} of {ws.items.length}</span>
            <span style={{ fontSize: "11px" }}>{item.finishName ?? "No Finish"}</span>
          </div>

          {/* Item details grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0", borderBottom: "1px solid #e5e7eb" }}>
            {[
              { label: "Product", value: item.productName },
              { label: "Colour", value: item.colour ?? "—" },
              { label: "Size", value: item.size ?? "—" },
              { label: "Qty", value: String(item.quantity) },
              { label: "Recipient", value: item.recipientType === "person" ? (item.recipientName ?? "—") : "Stock" },
              { label: "Finish / Decoration", value: item.finishName ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} style={{ padding: "4px 8px", borderRight: "1px solid #f0f0f0" }}>
                <div style={{ fontSize: "9px", color: "#888", textTransform: "uppercase", letterSpacing: "0.4px", marginBottom: "1px" }}>{label}</div>
                <div style={{ fontSize: "11px", fontWeight: "600" }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Processes for this item */}
          {item.processes.length > 0 ? (
            <div style={{ padding: "5px 10px", backgroundColor: "#f9fafb" }}>
              <div style={{ fontSize: "9px", fontWeight: "700", color: "#1e3a5f", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "3px" }}>
                Decoration Processes ({item.processes.length})
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10px" }}>
                <thead>
                  <tr style={{ backgroundColor: "#e8edf5" }}>
                    <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Process</th>
                    <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Type</th>
                    <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Placement</th>
                    <th style={{ padding: "2px 6px", textAlign: "left", fontWeight: "600" }}>Notes</th>
                    <th style={{ padding: "2px 6px", textAlign: "center", fontWeight: "600" }}>Done ✓</th>
                  </tr>
                </thead>
                <tbody>
                  {item.processes.map((p) => (
                    <tr key={p.id} style={{ borderBottom: "1px solid #e5e7eb" }}>
                      <td style={{ padding: "3px 6px", fontWeight: "600" }}>{p.name}</td>
                      <td style={{ padding: "3px 6px", color: "#555" }}>{p.type ?? "—"}</td>
                      <td style={{ padding: "3px 6px", color: "#555" }}>{p.placement ?? "—"}</td>
                      <td style={{ padding: "3px 6px", color: "#777", fontStyle: "italic" }}>{p.notes ?? "—"}</td>
                      <td style={{ padding: "3px 6px", textAlign: "center" }}>
                        <span style={{ display: "inline-block", width: "18px", height: "18px", border: "1.5px solid #999", borderRadius: "3px" }}></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: "4px 10px", fontSize: "10px", color: "#999", fontStyle: "italic" }}>
              No decoration processes configured for this finish.
            </div>
          )}
        </div>
      ))}

      {ws.notes && (
        <div style={{ marginTop: "3mm", padding: "3mm", backgroundColor: "#fff9c4", border: "1px solid #f59e0b", borderRadius: "4px", fontSize: "11px" }}>
          <strong>Notes:</strong> {ws.notes}
        </div>
      )}

      {/* Sign-off */}
      <div style={{ marginTop: "6mm", display: "flex", gap: "20px" }}>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Produced by: ___________________________</div>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Date completed: ___________________________</div>
        <div style={{ flex: 1, borderBottom: "1px solid #999", paddingBottom: "2mm", fontSize: "10px", color: "#666" }}>Checked by: ___________________________</div>
      </div>

      <div style={{ marginTop: "6mm", paddingTop: "3mm", borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#aaa" }}>
        <span>Select Branding Solutions — Internal Use Only</span>
        <span>{ws.worksheetNumber} · {dateStr}</span>
      </div>
    </div>
  );
}

function WorksheetCard({ ws, onStatusChange, onDelete, onReturnToPicking }: {
  ws: Worksheet;
  onStatusChange: (id: number, status: string) => void;
  onDelete: (id: number) => void;
  onReturnToPicking: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[ws.status];
  const StatusIcon = cfg.icon;

  const handlePrint = () => {
    const el = document.getElementById(`ws-print-${ws.id}`);
    if (!el) return;
    const win = window.open("", "_blank", "width=960,height=800");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><title>Worksheet ${ws.worksheetNumber}</title>
      <style>
        *{box-sizing:border-box}
        body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}
        #toolbar{
          position:sticky;top:0;z-index:10;
          display:flex;align-items:center;gap:10px;
          padding:10px 20px;background:#1e3a5f;color:white;
          box-shadow:0 2px 6px rgba(0,0,0,.3);
        }
        #toolbar span{flex:1;font-size:14px;font-weight:600;letter-spacing:.5px}
        #toolbar button{
          padding:6px 18px;border:none;border-radius:5px;
          font-size:13px;font-weight:600;cursor:pointer;
        }
        #btn-print{background:#22c55e;color:white}
        #btn-print:hover{background:#16a34a}
        #btn-close{background:rgba(255,255,255,.15);color:white}
        #btn-close:hover{background:rgba(255,255,255,.25)}
        #page{display:flex;justify-content:center;padding:24px 0 40px}
        #sheet{background:white;box-shadow:0 4px 24px rgba(0,0,0,.15)}
        @media print{
          #toolbar{display:none}
          body{background:white}
          #page{padding:0}
          #sheet{box-shadow:none}
          @page{size:A4;margin:15mm}
        }
      </style>
    </head><body>
      <div id="toolbar">
        <span>📋 ${ws.worksheetNumber} — ${ws.customerName ?? ws.orderNumber ?? "Worksheet"}</span>
        <button id="btn-print" onclick="window.print()">🖨 Print</button>
        <button id="btn-close" onclick="window.close()">✕ Close</button>
      </div>
      <div id="page"><div id="sheet">${el.innerHTML}</div></div>
    </body></html>`);
    win.document.close();
    win.focus();
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
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => onReturnToPicking(ws.id)}>
                <RotateCcw className="w-3.5 h-3.5" /> Return to Picking
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5" /> Print Worksheet
              </Button>
              <Button size="sm" className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={() => onStatusChange(ws.id, "wip")}>
                <ArrowRight className="w-3.5 h-3.5" /> Move to WIP
              </Button>
            </>
          )}
          {ws.status === "wip" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-orange-300 text-orange-700 hover:bg-orange-50" onClick={() => onReturnToPicking(ws.id)}>
                <RotateCcw className="w-3.5 h-3.5" /> Return to Picking
              </Button>
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

// ─── Print Picking Slip (renders into a new window) ───────────────────────────

function printPickingSlip(order: PickingOrder) {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const dueStr = order.requiredDate
    ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  const itemRows = order.items.map((item, i) => {
    const supplierCodeCell = item.supplierCode
      ? `<span style="font-family:monospace;font-weight:bold;font-size:12px">${item.supplierCode}</span>`
      : "";
    const fccSkuCell = item.productSku
      ? `<span style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:3px;padding:1px 5px;font-size:10px;font-family:monospace">${item.productSku}</span>`
      : "";
    const supplierNameCell = item.supplierName
      ? `<span style="color:#555;font-size:10px">${item.supplierName}</span>`
      : `<span style="color:#999;font-size:10px">${item.productName}</span>`;
    const productCell = [supplierCodeCell, fccSkuCell, supplierNameCell].filter(Boolean).join("&nbsp;&nbsp;");

    return `
    <tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${productCell}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${item.colour ?? "—"}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${item.size ?? "—"}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${item.finishName ?? "—"}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${item.recipientType === "person" ? (item.recipientName ?? "—") : "Stock"}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:bold">${item.quantity}</td>
      <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">
        <span style="display:inline-block;width:22px;height:22px;border:1.5px solid #999;border-radius:3px">&nbsp;</span>
      </td>
    </tr>`;
  }).join("");

  const sheetContent = `
    <div class="header">
      <div>
        ${order.customerName ? `<div style="font-size:26px;font-weight:900;color:#1e3a5f;margin-bottom:1mm">${order.customerName}</div>` : ""}
        <div style="font-size:16px;font-weight:700;color:#1e3a5f;letter-spacing:1px">PICKING SLIP</div>
        <div style="font-size:12px;color:#555;margin-top:1mm">${order.orderNumber}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:bold;font-size:13px">Select Branding Solutions</div>
        <div style="color:#555">Printed: ${dateStr}</div>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item"><span class="meta-label">Required Date</span><span class="meta-value">${dueStr}</span></div>
      <div class="meta-item"><span class="meta-label">Items</span><span class="meta-value">${order.items.length}</span></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Supplier Code / FCC SKU / Supplier</th>
          <th>Colour</th>
          <th>Size</th>
          <th>Finish / Decoration</th>
          <th class="center">Recipient</th>
          <th class="center">Qty</th>
          <th class="center">Picked ✓</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
    <div class="sig-box">
      <div class="sig-field">Picked by: ___________________________</div>
      <div class="sig-field">Date picked: ___________________________</div>
      <div class="sig-field">Checked by: ___________________________</div>
    </div>
    <div class="footer">
      <span>Select Branding Solutions — Internal Use Only</span>
      <span>${order.orderNumber} · ${dateStr}</span>
    </div>`;

  const html = `<!DOCTYPE html><html><head><title>Picking Slip — ${order.orderNumber}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{
        position:sticky;top:0;z-index:10;
        display:flex;align-items:center;gap:10px;
        padding:10px 20px;background:#1e3a5f;color:white;
        box-shadow:0 2px 6px rgba(0,0,0,.3);
      }
      #toolbar span{flex:1;font-size:14px;font-weight:600;letter-spacing:.5px}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}
      #btn-print:hover{background:#16a34a}
      #btn-close{background:rgba(255,255,255,.15);color:white}
      #btn-close:hover{background:rgba(255,255,255,.25)}
      #page{display:flex;justify-content:center;padding:24px 0 40px}
      #sheet{background:white;padding:12mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:210mm}
      table{width:100%;border-collapse:collapse}
      th{background:#1e3a5f;color:white;padding:5px 8px;text-align:left;font-size:11px}
      th.center{text-align:center}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:4mm;margin-bottom:4mm}
      .meta{display:flex;gap:20px;margin-bottom:5mm}
      .meta-item{display:flex;flex-direction:column}
      .meta-label{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:1px}
      .meta-value{font-weight:bold}
      .footer{margin-top:8mm;border-top:1px solid #e5e7eb;padding-top:4mm;display:flex;justify-content:space-between;font-size:9px;color:#888}
      .sig-box{margin-top:8mm;display:flex;gap:30px}
      .sig-field{flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666}
      @media print{
        #toolbar{display:none}
        body{background:white}
        #page{padding:0}
        #sheet{box-shadow:none;padding:0}
        @page{size:A4;margin:15mm}
      }
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Picking Slip — ${order.customerName ?? order.orderNumber}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page"><div id="sheet">${sheetContent}</div></div>
  </body></html>`;

  const win = window.open("", "_blank", "width=960,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Picking List Tab Component ───────────────────────────────────────────────

function PickingListTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [returning, setReturning] = useState<Set<number>>(new Set());

  const { data: pickingOrders = [], isLoading } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 30000,
  });

  const pickMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/picking-list/pick", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: (data: { ok: boolean; plainPicked: number; worksheetItems: number }) => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      setChecked(new Set());
      const parts: string[] = [];
      if (data.plainPicked > 0) parts.push(`${data.plainPicked} ready for dispatch`);
      if (data.worksheetItems > 0) parts.push(`${data.worksheetItems} sent to production`);
      toast({ title: "Picked", description: parts.join(" · ") || "Items confirmed" });
    },
    onError: () => toast({ title: "Error marking items picked", variant: "destructive" }),
  });

  const returnMutation = useMutation({
    mutationFn: (itemIds: number[]) =>
      apiFetch("/picking-list/return", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: (data: { ok: boolean; returned: number }) => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setReturning(new Set());
      setChecked(new Set());
      toast({
        title: "Returned to Purchasing",
        description: `${data.returned} item${data.returned !== 1 ? "s" : ""} de-allocated and added to purchasing requirements`,
      });
    },
    onError: () => toast({ title: "Error returning items", variant: "destructive" }),
  });

  function toggleReturning(id: number) {
    setReturning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

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
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={toggleAll} className="text-muted-foreground hover:text-foreground transition-colors">
            {checked.size === allItemIds.length && allItemIds.length > 0
              ? <CheckSquare className="w-5 h-5 text-primary" />
              : <Square className="w-5 h-5" />}
          </button>
          <span className="text-sm text-muted-foreground">
            {checked.size > 0 ? `${checked.size} of ${totalItems} selected` : `${totalItems} item${totalItems !== 1 ? "s" : ""} to pick`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {returning.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-amber-400 text-amber-700 hover:bg-amber-50"
              onClick={() => returnMutation.mutate([...returning])}
              disabled={returnMutation.isPending}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Return {returning.size} to Purchasing
            </Button>
          )}
          {checked.size > 0 && (() => {
            const checkedItems = pickingOrders.flatMap((o) => o.items).filter((i) => checked.has(i.itemId));
            const needsWorksheet = checkedItems.some((i) => i.finishId != null);
            const plainCount = checkedItems.filter((i) => i.finishId == null).length;
            const finishCount = checkedItems.filter((i) => i.finishId != null).length;
            const label = needsWorksheet && plainCount > 0
              ? `Pick — ${plainCount} to dispatch, ${finishCount} to production`
              : needsWorksheet
              ? `Pick → Send to Production (${finishCount})`
              : `Confirm ${checked.size} Picked`;
            return (
              <Button
                size="sm"
                onClick={() => pickMutation.mutate([...checked])}
                disabled={pickMutation.isPending}
                className={`gap-1.5 text-white ${needsWorksheet ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}`}
              >
                <CheckCircle2 className="w-4 h-4" />
                {label}
              </Button>
            );
          })()}
        </div>
      </div>

      {/* Order cards */}
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
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{order.items.length} item{order.items.length !== 1 ? "s" : ""}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-7 px-2.5"
                    onClick={() => printPickingSlip(order)}
                    title="Print picking slip for this order"
                  >
                    <Printer className="w-3 h-3" /> Print Slip
                  </Button>
                </div>
              </div>

              {/* Items */}
              <div className="divide-y divide-border">
                {order.items.map((item) => {
                  const isReturning = returning.has(item.itemId);
                  return (
                    <div key={item.itemId}>
                      <div className={`flex items-center gap-3 px-4 py-3 transition-colors ${checked.has(item.itemId) ? "bg-green-50/50" : isReturning ? "bg-amber-50/60" : ""}`}>
                        <button onClick={() => toggleItem(item.itemId)} className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors" title="Select for picking">
                          {checked.has(item.itemId)
                            ? <CheckSquare className="w-4 h-4 text-green-600" />
                            : <Square className="w-4 h-4" />}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-sm">{item.productName}</span>
                            {item.finishName && (
                              <span className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 border border-blue-200 rounded px-1.5 py-0.5 font-medium">
                                <Sparkles className="w-3 h-3" />{item.finishName}
                              </span>
                            )}
                          </div>
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
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge variant="secondary" className="text-sm font-bold min-w-[2rem] justify-center">
                            {item.quantity}
                          </Badge>
                          <button
                            onClick={() => toggleReturning(item.itemId)}
                            title="Stock not found — return to purchasing"
                            className={`p-1 rounded transition-colors ${isReturning ? "text-amber-600 bg-amber-100" : "text-muted-foreground hover:text-amber-600 hover:bg-amber-50"}`}
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      {isReturning && (
                        <div className="flex items-center gap-2 px-12 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>This item will be de-allocated and added to your purchasing requirements. Product stock will be corrected.</span>
                          <button onClick={() => toggleReturning(item.itemId)} className="ml-auto text-amber-600 hover:text-amber-800 underline whitespace-nowrap">Cancel</button>
                        </div>
                      )}
                    </div>
                  );
                })}
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

  const returnToPickingMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/worksheets/${id}/return-to-picking`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      toast({ title: "Returned to Picking List", description: "Items moved back to the picking list." });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const handleDelete = (id: number) => {
    if (!confirm("Delete this worksheet?")) return;
    deleteMutation.mutate(id);
  };

  const handleReturnToPicking = (id: number) => {
    if (!confirm("Return all items in this worksheet back to the Picking List?")) return;
    returnToPickingMutation.mutate(id);
  };

  const preWipWorksheets = allWorksheets.filter((w) => w.status === "pre_wip");
  const wip = allWorksheets.filter((w) => w.status === "wip");
  const complete = allWorksheets.filter((w) => w.status === "complete");

  const preWipTotal = preWipWorksheets.length + pendingOrders.length;

  const TAB_COUNTS = [
    { key: "picking_list", label: "Picking List", count: pickingCount, icon: ListChecks, color: "text-purple-600" },
    { key: "pre_wip", label: "Pre-WIP", count: preWipTotal, icon: Clock, color: "text-blue-600" },
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
                        onReturnToPicking={handleReturnToPicking}
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
                    onReturnToPicking={handleReturnToPicking}
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
                    onReturnToPicking={handleReturnToPicking}
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
