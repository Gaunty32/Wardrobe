import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, Package, CheckCircle, AlertTriangle, Clock, Printer,
  RefreshCw, ChevronDown, ChevronRight, FileText, Tag, Send, ExternalLink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface Employee {
  id: number; firstName: string; lastName: string | null;
  jobTitle: string | null; department: string | null;
}
interface DispatchItem {
  id: number; orderId: number; productName: string; colour: string | null;
  size: string | null; quantity: number; recipientType: string;
  recipientName: string | null; recipientEmployeeId: number | null;
  finishName: string | null; unitPrice: number; lineTotal: number;
  employee: Employee | null;
}
interface Worksheet {
  id: number; worksheetNumber: string; status: string;
  completedAt: string | null;
}
interface DeliveryAddress {
  id: number; label: string | null; line1: string | null; line2: string | null;
  city: string | null; county: string | null; postcode: string | null; country: string | null;
}
interface DispatchOrder {
  id: number; orderNumber: string; customerName: string | null; customerId: number | null;
  status: string; totalAmount: number; notes: string | null;
  orderDate: string; requiredDate: string | null; dispatchedAt: string | null;
  shippingMethod: string | null;
  attentionOf: string | null;
  productionComplete: boolean;
  worksheets: Worksheet[];
  items: DispatchItem[];
  deliveryAddress: DeliveryAddress | null;
}

function recipientFullName(item: DispatchItem): string {
  if (item.employee) {
    return [item.employee.firstName, item.employee.lastName].filter(Boolean).join(" ");
  }
  return item.recipientName ?? "Unknown";
}

function recipientJobTitle(item: DispatchItem): string | null {
  return item.employee?.jobTitle ?? null;
}

function isToday(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isPast(dateStr: string | null): boolean {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function printWearerLabels(order: DispatchOrder) {
  const namedItems = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
  if (namedItems.length === 0) {
    alert("No named recipients found for wearer labels.");
    return;
  }

  const labelPages: string[] = [];

  for (const item of namedItems) {
    const name = recipientFullName(item);
    const jobTitle = recipientJobTitle(item);
    const variant = [item.colour, item.size].filter(Boolean).join(" / ");

    for (let q = 0; q < item.quantity; q++) {
      labelPages.push(`
        <div class="label">
          <div class="order-ref">${order.orderNumber} · ${order.customerName ?? ""}</div>
          <div class="name">${name}</div>
          ${jobTitle ? `<div class="job-title">${jobTitle}</div>` : ""}
          <div class="divider"></div>
          <div class="product">${item.productName}</div>
          ${variant ? `<div class="variant">${variant}</div>` : ""}
        </div>
      `);
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Wearer Labels — ${order.orderNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; background: #e5e7eb; }
  #notice {
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; gap: 16px;
    padding: 10px 20px; background: #1e3a5f; color: white;
    box-shadow: 0 2px 6px rgba(0,0,0,.3);
  }
  #notice-text { flex: 1; }
  #notice-title { font-size: 14px; font-weight: 700; }
  #notice-sub { font-size: 12px; opacity: .8; margin-top: 2px; }
  #notice button { padding: 7px 20px; border: none; border-radius: 5px; font-size: 13px; font-weight: 700; cursor: pointer; }
  #btn-print { background: #22c55e; color: white; }
  #btn-close { background: rgba(255,255,255,.15); color: white; margin-left: 4px; }
  #page { padding: 20px; display: flex; flex-direction: column; gap: 16px; align-items: center; }
  .label {
    width: 6in; height: 4in;
    background: white; border: 1px solid #bbb; border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,.12);
    display: flex; flex-direction: column; justify-content: center;
    padding: 0.3in 0.4in;
  }
  .order-ref { font-size: 9pt; color: #555; margin-bottom: 10px; letter-spacing: .3px; }
  .name { font-size: 40pt; font-weight: 900; color: #000; line-height: 1.0; }
  .job-title { font-size: 14pt; color: #333; margin-top: 6px; }
  .divider { border-top: 2px solid #000; margin: 14px 0; }
  .product { font-size: 18pt; font-weight: 700; color: #000; }
  .variant { font-size: 13pt; color: #444; margin-top: 4px; }
  @media print {
    @page { size: 6in 4in; margin: 0; }
    #notice { display: none; }
    body { background: white; }
    #page { padding: 0; gap: 0; }
    .label {
      width: 6in; height: 4in;
      border: none; border-radius: 0; box-shadow: none;
      padding: 0.3in 0.4in;
      page-break-after: always;
    }
  }
</style>
</head>
<body>
  <div id="notice">
    <div id="notice-text">
      <div id="notice-title">🏷️ ${labelPages.length} Wearer Label${labelPages.length !== 1 ? "s" : ""} · ${order.customerName ?? order.orderNumber}</div>
      <div id="notice-sub">⚠️ Please select your LABEL PRINTER in the print dialog &nbsp;·&nbsp; 6 × 4 inch label format</div>
    </div>
    <button id="btn-print" onclick="window.print()">🖨 Print Labels</button>
    <button id="btn-close" onclick="window.close()">✕ Close</button>
  </div>
  <div id="page">${labelPages.join("")}</div>
</body>
</html>`;

  const win = window.open("", "_blank", "width=860,height=640");
  if (win) { win.document.write(html); win.document.close(); win.focus(); }
}

function printDeliveryNote(order: DispatchOrder) {
  const namedItems = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId));
  const stockItems = order.items.filter((i) => i.recipientType !== "person" || (!i.recipientName && !i.recipientEmployeeId));

  const recipientGroups = new Map<string, { name: string; jobTitle: string | null; items: DispatchItem[] }>();
  for (const item of namedItems) {
    const name = recipientFullName(item);
    if (!recipientGroups.has(name)) {
      recipientGroups.set(name, { name, jobTitle: recipientJobTitle(item), items: [] });
    }
    recipientGroups.get(name)!.items.push(item);
  }

  const addr = order.deliveryAddress;
  const addrLines = addr ? [addr.line1, addr.line2, addr.city, addr.county, addr.postcode, addr.country].filter(Boolean) : [];

  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);

  const groupRows = [...recipientGroups.values()].map((g) => `
    <tr class="group-header">
      <td colspan="4"><strong>${g.name}</strong>${g.jobTitle ? ` <span class="job">${g.jobTitle}</span>` : ""}</td>
    </tr>
    ${g.items.map((item) => `
      <tr>
        <td style="padding-left: 20px">${item.productName}</td>
        <td>${item.colour ?? "—"}</td>
        <td>${item.size ?? "—"}</td>
        <td class="qty">${item.quantity}</td>
      </tr>
    `).join("")}
  `).join("");

  const stockRows = stockItems.length > 0 ? `
    <tr class="group-header">
      <td colspan="4"><strong>General Stock</strong></td>
    </tr>
    ${stockItems.map((item) => `
      <tr>
        <td style="padding-left: 20px">${item.productName}</td>
        <td>${item.colour ?? "—"}</td>
        <td>${item.size ?? "—"}</td>
        <td class="qty">${item.quantity}</td>
      </tr>
    `).join("")}
  ` : "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Delivery Note — ${order.orderNumber}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 10pt; color: #000; background: white; padding: 20mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; }
  .company-name { font-size: 22pt; font-weight: bold; color: #000; }
  .doc-title { font-size: 16pt; font-weight: bold; text-align: right; color: #333; }
  .doc-number { font-size: 11pt; color: #555; text-align: right; }
  .info-row { display: flex; gap: 32px; margin-bottom: 24px; }
  .info-block { flex: 1; }
  .info-block h3 { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; color: #888; margin-bottom: 6px; }
  .info-block p { font-size: 10pt; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th { background: #222; color: white; padding: 6px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; }
  th.qty { text-align: center; }
  td { padding: 5px 10px; border-bottom: 1px solid #e0e0e0; font-size: 10pt; }
  td.qty { text-align: center; font-weight: bold; }
  tr.group-header td { background: #f5f5f5; font-size: 10pt; padding: 6px 10px; border-bottom: 1px solid #ccc; }
  .job { font-size: 9pt; color: #555; font-weight: normal; margin-left: 8px; }
  .totals { margin-top: 16px; text-align: right; font-size: 10pt; }
  .sig-block { margin-top: 32px; display: flex; gap: 48px; }
  .sig-line { flex: 1; border-top: 1px solid #000; padding-top: 6px; font-size: 9pt; color: #555; }
  .footer { margin-top: 24px; font-size: 8pt; color: #888; border-top: 1px solid #ddd; padding-top: 8px; }
  @media print { @page { size: A4; margin: 20mm; } body { padding: 0; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="company-name">Select Branding Solutions</div>
    </div>
    <div>
      <div class="doc-title">Delivery Note</div>
      <div class="doc-number">${order.orderNumber}</div>
    </div>
  </div>

  <div class="info-row">
    <div class="info-block">
      <h3>Deliver To</h3>
      <p><strong>${order.customerName ?? ""}</strong><br>
      ${order.attentionOf ? `FAO: ${order.attentionOf}<br>` : ""}${addrLines.length > 0 ? addrLines.join("<br>") : "<em>No delivery address on record</em>"}</p>
    </div>
    <div class="info-block">
      <h3>Order Details</h3>
      <p>Order Date: ${new Date(order.orderDate).toLocaleDateString("en-GB")}<br>
      ${order.requiredDate ? `Required By: <strong>${new Date(order.requiredDate).toLocaleDateString("en-GB")}</strong><br>` : ""}
      Dispatched: ${new Date().toLocaleDateString("en-GB")}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th>Colour</th>
        <th>Size</th>
        <th class="qty">Qty</th>
      </tr>
    </thead>
    <tbody>
      ${groupRows}
      ${stockRows}
      <tr style="border-top: 2px solid #000">
        <td colspan="3" style="text-align:right; font-weight: bold">Total Items</td>
        <td class="qty" style="font-size: 12pt">${totalQty}</td>
      </tr>
    </tbody>
  </table>

  <div class="sig-block">
    <div class="sig-line">Packed by: ______________________</div>
    <div class="sig-line">Checked by: ______________________</div>
    <div class="sig-line">Date: ______________________</div>
  </div>

  <div class="footer">
    Please check contents carefully. Any discrepancies should be reported within 48 hours of receipt.
  </div>

  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) { win.document.write(html); win.document.close(); }
}

function RequiredDateBadge({ requiredDate }: { requiredDate: string | null }) {
  if (!requiredDate) return null;
  const today = isToday(requiredDate);
  const past = isPast(requiredDate) && !today;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border ${
      past ? "bg-red-100 text-red-700 border-red-300" :
      today ? "bg-amber-100 text-amber-700 border-amber-300" :
      "bg-muted text-muted-foreground border-border"
    }`}>
      <Clock className="w-3 h-3" />
      {today ? "Due today" : past ? `Overdue — ${formatDate(requiredDate)}` : formatDate(requiredDate)}
    </span>
  );
}

interface DispatchResponse {
  order: DispatchOrder;
  dpd: { consignmentNumber: string; trackingUrl: string; labelPdfBase64: string | null } | null;
  dpdError: string | null;
  dpdConfigured: boolean;
}

function printBase64Pdf(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (win) win.onload = () => { win.print(); setTimeout(() => URL.revokeObjectURL(url), 10000); };
}

function DispatchCard({ order, onDispatched }: { order: DispatchOrder; onDispatched: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [numberOfParcels, setNumberOfParcels] = useState(1);
  const [totalWeightKg, setTotalWeightKg] = useState<number | "">("");
  const [bookDpd, setBookDpd] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Auto-suggest DPD booking based on shipping method
  const isDpdShipping = !!order.shippingMethod?.toLowerCase().includes("dpd");

  function openDispatchModal() {
    setNumberOfParcels(1);
    setTotalWeightKg("");
    setBookDpd(isDpdShipping);
    setDispatchOpen(true);
  }

  const dispatchMutation = useMutation({
    mutationFn: () => apiFetch<DispatchResponse>(`/dispatch/orders/${order.id}/dispatch`, {
      method: "PATCH",
      body: JSON.stringify({
        numberOfParcels,
        totalWeightKg: totalWeightKg === "" ? undefined : totalWeightKg,
        bookDpd,
      }),
    }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      setDispatchOpen(false);

      if (data.dpd) {
        toast({
          title: `${order.orderNumber} dispatched via DPD`,
          description: `Consignment: ${data.dpd.consignmentNumber}`,
        });
        if (data.dpd.labelPdfBase64) {
          printBase64Pdf(data.dpd.labelPdfBase64);
        }
      } else if (data.dpdError) {
        toast({ title: `${order.orderNumber} dispatched`, description: `Note: ${data.dpdError}`, variant: "destructive" });
      } else {
        toast({ title: "Order dispatched", description: `${order.orderNumber} marked as shipped.` });
      }
      onDispatched();
    },
    onError: (e: Error) => toast({ title: "Dispatch failed", description: e.message, variant: "destructive" }),
  });

  const totalWs = order.worksheets.length;
  const completeWs = order.worksheets.filter((w) => w.status === "complete").length;
  const dueToday = isToday(order.requiredDate);
  const overdue = isPast(order.requiredDate) && !dueToday;
  const namedCount = order.items.filter((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)).length;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-base">{order.orderNumber}</span>
              <span className="text-muted-foreground font-medium">{order.customerName}</span>
              <RequiredDateBadge requiredDate={order.requiredDate} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              <span className={`flex items-center gap-1 font-medium ${order.productionComplete ? "text-green-600" : "text-amber-600"}`}>
                {order.productionComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                {completeWs}/{totalWs} worksheets complete
              </span>
              <span>{order.items.length} item lines</span>
              {namedCount > 0 && <span>{namedCount} named recipients</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => printWearerLabels(order)} disabled={namedCount === 0}>
            <Tag className="w-3.5 h-3.5" /> Wearer Labels
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => printDeliveryNote(order)}>
            <FileText className="w-3.5 h-3.5" /> Delivery Note
          </Button>
          <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={openDispatchModal}>
            <Send className="w-3.5 h-3.5" /> Dispatch
          </Button>
        </div>
      </div>

      {/* Smart banners */}
      {order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">All production complete</span> — ready to dispatch whenever you are.
        </div>
      )}
      {!order.productionComplete && (dueToday || overdue) && (
        <div className="mx-5 mb-3 flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><span className="font-medium">{overdue ? "Overdue" : "Due today"}</span> — production not yet complete. Dispatch what's ready now or wait?</span>
          </div>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1" onClick={openDispatchModal}>
              <Send className="w-3 h-3" /> Send Now
            </Button>
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          {/* Worksheets */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Worksheets</h4>
            <div className="flex flex-wrap gap-2">
              {order.worksheets.map((ws) => (
                <Badge key={ws.id} className={`text-xs gap-1 ${
                  ws.status === "complete" ? "bg-green-100 text-green-800 border-green-300" :
                  ws.status === "wip" ? "bg-blue-100 text-blue-800 border-blue-300" :
                  "bg-slate-100 text-slate-700 border-slate-300"
                }`}>
                  {ws.status === "complete" ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {ws.worksheetNumber} — {ws.status === "pre_wip" ? "Pre-Production" : ws.status === "wip" ? "WIP" : "Complete"}
                </Badge>
              ))}
            </div>
          </div>

          {/* Items by recipient */}
          <div>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items</h4>
            <div className="space-y-1">
              {order.items.map((item) => (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                  <Package className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">{item.productName}</span>
                    {(item.colour || item.size) && (
                      <span className="text-muted-foreground ml-2">{[item.colour, item.size].filter(Boolean).join(" / ")}</span>
                    )}
                  </div>
                  <span className="text-muted-foreground text-xs">
                    {item.recipientType === "person" && (item.recipientName || item.employee)
                      ? recipientFullName(item)
                      : "Stock"}
                  </span>
                  <Badge variant="secondary" className="text-xs">×{item.quantity}</Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Delivery address */}
          {order.deliveryAddress && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivery Address</h4>
              <p className="text-sm text-muted-foreground">
                {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                  .filter(Boolean).join(", ")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dispatch modal */}
      <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              Dispatch {order.orderNumber}
            </DialogTitle>
            <DialogDescription>
              Enter parcel details for the despatch note. {isDpdShipping ? "DPD booking will be made automatically." : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Delivery address preview */}
            {order.deliveryAddress && (
              <div className="rounded-lg bg-muted/40 border border-border px-4 py-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivering to</p>
                <p className="font-medium">{order.customerName}</p>
                <p className="text-muted-foreground text-xs">
                  {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                    .filter(Boolean).join(", ")}
                </p>
              </div>
            )}

            <div className={`grid gap-3 ${isDpdShipping ? "grid-cols-2" : "grid-cols-1"}`}>
              <div className="space-y-1.5">
                <Label htmlFor="parcels">Number of boxes</Label>
                <Input
                  id="parcels"
                  type="number"
                  min={1}
                  step={1}
                  value={numberOfParcels}
                  onChange={(e) => setNumberOfParcels(Math.max(1, parseInt(e.target.value) || 1))}
                />
              </div>
              {isDpdShipping && (
                <div className="space-y-1.5">
                  <Label htmlFor="weight">Total weight (kg)</Label>
                  <Input
                    id="weight"
                    type="number"
                    min={0.1}
                    step={0.1}
                    placeholder="e.g. 2.5"
                    value={totalWeightKg}
                    onChange={(e) => setTotalWeightKg(e.target.value === "" ? "" : parseFloat(e.target.value))}
                  />
                </div>
              )}
            </div>

            {/* DPD booking toggle — only shown when shipping method is DPD */}
            {isDpdShipping && (
              <>
                <div
                  className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                    bookDpd ? "border-blue-300 bg-blue-50" : "border-border bg-muted/20"
                  }`}
                  onClick={() => setBookDpd((v) => !v)}
                >
                  <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    bookDpd ? "border-blue-600 bg-blue-600" : "border-muted-foreground"
                  }`}>
                    {bookDpd && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Book DPD consignment</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Automatically book with DPD and print the shipping label.
                      {!order.deliveryAddress && " (Requires a delivery address on the order.)"}
                    </p>
                  </div>
                </div>

                {bookDpd && !order.deliveryAddress && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                    No delivery address is set on this order — DPD booking will be skipped.
                  </p>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending || (bookDpd && totalWeightKg === "")}
            >
              <Send className="w-4 h-4" />
              {dispatchMutation.isPending
                ? (bookDpd ? "Booking DPD…" : "Dispatching…")
                : "Confirm Dispatch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Dispatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: orders = [], isLoading, refetch } = useQuery<DispatchOrder[]>({
    queryKey: ["dispatch-orders"],
    queryFn: () => apiFetch("/dispatch/orders"),
    refetchInterval: 30000,
  });

  const readyCount = orders.filter((o) => o.productionComplete).length;
  const pendingCount = orders.filter((o) => !o.productionComplete).length;
  const urgentCount = orders.filter((o) => !o.productionComplete && (isToday(o.requiredDate) || isPast(o.requiredDate))).length;

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Truck className="w-7 h-7 text-primary" /> Dispatch
            </h1>
            <p className="text-muted-foreground mt-1">Post-production packing, labelling, and dispatch.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
        </div>

        {/* Summary bar */}
        {orders.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <div className="text-2xl font-bold text-green-600">{readyCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Ready to dispatch</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Awaiting production</div>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-center">
              <div className={`text-2xl font-bold ${urgentCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{urgentCount}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Urgent / overdue</div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground gap-2">
            <RefreshCw className="w-5 h-5 animate-spin" /> Loading dispatch queue...
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
            <CheckCircle className="w-12 h-12 text-green-400" />
            <p className="text-lg font-medium">Nothing to dispatch</p>
            <p className="text-sm">Orders will appear here once production worksheets are marked complete.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <DispatchCard key={order.id} order={order} onDispatched={() => {}} />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
