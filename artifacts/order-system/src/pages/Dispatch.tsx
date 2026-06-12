import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Truck, Package, CheckCircle, AlertTriangle, Clock, Printer, User,
  RefreshCw, ChevronDown, ChevronRight, FileText, Tag, Send,
  History, Search, X, ExternalLink, RotateCcw,
} from "lucide-react";
import ZebraLabels from "@/components/ZebraLabels";
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
  stockStatus: string | null; purchaseRequired: boolean | null;
  dispatchedAt: string | null;
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
interface ShippedOrder {
  id: number; orderNumber: string; customerName: string | null;
  status: string; totalAmount: number;
  orderDate: string; requiredDate: string | null; dispatchedAt: string | null;
  shippingMethod: string | null;
  trackingNumber: string | null;
  dpdConsignmentId: string | null;
  attentionOf: string | null;
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
  dpd_next_day: "Courier",
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

function openWearerLabels(orderId: number, opts?: { includeDeliveryLabel?: boolean; recipient?: string; dispatchedItemIds?: number[] }) {
  const params = new URLSearchParams();
  if (opts?.includeDeliveryLabel) params.set("includeDeliveryLabel", "1");
  if (opts?.recipient) params.set("recipient", opts.recipient);
  if (opts?.dispatchedItemIds && opts.dispatchedItemIds.length > 0) params.set("dispatchedItemIds", opts.dispatchedItemIds.join(","));
  window.open(`/api/orders/${orderId}/wearer-labels?${params}`, "_blank");
}

const LOCAL_DELIVERY_METHODS = new Set(["free_local", "local_delivery"]);

function openDeliveryNote(orderId: number, shippingMethod?: string | null, dispatchedItemIds?: number[]) {
  const params = dispatchedItemIds && dispatchedItemIds.length > 0
    ? `?dispatchedItemIds=${dispatchedItemIds.join(",")}`
    : "";
  window.open(`/api/orders/${orderId}/delivery-note${params}`, "_blank");
  if (shippingMethod && LOCAL_DELIVERY_METHODS.has(shippingMethod)) {
    setTimeout(() => window.open(`/api/orders/${orderId}/shipping-label`, "_blank"), 300);
  }
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
  dispatchedItemIds: number[];
  dpd: { consignmentNumber: string; trackingUrl: string; labelHtml: string | null } | null;
  dpdError: string | null;
  dpdConfigured: boolean;
}

function printDpdLabelHtml(html: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  setTimeout(() => { win.print(); }, 600);
}

function DispatchCard({ order, onDispatched }: { order: DispatchOrder; onDispatched: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [numberOfParcels, setNumberOfParcels] = useState(1);
  const [totalWeightKg, setTotalWeightKg] = useState<number | "">("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const DPD_METHODS = new Set(["dpd", "dpd_next_day", "courier"]);
  const isDpdShipping = !!order.shippingMethod && DPD_METHODS.has(order.shippingMethod);
  const deliveryMethodLabel = shippingLabel(order.shippingMethod);

  function openDispatchModal() {
    setNumberOfParcels(1);
    setTotalWeightKg("");
    setDispatchOpen(true);
  }

  const returnMutation = useMutation({
    mutationFn: () => apiFetch(`/dispatch/orders/${order.id}/return`, { method: "POST" }),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["dispatch-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      toast({ title: "Returned to purchasing", description: `${data.returned} item line${data.returned !== 1 ? "s" : ""} reset` });
    },
    onError: (e: Error) => toast({ title: "Cannot return", description: e.message, variant: "destructive" }),
  });

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

      // Always print the delivery note first — pass the just-dispatched IDs so
      // the note shows "Items Delivered Now" + "Items To Follow" for partial dispatches
      openDeliveryNote(order.id, order.shippingMethod, data.dispatchedItemIds);

      const isPartShipped = data.order.status === "part_shipped";

      if (data.dpd) {
        toast({
          title: isPartShipped ? `${order.orderNumber} part-dispatched via DPD` : `${order.orderNumber} dispatched via DPD`,
          description: `Consignment: ${data.dpd.consignmentNumber}${isPartShipped ? " — remaining items to follow" : ""}`,
        });
        if (data.dpd.labelHtml) {
          setTimeout(() => printDpdLabelHtml(data.dpd.labelHtml!), 400);
        }
        const namedCount = order.items.filter(
          (i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId)
        ).length;
        if (namedCount > 0) {
          setTimeout(() => openWearerLabels(order.id, { includeDeliveryLabel: true, dispatchedItemIds: data.dispatchedItemIds }), 800);
        }
      } else if (data.dpdError) {
        toast({ title: `DPD booking failed — ${order.orderNumber} dispatched`, description: `${data.dpdError}. Open the order and use the "Book DPD" button to retry.`, variant: "destructive", duration: 10000 });
      } else if (isPartShipped) {
        toast({ title: "Part dispatched", description: `${order.orderNumber} — remaining items will follow when ready.` });
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
              {order.status === "part_shipped" && (
                <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1">
                  <Package className="w-3 h-3" /> Part Shipped
                </Badge>
              )}
              <RequiredDateBadge requiredDate={order.requiredDate} />
            </div>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
              {order.status === "part_shipped" ? (
                <span className={`flex items-center gap-1 font-medium ${order.productionComplete ? "text-green-600" : "text-amber-600"}`}>
                  {order.productionComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {order.productionComplete ? "Remaining items ready" : "Awaiting remaining items"}
                </span>
              ) : (
                <span className={`flex items-center gap-1 font-medium ${order.productionComplete ? "text-green-600" : "text-amber-600"}`}>
                  {order.productionComplete ? <CheckCircle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                  {completeWs}/{totalWs} worksheets complete
                </span>
              )}
              <span>{order.items.length} item lines</span>
              {namedCount > 0 && <span>{namedCount} named recipients</span>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          <ZebraLabels orderId={order.id} orderNumber={order.orderNumber} hasNamedRecipients={namedCount > 0} />
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => openDeliveryNote(order.id, order.shippingMethod)}>
            <FileText className="w-3.5 h-3.5" /> Delivery Note
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
            disabled={returnMutation.isPending}
            onClick={() => {
              if (confirm(`Return ${order.orderNumber} from dispatch? Items without a completed worksheet will be sent back to purchasing.`)) {
                returnMutation.mutate();
              }
            }}
          >
            <RotateCcw className="w-3.5 h-3.5" /> Return
          </Button>
          <Button
            size="sm"
            className={`gap-1.5 text-xs text-white ${order.status === "part_shipped" ? "bg-amber-600 hover:bg-amber-700" : "bg-green-600 hover:bg-green-700"}`}
            onClick={openDispatchModal}
          >
            <Send className="w-3.5 h-3.5" />
            {order.status === "part_shipped" ? "Dispatch Remaining" : "Dispatch"}
          </Button>
        </div>
      </div>

      {order.status === "part_shipped" && order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">Remaining items in stock</span> — ready to dispatch the follow-up shipment.
        </div>
      )}
      {order.status === "part_shipped" && !order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <Package className="w-4 h-4 flex-shrink-0" />
          <span><span className="font-medium">Part dispatched</span> — {order.items.filter(i => !i.dispatchedAt).length} item line(s) awaiting delivery before follow-up shipment.</span>
        </div>
      )}
      {order.status !== "part_shipped" && order.productionComplete && (
        <div className="mx-5 mb-3 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-green-50 border border-green-200 text-sm text-green-800">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span className="font-medium">All production complete</span> — ready to dispatch whenever you are.
        </div>
      )}
      {!order.productionComplete && order.status !== "part_shipped" && (dueToday || overdue) && (
        <div className="mx-5 mb-3 flex items-center justify-between px-4 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span><span className="font-medium">{overdue ? "Overdue" : "Due today"}</span> — production not yet complete.</span>
          </div>
          <div className="flex gap-2 flex-shrink-0 ml-3">
            <Button size="sm" className="h-7 text-xs bg-amber-600 hover:bg-amber-700 text-white gap-1" onClick={openDispatchModal}>
              <Send className="w-3 h-3" /> Send Now
            </Button>
          </div>
        </div>
      )}

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
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

          {(() => {
            const recipientMap = new Map<string, number>();
            for (const item of order.items) {
              if (item.recipientType === "person" && (item.recipientName || item.employee)) {
                const name = recipientFullName(item);
                recipientMap.set(name, (recipientMap.get(name) ?? 0) + item.quantity);
              }
            }
            const recipients = Array.from(recipientMap.entries()).sort(([a], [b]) => a.localeCompare(b));
            if (recipients.length === 0) return null;
            return (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Named Recipients</h4>
                <div className="space-y-1">
                  {recipients.map(([name, qty]) => (
                    <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate flex-1">{name}</span>
                      <span className="text-muted-foreground text-xs">{qty} item{qty !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Use the <strong>Labels</strong> button above to print wearer labels directly to the Zebra printer.</p>
              </div>
            );
          })()}

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

            {(() => {
              const notReady = order.items.filter(
                i => !i.dispatchedAt && i.stockStatus !== "complete" && i.stockStatus !== "allocated"
              );
              if (notReady.length === 0) return null;
              return (
                <div className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-sm text-amber-900 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                    {notReady.length} item line{notReady.length !== 1 ? "s" : ""} not yet in stock
                  </p>
                  <ul className="text-xs space-y-0.5 pl-5 list-disc text-amber-800">
                    {notReady.map(i => {
                      const parts = [i.colour, i.size].filter(Boolean).join(" / ");
                      return (
                        <li key={i.id}>
                          {i.productName}{parts ? ` (${parts})` : ""} ×{i.quantity}
                          {i.wearerName ? <span className="text-amber-700"> — {i.wearerName}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-xs text-amber-800">
                    Dispatching now will send the ready items only. The items above will follow as a separate shipment once they arrive.
                    <strong> Cancel and wait</strong> if you want to dispatch the order complete.
                  </p>
                </div>
              );
            })()}

            <div className="rounded-lg bg-muted/20 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground text-xs uppercase tracking-wide mb-1.5">What happens when you confirm</p>
              <p>✓ Delivery note opened for printing</p>
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

// ── Dispatched history row ─────────────────────────────────────────────────────
function ShippedRow({ order }: { order: ShippedOrder }) {
  const [expanded, setExpanded] = useState(false);

  const tracking = order.trackingNumber || order.dpdConsignmentId;
  const isDpd = !!order.dpdConsignmentId;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold text-sm">{order.orderNumber}</span>
              <span className="text-muted-foreground font-medium text-sm">{order.customerName}</span>
              {order.status === "delivered" ? (
                <Badge className="text-xs bg-green-100 text-green-800 border-green-300 gap-1">
                  <CheckCircle className="w-3 h-3" /> Delivered
                </Badge>
              ) : (
                <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300 gap-1">
                  <Truck className="w-3 h-3" /> Shipped
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-4 mt-0.5 text-xs text-muted-foreground flex-wrap">
              <span>Dispatched {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}</span>
              <span>{shippingLabel(order.shippingMethod)}</span>
              {tracking && (
                <span className="flex items-center gap-1 font-mono">
                  {tracking}
                  {isDpd && (
                    <a
                      href={`https://track.dpd.co.uk/search?reference=${order.dpdConsignmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:text-blue-800 ml-0.5"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </span>
              )}
              <span>{order.items.length} item lines</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => openDeliveryNote(order.id, order.shippingMethod)}>
            <FileText className="w-3 h-3" /> Delivery Note
          </Button>
          <ZebraLabels orderId={order.id} orderNumber={order.orderNumber} hasNamedRecipients={order.items.some((i) => i.recipientType === "person" && (i.recipientName || i.recipientEmployeeId))} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {order.deliveryAddress && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Delivered to</h4>
                {order.attentionOf && <p className="font-medium">{order.attentionOf}</p>}
                <p className="text-muted-foreground text-xs">
                  {[order.deliveryAddress.line1, order.deliveryAddress.line2, order.deliveryAddress.city, order.deliveryAddress.postcode]
                    .filter(Boolean).join(", ")}
                </p>
              </div>
            )}
            {tracking && (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Tracking</h4>
                <p className="font-mono text-sm flex items-center gap-1.5">
                  {tracking}
                  {isDpd && (
                    <a
                      href={`https://track.dpd.co.uk/search?reference=${order.dpdConsignmentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </p>
              </div>
            )}
          </div>

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
                      ? [item.employee?.firstName, item.employee?.lastName, item.recipientName].filter(Boolean).join(" ")
                      : "Stock"}
                  </span>
                  <Badge variant="secondary" className="text-xs">×{item.quantity}</Badge>
                </div>
              ))}
            </div>
          </div>

          {(() => {
            const recipientMap = new Map<string, number>();
            for (const item of order.items) {
              if (item.recipientType === "person" && (item.recipientName || item.employee)) {
                const name = recipientFullName(item);
                recipientMap.set(name, (recipientMap.get(name) ?? 0) + item.quantity);
              }
            }
            const recipients = Array.from(recipientMap.entries()).sort(([a], [b]) => a.localeCompare(b));
            if (recipients.length === 0) return null;
            return (
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Named Recipients</h4>
                <div className="space-y-1">
                  {recipients.map(([name, qty]) => (
                    <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/30 text-sm">
                      <User className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium truncate flex-1">{name}</span>
                      <span className="text-muted-foreground text-xs">{qty} item{qty !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">Use the <strong>Labels</strong> button above to reprint wearer labels.</p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── History tab with filters ───────────────────────────────────────────────────
function DispatchedHistory() {
  const [customerFilter, setCustomerFilter] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [debouncedCustomer, setDebouncedCustomer] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomer(customerFilter), 350);
    return () => clearTimeout(t);
  }, [customerFilter]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchFilter), 350);
    return () => clearTimeout(t);
  }, [searchFilter]);

  const params = new URLSearchParams();
  if (debouncedCustomer) params.set("customer", debouncedCustomer);
  if (debouncedSearch) params.set("search", debouncedSearch);

  const { data: orders = [], isLoading, refetch } = useQuery<ShippedOrder[]>({
    queryKey: ["dispatch-shipped", debouncedCustomer, debouncedSearch],
    queryFn: () => apiFetch(`/dispatch/shipped?${params}`),
  });

  const hasFilter = !!debouncedCustomer || !!debouncedSearch;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="flex-1 min-w-48 space-y-1">
          <Label htmlFor="filter-customer" className="text-xs">Customer</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="filter-customer"
              placeholder="e.g. Uneek Clothing"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {customerFilter && (
              <button onClick={() => setCustomerFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-48 space-y-1">
          <Label htmlFor="filter-search" className="text-xs">Order / despatch / tracking number</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              id="filter-search"
              placeholder="e.g. SBS-001 or 15012345678901"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {searchFilter && (
              <button onClick={() => setSearchFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading history...
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <History className="w-10 h-10 text-muted-foreground/40" />
          <p className="font-medium">{hasFilter ? "No dispatched orders match your filters" : "No dispatched orders yet"}</p>
          {hasFilter && (
            <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => { setCustomerFilter(""); setSearchFilter(""); }}>
              <X className="w-3 h-3" /> Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""} found (most recent first)</p>
          {orders.map((order) => (
            <ShippedRow key={order.id} order={order} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Bulk Labels Dialog ─────────────────────────────────────────────────────────
function BulkLabelsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [customerInput, setCustomerInput] = useState("");
  const [orderInput, setOrderInput] = useState("");
  const { toast } = useToast();

  function handleOpen() {
    const orderNum = orderInput.trim();
    const customer = customerInput.trim();
    if (!orderNum && !customer) {
      toast({ title: "Enter a value", description: "Type a customer name or order number.", variant: "destructive" });
      return;
    }
    const params = new URLSearchParams();
    if (orderNum) params.set("orderNumber", orderNum);
    else params.set("customer", customer);
    window.open(`/api/wearer-labels/bulk?${params}`, "_blank");
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tag className="w-4 h-4" /> Bulk Wearer Labels</DialogTitle>
          <DialogDescription>
            Print all wearer labels for a customer or a single order in one go.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-customer" className="text-sm font-medium">Customer name</Label>
            <Input
              id="bulk-customer"
              placeholder="e.g. Fast Lane Club"
              value={customerInput}
              onChange={(e) => setCustomerInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            />
            <p className="text-xs text-muted-foreground">Partial match across all confirmed &amp; dispatched orders.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-order" className="text-sm font-medium">Order number</Label>
            <Input
              id="bulk-order"
              placeholder="e.g. SBS-042"
              value={orderInput}
              onChange={(e) => setOrderInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpen()}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOpen} className="gap-1.5"><Printer className="w-3.5 h-3.5" /> Open Labels</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function Dispatch() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"queue" | "history">("queue");
  const [bulkLabelsOpen, setBulkLabelsOpen] = useState(false);
  const [queueFilter, setQueueFilter] = useState<"all" | "ready" | "pending" | "urgent">("all");

  const { data: orders = [], isLoading, refetch } = useQuery<DispatchOrder[]>({
    queryKey: ["dispatch-orders"],
    queryFn: () => apiFetch("/dispatch/orders"),
    refetchInterval: 15_000,
  });

  const readyCount = orders.filter((o) => o.productionComplete).length;
  const pendingCount = orders.filter((o) => !o.productionComplete).length;
  const urgentCount = orders.filter((o) => !o.productionComplete && (isToday(o.requiredDate) || isPast(o.requiredDate))).length;

  const filteredOrders = orders.filter((o) => {
    if (queueFilter === "ready") return o.productionComplete;
    if (queueFilter === "pending") return !o.productionComplete;
    if (queueFilter === "urgent") return !o.productionComplete && (isToday(o.requiredDate) || isPast(o.requiredDate));
    return true;
  });

  return (
    <Layout>
      <div className="space-y-6">
        <BulkLabelsDialog open={bulkLabelsOpen} onClose={() => setBulkLabelsOpen(false)} />
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Truck className="w-7 h-7 text-primary" /> Dispatch
            </h1>
            <p className="text-muted-foreground mt-1">Post-production packing, labelling, and dispatch.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setBulkLabelsOpen(true)}>
              <Tag className="w-3.5 h-3.5" /> Bulk Labels
            </Button>
            {tab === "queue" && (
              <Button variant="ghost" size="icon" onClick={() => refetch()}><RefreshCw className="w-4 h-4" /></Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("queue")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === "queue"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Truck className="w-4 h-4" />
            Dispatch Queue
            {orders.length > 0 && (
              <span className="ml-1 text-xs bg-muted text-muted-foreground rounded-full px-1.5 py-0.5">
                {orders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("history")}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
              tab === "history"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <History className="w-4 h-4" />
            Dispatched
          </button>
        </div>

        {tab === "queue" && (
          <>
            {orders.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setQueueFilter(f => f === "ready" ? "all" : "ready")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "ready" ? "border-green-500 bg-green-50 ring-1 ring-green-500" : "border-border bg-card hover:border-green-300 hover:bg-green-50/40"}`}
                >
                  <div className="text-2xl font-bold text-green-600">{readyCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Ready to dispatch</div>
                </button>
                <button
                  onClick={() => setQueueFilter(f => f === "pending" ? "all" : "pending")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "pending" ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500" : "border-border bg-card hover:border-amber-300 hover:bg-amber-50/40"}`}
                >
                  <div className="text-2xl font-bold text-amber-600">{pendingCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Awaiting production</div>
                </button>
                <button
                  onClick={() => setQueueFilter(f => f === "urgent" ? "all" : "urgent")}
                  className={`rounded-lg border px-4 py-3 text-center transition-all cursor-pointer ${queueFilter === "urgent" ? "border-red-500 bg-red-50 ring-1 ring-red-500" : "border-border bg-card hover:border-red-300 hover:bg-red-50/40"}`}
                >
                  <div className={`text-2xl font-bold ${urgentCount > 0 ? "text-red-600" : "text-muted-foreground"}`}>{urgentCount}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Urgent / overdue</div>
                </button>
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
            ) : filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <p className="text-sm">No orders match this filter.</p>
                <button className="text-xs text-primary underline" onClick={() => setQueueFilter("all")}>Show all</button>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <DispatchCard key={order.id} order={order} onDispatched={() => {}} />
                ))}
              </div>
            )}
          </>
        )}

        {tab === "history" && <DispatchedHistory />}
      </div>
    </Layout>
  );
}
