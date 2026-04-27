import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { formatCurrency } from "@/lib/utils";

const API_BASE = "/api";
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BarChart2, Mail, Phone, ChevronDown, ChevronRight, Clock, AlertCircle,
  ExternalLink, RefreshCw, ShoppingCart, Users,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type PendingOrder = {
  id: number;
  orderNumber: string;
  status: string;
  portalStatus: string;
  totalAmount: number;
  orderDate: string | null;
  createdAt: string;
  requiredDate: string | null;
  submittedByName: string | null;
  submittedByEmail: string | null;
  itemCount: number;
  notes: string | null;
};

type PendingCustomer = {
  customerId: number;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  orders: PendingOrder[];
  totalValue: number;
  oldestOrderDate: string;
};

type ReportData = {
  customers: PendingCustomer[];
  totalOrders: number;
};

function portalStatusLabel(s: string): { label: string; variant: "default" | "secondary" | "destructive" | "outline" } {
  switch (s) {
    case "pending_review": return { label: "Awaiting manager", variant: "secondary" };
    case "submitted":      return { label: "Awaiting SBS",     variant: "default" };
    case "portal_draft":   return { label: "Draft",            variant: "outline" };
    default:               return { label: s,                  variant: "outline" };
  }
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function AgeBadge({ dateStr }: { dateStr: string }) {
  const days = daysSince(dateStr);
  if (days >= 7) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-destructive bg-destructive/10 rounded px-1.5 py-0.5">
      <AlertCircle className="w-3 h-3" /> {days}d ago
    </span>
  );
  if (days >= 3) return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">
      <Clock className="w-3 h-3" /> {days}d ago
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
      <Clock className="w-3 h-3" /> {days}d ago
    </span>
  );
}

function CustomerRow({ customer }: { customer: PendingCustomer }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const oldestDate = customer.orders.reduce((oldest, o) => {
    const d = o.orderDate ?? o.createdAt;
    return d < oldest ? d : oldest;
  }, customer.orders[0]?.orderDate ?? customer.orders[0]?.createdAt ?? "");

  const awaitingSBS = customer.orders.filter(o => o.portalStatus === "submitted").length;
  const awaitingManager = customer.orders.filter(o => o.portalStatus === "pending_review").length;

  const copyEmail = () => {
    if (!customer.customerEmail) return;
    navigator.clipboard.writeText(customer.customerEmail);
    toast({ title: "Email copied", description: customer.customerEmail });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <TableRow className="cursor-pointer hover:bg-muted/40 transition-colors">
          <TableCell className="w-6 py-3">
            {open
              ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
              : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </TableCell>
          <TableCell className="font-medium py-3">
            <div className="flex items-center gap-2">
              <Link
                href={`/customers/${customer.customerId}`}
                onClick={e => e.stopPropagation()}
                className="hover:underline text-primary flex items-center gap-1"
              >
                {customer.customerName}
                <ExternalLink className="w-3 h-3 opacity-50" />
              </Link>
            </div>
            {(customer.customerEmail || customer.customerPhone) && (
              <div className="flex items-center gap-3 mt-0.5">
                {customer.customerEmail && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{customer.customerEmail}</span>
                )}
                {customer.customerPhone && (
                  <span className="text-[11px] text-muted-foreground">{customer.customerPhone}</span>
                )}
              </div>
            )}
          </TableCell>
          <TableCell className="py-3 text-center">
            <span className="font-semibold tabular-nums">{customer.orders.length}</span>
          </TableCell>
          <TableCell className="py-3">
            <div className="flex flex-wrap gap-1">
              {awaitingSBS > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0 h-5">
                  {awaitingSBS} awaiting SBS
                </Badge>
              )}
              {awaitingManager > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                  {awaitingManager} awaiting manager
                </Badge>
              )}
            </div>
          </TableCell>
          <TableCell className="py-3 text-right tabular-nums font-medium">
            {customer.totalValue > 0 ? formatCurrency(customer.totalValue) : "—"}
          </TableCell>
          <TableCell className="py-3">
            <AgeBadge dateStr={oldestDate} />
          </TableCell>
          <TableCell className="py-3">
            <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
              {customer.customerEmail && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={copyEmail}
                >
                  <Mail className="w-3 h-3" /> Copy email
                </Button>
              )}
              {customer.customerEmail && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  asChild
                >
                  <a href={`mailto:${customer.customerEmail}?subject=Your%20pending%20order%20with%20Select%20Branding%20Solutions`}>
                    <Mail className="w-3 h-3" /> Send nudge
                  </a>
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleTrigger>

      <CollapsibleContent asChild>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={7} className="p-0 border-b">
            <div className="bg-muted/20 px-8 py-3 border-t">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b">
                    <th className="text-left font-medium pb-1.5">Order</th>
                    <th className="text-left font-medium pb-1.5">Status</th>
                    <th className="text-left font-medium pb-1.5">Submitted by</th>
                    <th className="text-right font-medium pb-1.5">Items</th>
                    <th className="text-right font-medium pb-1.5">Value</th>
                    <th className="text-left font-medium pb-1.5 pl-4">Required by</th>
                    <th className="text-left font-medium pb-1.5 pl-4">Submitted</th>
                    <th className="text-right font-medium pb-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {customer.orders.map(order => {
                    const ps = portalStatusLabel(order.portalStatus);
                    return (
                      <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                        <td className="py-2 font-mono text-xs font-semibold text-primary">
                          {order.orderNumber}
                        </td>
                        <td className="py-2">
                          <Badge variant={ps.variant} className="text-[10px] px-1.5 py-0 h-5">
                            {ps.label}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {order.submittedByName ?? "—"}
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs">
                          {order.itemCount}
                        </td>
                        <td className="py-2 text-right tabular-nums text-xs font-medium">
                          {order.totalAmount > 0 ? formatCurrency(order.totalAmount) : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground pl-4">
                          {order.requiredDate
                            ? new Date(order.requiredDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                            : "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground pl-4">
                          <AgeBadge dateStr={order.orderDate ?? order.createdAt} />
                        </td>
                        <td className="py-2 text-right">
                          <Link href={`/orders/${order.id}`}>
                            <Button variant="ghost" size="sm" className="h-6 text-xs px-2">
                              View <ExternalLink className="w-3 h-3 ml-1" />
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {customer.orders.some(o => o.notes) && (
                <div className="mt-2 pt-2 border-t text-xs text-muted-foreground">
                  <span className="font-medium">Notes: </span>
                  {customer.orders.find(o => o.notes)?.notes}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function Reports() {
  const { data, isLoading, refetch, isRefetching } = useQuery<ReportData>({
    queryKey: ["reports-portal-pending"],
    queryFn: () => apiFetch("/reports/portal-pending"),
    staleTime: 1000 * 60 * 2,
  });

  const customers = data?.customers ?? [];
  const totalOrders = data?.totalOrders ?? 0;

  const awaitingSBS = customers.reduce(
    (n, c) => n + c.orders.filter(o => o.portalStatus === "submitted").length, 0
  );
  const awaitingManager = customers.reduce(
    (n, c) => n + c.orders.filter(o => o.portalStatus === "pending_review").length, 0
  );
  const totalValue = customers.reduce((s, c) => s + c.totalValue, 0);

  return (
    <Layout>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Operational summaries and actionable insights</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", isRefetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* ── Portal Pending Orders ───────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-primary" />
                Unconfirmed Portal Orders
              </CardTitle>
              <CardDescription className="mt-1">
                Customers who have submitted orders through the portal that haven't been confirmed by SBS yet —
                a good list for a friendly nudge or a quick confirmation.
              </CardDescription>
            </div>
            {!isLoading && customers.length > 0 && (
              <div className="flex gap-3 shrink-0 text-right">
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{customers.length}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> customers</p>
                </div>
                <div className="text-center px-3 py-1.5 rounded-lg bg-muted/50">
                  <p className="text-lg font-bold tabular-nums">{totalOrders}</p>
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1"><ShoppingCart className="w-3 h-3" /> orders</p>
                </div>
                {totalValue > 0 && (
                  <div className="text-center px-3 py-1.5 rounded-lg bg-primary/10">
                    <p className="text-lg font-bold tabular-nums text-primary">{formatCurrency(totalValue)}</p>
                    <p className="text-[11px] text-muted-foreground">total value</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {!isLoading && (awaitingSBS > 0 || awaitingManager > 0) && (
            <div className="flex gap-2 mt-3 flex-wrap">
              {awaitingSBS > 0 && (
                <Badge variant="default" className="text-xs">
                  {awaitingSBS} awaiting SBS confirmation
                </Badge>
              )}
              {awaitingManager > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {awaitingManager} awaiting manager approval
                </Badge>
              )}
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Loading report…
            </div>
          ) : customers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mb-3">
                <ShoppingCart className="w-6 h-6 text-green-600" />
              </div>
              <p className="font-medium text-sm">All clear!</p>
              <p className="text-muted-foreground text-sm mt-1">No unconfirmed portal orders at the moment.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-6"></TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead className="text-center w-20">Orders</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Waiting since</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map(customer => (
                    <CustomerRow key={customer.customerId ?? customer.customerName} customer={customer} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </Layout>
  );
}
