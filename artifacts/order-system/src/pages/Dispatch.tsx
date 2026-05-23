import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, Package, CheckCircle, AlertTriangle, Clock, Printer,
  RefreshCw, ChevronDown, ChevronRight, FileText, Tag, Send
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
  trackingNumber: string | null;
  dpdConsignmentId: string | null;
  attentionOf: string | null;
  productionComplete: boolean;
  worksheets: Worksheet[];
  items: DispatchItem[];
  deliveryAddress: DeliveryAddress | null;
}

const SHIPPING_LABELS: Record<string, string> = {
  free_local: "Free Local Delivery",
  local_delivery: "Local Delivery",
  office_collection: "Office Collection",
  warehouse_collection: "Warehouse Collection",
  courier: "Courier",
  dpd: "DPD Courier",
};

function shippingLabel(method: string | null): string {
  if (!method) return "Not specified";
  return SHIPPING_LABELS[method] ?? method;
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

function openWearerLabels(orderId: number, opts?: { includeDeliveryLabel?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.includeDeliveryLabel) params.set("includeDeliveryLabel", "1");
  window.open(`/api/orders/${orderId}/wearer-labels?${params}`, "_blank");
}

function openDeliveryNote(orderId: number) {
  window.open(`/api/orders/${orderId}/delivery-note`, "_blank");
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isDpdShipping = !!order.shippingMethod?.toLowerCase().includes("dpd");
  const deliveryMethodLabel = shippingLabel(order.shippingMethod);

  function openDispatchModal() {
    setNumberOfParcels(1);
    setTotalWeightKg("");
    setDispatchOpen(true);
  }

  const dispatchMutation = useMutation({
    mutationFn: () => apiFetch<DispatchResponse>(`/dispatch/orders/${order.id}/dispatch`, {
      method: "PATCH",
      body: JSON.stringify({
        numberOfParcels,
        totalWeightKg: totalWeightKg === "" ? undefined : totalWeightKg,
        bookDpd: isDpdShipping,
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
        // Auto-print wearer labels with the confirmed tracking number
        const namedCount = order.items.filter(
          (i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)
        ).length;
        if (namedCount > 0) {
          openWearerLabels(order.id, { includeDeliveryLabel: true });
        }
      } else if (data.dpdError) {
        toast({ title: `${order.orderNumber} dispatched`, description: `DPD note: ${data.dpdError}`, variant: "destructive" });
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
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => openWearerLabels(order.id, { includeDeliveryLabel: true })} disabled={namedCount === 0}>
            <Tag className="w-3.5 h-3.5" /> Wearer Labels
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => openDeliveryNote(order.id)}>
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
              Confirm the parcel details below, then press Dispatch.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Delivery method pill */}
            <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
              isDpdShipping ? "border-blue-200 bg-blue-50" : "border-border bg-muted/30"
            }`}>
              <Truck className={`w-5 h-5 flex-shrink-0 ${isDpdShipping ? "text-blue-600" : "text-muted-foreground"}`} />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery method</p>
                <p className="font-semibold text-sm mt-0.5">{deliveryMethodLabel}</p>
              </div>
              {isDpdShipping && (
                <span className="ml-auto text-xs font-medium text-blue-700 bg-blue-100 border border-blue-200 rounded-full px-2.5 py-0.5">
                  Auto-booked via DPD API
                </span>
              )}
            </div>

            {/* Delivery address */}
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

            {!order.deliveryAddress && isDpdShipping && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ⚠ No delivery address is set on this order — DPD booking will be skipped.
              </p>
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

            {/* What happens next */}
            <div className="rounded-lg bg-muted/20 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wide mb-1.5">What happens when you confirm</p>
              {isDpdShipping && <p>✓ DPD booking created automatically — tracking number assigned</p>}
              {isDpdShipping && <p>✓ DPD shipping label printed (select your label printer)</p>}
              {namedCount > 0 && isDpdShipping && <p>✓ Wearer labels printed with tracking number (delivery label first)</p>}
              {namedCount > 0 && !isDpdShipping && <p>✓ Wearer labels available to print (delivery label first)</p>}
              <p>✓ Order marked as dispatched</p>
              <p>✓ Portal customers notified automatically if applicable</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-2"
              onClick={() => dispatchMutation.mutate()}
              disabled={dispatchMutation.isPending || (isDpdShipping && totalWeightKg === "")}
            >
              <Send className="w-4 h-4" />
              {dispatchMutation.isPending
                ? (isDpdShipping ? "Booking DPD…" : "Dispatching…")
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
