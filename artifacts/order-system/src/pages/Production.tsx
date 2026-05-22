import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ClipboardList, CheckCircle2, Clock, Printer, ArrowRight,
  RefreshCw, Trash2, ChevronDown, ChevronRight, Sparkles, User, Archive, Ruler, Palette,
  ShoppingCart, ExternalLink, ListChecks, CheckSquare, Square, RotateCcw, AlertCircle,
  Search, Calendar, X, FileText, Zap, AlertTriangle, Play, Layers, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate, formatCurrency } from "@/lib/utils";
import { sortSizes } from "@/lib/sizeUtils";

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
  requiredDate: string | null;
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
  poNumber: string | null;
  poStatus: string | null;
  estimatedDelivery: string | null;
}

interface PendingOrder {
  orderId: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  items: PendingItem[];
}

interface ReadyOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  requiredDate: string | null;
  totalAmount: number;
  itemCount: number;
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
  pre_wip: { label: "Pre-Production", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Clock },
  wip: { label: "Work in Progress", color: "bg-amber-100 text-amber-800 border-amber-200", icon: ClipboardList },
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
};

// ─── Filter types & utilities ──────────────────────────────────────────────────

interface Filters {
  search: string;
  finish: string;
  process: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: Filters = { search: "", finish: "", process: "", dateFrom: "", dateTo: "" };

// ── Daily Work Plan types ──────────────────────────────────────────────────────
interface PlanTaskItem {
  productName: string;
  colour: string | null;
  size: string | null;
  qty: number;
  recipient: string | null;
}

interface PlanTask {
  type: "picking" | "pre_wip" | "wip";
  worksheetId: number | null;
  worksheetNumber: string | null;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
  qty: number;
  items: PlanTaskItem[];
}

interface PlanTaskGroup {
  finishName: string;
  totalQty: number;
  orderCount: number;
  overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
  earliestRequired: string | null;
  tasks: PlanTask[];
}

interface DailyPlan {
  generatedAt: string;
  taskGroups: PlanTaskGroup[];
  summary: {
    overdue: number;
    today: number;
    soon: number;
    thisWeek: number;
    upcoming: number;
    urgentCount: number;
    totalItems: number;
  };
}

function matchesDateFilters(requiredDate: string | null | undefined, dateFrom: string, dateTo: string): boolean {
  if (dateFrom && requiredDate) {
    if (new Date(requiredDate) < new Date(dateFrom)) return false;
  }
  if (dateTo && requiredDate) {
    if (new Date(requiredDate) > new Date(dateTo + "T23:59:59")) return false;
  }
  return true;
}

function filterWorksheets(worksheets: Worksheet[], f: Filters): Worksheet[] {
  return worksheets.filter((ws) => {
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!ws.customerName?.toLowerCase().includes(q) && !ws.orderNumber?.toLowerCase().includes(q)) return false;
    }
    if (f.finish) {
      const fin = f.finish.toLowerCase();
      if (!ws.items.some((i) => i.finishName?.toLowerCase().includes(fin))) return false;
    }
    if (f.process) {
      const proc = f.process.toLowerCase();
      if (!ws.items.some((i) => i.processes.some((p) => p.name.toLowerCase().includes(proc)))) return false;
    }
    if (!matchesDateFilters(ws.requiredDate, f.dateFrom, f.dateTo)) return false;
    return true;
  });
}

function filterPickingOrders(orders: PickingOrder[], f: Filters): PickingOrder[] {
  return orders
    .map((order) => {
      if (f.search) {
        const q = f.search.toLowerCase();
        if (!order.customerName?.toLowerCase().includes(q) && !order.orderNumber.toLowerCase().includes(q)) return null;
      }
      if (!matchesDateFilters(order.requiredDate, f.dateFrom, f.dateTo)) return null;
      let items = order.items;
      if (f.finish) {
        const fin = f.finish.toLowerCase();
        items = items.filter((i) => i.finishName?.toLowerCase().includes(fin));
        if (items.length === 0) return null;
      }
      return { ...order, items };
    })
    .filter(Boolean) as PickingOrder[];
}

function FiltersBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = (key: keyof Filters, val: string) => onChange({ ...filters, [key]: val });
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 bg-muted/30 rounded-lg border border-border text-sm">
      <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
        <Search className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Customer or order number…"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Finish…"
          value={filters.finish}
          onChange={(e) => set("finish", e.target.value)}
          className="bg-transparent outline-none placeholder:text-muted-foreground w-24 text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="text"
          placeholder="Process…"
          value={filters.process}
          onChange={(e) => set("process", e.target.value)}
          className="bg-transparent outline-none placeholder:text-muted-foreground w-24 text-sm"
        />
      </div>
      <div className="h-4 border-l border-border" />
      <div className="flex items-center gap-1.5">
        <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <input
          type="date"
          value={filters.dateFrom}
          onChange={(e) => set("dateFrom", e.target.value)}
          className="bg-transparent outline-none text-muted-foreground w-32 text-sm"
        />
        <span className="text-muted-foreground">–</span>
        <input
          type="date"
          value={filters.dateTo}
          onChange={(e) => set("dateTo", e.target.value)}
          className="bg-transparent outline-none text-muted-foreground w-32 text-sm"
        />
      </div>
      {hasFilters && (
        <button
          onClick={() => onChange(EMPTY_FILTERS)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto"
        >
          <X className="w-3 h-3" /> Clear
        </button>
      )}
    </div>
  );
}

// ─── Combined picking slip (multi-order matrix) ────────────────────────────────

function printCombinedPickingSlip(selectedItems: PickingItem[], allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB");

  // Count distinct orders
  const orderIds = new Set(selectedItems.map(i => i.orderId));
  const totalQty = selectedItems.reduce((s, i) => s + i.quantity, 0);

  // Build order summary list (date + customer)
  const orderSummaries = Array.from(orderIds).map(id => {
    const order = allOrders.find(o => o.orderId === id);
    if (!order) return "";
    const dueStr = order.requiredDate
      ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;
    return `${order.orderNumber}${order.customerName ? ` — ${order.customerName}` : ""}${dueStr ? ` (due ${dueStr})` : ""}`;
  }).filter(Boolean);

  // Aggregate into matrix: key = product+colour+finish, value = size→qty map
  type RowKey = { productName: string; productSku: string | null; supplierCode: string | null; supplierName: string | null; colour: string | null; finishName: string | null };
  const rowMap = new Map<string, { meta: RowKey; sizes: Map<string, number> }>();
  const allSizes = new Set<string>();

  for (const item of selectedItems) {
    const key = [item.productName, item.productSku ?? "", item.colour ?? "", item.finishName ?? "Plain"].join("||");
    if (!rowMap.has(key)) {
      rowMap.set(key, {
        meta: { productName: item.productName, productSku: item.productSku, supplierCode: item.supplierCode, supplierName: item.supplierName, colour: item.colour, finishName: item.finishName },
        sizes: new Map(),
      });
    }
    const sizeKey = item.size ?? "—";
    allSizes.add(sizeKey);
    const entry = rowMap.get(key)!;
    entry.sizes.set(sizeKey, (entry.sizes.get(sizeKey) ?? 0) + item.quantity);
  }

  const sortedSizes = sortSizes(Array.from(allSizes));
  const rows = Array.from(rowMap.values());

  const thStyle = `background:#374151;color:white;padding:5px 8px;font-size:10px;text-align:center;white-space:nowrap`;
  const thLeftStyle = `background:#374151;color:white;padding:5px 8px;font-size:10px;text-align:left`;
  const tdStyle = `padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:11px`;
  const tdLeftStyle = `padding:5px 8px;border-bottom:1px solid #e5e7eb;font-size:11px`;

  const sizeHeaders = sortedSizes.map(s => `<th style="${thStyle}">${s}</th>`).join("");
  const tableRows = rows.map(({ meta, sizes }) => {
    const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
    const sizeCells = sortedSizes.map(s => {
      const qty = sizes.get(s) ?? 0;
      return `<td style="${tdStyle}${qty > 0 ? ";font-weight:bold" : ";color:#bbb"}">${qty > 0 ? qty : "—"}</td>`;
    }).join("");
    return `<tr>
      <td style="${tdLeftStyle}">
        ${meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:11px">${meta.supplierCode}</span> ` : ""}
        ${meta.productSku ? `<span style="font-size:10px;color:#2563eb">${meta.productSku}</span><br>` : ""}
        ${meta.supplierName ? `<span style="font-size:10px;color:#888">${meta.supplierName}</span><br>` : ""}
        <span style="font-size:11px">${meta.productName}</span>
      </td>
      <td style="${tdLeftStyle}">${meta.colour ?? "—"}</td>
      <td style="${tdLeftStyle}">${meta.finishName ?? "Plain"}</td>
      ${sizeCells}
      <td style="${tdStyle};font-weight:bold;background:#f9fafb">${rowTotal}</td>
      <td style="${tdStyle}"><span style="display:inline-block;width:22px;height:22px;border:1.5px solid #999;border-radius:3px">&nbsp;</span></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Combined Picking Slip</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
      #page{display:flex;justify-content:center;padding:24px 0 40px}
      #sheet{background:white;padding:12mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:210mm}
      @media print{#toolbar{display:none}body{background:white}#page{padding:0}#sheet{box-shadow:none;padding:0}@page{size:A4 portrait;margin:12mm}}
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Combined Picking Slip — ${orderIds.size} order${orderIds.size !== 1 ? "s" : ""} · ${rows.length} line${rows.length !== 1 ? "s" : ""} · Qty ${totalQty}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page"><div id="sheet">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1e3a5f;padding-bottom:4mm;margin-bottom:4mm">
        <div>
          <div style="font-size:20px;font-weight:900;color:#1e3a5f">COMBINED PICKING SLIP</div>
          <div style="font-size:11px;color:#555;margin-top:1mm">${orderIds.size} order${orderIds.size !== 1 ? "s" : ""} · ${rows.length} style${rows.length !== 1 ? "s" : ""} · Total qty ${totalQty}</div>
        </div>
        <div style="text-align:right"><div style="font-weight:bold">Select Branding Solutions</div><div style="color:#555">Printed: ${dateStr}</div></div>
      </div>
      <div style="font-size:10px;color:#555;margin-bottom:4mm;line-height:1.6">
        ${orderSummaries.map(s => `<span style="margin-right:16px">📦 ${s}</span>`).join("")}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${thLeftStyle}">Product / Style</th>
          <th style="${thLeftStyle}">Colour</th>
          <th style="${thLeftStyle}">Finish</th>
          ${sizeHeaders}
          <th style="${thStyle};background:#1e3a5f">Total</th>
          <th style="${thStyle}">Picked ✓</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      <div style="margin-top:8mm;display:flex;gap:30px;border-top:1px solid #e5e7eb;padding-top:4mm">
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Picked by: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Date picked: ___________________________</div>
        <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Checked by: ___________________________</div>
      </div>
    </div></div>
  </body></html>`;

  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Print Per-Customer Picking Slips ─────────────────────────────────────────

function printPerCustomerPickingSlips(selectedItems: PickingItem[], allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB");

  const thStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:center;white-space:nowrap`;
  const thLeftStyle = `background:#374151;color:white;padding:4px 7px;font-size:9.5px;text-align:left`;
  const tdStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;text-align:center;font-size:10px`;
  const tdLeftStyle = `padding:4px 7px;border-bottom:1px solid #e5e7eb;font-size:10px`;

  // ── Group items by customer name (same customer = one slip, regardless of order count) ──
  type CustomerGroup = {
    customerName: string | null;
    orders: Array<{ orderNumber: string; requiredDate: string | null; orderId: number }>;
    items: PickingItem[];
    earliestDate: string | null;
  };
  const groupMap = new Map<string, CustomerGroup>();

  for (const item of selectedItems) {
    const order = allOrders.find(o => o.orderId === item.orderId);
    // Key by customer name; fall back to orderId string so un-named orders don't collapse
    const groupKey = item.customerName ? item.customerName.toLowerCase().trim() : `__order_${item.orderId}`;
    if (!groupMap.has(groupKey)) {
      groupMap.set(groupKey, { customerName: item.customerName, orders: [], items: [], earliestDate: null });
    }
    const group = groupMap.get(groupKey)!;
    group.items.push(item);
    if (order && !group.orders.find(o => o.orderId === order.orderId)) {
      group.orders.push({ orderNumber: order.orderNumber, requiredDate: order.requiredDate, orderId: order.orderId });
    }
  }

  // Compute earliest required date per group and sort orders within each group by date
  for (const group of groupMap.values()) {
    group.orders.sort((a, b) => {
      if (!a.requiredDate && !b.requiredDate) return 0;
      if (!a.requiredDate) return 1;
      if (!b.requiredDate) return -1;
      return a.requiredDate.localeCompare(b.requiredDate);
    });
    const dates = group.orders.map(o => o.requiredDate).filter(Boolean) as string[];
    group.earliestDate = dates.length > 0 ? dates[0] : null;
  }

  // Sort customer groups: most urgent (earliest required date) first, undated last
  const sortedGroups = Array.from(groupMap.values()).sort((a, b) => {
    if (!a.earliestDate && !b.earliestDate) return 0;
    if (!a.earliestDate) return 1;
    if (!b.earliestDate) return -1;
    return a.earliestDate.localeCompare(b.earliestDate);
  });

  const slipPages = sortedGroups.map((group, pageIdx) => {
    type RowKey = { productName: string; productSku: string | null; supplierCode: string | null; supplierName: string | null; colour: string | null; finishName: string | null };
    const rowMap = new Map<string, { meta: RowKey; sizes: Map<string, number> }>();
    const allSizes = new Set<string>();

    for (const item of group.items) {
      const key = [item.productName, item.productSku ?? "", item.colour ?? "", item.finishName ?? "Plain"].join("||");
      if (!rowMap.has(key)) {
        rowMap.set(key, {
          meta: { productName: item.productName, productSku: item.productSku, supplierCode: item.supplierCode, supplierName: item.supplierName, colour: item.colour, finishName: item.finishName },
          sizes: new Map(),
        });
      }
      const sizeKey = item.size ?? "—";
      allSizes.add(sizeKey);
      const entry = rowMap.get(key)!;
      entry.sizes.set(sizeKey, (entry.sizes.get(sizeKey) ?? 0) + item.quantity);
    }

    const sortedSizes = sortSizes(Array.from(allSizes));
    const rows = Array.from(rowMap.values());
    const totalQty = group.items.reduce((s, i) => s + i.quantity, 0);

    const sizeHeaders = sortedSizes.map(s => `<th style="${thStyle}">${s}</th>`).join("");
    const tableRows = rows.map(({ meta, sizes }) => {
      const rowTotal = Array.from(sizes.values()).reduce((s, v) => s + v, 0);
      const sizeCells = sortedSizes.map(s => {
        const qty = sizes.get(s) ?? 0;
        return `<td style="${tdStyle}${qty > 0 ? ";font-weight:bold" : ";color:#bbb"}">${qty > 0 ? qty : "—"}</td>`;
      }).join("");
      return `<tr>
        <td style="${tdLeftStyle}">
          ${meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:10px">${meta.supplierCode}</span> ` : ""}
          ${meta.productSku ? `<span style="font-size:9px;color:#2563eb">${meta.productSku}</span><br>` : ""}
          ${meta.supplierName ? `<span style="font-size:9px;color:#888">${meta.supplierName}</span><br>` : ""}
          <span style="font-size:10px">${meta.productName}</span>
        </td>
        <td style="${tdLeftStyle}">${meta.colour ?? "—"}</td>
        <td style="${tdLeftStyle}">${meta.finishName ?? "Plain"}</td>
        ${sizeCells}
        <td style="${tdStyle};font-weight:bold;background:#f9fafb">${rowTotal}</td>
        <td style="${tdStyle}"><span style="display:inline-block;width:20px;height:20px;border:1.5px solid #999;border-radius:3px">&nbsp;</span></td>
      </tr>`;
    }).join("");

    // Order list — sorted by required date, each on its own line
    const orderLines = group.orders.map(o => {
      const due = o.requiredDate
        ? new Date(o.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : null;
      const isEarliest = o.requiredDate === group.earliestDate;
      return `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:18px${isEarliest && group.orders.length > 1 ? ";font-weight:bold" : ""}">
        <span style="font-family:monospace;font-size:10px;color:#1e3a5f">${o.orderNumber}</span>
        ${due ? `<span style="font-size:10px;color:${isEarliest ? "#b45309" : "#555"}">${isEarliest && group.orders.length > 1 ? "⚑ " : ""}Due: ${due}</span>` : ""}
      </span>`;
    }).join("");

    const isLast = pageIdx === sortedGroups.length - 1;
    return `
      <div class="slip${isLast ? "" : " page-break"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:3mm;margin-bottom:3mm">
          <div>
            <div style="font-size:22px;font-weight:900;color:#1e3a5f;line-height:1.1">${group.customerName ?? "Unknown Customer"}</div>
            <div style="font-size:11px;font-weight:700;color:#374151;letter-spacing:0.5px;margin-top:1.5mm">PICKING SLIP</div>
            <div style="font-size:10px;color:#555;margin-top:2mm;line-height:1.8">${orderLines}</div>
            <div style="font-size:10px;color:#666;margin-top:1mm">${rows.length} style${rows.length !== 1 ? "s" : ""} &nbsp;·&nbsp; Total qty <strong>${totalQty}</strong></div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8mm">
            <div style="font-weight:bold;font-size:12px">Select Branding Solutions</div>
            <div style="color:#555;font-size:10px">Printed: ${dateStr}</div>
            ${group.earliestDate ? `<div style="margin-top:2mm;font-size:11px;font-weight:bold;color:#b45309">Required by: ${new Date(group.earliestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thLeftStyle}">Product / Style</th>
            <th style="${thLeftStyle}">Colour</th>
            <th style="${thLeftStyle}">Finish</th>
            ${sizeHeaders}
            <th style="${thStyle};background:#1e3a5f">Total</th>
            <th style="${thStyle}">Picked ✓</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div style="margin-top:6mm;display:flex;gap:24px;border-top:1px solid #e5e7eb;padding-top:3mm">
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Picked by: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Date picked: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:9.5px;color:#666">Checked by: ___________________________</div>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Per-Customer Picking Slips</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:10px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
      #page{display:flex;flex-direction:column;align-items:center;padding:24px 0 40px;gap:24px}
      .slip{background:white;padding:10mm 12mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:257mm}
      @media print{
        #toolbar{display:none}body{background:white}#page{padding:0;gap:0}
        .slip{box-shadow:none;width:100%;padding:0}
        .page-break{page-break-after:always}
        @page{size:A4 portrait;margin:10mm}
      }
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Per-Customer Picking Slips — ${sortedGroups.length} customer${sortedGroups.length !== 1 ? "s" : ""} · sorted by required date</span>
      <button id="btn-print" onclick="window.print()">🖨 Print all ${sortedGroups.length}</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page">${slipPages}</div>
  </body></html>`;

  const win2 = window.open("", "_blank", "width=1100,height=800");
  if (!win2) return;
  win2.document.write(html);
  win2.document.close();
  win2.focus();
}

function PrintWorksheet({ ws }: { ws: Worksheet }) {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="print-only bg-white text-black font-sans text-sm" style={{ width: "210mm", padding: "12mm 15mm", boxSizing: "border-box" }}>
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

  // Build colour × size matrices, grouped by product name
  const matrices = useMemo(() => {
    type Matrix = {
      productName: string;
      supplierName: string | null;
      colours: string[];
      sizes: string[];
      cells: Map<string, PendingItem>; // key: "colour||size"
    };
    const map = new Map<string, Matrix>();
    for (const item of order.items) {
      if (!map.has(item.productName)) {
        map.set(item.productName, { productName: item.productName, supplierName: item.supplierName, colours: [], sizes: [], cells: new Map() });
      }
      const m = map.get(item.productName)!;
      const colour = item.colour ?? "";
      const size = item.size ?? "";
      if (!m.colours.includes(colour)) m.colours.push(colour);
      if (!m.sizes.includes(size)) m.sizes.push(size);
      m.cells.set(`${colour}||${size}`, item);
    }
    for (const m of map.values()) {
      m.sizes = sortSizes(m.sizes);
    }
    return [...map.values()];
  }, [order.items]);

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
        <div className="border-t border-amber-200 px-5 py-4 space-y-4">
          {matrices.map((m) => {
            const hasSizes = m.sizes.some(s => s !== "");
            const hasColours = m.colours.some(c => c !== "");
            return (
              <div key={m.productName}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">{m.productName}</span>
                  {m.supplierName && (
                    <span className="text-xs text-muted-foreground">{m.supplierName}</span>
                  )}
                </div>
                <div className="overflow-x-auto rounded-lg border border-amber-100">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-amber-50/80 border-b border-amber-100">
                        {hasColours && <th className="text-left px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">Colour</th>}
                        {hasSizes
                          ? m.sizes.map(size => (
                              <th key={size} className="text-center px-3 py-2 font-medium text-muted-foreground whitespace-nowrap">{size || "—"}</th>
                            ))
                          : <th className="text-center px-3 py-2 font-medium text-muted-foreground">Qty</th>
                        }
                        <th className="text-center px-3 py-2 font-medium text-muted-foreground">Total</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.colours.map((colour, ci) => {
                        const rowItems = (hasSizes ? m.sizes : [""]).map(size => m.cells.get(`${colour}||${size}`));
                        const existing = rowItems.filter(Boolean) as PendingItem[];
                        const rowTotal = existing.reduce((s, it) => s + it.purchaseQuantity, 0);
                        const allOrdered = existing.length > 0 && existing.every(it => it.poStatus === "ordered");
                        const allDraft = existing.length > 0 && existing.every(it => it.poStatus === "draft");
                        const anyOnPo = existing.some(it => !!it.poNumber);
                        const delivery = existing.find(it => it.estimatedDelivery)?.estimatedDelivery;
                        return (
                          <tr key={colour} className={`border-b border-amber-50 last:border-0 ${ci % 2 === 0 ? "bg-white/60" : "bg-amber-50/20"}`}>
                            {hasColours && (
                              <td className="px-3 py-2 font-medium text-foreground whitespace-nowrap">{colour || "—"}</td>
                            )}
                            {(hasSizes ? m.sizes : [""]).map(size => {
                              const item = m.cells.get(`${colour}||${size}`);
                              if (!item) return <td key={size} className="text-center px-3 py-2 text-muted-foreground/30 select-none">—</td>;
                              const cellCls = item.poStatus === "ordered"
                                ? "bg-green-100 text-green-800"
                                : item.poStatus === "draft"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-amber-100 text-amber-800";
                              return (
                                <td key={size} className="text-center px-2 py-1.5">
                                  <span className={`inline-block min-w-[1.75rem] rounded px-1.5 py-0.5 font-semibold ${cellCls}`}>
                                    {item.purchaseQuantity}
                                  </span>
                                </td>
                              );
                            })}
                            <td className="text-center px-3 py-2 font-semibold text-foreground">{rowTotal}</td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              <div className="flex flex-col gap-0.5">
                                {allOrdered ? (
                                  <span className="inline-flex items-center gap-1 text-green-700">
                                    <CheckCircle2 className="w-3 h-3" /> Ordered
                                  </span>
                                ) : allDraft ? (
                                  <span className="inline-flex items-center gap-1 text-blue-700">
                                    <Clock className="w-3 h-3" /> Draft PO
                                  </span>
                                ) : anyOnPo ? (
                                  <span className="inline-flex items-center gap-1 text-amber-700">
                                    <AlertCircle className="w-3 h-3" /> Partial
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-amber-600">
                                    <AlertCircle className="w-3 h-3" /> Not yet ordered
                                  </span>
                                )}
                                {delivery && (
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    <Calendar className="w-3 h-3" />
                                    {new Date(delivery).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          <p className="text-xs text-amber-700 flex items-center gap-1.5 pt-1">
            <ShoppingCart className="w-3.5 h-3.5" />
            Stock must be received in Purchasing before this order can move to production.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Print Picking Slip (renders into a new window) ───────────────────────────

function printPickingSlip(order: PickingOrder, allOrders: PickingOrder[]) {
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Gather ALL orders for this customer (consolidate across all their orders)
  const customerOrders = order.customerName
    ? allOrders.filter(o => o.customerName === order.customerName)
    : [order];
  const allItems = customerOrders.flatMap(o => o.items);

  // Sort orders by required date for the order list header
  const sortedOrders = [...customerOrders].sort((a, b) => {
    if (!a.requiredDate && !b.requiredDate) return 0;
    if (!a.requiredDate) return 1;
    if (!b.requiredDate) return -1;
    return a.requiredDate.localeCompare(b.requiredDate);
  });
  const earliestDate = sortedOrders.find(o => o.requiredDate)?.requiredDate ?? null;

  // Group items by finish — each finish gets its own slip page
  const finishGroups = new Map<string, PickingItem[]>();
  for (const item of allItems) {
    const key = item.finishName ?? "Plain (No Finish)";
    if (!finishGroups.has(key)) finishGroups.set(key, []);
    finishGroups.get(key)!.push(item);
  }

  // Sort finishes alphabetically, Plain last
  const sortedFinishes = Array.from(finishGroups.keys()).sort((a, b) => {
    if (a === "Plain (No Finish)") return 1;
    if (b === "Plain (No Finish)") return -1;
    return a.localeCompare(b);
  });

  const thL = `background:#1e3a5f;color:white;padding:5px 8px;font-size:11px;text-align:left`;
  const thC = `background:#1e3a5f;color:white;padding:5px 8px;font-size:11px;text-align:center`;

  // Order summary line for the slip header
  const orderLines = sortedOrders.map(o => {
    const due = o.requiredDate
      ? new Date(o.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;
    const isUrgent = o.requiredDate === earliestDate && sortedOrders.length > 1;
    return `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:16px${isUrgent ? ";font-weight:bold" : ""}">
      <span style="font-family:monospace;font-size:10px;color:#1e3a5f">${o.orderNumber}</span>
      ${due ? `<span style="font-size:10px;color:${isUrgent ? "#b45309" : "#555"}">${isUrgent ? "⚑ " : ""}Due: ${due}</span>` : ""}
    </span>`;
  }).join("");

  const slipPages = sortedFinishes.map((finishName, pageIdx) => {
    const items = finishGroups.get(finishName)!;

    // Consolidate rows by product + colour + size (no finish col — it's the heading)
    type RowMeta = { supplierCode: string | null; productSku: string | null; productName: string; supplierName: string | null; colour: string | null; size: string | null };
    const rowMap = new Map<string, { meta: RowMeta; qty: number }>();
    for (const item of items) {
      const key = [item.supplierCode ?? "", item.productSku ?? "", item.productName, item.colour ?? "", item.size ?? ""].join("||");
      if (!rowMap.has(key)) {
        rowMap.set(key, { meta: { supplierCode: item.supplierCode, productSku: item.productSku, productName: item.productName, supplierName: item.supplierName, colour: item.colour, size: item.size }, qty: 0 });
      }
      rowMap.get(key)!.qty += item.quantity;
    }

    const rows = Array.from(rowMap.values());
    const totalQty = rows.reduce((s, r) => s + r.qty, 0);
    const isLast = pageIdx === sortedFinishes.length - 1;

    const itemRows = rows.map(({ meta, qty }, i) => {
      const codeSpan = meta.supplierCode ? `<span style="font-family:monospace;font-weight:bold;font-size:12px">${meta.supplierCode}</span>&nbsp;&nbsp;` : "";
      const skuSpan = meta.productSku ? `<span style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:3px;padding:1px 5px;font-size:10px;font-family:monospace">${meta.productSku}</span>&nbsp;&nbsp;` : "";
      const nameSpan = meta.supplierName ? `<span style="color:#555;font-size:10px">${meta.supplierName}</span>` : `<span style="color:#999;font-size:10px">${meta.productName}</span>`;
      return `<tr style="background:${i % 2 === 0 ? "#f9fafb" : "white"}">
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${codeSpan}${skuSpan}${nameSpan}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb">${meta.colour ?? "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">${meta.size ?? "—"}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:bold">${qty}</td>
        <td style="padding:5px 8px;border-bottom:1px solid #e5e7eb;text-align:center">
          <span style="display:inline-block;width:22px;height:22px;border:1.5px solid #999;border-radius:3px">&nbsp;</span>
        </td>
      </tr>`;
    }).join("");

    return `
      <div class="slip${isLast ? "" : " page-break"}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2.5px solid #1e3a5f;padding-bottom:4mm;margin-bottom:4mm">
          <div>
            <div style="font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1">${order.customerName ?? "Picking Slip"}</div>
            <div style="font-size:14px;font-weight:700;color:#374151;letter-spacing:0.5px;margin-top:1.5mm">PICKING SLIP</div>
            <div style="display:inline-block;margin-top:2mm;padding:2px 10px;background:#1e3a5f;color:white;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.5px">${finishName}</div>
            <div style="font-size:10px;color:#555;margin-top:2.5mm;line-height:1.8">${orderLines}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;margin-left:8mm">
            <div style="font-weight:bold;font-size:12px">Select Branding Solutions</div>
            <div style="color:#555;font-size:10px">Printed: ${dateStr}</div>
            ${earliestDate ? `<div style="margin-top:2mm;font-size:11px;font-weight:bold;color:#b45309">Required by: ${new Date(earliestDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</div>` : ""}
            <div style="margin-top:1mm;font-size:10px;color:#555">${rows.length} line${rows.length !== 1 ? "s" : ""} · Qty <strong>${totalQty}</strong></div>
            ${sortedFinishes.length > 1 ? `<div style="margin-top:1mm;font-size:9px;color:#888">Slip ${pageIdx + 1} of ${sortedFinishes.length}</div>` : ""}
          </div>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="${thL}">Supplier Code / SKU / Supplier</th>
            <th style="${thL}">Colour</th>
            <th style="${thC}">Size</th>
            <th style="${thC}">Qty</th>
            <th style="${thC}">Picked ✓</th>
          </tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div style="margin-top:8mm;display:flex;gap:30px;border-top:1px solid #e5e7eb;padding-top:4mm">
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Picked by: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Date picked: ___________________________</div>
          <div style="flex:1;border-bottom:1px solid #999;padding-bottom:2mm;font-size:10px;color:#666">Checked by: ___________________________</div>
        </div>
        <div style="margin-top:6mm;display:flex;justify-content:space-between;font-size:9px;color:#aaa;border-top:1px solid #f0f0f0;padding-top:3mm">
          <span>Select Branding Solutions — Internal Use Only</span>
          <span>${order.customerName ?? ""} · ${finishName} · ${dateStr}</span>
        </div>
      </div>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><title>Picking Slip — ${order.customerName ?? order.orderNumber}</title>
    <style>
      *{box-sizing:border-box}
      body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif;font-size:11px;color:#111}
      #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
      #toolbar span{flex:1;font-size:14px;font-weight:600;letter-spacing:.5px}
      #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
      #btn-print{background:#22c55e;color:white}#btn-print:hover{background:#16a34a}
      #btn-close{background:rgba(255,255,255,.15);color:white}#btn-close:hover{background:rgba(255,255,255,.25)}
      #page{display:flex;flex-direction:column;align-items:center;padding:24px 0 40px;gap:24px}
      .slip{background:white;padding:12mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.15);width:210mm}
      @media print{
        #toolbar{display:none}body{background:white}#page{padding:0;gap:0}
        .slip{box-shadow:none;width:100%;padding:0}
        .page-break{page-break-after:always}
        @page{size:A4 portrait;margin:12mm}
      }
    </style>
  </head><body>
    <div id="toolbar">
      <span>📋 Picking Slip — ${order.customerName ?? order.orderNumber} · ${sortedFinishes.length} finish${sortedFinishes.length !== 1 ? "es" : ""} · ${customerOrders.length} order${customerOrders.length !== 1 ? "s" : ""}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print all ${sortedFinishes.length}</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page">${slipPages}</div>
  </body></html>`;

  const win = window.open("", "_blank", "width=960,height=800");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
}

// ─── Dispatch-ready types & document print functions ──────────────────────────

interface DocEmployee { id: number; firstName: string; lastName: string | null; jobTitle: string | null; department: string | null; }
interface DocItem {
  id: number; orderId: number; productName: string; colour: string | null; size: string | null;
  finishName: string | null; quantity: number; recipientType: string; recipientName: string | null;
  recipientEmployeeId: number | null; unitPrice: number; lineTotal: number; employee: DocEmployee | null;
}
interface DocAddress { line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null; }
interface DocCustomer { name: string; address: string | null; city: string | null; state: string | null; postcode: string | null; email: string | null; phone: string | null; }
interface DocOrder {
  id: number; orderNumber: string; customerName: string | null; orderDate: string;
  requiredDate: string | null; totalAmount: number; notes: string | null;
  customer: DocCustomer | null; deliveryAddress: DocAddress | null; items: DocItem[];
}

function docRecipientName(item: DocItem): string {
  if (item.employee) return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
  return item.recipientName ?? "Unknown";
}

function openPreview(title: string, bodyHtml: string, styleCss: string, toolbarLabel: string) {
  const win = window.open("", "_blank", "width=960,height=800");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    *{box-sizing:border-box}
    body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar span{flex:1;font-size:14px;font-weight:600}
    #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
    #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
    #page{display:flex;justify-content:center;padding:24px 0 40px}
    #sheet{background:white;width:210mm;box-shadow:0 4px 24px rgba(0,0,0,.15)}
    @media print{#toolbar{display:none}body{background:white}#page{padding:0}#sheet{box-shadow:none}@page{size:A4;margin:20mm}}
    ${styleCss}
  </style></head><body>
    <div id="toolbar">
      <span>${toolbarLabel}</span>
      <button id="btn-print" onclick="window.print()">🖨 Print</button>
      <button id="btn-close" onclick="window.close()">✕ Close</button>
    </div>
    <div id="page"><div id="sheet">${bodyHtml}</div></div>
  </body></html>`);
  win.document.close();
  win.focus();
}

function printDocDeliveryNote(order: DocOrder) {
  const dateStr = new Date().toLocaleDateString("en-AU");
  const addr = order.deliveryAddress;
  const addrLines = addr ? [addr.line1, addr.line2, addr.city, addr.county, addr.postcode, addr.country].filter(Boolean) : [];
  const namedItems = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
  const stockItems = order.items.filter((i) => !(i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)));
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);

  const recipientGroups = new Map<string, { name: string; jobTitle: string | null; items: DocItem[] }>();
  for (const item of namedItems) {
    const name = docRecipientName(item);
    if (!recipientGroups.has(name)) recipientGroups.set(name, { name, jobTitle: item.employee?.jobTitle ?? null, items: [] });
    recipientGroups.get(name)!.items.push(item);
  }

  const groupRows = [...recipientGroups.values()].map((g) => `
    <tr class="group-hdr"><td colspan="4"><strong>${g.name}</strong>${g.jobTitle ? ` <span class="job">${g.jobTitle}</span>` : ""}</td></tr>
    ${g.items.map((i) => `<tr><td style="padding-left:18px">${i.productName}${i.finishName ? ` <span class="finish">${i.finishName}</span>` : ""}</td><td>${i.colour ?? "—"}</td><td>${i.size ?? "—"}</td><td class="ctr">${i.quantity}</td></tr>`).join("")}
  `).join("");
  const stockRows = stockItems.length > 0 ? `
    <tr class="group-hdr"><td colspan="4"><strong>General Stock</strong></td></tr>
    ${stockItems.map((i) => `<tr><td style="padding-left:18px">${i.productName}${i.finishName ? ` <span class="finish">${i.finishName}</span>` : ""}</td><td>${i.colour ?? "—"}</td><td>${i.size ?? "—"}</td><td class="ctr">${i.quantity}</td></tr>`).join("")}
  ` : "";

  openPreview(
    `Delivery Note — ${order.orderNumber}`,
    `<div style="padding:15mm">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:5mm;margin-bottom:5mm">
        <div><div style="font-size:22pt;font-weight:900;color:#1e3a5f">Select Branding Solutions</div></div>
        <div style="text-align:right"><div style="font-size:16pt;font-weight:bold;color:#333">DELIVERY NOTE</div><div style="font-size:11pt;color:#555">${order.orderNumber}</div></div>
      </div>
      <div style="display:flex;gap:24px;margin-bottom:5mm">
        <div style="flex:1"><div class="lbl">Deliver To</div><p><strong>${order.customerName ?? ""}</strong><br>${addrLines.length > 0 ? addrLines.join("<br>") : "<em>No delivery address</em>"}</p></div>
        <div style="flex:1"><div class="lbl">Order Details</div><p>Order Date: ${new Date(order.orderDate).toLocaleDateString("en-AU")}<br>${order.requiredDate ? `Required By: <strong>${new Date(order.requiredDate).toLocaleDateString("en-AU")}</strong><br>` : ""}Dispatched: ${dateStr}</p></div>
      </div>
      <table><thead><tr><th>Item</th><th>Colour</th><th>Size</th><th class="ctr">Qty</th></tr></thead>
      <tbody>${groupRows}${stockRows}<tr style="border-top:2px solid #000"><td colspan="3" style="text-align:right;font-weight:bold">Total Items</td><td class="ctr" style="font-size:13pt">${totalQty}</td></tr></tbody></table>
      <div style="margin-top:8mm;display:flex;gap:32px"><div class="sig">Packed by: ______________________</div><div class="sig">Checked by: ______________________</div><div class="sig">Date: ______________________</div></div>
      <div style="margin-top:6mm;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:4mm">Please check contents carefully. Any discrepancies should be reported within 48 hours of receipt.</div>
    </div>`,
    `.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px}
     table{width:100%;border-collapse:collapse;margin-top:8px}
     th{background:#1e3a5f;color:white;padding:5px 8px;text-align:left;font-size:9pt}th.ctr{text-align:center}
     td{padding:4px 8px;border-bottom:1px solid #e0e0e0;font-size:10pt}td.ctr{text-align:center;font-weight:bold}
     tr.group-hdr td{background:#f5f5f5;padding:5px 8px;border-bottom:1px solid #ccc;font-size:10pt}
     .job{font-size:9pt;color:#555;font-weight:normal;margin-left:6px}.finish{font-size:9pt;color:#2563eb}
     .sig{flex:1;border-top:1px solid #999;padding-top:4px;font-size:9pt;color:#555}`,
    `📄 Delivery Note — ${order.customerName ?? order.orderNumber}`
  );
}

function printDocInvoice(order: DocOrder) {
  const dateStr = new Date().toLocaleDateString("en-AU");
  const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = dueDate.toLocaleDateString("en-AU");
  const customer = order.customer;
  const addr = order.deliveryAddress;
  const addrLines = addr ? [addr.line1, addr.line2, addr.city, addr.county, addr.postcode, addr.country].filter(Boolean) : [];
  const custAddrLines = customer ? [customer.address, customer.city, customer.state, customer.postcode].filter(Boolean) : [];
  const subtotal = order.items.reduce((s, i) => s + i.lineTotal, 0);
  const gst = subtotal * 0.1;
  const total = subtotal + gst;
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  const itemRows = order.items.map((i) => `
    <tr>
      <td>${i.productName}${i.finishName ? ` <span class="finish">${i.finishName}</span>` : ""}${i.colour || i.size ? `<br><span class="variant">${[i.colour, i.size].filter(Boolean).join(" / ")}</span>` : ""}</td>
      <td class="ctr">${i.quantity}</td>
      <td class="right">${fmt(i.unitPrice)}</td>
      <td class="right">${fmt(i.lineTotal)}</td>
    </tr>`).join("");

  openPreview(
    `Invoice — ${order.orderNumber}`,
    `<div style="padding:15mm">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:5mm;margin-bottom:5mm">
        <div><div style="font-size:22pt;font-weight:900;color:#1e3a5f">Select Branding Solutions</div><div style="font-size:9pt;color:#555;margin-top:2mm">ABN: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</div></div>
        <div style="text-align:right"><div style="font-size:18pt;font-weight:bold;color:#333">INVOICE</div><div style="font-size:11pt;color:#555">${order.orderNumber}</div><div style="font-size:9pt;color:#888">Date: ${dateStr} · Due: ${dueDateStr}</div></div>
      </div>
      <div style="display:flex;gap:24px;margin-bottom:6mm">
        <div style="flex:1"><div class="lbl">Bill To</div><p><strong>${order.customerName ?? ""}</strong><br>${custAddrLines.length > 0 ? custAddrLines.join("<br>") : ""}<br>${customer?.email ? customer.email : ""}</p></div>
        <div style="flex:1"><div class="lbl">Deliver To</div><p>${addrLines.length > 0 ? addrLines.join("<br>") : "<em>Same as billing</em>"}</p></div>
        <div style="flex:1"><div class="lbl">Reference</div><p>Order: ${order.orderNumber}<br>${order.requiredDate ? `Required: ${new Date(order.requiredDate).toLocaleDateString("en-AU")}` : ""}</p></div>
      </div>
      <table><thead><tr><th>Description</th><th class="ctr">Qty</th><th class="right">Unit Price</th><th class="right">Total</th></tr></thead>
      <tbody>${itemRows}</tbody></table>
      <div style="display:flex;justify-content:flex-end;margin-top:4mm">
        <div style="width:220px">
          <div class="tot-row"><span>Subtotal</span><span>${fmt(subtotal)}</span></div>
          <div class="tot-row"><span>GST (10%)</span><span>${fmt(gst)}</span></div>
          <div class="tot-row total"><span>Total (inc. GST)</span><span>${fmt(total)}</span></div>
        </div>
      </div>
      <div style="margin-top:8mm;padding:4mm 5mm;background:#f9f9f9;border:1px solid #e0e0e0;border-radius:4px;font-size:9pt;color:#555">
        <strong>Payment Terms:</strong> Net 30 days from invoice date · EFT preferred · Please reference invoice number on payment.
      </div>
      <div style="margin-top:4mm;font-size:8pt;color:#888;border-top:1px solid #ddd;padding-top:3mm">Select Branding Solutions · Thank you for your business.</div>
    </div>`,
    `.lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;color:#888;margin-bottom:4px}
     table{width:100%;border-collapse:collapse;margin-top:8px}
     th{background:#1e3a5f;color:white;padding:5px 8px;text-align:left;font-size:9pt}th.ctr{text-align:center}th.right{text-align:right}
     td{padding:4px 8px;border-bottom:1px solid #e0e0e0;font-size:10pt}td.ctr{text-align:center}td.right{text-align:right}
     .variant{font-size:8pt;color:#888}.finish{font-size:9pt;color:#2563eb}
     .tot-row{display:flex;justify-content:space-between;padding:3px 0;font-size:10pt;border-bottom:1px solid #eee}
     .tot-row.total{font-size:12pt;font-weight:bold;border-bottom:none;margin-top:4px;color:#1e3a5f}`,
    `🧾 Invoice — ${order.customerName ?? order.orderNumber}`
  );
}

function printDocWearerLabels(order: DocOrder) {
  const namedItems = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
  if (namedItems.length === 0) return;

  const labels: string[] = [];
  for (const item of namedItems) {
    const name = docRecipientName(item);
    const jobTitle = item.employee?.jobTitle ?? null;
    const variant = [item.colour, item.size].filter(Boolean).join(" / ");
    for (let q = 0; q < item.quantity; q++) {
      labels.push(`
        <div class="label">
          <div class="order-ref">${order.orderNumber} · ${order.customerName ?? ""}</div>
          <div class="name">${name}</div>
          ${jobTitle ? `<div class="job-title">${jobTitle}</div>` : ""}
          <div class="divider"></div>
          <div class="product">${item.productName}</div>
          ${item.finishName ? `<div class="finish">${item.finishName}</div>` : ""}
          ${variant ? `<div class="variant">${variant}</div>` : ""}
        </div>`);
    }
  }

  const win = window.open("", "_blank", "width=700,height=800");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>Wearer Labels — ${order.orderNumber}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:Arial,sans-serif;background:#e5e7eb}
    #toolbar{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:10px;padding:10px 20px;background:#1e3a5f;color:white;box-shadow:0 2px 6px rgba(0,0,0,.3)}
    #toolbar span{flex:1;font-size:14px;font-weight:600}
    #toolbar button{padding:6px 18px;border:none;border-radius:5px;font-size:13px;font-weight:600;cursor:pointer}
    #btn-print{background:#22c55e;color:white}#btn-close{background:rgba(255,255,255,.15);color:white}
    #page{padding:16px;display:flex;flex-direction:column;gap:12px;align-items:center}
    .label{width:4in;min-height:3in;background:white;border:1px solid #ccc;display:flex;flex-direction:column;justify-content:center;padding:0.3in;box-shadow:0 2px 8px rgba(0,0,0,.1)}
    .order-ref{font-size:9pt;color:#555;margin-bottom:10px}
    .name{font-size:28pt;font-weight:bold;color:#000;line-height:1.1}
    .job-title{font-size:12pt;color:#333;margin-top:4px}
    .divider{border-top:2px solid #000;margin:14px 0}
    .product{font-size:14pt;font-weight:600;color:#000}
    .finish{font-size:10pt;color:#2563eb;margin-top:2px}
    .variant{font-size:11pt;color:#444;margin-top:3px}
    @media print{#toolbar{display:none}body{background:white}#page{padding:0;gap:0}
      .label{border:none;box-shadow:none;width:4in;height:6in;page-break-after:always}
      @page{size:4in 6in;margin:0}}
  </style></head><body>
  <div id="toolbar">
    <span>🏷️ Wearer Labels — ${labels.length} label${labels.length !== 1 ? "s" : ""} · ${order.customerName ?? order.orderNumber}</span>
    <button id="btn-print" onclick="window.print()">🖨 Print</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">${labels.join("")}</div>
  </body></html>`);
  win.document.close();
  win.focus();
}

// ─── Ready to Dispatch modal ───────────────────────────────────────────────────

function ReadyToDispatchModal({ order, onClose }: { order: DocOrder; onClose: () => void }) {
  const namedCount = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)).length;
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [tracking, setTracking] = useState<string>((order as any).trackingNumber ?? "");
  const [trackingSaved, setTrackingSaved] = useState(!!(order as any).trackingNumber);

  const saveTracking = useMutation({
    mutationFn: (tn: string | null) =>
      fetch(`${API_BASE}/invoices/${order.id}/tracking`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber: tn || null }),
      }).then((r) => r.json()),
    onSuccess: () => {
      setTrackingSaved(true);
      qc.invalidateQueries({ queryKey: ["production-order", order.id] });
      toast({ title: "Tracking number saved" });
    },
    onError: () => toast({ title: "Failed to save tracking", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-green-700">
            <CheckCircle2 className="w-5 h-5" />
            Order Ready for Dispatch
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3">
            <div className="font-semibold text-green-900">{order.orderNumber}</div>
            <div className="text-sm text-green-700">{order.customerName}</div>
            <div className="text-xs text-green-600 mt-1">
              {order.items.length} line{order.items.length !== 1 ? "s" : ""} · {totalQty} item{totalQty !== 1 ? "s" : ""}
              {namedCount > 0 && ` · ${namedCount} named recipient${namedCount !== 1 ? "s" : ""}`}
            </div>
          </div>

          {/* DPD Tracking Number */}
          <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              📦 DPD Tracking Number
              {trackingSaved && tracking && <span className="text-green-600 normal-case font-normal">(saved)</span>}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                value={tracking}
                onChange={(e) => { setTracking(e.target.value); setTrackingSaved(false); }}
                placeholder="e.g. 15006678987456"
                className="h-8 text-xs font-mono flex-1"
              />
              <Button
                size="sm"
                variant={trackingSaved ? "outline" : "default"}
                className="h-8 px-3 text-xs shrink-0"
                onClick={() => saveTracking.mutate(tracking)}
                disabled={saveTracking.isPending || trackingSaved}
              >
                {saveTracking.isPending ? "Saving…" : trackingSaved ? "✓ Saved" : "Save"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Saved here, it will be included in the invoice email and shown on the customer's DPD tracking link.
            </p>
          </div>

          <p className="text-sm text-muted-foreground">Print the documents you need before dispatching.</p>

          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3"
              onClick={() => printDocDeliveryNote(order)}
            >
              <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
              <div className="text-left">
                <div className="font-medium">Delivery Note</div>
                <div className="text-xs text-muted-foreground">Items by recipient, sign-off fields</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="justify-start gap-2 h-auto py-3"
              onClick={() => printDocInvoice(order)}
            >
              <Archive className="w-4 h-4 text-purple-600 flex-shrink-0" />
              <div className="text-left">
                <div className="font-medium">Invoice</div>
                <div className="text-xs text-muted-foreground">Itemised with prices, GST, payment terms</div>
              </div>
            </Button>

            {namedCount > 0 && (
              <Button
                variant="outline"
                className="justify-start gap-2 h-auto py-3"
                onClick={() => printDocWearerLabels(order)}
              >
                <User className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-medium">Wearer Labels</div>
                  <div className="text-xs text-muted-foreground">{namedCount} named recipient{namedCount !== 1 ? "s" : ""} — one label per item</div>
                </div>
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
            onClick={() => { window.location.href = "/dispatch"; }}
          >
            <ArrowRight className="w-4 h-4" /> Go to Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Picking List Tab Component ───────────────────────────────────────────────

function PickingListTab({ filters }: { filters: Filters }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [returning, setReturning] = useState<Set<number>>(new Set());
  const [qtyOverrides, setQtyOverrides] = useState<Map<number, number>>(new Map());
  const [editingQty, setEditingQty] = useState<number | null>(null);

  function setQtyOverride(itemId: number, qty: number, fullQty: number) {
    setQtyOverrides((prev) => {
      const next = new Map(prev);
      if (qty >= fullQty) next.delete(itemId);
      else next.set(itemId, Math.max(1, qty));
      return next;
    });
  }

  const { data: rawPickingOrders = [], isLoading } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 30000,
  });

  const pickingOrders = filterPickingOrders(rawPickingOrders, filters);

  const pickMutation = useMutation({
    mutationFn: (itemIds: number[]) => {
      const qtyOverridesObj: Record<string, number> = {};
      for (const [id, qty] of qtyOverrides.entries()) {
        if (itemIds.includes(id)) qtyOverridesObj[String(id)] = qty;
      }
      return apiFetch("/picking-list/pick", {
        method: "POST",
        body: JSON.stringify({
          itemIds,
          ...(Object.keys(qtyOverridesObj).length > 0 ? { qtyOverrides: qtyOverridesObj } : {}),
        }),
      });
    },
    onSuccess: (data: { ok: boolean; plainPicked: number; worksheetItems: number }) => {
      queryClient.invalidateQueries({ queryKey: ["picking-list"] });
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setChecked(new Set());
      setQtyOverrides(new Map());
      const parts: string[] = [];
      if (data.plainPicked > 0) parts.push(`${data.plainPicked} ready for dispatch`);
      if (data.worksheetItems > 0) parts.push(`${data.worksheetItems} sent to production`);
      toast({ title: "Picked", description: parts.join(" · ") || "Items confirmed" });
    },
    onError: (err: any) => {
      let title = "Cannot send to production";
      let description = "An unexpected error occurred. Please try again.";
      try {
        const parsed = JSON.parse(err?.message ?? "");
        if (parsed?.error) description = parsed.error;
      } catch {
        if (err?.message) description = err.message;
      }
      toast({ title, description, variant: "destructive" });
    },
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
  const rawTotalItems = rawPickingOrders.reduce((s, o) => s + o.items.length, 0);

  if (isLoading) return (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
    </div>
  );

  if (rawTotalItems === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <ListChecks className="w-12 h-12 text-purple-300" />
      <p className="text-lg font-medium">No items to pick</p>
      <p className="text-sm text-center max-w-xs">Items allocated from delivered stock will appear here for warehouse picking.</p>
    </div>
  );

  if (totalItems === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
      <Search className="w-12 h-12 text-purple-200" />
      <p className="text-lg font-medium">No results match your filters</p>
      <p className="text-sm text-center max-w-xs">{rawTotalItems} item{rawTotalItems !== 1 ? "s" : ""} exist but none match the current filter.</p>
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
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-purple-400 text-purple-700 hover:bg-purple-50"
                  onClick={() => printCombinedPickingSlip(checkedItems, rawPickingOrders)}
                  title="Print a single combined picking slip for all selected items"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Combined Slip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-indigo-400 text-indigo-700 hover:bg-indigo-50"
                  onClick={() => printPerCustomerPickingSlips(checkedItems, rawPickingOrders)}
                  title="Print one picking slip per customer/order"
                >
                  <FileText className="w-3.5 h-3.5" />
                  Per Customer ({new Set(checkedItems.map(i => i.customerName ?? String(i.orderId))).size})
                </Button>
                <Button
                  size="sm"
                  onClick={() => pickMutation.mutate([...checked])}
                  disabled={pickMutation.isPending}
                  className={`gap-1.5 text-white ${needsWorksheet ? "bg-blue-600 hover:bg-blue-700" : "bg-green-600 hover:bg-green-700"}`}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {label}
                </Button>
              </>
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
                    onClick={() => printPickingSlip(order, rawPickingOrders)}
                    title="Print picking slip — all orders for this customer, one slip per finish"
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
                          {/* Inline qty editor */}
                          {editingQty === item.itemId ? (
                            <input
                              type="number"
                              min={1}
                              max={item.quantity}
                              defaultValue={qtyOverrides.get(item.itemId) ?? item.quantity}
                              autoFocus
                              className="w-14 h-7 text-center text-sm font-bold border border-primary rounded px-1 focus:outline-none focus:ring-1 focus:ring-primary"
                              onBlur={(e) => {
                                const v = parseInt(e.target.value);
                                if (!isNaN(v)) setQtyOverride(item.itemId, v, item.quantity);
                                setEditingQty(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                if (e.key === "Escape") { setEditingQty(null); }
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => setEditingQty(item.itemId)}
                              title="Click to edit quantity picked — reduces the number and sends the shortfall to purchasing"
                              className={`min-w-[2rem] h-7 px-2 rounded text-sm font-bold transition-colors border ${
                                qtyOverrides.has(item.itemId)
                                  ? "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200"
                                  : "bg-secondary text-secondary-foreground border-transparent hover:bg-muted hover:border-border"
                              }`}
                            >
                              {qtyOverrides.get(item.itemId) ?? item.quantity}
                            </button>
                          )}
                          {qtyOverrides.has(item.itemId) && (
                            <span className="text-xs text-amber-700 font-medium whitespace-nowrap">
                              shortfall: {item.quantity - (qtyOverrides.get(item.itemId) ?? item.quantity)}
                            </span>
                          )}
                          <button
                            onClick={() => toggleReturning(item.itemId)}
                            title="Stock not found — return whole item to purchasing"
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
                      {qtyOverrides.has(item.itemId) && !isReturning && (
                        <div className="flex items-center gap-2 px-12 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-800">
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>
                            Picking <strong>{qtyOverrides.get(item.itemId)}</strong> of {item.quantity} — shortfall of <strong>{item.quantity - (qtyOverrides.get(item.itemId) ?? item.quantity)}</strong> will be added to purchasing requirements.
                          </span>
                          <button onClick={() => setQtyOverride(item.itemId, item.quantity, item.quantity)} className="ml-auto text-amber-600 hover:text-amber-800 underline whitespace-nowrap">Reset</button>
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

// ── Daily Work Plan ────────────────────────────────────────────────────────────

const URGENCY_CONFIG = {
  overdue:   { label: "Overdue — Act Now",      bg: "bg-red-50",     border: "border-red-200",   dot: "bg-red-500",    text: "text-red-700",   badge: "bg-red-100 text-red-800 border-red-200" },
  today:     { label: "Due Today",              bg: "bg-orange-50",  border: "border-orange-200", dot: "bg-orange-500", text: "text-orange-700", badge: "bg-orange-100 text-orange-800 border-orange-200" },
  soon:      { label: "Due in 1–2 Days",        bg: "bg-amber-50",   border: "border-amber-200",  dot: "bg-amber-500",  text: "text-amber-700",  badge: "bg-amber-100 text-amber-800 border-amber-200" },
  this_week: { label: "Due This Week",          bg: "bg-blue-50",    border: "border-blue-200",   dot: "bg-blue-400",   text: "text-blue-700",   badge: "bg-blue-100 text-blue-800 border-blue-200" },
  upcoming:  { label: "Upcoming",               bg: "bg-muted/30",   border: "border-border",     dot: "bg-gray-400",   text: "text-foreground", badge: "bg-muted text-muted-foreground border-border" },
} as const;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  in_progress: { label: "In Progress",   color: "bg-amber-100 text-amber-800 border-amber-200" },
  ready:       { label: "Ready to Start", color: "bg-green-100 text-green-800 border-green-200" },
  pick_first:  { label: "Needs Picking",  color: "bg-purple-100 text-purple-800 border-purple-200" },
  mixed:       { label: "Mixed Stages",   color: "bg-gray-100 text-gray-700 border-gray-200" },
};

const TASK_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  picking: { label: "Picking List", color: "text-purple-600" },
  pre_wip: { label: "Pre-Production", color: "text-blue-600" },
  wip:     { label: "In Progress",  color: "text-amber-600" },
};

function daysLabel(days: number | null): string {
  if (days === null) return "No due date";
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function TaskGroupCard({
  group,
  onNavigate,
}: {
  group: PlanTaskGroup;
  onNavigate: (tab: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const urg = URGENCY_CONFIG[group.urgency];
  const stat = STATUS_LABELS[group.overallStatus] ?? STATUS_LABELS.mixed;

  const actionLabel =
    group.overallStatus === "pick_first" ? "Go to Picking List" :
    group.overallStatus === "in_progress" ? "View in WIP" :
    "View in Pre-Production";

  const actionTab =
    group.overallStatus === "pick_first" ? "picking_list" :
    group.overallStatus === "in_progress" ? "wip" :
    "pre_wip";

  const batchNote = group.orderCount > 1
    ? `${group.totalQty} items across ${group.orderCount} orders — batch together for maximum efficiency`
    : `${group.totalQty} item${group.totalQty !== 1 ? "s" : ""} for 1 order`;

  return (
    <div className={`rounded-xl border ${urg.border} ${urg.bg} shadow-sm overflow-hidden`}>
      {/* Header */}
      <div className="flex items-start gap-3 px-5 py-4">
        <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${urg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-base">{group.finishName}</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${stat.color}`}>
              {stat.label}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />
              {batchNote}
            </span>
            <span className={`text-sm font-medium ${urg.text}`}>
              {daysLabel(group.daysUntilDue)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7 gap-1"
            onClick={() => onNavigate(actionTab)}
          >
            {group.overallStatus === "in_progress" ? <Play className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
            {actionLabel}
          </Button>
          <button
            onClick={() => setExpanded((x) => !x)}
            className="p-1 rounded hover:bg-black/5 text-muted-foreground"
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Task rows */}
      <div className={`border-t ${urg.border} divide-y divide-${urg.border}`}>
        {group.tasks.map((task, i) => {
          const tLabel = TASK_TYPE_LABELS[task.type] ?? TASK_TYPE_LABELS.picking;
          return (
            <div key={i} className="px-5 py-3 flex items-start gap-3">
              <div className="w-2.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-sm">
                  {task.worksheetNumber && (
                    <span className="font-mono font-bold text-foreground">{task.worksheetNumber}</span>
                  )}
                  {task.orderNumber && (
                    <span className={`font-mono ${task.worksheetNumber ? "text-muted-foreground" : "font-bold text-foreground"}`}>
                      {task.orderNumber}
                    </span>
                  )}
                  {task.customerName && (
                    <span className="text-muted-foreground">— {task.customerName}</span>
                  )}
                  <span className={`text-xs font-medium ${tLabel.color}`}>{tLabel.label}</span>
                  <span className="ml-auto font-semibold text-foreground">{task.qty} item{task.qty !== 1 ? "s" : ""}</span>
                </div>
                {task.requiredDate && (
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Due {formatDate(task.requiredDate)}
                  </div>
                )}
                {expanded && task.items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {task.items.map((item, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs text-muted-foreground pl-2 border-l-2 border-muted">
                        <span className="font-medium text-foreground">{item.productName}</span>
                        {item.colour && <span>{item.colour}</span>}
                        {item.size && <span>/ {item.size}</span>}
                        {item.recipient && <span className="ml-auto">→ {item.recipient}</span>}
                        <span className="font-semibold text-foreground">×{item.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyPlanTab({ onNavigate, pendingCount, readyCount }: { onNavigate: (tab: string) => void; pendingCount: number; readyCount: number }) {
  const { data: plan, isLoading } = useQuery<DailyPlan>({
    queryKey: ["daily-plan"],
    queryFn: () => apiFetch("/production/daily-plan"),
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Building your work plan…
      </div>
    );
  }

  if (!plan || plan.taskGroups.length === 0) {
    const totalWaiting = pendingCount + readyCount;
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-4">
        <CheckCircle2 className="w-14 h-14 text-green-300" />
        <p className="text-lg font-medium">No active production work</p>
        {totalWaiting > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-4 max-w-md text-center space-y-2">
            <p className="text-sm font-medium text-amber-800">
              {readyCount > 0 && pendingCount > 0
                ? `${readyCount} order${readyCount !== 1 ? "s" : ""} ready for production · ${pendingCount} awaiting stock`
                : readyCount > 0
                  ? `${readyCount} confirmed order${readyCount !== 1 ? "s" : ""} ready to send to production`
                  : `${pendingCount} confirmed order${pendingCount !== 1 ? "s" : ""} waiting for stock to arrive`}
            </p>
            <button
              onClick={() => onNavigate("pre_wip")}
              className="text-sm font-semibold text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              View in Pre-Production →
            </button>
          </div>
        ) : (
          <p className="text-sm text-center max-w-sm">
            All clear! When orders are confirmed and items are allocated to stock, your daily work plan will appear here.
          </p>
        )}
      </div>
    );
  }

  const { summary } = plan;
  const urgentGroups  = plan.taskGroups.filter((g) => g.urgency === "overdue");
  const todayGroups   = plan.taskGroups.filter((g) => g.urgency === "today");
  const soonGroups    = plan.taskGroups.filter((g) => g.urgency === "soon");
  const weekGroups    = plan.taskGroups.filter((g) => g.urgency === "this_week");
  const upcomingGroups = plan.taskGroups.filter((g) => g.urgency === "upcoming");

  const needsActionNow = summary.overdue + summary.today + summary.soon;

  return (
    <div className="space-y-6">
      {/* ── Summary banner ── */}
      <div className={`rounded-xl border p-4 flex flex-wrap items-center gap-4 ${needsActionNow > 0 ? "bg-red-50 border-red-200" : "bg-green-50 border-green-200"}`}>
        <div className="flex items-center gap-2">
          {needsActionNow > 0
            ? <AlertTriangle className="w-5 h-5 text-red-600" />
            : <CheckCircle2 className="w-5 h-5 text-green-600" />
          }
          <span className={`font-semibold ${needsActionNow > 0 ? "text-red-700" : "text-green-700"}`}>
            {needsActionNow > 0
              ? `${needsActionNow} process batch${needsActionNow !== 1 ? "es" : ""} need attention now`
              : "All urgent work is under control"}
          </span>
        </div>
        <div className="flex items-center gap-3 ml-auto flex-wrap text-sm">
          {summary.overdue > 0   && <span className="flex items-center gap-1 text-red-700 font-medium"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />{summary.overdue} overdue</span>}
          {summary.today > 0     && <span className="flex items-center gap-1 text-orange-700 font-medium"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />{summary.today} due today</span>}
          {summary.soon > 0      && <span className="flex items-center gap-1 text-amber-700 font-medium"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />{summary.soon} due soon</span>}
          {summary.thisWeek > 0  && <span className="flex items-center gap-1 text-blue-700 font-medium"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />{summary.thisWeek} this week</span>}
          {summary.upcoming > 0  && <span className="flex items-center gap-1 text-muted-foreground"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />{summary.upcoming} upcoming</span>}
        </div>
      </div>

      {/* Batching tip */}
      <div className="flex items-start gap-2 rounded-lg bg-muted/40 border border-border px-4 py-3 text-sm text-muted-foreground">
        <Layers className="w-4 h-4 mt-0.5 flex-shrink-0 text-primary" />
        <span>
          <span className="font-medium text-foreground">Batch for efficiency —</span>{" "}
          Jobs with the same finish are grouped together below. Complete all items in a group in one run rather than returning to them across multiple shifts.
        </span>
      </div>

      {/* ── Overdue ── */}
      {urgentGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <h3 className="font-semibold text-red-700">Overdue — Complete Immediately</h3>
          </div>
          {urgentGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Due today ── */}
      {todayGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-orange-600" />
            <h3 className="font-semibold text-orange-700">Due Today — Start First</h3>
          </div>
          {todayGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Due soon (1–2 days) ── */}
      {soonGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <h3 className="font-semibold text-amber-700">Due in 1–2 Days — Plan Today</h3>
          </div>
          {soonGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── This week ── */}
      {weekGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <h3 className="font-semibold text-blue-700">Due This Week</h3>
          </div>
          {weekGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}

      {/* ── Upcoming ── */}
      {upcomingGroups.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-muted-foreground" />
            <h3 className="font-semibold text-muted-foreground">Upcoming</h3>
          </div>
          {upcomingGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} onNavigate={onNavigate} />)}
        </div>
      )}
    </div>
  );
}

export default function Production() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") ?? "plan";
  });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [readyOrder, setReadyOrder] = useState<DocOrder | null>(null);

  const { data: allWorksheets = [], isLoading: wsLoading } = useQuery<Worksheet[]>({
    queryKey: ["worksheets"],
    queryFn: () => apiFetch("/worksheets"),
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery<{
    awaitingStock: PendingOrder[];
    readyForProduction: ReadyOrder[];
  }>({
    queryKey: ["production-pending"],
    queryFn: () => apiFetch("/production/pending"),
  });
  const pendingOrders = pendingData?.awaitingStock ?? [];
  const readyForProduction = pendingData?.readyForProduction ?? [];

  const { data: pickingOrders = [] } = useQuery<PickingOrder[]>({
    queryKey: ["picking-list"],
    queryFn: () => apiFetch("/picking-list"),
    refetchInterval: 30000,
  });

  const pickingCount = pickingOrders.reduce((s, o) => s + o.items.length, 0);

  const isLoading = wsLoading || pendingLoading;

  const statusMutation = useMutation({
    mutationFn: ({ id, status, orderId: _orderId }: { id: number; status: string; orderId?: number | null }) =>
      apiFetch(`/worksheets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: async (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      if (variables.status === "complete" && variables.orderId) {
        toast({ title: "Worksheet complete — checking order status…" });
        try {
          const result = await apiFetch<{ isComplete: boolean; order: DocOrder }>(`/dispatch/orders/${variables.orderId}/ready`);
          if (result.isComplete) {
            setReadyOrder(result.order);
          } else {
            toast({ title: "Worksheet marked complete" });
          }
        } catch {
          toast({ title: "Worksheet marked complete" });
        }
      } else {
        toast({ title: "Status updated" });
      }
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

  const preWipWorksheets = filterWorksheets(allWorksheets.filter((w) => w.status === "pre_wip"), filters);
  const wip = filterWorksheets(allWorksheets.filter((w) => w.status === "wip"), filters);
  const complete = filterWorksheets(allWorksheets.filter((w) => w.status === "complete"), filters);

  const filteredPendingOrders = pendingOrders.filter((o) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!o.customerName?.toLowerCase().includes(q) && !o.orderNumber.toLowerCase().includes(q)) return false;
    }
    if (!matchesDateFilters(o.requiredDate as unknown as string | null, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });

  const filteredReadyForProduction = readyForProduction.filter((o) => {
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!o.customerName?.toLowerCase().includes(q) && !o.orderNumber.toLowerCase().includes(q)) return false;
    }
    if (!matchesDateFilters(o.requiredDate as unknown as string | null, filters.dateFrom, filters.dateTo)) return false;
    return true;
  });

  const preWipTotal = preWipWorksheets.length + filteredPendingOrders.length + filteredReadyForProduction.length;

  // Unfiltered counts for stat cards (show actual total, filtered shown inside tab)
  const rawPreWip = allWorksheets.filter((w) => w.status === "pre_wip").length + pendingOrders.length + readyForProduction.length;
  const rawWip = allWorksheets.filter((w) => w.status === "wip").length;
  const rawComplete = allWorksheets.filter((w) => w.status === "complete").length;
  const hasFilters = Object.values(filters).some(Boolean);

  const { data: dailyPlan } = useQuery<DailyPlan>({
    queryKey: ["daily-plan"],
    queryFn: () => apiFetch("/production/daily-plan"),
    refetchInterval: 60_000,
  });

  const urgentPlanCount = dailyPlan?.summary.urgentCount ?? 0;

  const TAB_COUNTS = [
    { key: "plan",         label: "Today's Plan",      count: urgentPlanCount,                                  icon: Zap,         color: "text-primary" },
    { key: "picking_list", label: "Picking List",       count: pickingCount,                                     icon: ListChecks,  color: "text-purple-600" },
    { key: "pre_wip",      label: "Pre-Production",      count: hasFilters ? preWipTotal : rawPreWip,             icon: Clock,       color: "text-blue-600" },
    { key: "wip",          label: "Work in Progress",   count: hasFilters ? wip.length : rawWip,                 icon: ClipboardList, color: "text-amber-600" },
    { key: "complete",     label: "Complete",           count: hasFilters ? complete.length : rawComplete,       icon: CheckCircle2, color: "text-green-600" },
  ];

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["worksheets"] });
    queryClient.invalidateQueries({ queryKey: ["production-pending"] });
    queryClient.invalidateQueries({ queryKey: ["picking-list"] });
    queryClient.invalidateQueries({ queryKey: ["daily-plan"] });
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
            <p className="text-muted-foreground mt-1">Your daily work plan — batched by process for maximum efficiency.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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

          {activeTab !== "plan" && (
            <div className="mt-3">
              <FiltersBar filters={filters} onChange={setFilters} />
            </div>
          )}

          {/* ── Today's Plan Tab ── */}
          <TabsContent value="plan">
            <DailyPlanTab onNavigate={setActiveTab} pendingCount={pendingOrders.length} readyCount={readyForProduction.length} />
          </TabsContent>

          {/* ── Pre-Production Tab ── */}
          <TabsContent value="pre_wip">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
              </div>
            ) : preWipTotal === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <Clock className="w-12 h-12 text-blue-300" />
                <p className="text-lg font-medium">Nothing in Pre-Production</p>
                <p className="text-sm text-center max-w-xs">
                  Confirmed orders where garments haven't arrived yet appear here. Use 'Send to Production' on an order to create worksheets.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredReadyForProduction.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 text-sm font-medium text-green-700">
                      <ClipboardList className="w-4 h-4" />
                      Needs Production ({filteredReadyForProduction.length} order{filteredReadyForProduction.length !== 1 ? "s" : ""})
                    </div>
                    {filteredReadyForProduction.map((order) => (
                      <div key={order.id} className="rounded-xl border border-green-200 bg-green-50/50 shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4">
                          <div className="flex items-center gap-3 min-w-0">
                            <ClipboardList className="w-4 h-4 text-green-700 flex-shrink-0" />
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <a
                                  href={`/orders/${order.id}`}
                                  className="font-mono font-bold text-base hover:underline text-foreground"
                                >
                                  {order.orderNumber}
                                </a>
                                <Badge className="text-xs bg-green-100 text-green-800 border-green-300">
                                  Confirmed
                                </Badge>
                              </div>
                              <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                                {order.customerName && <span>{order.customerName}</span>}
                                {order.requiredDate && <span>· Due {formatDate(order.requiredDate)}</span>}
                                <span>· {order.itemCount} item{order.itemCount !== 1 ? "s" : ""}</span>
                                <span>· {formatCurrency(order.totalAmount)}</span>
                              </div>
                            </div>
                          </div>
                          <a href={`/orders/${order.id}`}>
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs">
                              <ExternalLink className="w-3.5 h-3.5" /> View &amp; Send to Production
                            </Button>
                          </a>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {filteredPendingOrders.length > 0 && (
                  <>
                    {filteredReadyForProduction.length > 0 && <div className="pt-1" />}
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                      <ShoppingCart className="w-4 h-4" />
                      Awaiting Stock ({filteredPendingOrders.length} order{filteredPendingOrders.length !== 1 ? "s" : ""})
                    </div>
                    {filteredPendingOrders.map((order) => (
                      <PendingOrderCard key={order.orderId} order={order} />
                    ))}
                  </>
                )}
                {preWipWorksheets.length > 0 && (
                  <>
                    {(filteredPendingOrders.length > 0 || filteredReadyForProduction.length > 0) && (
                      <div className="flex items-center gap-2 text-sm font-medium text-blue-700 pt-2">
                        <Clock className="w-4 h-4" />
                        Worksheets Ready ({preWipWorksheets.length})
                      </div>
                    )}
                    {preWipWorksheets.map((ws) => (
                      <WorksheetCard
                        key={ws.id}
                        ws={ws}
                        onStatusChange={(id, s) => statusMutation.mutate({ id, status: s, orderId: ws.orderId })}
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
                <p className="text-sm text-center max-w-xs">Move items here from Pre-Production when the garments have arrived and decoration can begin.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {wip.map((ws) => (
                  <WorksheetCard
                    key={ws.id}
                    ws={ws}
                    onStatusChange={(id, s) => statusMutation.mutate({ id, status: s, orderId: ws.orderId })}
                    onDelete={handleDelete}
                    onReturnToPicking={handleReturnToPicking}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Picking List Tab ── */}
          <TabsContent value="picking_list">
            <PickingListTab filters={filters} />
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
                    onStatusChange={(id, s) => statusMutation.mutate({ id, status: s, orderId: ws.orderId })}
                    onDelete={handleDelete}
                    onReturnToPicking={handleReturnToPicking}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {readyOrder && (
        <ReadyToDispatchModal order={readyOrder} onClose={() => setReadyOrder(null)} />
      )}
    </Layout>
  );
}
