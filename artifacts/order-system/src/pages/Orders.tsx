import { useState, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import { Link, useLocation } from "wouter";
import {
  useListOrders,
  useCreateOrder,
  useListCustomers,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, toTitleCase } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShoppingCart, Loader2, ArrowRight, ChevronsUpDown, Check, Globe, CheckCircle2, XCircle, Search, AlertTriangle, TrendingUp, FileText, Pencil, Paperclip, StickyNote } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

const API_BASE = "/api";
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

interface WeeklyStat { week_start: string; order_count: number; total_value: number; }

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function DueDateCell({ requiredDate }: { requiredDate: string | null | undefined }) {
  if (!requiredDate) return <span className="text-muted-foreground text-xs">—</span>;
  const date = new Date(requiredDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(date); due.setHours(0, 0, 0, 0);
  const overdue = due < today;
  const dueToday = due.getTime() === today.getTime();
  const formatted = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  if (overdue) return (
    <span className="flex items-center gap-1 text-red-600 font-semibold text-sm">
      <AlertTriangle className="w-3.5 h-3.5" />{formatted}
    </span>
  );
  if (dueToday) return (
    <span className="flex items-center gap-1 text-amber-600 font-semibold text-sm">
      <AlertTriangle className="w-3.5 h-3.5" />{formatted}
    </span>
  );
  return <span className="text-sm font-medium">{formatted}</span>;
}

function WeeklyWorm({ data }: { data: WeeklyStat[] }) {
  if (!data.length) return (
    <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">No order data for the past 12 weeks</div>
  );
  const chartData = data.map((d) => ({ week: formatWeekLabel(d.week_start), value: d.total_value, count: d.order_count }));
  return (
    <ResponsiveContainer width="100%" height={100}>
      <AreaChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="wormGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#1e3a5f" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#1e3a5f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
        <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} />
        <YAxis
          tickFormatter={(v) => v === 0 ? "" : `£${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 10, fill: "#888" }} axisLine={false} tickLine={false} width={36}
        />
        <Tooltip
          formatter={(v: number) => [formatCurrency(v), "Order value"]}
          labelFormatter={(l) => `Week of ${l}`}
          contentStyle={{ fontSize: 12, borderRadius: 6, border: "1px solid #e5e7eb" }}
        />
        <Area type="monotone" dataKey="value" stroke="#1e3a5f" strokeWidth={2} fill="url(#wormGrad)" dot={{ r: 3, fill: "#1e3a5f" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function QuoteHoldingPanel() {
  const [, setLocation] = useLocation();

  const { data: quotes = [], isLoading } = useQuery<any[]>({
    queryKey: ["quote-orders"],
    queryFn: () => apiFetch("/orders?status=quote"),
    refetchInterval: 30000,
  });

  if (isLoading || !quotes.length) return null;

  return (
    <Card className="border-violet-200 bg-violet-50/50 shadow-sm">
      <CardHeader className="py-3 px-5 border-b border-violet-200/60 flex flex-row items-center gap-2">
        <FileText className="w-4 h-4 text-violet-600" />
        <span className="font-semibold text-violet-800 text-sm">Quotes &amp; Awaiting Payment</span>
        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-violet-600 text-white text-xs font-bold">{quotes.length}</span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((o: any) => (
              <TableRow key={o.id} className="hover:bg-violet-50/80 cursor-pointer" onClick={() => setLocation(`/orders/${o.id}`)}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-violet-700">{o.orderNumber}</span>
                    {o.notes && <StickyNote className="w-3 h-3 text-amber-400 shrink-0" title="Has internal note" />}
                    {o.attachments?.length > 0 && <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" title="Has attachments" />}
                  </div>
                </TableCell>
                <TableCell className="font-medium">{toTitleCase(o.customerName ?? "")}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{o.requiredDate ? formatDate(o.requiredDate) : <span className="italic text-muted-foreground/50">—</span>}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(o.totalAmount ?? "0"))}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-violet-700 hover:bg-violet-100" onClick={e => { e.stopPropagation(); setLocation(`/orders/${o.id}`); }}>
                    View <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PoPendingInline({ orderId, current, onSaved }: { orderId: number; current: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ poNumber: value || null }) });
      onSaved();
    } catch {
      toast({ title: "Could not save PO number", variant: "destructive" });
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="text-xs border rounded px-1.5 py-0.5 font-mono w-32 outline-none focus:ring-1 focus:ring-primary/40"
        placeholder="e.g. PO-2026-001"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      className="flex items-center gap-1 group"
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit PO number"
    >
      {current
        ? <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">{current}</span>
        : <span className="text-xs text-muted-foreground/40 group-hover:text-muted-foreground transition-colors italic">Add PO#</span>
      }
      <Pencil className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
    </button>
  );
}

function PortalPendingOrders() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: pending = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-pending-orders"],
    queryFn: () => apiFetch("/portal/admin/pending-orders"),
    refetchInterval: 30000,
  });

  const [confirmingAll, setConfirmingAll] = useState(false);

  const confirm = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/admin/orders/${id}/confirm`, { method: "POST" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-pending-orders"] }); qc.invalidateQueries({ queryKey: getListOrdersQueryKey() }); toast({ title: "Order confirmed", description: "Moved to draft orders." }); },
  });

  async function confirmAll() {
    setConfirmingAll(true);
    try {
      await Promise.all(pending.map((o: any) => apiFetch(`/portal/admin/orders/${o.id}/confirm`, { method: "POST" })));
      qc.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: `${pending.length} orders confirmed`, description: "All portal orders moved to draft." });
    } catch {
      toast({ title: "Error", description: "Some orders could not be confirmed.", variant: "destructive" });
    } finally {
      setConfirmingAll(false);
    }
  }

  const reject = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/admin/orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: "" }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Order rejected", description: "The portal order has been declined and removed from the list." });
    },
  });

  if (isLoading || !pending.length) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/50 shadow-sm">

      <CardHeader className="py-3 px-5 border-b border-amber-200/60 flex flex-row items-center gap-2">
        <Globe className="w-4 h-4 text-amber-600" />
        <span className="font-semibold text-amber-800 text-sm">Portal Orders Awaiting Review</span>
        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-amber-600 text-white text-xs font-bold">{pending.length}</span>
        <div className="ml-auto">
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            disabled={confirmingAll || confirm.isPending}
            onClick={confirmAll}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {confirmingAll ? "Confirming…" : `Confirm All (${pending.length})`}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>PO #</TableHead>
              <TableHead className="text-right">Items</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((o: any) => (
              <TableRow key={o.id} className="hover:bg-amber-50/80 cursor-pointer" onClick={() => setLocation(`/orders/${o.id}`)}>
                <TableCell><span className="font-semibold text-amber-700">{o.order_number}</span></TableCell>
                <TableCell className="font-medium">{toTitleCase(o.customer_name)}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{formatDate(o.order_date)}</TableCell>
                <TableCell onClick={e => e.stopPropagation()}>
                  <PoPendingInline
                    orderId={o.id}
                    current={o.po_number ?? null}
                    onSaved={() => qc.invalidateQueries({ queryKey: ["portal-pending-orders"] })}
                  />
                </TableCell>
                <TableCell className="text-right text-sm">{o.item_count}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(o.total_amount ?? "0"))}</TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50" disabled={reject.isPending} onClick={() => reject.mutate(o.id)}>
                      <XCircle className="w-3.5 h-3.5" />Reject
                    </Button>
                    <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={confirm.isPending} onClick={() => confirm.mutate(o.id)}>
                      <CheckCircle2 className="w-3.5 h-3.5" />Confirm
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function Orders() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customerComboOpen, setCustomerComboOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allOrders = [], isLoading } = useListOrders({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: customers = [] } = useListCustomers();
  const { data: weeklyStats = [] } = useQuery<WeeklyStat[]>({
    queryKey: ["orders-weekly-stats"],
    queryFn: () => apiFetch("/orders/weekly-stats"),
    refetchInterval: 60000,
  });
  const createMutation = useCreateOrder();

  const selectedCustomer = customers.find(c => c.id.toString() === selectedCustomerId);

  const orders = useMemo(() => {
    if (!customerSearch.trim()) return allOrders;
    const q = customerSearch.toLowerCase();
    return allOrders.filter(o =>
      (o.customerName ?? "").toLowerCase().includes(q) ||
      o.orderNumber.toLowerCase().includes(q)
    );
  }, [allOrders, customerSearch]);

  const totalValue = useMemo(() => orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0), [orders]);

  const handleCreateOrder = () => {
    if (!selectedCustomerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { customerId: parseInt(selectedCustomerId, 10), orderDate: new Date().toISOString() } },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Order created", description: `Taking you to ${newOrder.orderNumber}…` });
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: (err: any) => {
          toast({ title: "Failed to create order", description: err?.message ?? "Unknown error", variant: "destructive" });
        }
      }
    );
  };

  const openCreate = () => {
    setSelectedCustomerId("");
    setCustomerComboOpen(false);
    setIsCreateOpen(true);
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Sales Orders</h1>
            <p className="text-muted-foreground mt-1">Manage and track customer orders.</p>
          </div>
          <Button onClick={openCreate} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> New Order
          </Button>
        </div>

        <QuoteHoldingPanel />
        <PortalPendingOrders />

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-3 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-3 flex-wrap">
            <div className="w-full max-w-[180px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Filter by status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="quote">Quote</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customer or order…"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="pl-8 bg-background h-9"
              />
            </div>
            {customerSearch && (
              <span className="text-xs text-muted-foreground">{orders.length} result{orders.length !== 1 ? "s" : ""}</span>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : orders.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-[90px]">Order #</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead>Order Date</TableHead>
                        <TableHead>Customer</TableHead>
                        <TableHead>PO Number</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => {
                        const isPortalPending = order.status === "portal_pending";
                        return (
                        <TableRow
                          key={order.id}
                          className={cn(
                            "group cursor-pointer",
                            isPortalPending
                              ? "bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400"
                              : "hover:bg-muted/30"
                          )}
                          onClick={() => setLocation(`/orders/${order.id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {isPortalPending && <Globe className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                              <span className={cn("font-bold text-base tracking-wide", isPortalPending ? "text-amber-700" : "text-primary")}>{order.orderNumber}</span>
                              {(order as any).notes && (
                                <StickyNote className="w-3 h-3 text-amber-400 shrink-0" title="Has internal note" />
                              )}
                              {(order as any).attachments?.length > 0 && (
                                <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" title="Has attachments" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <DueDateCell requiredDate={(order as any).requiredDate} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{formatDate(order.orderDate)}</TableCell>
                          <TableCell className="font-medium text-foreground">{toTitleCase(order.customerName) || 'Unknown'}</TableCell>
                          <TableCell className="text-sm font-mono text-muted-foreground">{(order as any).poNumber ?? <span className="italic text-muted-foreground/50">—</span>}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right font-semibold text-foreground">
                            {formatCurrency(order.totalAmount)}
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Link href={`/orders/${order.id}`}>
                              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                View <ArrowRight className="w-4 h-4 ml-1" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Total row */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/20">
                  <span className="text-sm text-muted-foreground">
                    {orders.length} order{orders.length !== 1 ? "s" : ""}
                    {customerSearch ? " (filtered)" : ""}
                  </span>
                  <span className="font-bold text-foreground text-base">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No orders found</h3>
                <p className="mt-1">
                  {customerSearch ? `No orders matching "${customerSearch}".` : "There are no orders matching your criteria."}
                </p>
                {!customerSearch && <Button onClick={openCreate} variant="outline" className="mt-6">Create First Order</Button>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Weekly worm */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-3 px-5 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-2">
            <TrendingUp className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Weekly Order Value</span>
            <span className="text-xs text-muted-foreground ml-1">— rolling 12 weeks</span>
          </CardHeader>
          <CardContent className="pt-3 pb-2 px-2">
            <WeeklyWorm data={weeklyStats} />
          </CardContent>
        </Card>

        {/* ── Create Order Dialog ── */}
        <Dialog open={isCreateOpen} onOpenChange={v => { if (!v) setIsCreateOpen(false); }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">New Sales Order</DialogTitle>
              <DialogDescription>
                Select a customer to start a draft order. You'll add products on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <Label>Customer</Label>
              <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={customerComboOpen}
                    className="w-full justify-between font-normal h-10"
                  >
                    {selectedCustomer ? toTitleCase(selectedCustomer.name) : "Search customers…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to search…" />
                    <CommandList>
                      <CommandEmpty>No customers found.</CommandEmpty>
                      <CommandGroup>
                        {customers.map(c => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setSelectedCustomerId(c.id.toString());
                              setCustomerComboOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCustomerId === c.id.toString() ? "opacity-100" : "opacity-0")} />
                            <div>
                              <p className="font-medium">{toTitleCase(c.name)}</p>
                              {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateOrder} disabled={createMutation.isPending || !selectedCustomerId}>
                {createMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                  : "Create & Continue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
