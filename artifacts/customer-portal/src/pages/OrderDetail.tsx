import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useState } from "react";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, Clock, CheckCircle2, XCircle, AlertCircle, Hash, Pencil, Check, X, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

function PortalStatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  if (portalStatus === "pending_review") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1.5 text-sm px-3 py-1"><AlertCircle className="w-3.5 h-3.5" />Awaiting approval</Badge>;
  }
  if (portalStatus === "pending" || status === "portal_pending") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1.5 text-sm px-3 py-1"><Clock className="w-3.5 h-3.5" />Pending review</Badge>;
  }
  if (portalStatus === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1.5 text-sm px-3 py-1"><Clock className="w-3.5 h-3.5" />Submitted to SBS</Badge>;
  }
  if (portalStatus === "confirmed") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1.5 text-sm px-3 py-1"><CheckCircle2 className="w-3.5 h-3.5" />Confirmed</Badge>;
  }
  if (portalStatus === "rejected" || status === "cancelled") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1.5 text-sm px-3 py-1"><XCircle className="w-3.5 h-3.5" />Rejected</Badge>;
  }
  if (status === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent text-sm px-3 py-1">Shipped</Badge>;
  if (status === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent text-sm px-3 py-1">Delivered</Badge>;
  return <Badge variant="outline" className="text-sm px-3 py-1">{status}</Badge>;
}

export default function OrderDetailPage() {
  const { canSeePricing, isManager, isDeptManager } = useAuth();
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editingPo, setEditingPo] = useState(false);
  const [poInput, setPoInput] = useState("");
  const [lineFilter, setLineFilter] = useState("");

  // Edit mode state
  const [editing, setEditing] = useState(false);
  // editDraft: { [itemId]: quantity } — undefined means deleted
  const [editDraft, setEditDraft] = useState<Record<number, number>>({});

  const { data: order, isLoading, error } = useQuery<any>({
    queryKey: ["portal-order", id],
    queryFn: () => apiFetch(`/portal/orders/${id}`),
    enabled: !!id,
  });

  const poMutation = useMutation({
    mutationFn: (poNumber: string) =>
      apiFetch(`/portal/orders/${id}/po`, { method: "PATCH", body: JSON.stringify({ poNumber }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-order", id] });
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      setEditingPo(false);
      toast({ title: "PO number saved" });
    },
    onError: () => toast({ title: "Failed to save PO number", variant: "destructive" }),
  });

  const saveItemsMutation = useMutation({
    mutationFn: (items: { id: number; quantity: number }[]) =>
      apiFetch(`/portal/manager/orders/${id}/items`, {
        method: "PATCH",
        body: JSON.stringify({ items }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-order", id] });
      qc.invalidateQueries({ queryKey: ["portal-orders"] });
      qc.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      setEditing(false);
      toast({ title: "Order updated" });
    },
    onError: (err: any) => toast({ title: err?.message ?? "Failed to save changes", variant: "destructive" }),
  });

  const enterEditMode = () => {
    const draft: Record<number, number> = {};
    for (const item of (order?.items ?? [])) {
      draft[item.id] = item.quantity;
    }
    setEditDraft(draft);
    setEditing(true);
    setLineFilter("");
  };

  const cancelEdit = () => {
    setEditing(false);
    setEditDraft({});
  };

  const saveEdit = () => {
    const items = Object.entries(editDraft)
      .filter(([, qty]) => qty > 0)
      .map(([id, quantity]) => ({ id: Number(id), quantity }));
    if (items.length === 0) {
      toast({ title: "Cannot remove all items from an order", variant: "destructive" });
      return;
    }
    saveItemsMutation.mutate(items);
  };

  if (isLoading) {
    return (
      <PortalLayout>
        <div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      </PortalLayout>
    );
  }

  if (error || !order) {
    return (
      <PortalLayout>
        <div className="text-center py-20">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-3" />
          <p className="font-medium text-lg">Order not found</p>
          <Button variant="outline" className="mt-4" onClick={() => setLocation("/orders")}>Back to orders</Button>
        </div>
      </PortalLayout>
    );
  }

  const isPendingReview = order.portal_status === "pending_review";
  const canEdit = (isManager || isDeptManager) && isPendingReview;

  const allItems: any[] = order.items ?? [];

  // In edit mode ignore the text filter — always show all items so nothing is hidden when deleting
  const q = editing ? "" : lineFilter.toLowerCase().trim();
  const displayItems: any[] = !q ? allItems : allItems.filter((item: any) =>
    item.product_name?.toLowerCase().includes(q) ||
    item.recipient_name?.toLowerCase().includes(q) ||
    item.colour?.toLowerCase().includes(q) ||
    item.size?.toLowerCase().includes(q)
  );

  // For totals: use editDraft when editing, otherwise actual items
  const effectiveItems = editing
    ? allItems
        .filter(i => (editDraft[i.id] ?? 0) > 0)
        .map(i => ({ ...i, quantity: editDraft[i.id], line_total: (parseFloat(i.unit_price ?? "0") * editDraft[i.id]).toFixed(2) }))
    : allItems;

  const itemsSubtotal = effectiveItems.reduce((s: number, i: any) => s + parseFloat(i.line_total ?? "0"), 0);
  const carriageAmount = parseFloat(order.carriage_amount ?? "0");
  const vatAmount = (itemsSubtotal + carriageAmount) * 0.2;
  const grandTotal = itemsSubtotal + carriageAmount + vatAmount;

  const deletedCount = editing ? allItems.filter(i => (editDraft[i.id] ?? 0) === 0).length : 0;

  return (
    <PortalLayout>
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => { cancelEdit(); setLocation("/orders"); }}>
          <ArrowLeft className="w-4 h-4 mr-1" /> All orders
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">{order.order_number}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Placed {formatDate(order.order_date)}</p>
          {/* PO Number */}
          <div className="flex items-center gap-2 mt-2">
            <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            {editingPo ? (
              <form
                className="flex items-center gap-1.5"
                onSubmit={e => { e.preventDefault(); poMutation.mutate(poInput); }}
              >
                <Input
                  autoFocus
                  value={poInput}
                  onChange={e => setPoInput(e.target.value)}
                  placeholder="Enter PO number"
                  className="h-7 text-sm w-48"
                  maxLength={100}
                />
                <Button type="submit" size="icon" className="h-7 w-7" disabled={poMutation.isPending}>
                  <Check className="w-3.5 h-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7"
                  onClick={() => setEditingPo(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </form>
            ) : (
              <button
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground group"
                onClick={() => { setPoInput(order.po_number ?? ""); setEditingPo(true); }}
              >
                {order.po_number
                  ? <span className="font-medium text-foreground">PO: {order.po_number}</span>
                  : <span className="italic">Add PO number</span>
                }
                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <PortalStatusBadge status={order.status} portalStatus={order.portal_status} />
          {canEdit && !editing && (
            <Button size="sm" variant="outline" onClick={enterEditMode} className="gap-1.5">
              <Pencil className="w-3.5 h-3.5" /> Edit order
            </Button>
          )}
        </div>
      </div>

      {/* Edit mode banner */}
      {editing && (
        <Card className="mb-5 border-blue-200 bg-blue-50/50">
          <CardContent className="py-3 px-5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-medium text-blue-900">Editing order items</p>
              <p className="text-xs text-blue-700 mt-0.5">
                Adjust quantities or remove lines. Changes are saved when you click <strong>Save changes</strong>.
                {deletedCount > 0 && (
                  <span className="ml-1 text-red-700 font-medium">{deletedCount} line{deletedCount !== 1 ? "s" : ""} marked for removal.</span>
                )}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saveItemsMutation.isPending}
                className="border-blue-300 text-blue-800 hover:bg-blue-100">
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={saveItemsMutation.isPending} className="gap-1.5">
                {saveItemsMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status messages (only when not editing) */}
      {!editing && isPendingReview && !isManager && !isDeptManager && (
        <Card className="mb-5 border-amber-200 bg-amber-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">Your order has been submitted and is awaiting review by our team. We'll be in touch shortly.</p>
          </CardContent>
        </Card>
      )}
      {!editing && isPendingReview && (isManager || isDeptManager) && (
        <Card className="mb-5 border-amber-200 bg-amber-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">This order is awaiting your approval. Review the items below, then approve it from the dashboard — or use <strong>Edit order</strong> to make changes first.</p>
          </CardContent>
        </Card>
      )}
      {order.portal_status === "rejected" && (
        <Card className="mb-5 border-red-200 bg-red-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <XCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <p className="text-sm text-red-800">This order was not accepted. Please contact your account manager for more information.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Order date</p>
            <p className="font-medium">{formatDate(order.order_date)}</p>
          </CardContent>
        </Card>
        {order.required_date && (
          <Card>
            <CardContent className="py-4 px-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Required by</p>
              <p className="font-medium">{formatDate(order.required_date)}</p>
            </CardContent>
          </Card>
        )}
        {canSeePricing && (
          <Card>
            <CardContent className="py-4 px-5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total (inc. VAT)</p>
              <p className="font-semibold text-lg">{formatCurrency(grandTotal)}</p>
              {editing && <p className="text-xs text-blue-600 mt-0.5">Live estimate</p>}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Audit trail */}
      {!editing && (order.portal_submitted_by_name || order.portal_approved_by_name) && (
        <Card className="mb-5">
          <CardContent className="py-4 px-5 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Order history</p>
            {order.portal_submitted_by_name && (
              <div className="flex items-start gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                <span>
                  <span className="font-medium">{order.portal_submitted_by_name}</span>
                  {" submitted this order"}
                  {order.portal_submitted_at && (
                    <span className="text-muted-foreground"> — {new Date(order.portal_submitted_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  )}
                </span>
              </div>
            )}
            {order.portal_approved_by_name && (
              <div className="flex items-start gap-2 text-sm">
                <span className="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0" />
                <span>
                  <span className="font-medium">{order.portal_approved_by_name}</span>
                  {" approved and forwarded to SBS"}
                  {order.portal_approved_at && (
                    <span className="text-muted-foreground"> — {new Date(order.portal_approved_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</span>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {order.portal_notes && !editing && (
        <Card className="mb-5">
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Your notes</p>
            <p className="text-sm whitespace-pre-line">{order.portal_notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">
              Order items
              {!editing && lineFilter.trim() && displayItems.length !== allItems.length && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">({displayItems.length} of {allItems.length})</span>
              )}
              {editing && deletedCount > 0 && (
                <span className="ml-2 text-sm font-normal text-red-600">({allItems.length - deletedCount} of {allItems.length} kept)</span>
              )}
            </CardTitle>
            {!editing && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter by name or product…"
                  value={lineFilter}
                  onChange={e => setLineFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
                />
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Colour / Size</TableHead>
                  <TableHead>Finish</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  {canSeePricing && <TableHead className="text-right">Unit price</TableHead>}
                  {canSeePricing && <TableHead className="text-right">Total</TableHead>}
                  {editing && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayItems.map((item: any) => {
                  const isDeleted = editing && editDraft[item.id] === 0;
                  const qty = editing ? (editDraft[item.id] ?? item.quantity) : item.quantity;
                  const lineTotal = editing
                    ? parseFloat(item.unit_price ?? "0") * qty
                    : parseFloat(item.line_total ?? "0");

                  return (
                    <TableRow
                      key={item.id}
                      className={isDeleted ? "opacity-40 line-through bg-red-50/40" : undefined}
                    >
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.finish_name || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.recipient_name || (item.recipient_type === "stock" ? "Stock" : "—")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {editing && !isDeleted ? (
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={qty}
                            onChange={e => {
                              const v = Math.max(1, parseInt(e.target.value, 10) || 1);
                              setEditDraft(d => ({ ...d, [item.id]: v }));
                            }}
                            className="w-16 text-right border border-input rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring tabular-nums"
                          />
                        ) : (
                          qty
                        )}
                      </TableCell>
                      {canSeePricing && (
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(item.unit_price)}
                        </TableCell>
                      )}
                      {canSeePricing && (
                        <TableCell className="text-right tabular-nums font-medium">
                          {isDeleted ? "—" : formatCurrency(lineTotal)}
                        </TableCell>
                      )}
                      {editing && (
                        <TableCell className="text-right">
                          {isDeleted ? (
                            <button
                              title="Restore this line"
                              onClick={() => setEditDraft(d => ({ ...d, [item.id]: item.quantity }))}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              title="Remove this line"
                              onClick={() => setEditDraft(d => ({ ...d, [item.id]: 0 }))}
                              className="text-muted-foreground hover:text-red-600 p-1 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          {canSeePricing && (
            <div className="border-t">
              <div className="px-5 py-2 flex justify-end">
                <div className="text-right space-y-1 min-w-[220px]">
                  {!editing && lineFilter.trim() && displayItems.length !== allItems.length && (
                    <div className="flex justify-between gap-8 text-sm font-medium">
                      <span>Filtered subtotal</span>
                      <span>{formatCurrency(displayItems.reduce((s: number, i: any) => s + parseFloat(i.line_total ?? "0"), 0))}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                    <span>Subtotal (exc. VAT)</span>
                    <span>{formatCurrency(itemsSubtotal)}</span>
                  </div>
                  {carriageAmount > 0 && (
                    <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                      <span>Carriage</span>
                      <span>{formatCurrency(carriageAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-8 text-sm text-muted-foreground">
                    <span>VAT (20%)</span>
                    <span>{formatCurrency(vatAmount)}</span>
                  </div>
                  <div className="flex justify-between gap-8 pt-1.5 border-t font-bold text-base">
                    <span>Total (inc. VAT)</span>
                    <span>{formatCurrency(grandTotal)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Save / cancel sticky bar at the bottom when editing */}
          {editing && (
            <div className="border-t bg-muted/30 px-5 py-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={cancelEdit} disabled={saveItemsMutation.isPending}>
                Cancel
              </Button>
              <Button size="sm" onClick={saveEdit} disabled={saveItemsMutation.isPending} className="gap-1.5">
                {saveItemsMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </PortalLayout>
  );
}
