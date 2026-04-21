import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Plus, Loader2, ShoppingBag, ArrowRight, Clock, CheckCircle2, XCircle, Package, AlertCircle, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  if (portalStatus === "pending_review") {
    return <Badge variant="outline" className="border-orange-300 text-orange-700 bg-orange-50 gap-1"><AlertCircle className="w-3 h-3" />Awaiting approval</Badge>;
  }
  if (portalStatus === "pending" || status === "portal_pending") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1"><Clock className="w-3 h-3" />Pending SBS review</Badge>;
  }
  if (portalStatus === "submitted") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1"><Clock className="w-3 h-3" />Submitted to SBS</Badge>;
  }
  if (portalStatus === "confirmed" || status === "draft") {
    return <Badge variant="outline" className="border-blue-300 text-blue-700 bg-blue-50 gap-1"><CheckCircle2 className="w-3 h-3" />Confirmed</Badge>;
  }
  if (portalStatus === "rejected" || status === "cancelled") {
    return <Badge variant="outline" className="border-red-300 text-red-700 bg-red-50 gap-1"><XCircle className="w-3 h-3" />Rejected</Badge>;
  }
  if (status === "confirmed") return <Badge variant="outline" className="border-green-300 text-green-700 bg-green-50">In production</Badge>;
  if (status === "shipped") return <Badge className="bg-blue-100 text-blue-800 border-transparent">Shipped</Badge>;
  if (status === "delivered") return <Badge className="bg-green-100 text-green-800 border-transparent">Delivered</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function ManagerReviewPanel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pendingOrders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-manager-pending"],
    queryFn: () => apiFetch("/portal/manager/pending-orders"),
  });

  const submitMutation = useMutation({
    mutationFn: (orderId: number) => apiFetch(`/portal/manager/orders/${orderId}/submit`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      toast({ title: "Order submitted to SBS" });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ orderId, reason }: { orderId: number; reason: string }) =>
      apiFetch(`/portal/manager/orders/${orderId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portal-manager-pending"] });
      queryClient.invalidateQueries({ queryKey: ["portal-orders"] });
      setRejectTarget(null);
      setRejectReason("");
      toast({ title: "Order rejected" });
    },
  });

  if (isLoading) return null;
  if (pendingOrders.length === 0) return null;

  return (
    <>
      <Card className="mb-6 border-orange-200 bg-orange-50/40">
        <CardHeader className="pb-3 pt-4 px-5">
          <CardTitle className="text-base flex items-center gap-2 text-orange-800">
            <AlertCircle className="w-4 h-4" />
            Orders awaiting your approval
            <Badge className="ml-auto bg-orange-500 text-white tabular-nums">{pendingOrders.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5 pb-4 flex flex-col gap-3">
          {pendingOrders.map((order: any) => (
            <div key={order.id} className="rounded-lg border border-orange-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-primary text-sm">{order.order_number}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(order.order_date)}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex gap-2 flex-wrap">
                  <span>{order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}</span>
                  <span className="text-border">·</span>
                  <span className="font-medium text-foreground">{formatCurrency(order.total_amount)}</span>
                  {order.portal_notes && (
                    <>
                      <span className="text-border">·</span>
                      <span className="italic truncate max-w-[200px]">{order.portal_notes}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  onClick={() => setRejectTarget(order)}
                  disabled={rejectMutation.isPending}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  onClick={() => submitMutation.mutate(order.id)}
                  disabled={submitMutation.isPending}
                >
                  {submitMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                  Submit to SBS
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!rejectTarget} onOpenChange={(o) => { if (!o) { setRejectTarget(null); setRejectReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject order {rejectTarget?.order_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Let the team member know why this order was rejected…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRejectTarget(null); setRejectReason(""); }}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate({ orderId: rejectTarget.id, reason: rejectReason })}
            >
              {rejectMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
              Confirm reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { isManager, user } = useAuth();
  const firstName = (user as any)?.firstName ?? "there";

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-orders"],
    queryFn: () => apiFetch("/portal/orders"),
  });

  return (
    <PortalLayout>
      {/* Welcome banner */}
      <div className="rounded-xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 px-6 py-5 mb-6">
        <h2 className="text-xl font-semibold text-foreground">Hi {firstName} 👋</h2>
        <p className="text-muted-foreground text-sm mt-1 max-w-xl">
          Welcome to your own bespoke wardrobe — manage your team's branded clothing requirements all in one place.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your order history and status</p>
        </div>
        <Button onClick={() => setLocation("/orders/new")} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Order
        </Button>
      </div>

      {isManager && <ManagerReviewPanel />}

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <ShoppingBag className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold text-foreground">No orders yet</h2>
            <p className="text-muted-foreground text-sm mt-1 mb-6">Place your first order to get started</p>
            <Button onClick={() => setLocation("/orders/new")}>
              <Plus className="w-4 h-4 mr-1.5" /> Place an order
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order: any) => (
            <Card
              key={order.id}
              className="cursor-pointer hover:border-primary/40 hover:shadow-sm transition-all group"
              onClick={() => setLocation(`/orders/${order.id}`)}
            >
              <CardContent className="py-4 px-5 flex items-center gap-4">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Package className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-primary">{order.order_number}</span>
                    <StatusBadge status={order.status} portalStatus={order.portal_status} />
                  </div>
                  <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                    <span>{formatDate(order.order_date)}</span>
                    <span className="text-border">·</span>
                    <span>{order.item_count} item{Number(order.item_count) !== 1 ? "s" : ""}</span>
                    {order.required_date && (
                      <>
                        <span className="text-border">·</span>
                        <span>Required {formatDate(order.required_date)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold tabular-nums">{formatCurrency(order.total_amount)}</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalLayout>
  );
}
