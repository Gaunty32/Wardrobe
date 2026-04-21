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
import { ArrowLeft, Loader2, Clock, CheckCircle2, XCircle, AlertCircle, Hash, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function PortalStatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  if (portalStatus === "pending" || status === "portal_pending") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1.5 text-sm px-3 py-1"><Clock className="w-3.5 h-3.5" />Pending review</Badge>;
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
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [editingPo, setEditingPo] = useState(false);
  const [poInput, setPoInput] = useState("");

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

  const items: any[] = order.items ?? [];
  const totalAmount = parseFloat(order.total_amount ?? "0");

  return (
    <PortalLayout>
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> All orders
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
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
        <PortalStatusBadge status={order.status} portalStatus={order.portal_status} />
      </div>

      {/* Status message */}
      {(order.portal_status === "pending" || order.status === "portal_pending") && (
        <Card className="mb-5 border-amber-200 bg-amber-50/50">
          <CardContent className="py-3 px-5 flex items-start gap-2.5">
            <Clock className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800">Your order has been submitted and is awaiting review by our team. We'll be in touch shortly.</p>
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
        <Card>
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Total</p>
            <p className="font-semibold text-lg">{formatCurrency(totalAmount)}</p>
          </CardContent>
        </Card>
      </div>

      {order.portal_notes && (
        <Card className="mb-5">
          <CardContent className="py-4 px-5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">Your notes</p>
            <p className="text-sm whitespace-pre-line">{order.portal_notes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3 px-5 border-b">
          <CardTitle className="text-base">Order items</CardTitle>
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
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any, i: number) => (
                  <TableRow key={i}>
                    <TableCell className="font-medium">{item.product_name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.finish_name || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.recipient_name || (item.recipient_type === "stock" ? "Stock" : "—")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(item.unit_price)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{formatCurrency(item.line_total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t px-5 py-3 flex justify-end">
            <div className="text-right">
              <span className="text-muted-foreground text-sm mr-4">Order total</span>
              <span className="font-bold text-lg">{formatCurrency(totalAmount)}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </PortalLayout>
  );
}
