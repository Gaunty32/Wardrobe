import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Loader2, ShoppingBag, ArrowRight, Clock, CheckCircle2, XCircle, Package } from "lucide-react";

function StatusBadge({ status, portalStatus }: { status: string; portalStatus?: string }) {
  if (portalStatus === "pending" || status === "portal_pending") {
    return <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1"><Clock className="w-3 h-3" />Pending review</Badge>;
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

export default function Dashboard() {
  const [, setLocation] = useLocation();

  const { data: orders = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-orders"],
    queryFn: () => apiFetch("/portal/orders"),
  });

  return (
    <PortalLayout>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My Orders</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your order history and status</p>
        </div>
        <Button onClick={() => setLocation("/orders/new")} className="gap-1.5">
          <Plus className="w-4 h-4" /> New Order
        </Button>
      </div>

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
                    <span>{order.item_count} item{order.item_count !== 1 ? "s" : ""}</span>
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
