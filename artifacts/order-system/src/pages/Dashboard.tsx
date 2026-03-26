import { useState, useRef, useEffect } from "react";
import Layout from "@/components/Layout";
import {
  useGetDashboardStats,
  useListCustomers,
  useListOrders,
  useCreateOrder,
  getListOrdersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency, formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/StatusBadge";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import {
  DollarSign,
  ShoppingCart,
  Users,
  Package,
  ArrowRight,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  User,
  FileText,
  X,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: stats, isLoading } = useGetDashboardStats();
  const { data: customers } = useListCustomers();
  const { data: orders } = useListOrders();
  const createOrderMutation = useCreateOrder();

  // Customer search
  const [customerQuery, setCustomerQuery] = useState("");
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const customerSearchRef = useRef<HTMLDivElement>(null);

  // Order search
  const [orderQuery, setOrderQuery] = useState("");
  const [showOrderResults, setShowOrderResults] = useState(false);
  const orderSearchRef = useRef<HTMLDivElement>(null);

  // New Order dialog
  const [isNewOrderOpen, setIsNewOrderOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  // New Return dialog
  const [isNewReturnOpen, setIsNewReturnOpen] = useState(false);
  const [returnOrderId, setReturnOrderId] = useState<string>("");
  const [returnReason, setReturnReason] = useState("");

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (customerSearchRef.current && !customerSearchRef.current.contains(e.target as Node)) {
        setShowCustomerResults(false);
      }
      if (orderSearchRef.current && !orderSearchRef.current.contains(e.target as Node)) {
        setShowOrderResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredCustomers = customers?.filter((c) => {
    const q = customerQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q)) ||
      (c.phone?.toLowerCase().includes(q))
    );
  }).slice(0, 6) ?? [];

  const filteredOrders = orders?.filter((o) => {
    const q = orderQuery.toLowerCase();
    return (
      o.orderNumber.toLowerCase().includes(q) ||
      (o.customerName?.toLowerCase().includes(q))
    );
  }).slice(0, 6) ?? [];

  const handleCreateOrder = () => {
    createOrderMutation.mutate(
      {
        data: {
          customerId: selectedCustomerId ? parseInt(selectedCustomerId, 10) : null,
          orderDate: new Date().toISOString(),
          items: [],
        },
      },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Order Created", description: "Taking you to the new order..." });
          setIsNewOrderOpen(false);
          setSelectedCustomerId("");
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Could not create order.", variant: "destructive" });
        },
      }
    );
  };

  const handleCreateReturn = () => {
    if (!returnOrderId) {
      toast({ title: "Select an order", description: "Please select the order being returned.", variant: "destructive" });
      return;
    }
    const originalOrder = orders?.find((o) => o.id === parseInt(returnOrderId, 10));
    createOrderMutation.mutate(
      {
        data: {
          customerId: originalOrder?.customerId ?? null,
          notes: `RETURN — Original: ${originalOrder?.orderNumber ?? ""}${returnReason ? `. Reason: ${returnReason}` : ""}`,
          orderDate: new Date().toISOString(),
          items: [],
        },
      },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Return Created", description: "Add the returned items on the next screen." });
          setIsNewReturnOpen(false);
          setReturnOrderId("");
          setReturnReason("");
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: () => {
          toast({ title: "Error", description: "Could not create return.", variant: "destructive" });
        },
      }
    );
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <div className="flex flex-col items-center text-muted-foreground">
            <Loader2 className="w-10 h-10 animate-spin mb-4 text-primary" />
            <p className="font-medium animate-pulse">Loading dashboard...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!stats) return null;

  const chartData = [
    { name: "Draft", value: stats.ordersByStatus.draft, color: "#94a3b8" },
    { name: "Confirmed", value: stats.ordersByStatus.confirmed, color: "#3b82f6" },
    { name: "Shipped", value: stats.ordersByStatus.shipped, color: "#f59e0b" },
    { name: "Delivered", value: stats.ordersByStatus.delivered, color: "#10b981" },
    { name: "Cancelled", value: stats.ordersByStatus.cancelled, color: "#ef4444" },
  ].filter((item) => item.value > 0);

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Overview</h1>
            <p className="text-muted-foreground mt-1">Here's what's happening with your business today.</p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setIsNewOrderOpen(true)} className="shadow-sm shadow-primary/20">
              <Plus className="w-4 h-4 mr-2" /> New Order
            </Button>
            <Button variant="outline" onClick={() => setIsNewReturnOpen(true)}>
              <RotateCcw className="w-4 h-4 mr-2" /> New Return
            </Button>
          </div>
        </div>

        {/* Search Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Customer Search */}
          <div ref={customerSearchRef} className="relative">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Customer Search</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name, email or phone..."
                className="pl-9 pr-8 bg-background"
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setShowCustomerResults(e.target.value.length > 0);
                }}
                onFocus={() => customerQuery.length > 0 && setShowCustomerResults(true)}
              />
              {customerQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setCustomerQuery(""); setShowCustomerResults(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {showCustomerResults && customerQuery.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                {filteredCustomers.length > 0 ? (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 border-b border-border/40 last:border-0"
                      onClick={() => {
                        setShowCustomerResults(false);
                        setCustomerQuery("");
                        setLocation("/customers");
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm flex-shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.email ?? c.phone ?? "No contact info"}</p>
                      </div>
                      <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto flex-shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <User className="w-4 h-4" /> No customers found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Order Search */}
          <div ref={orderSearchRef} className="relative">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Order Search</p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by order number or customer..."
                className="pl-9 pr-8 bg-background"
                value={orderQuery}
                onChange={(e) => {
                  setOrderQuery(e.target.value);
                  setShowOrderResults(e.target.value.length > 0);
                }}
                onFocus={() => orderQuery.length > 0 && setShowOrderResults(true)}
              />
              {orderQuery && (
                <button
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setOrderQuery(""); setShowOrderResults(false); }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {showOrderResults && orderQuery.length > 0 && (
              <div className="absolute z-50 top-full mt-1 left-0 right-0 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((o) => (
                    <button
                      key={o.id}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 border-b border-border/40 last:border-0"
                      onClick={() => {
                        setShowOrderResults(false);
                        setOrderQuery("");
                        setLocation(`/orders/${o.id}`);
                      }}
                    >
                      <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground text-sm">{o.orderNumber}</p>
                        <p className="text-xs text-muted-foreground truncate">{o.customerName ?? "No customer"} &bull; {formatDate(o.orderDate)}</p>
                      </div>
                      <StatusBadge status={o.status} className="flex-shrink-0" />
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
                    <FileText className="w-4 h-4" /> No orders found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-blue-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Revenue</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {formatCurrency(stats.totalRevenue)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-indigo-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Orders</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
                <ShoppingCart className="w-5 h-5 text-indigo-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalOrders}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-emerald-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Customers</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Users className="w-5 h-5 text-emerald-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalCustomers}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card shadow-sm border-border/50 overflow-hidden relative hover:shadow-md transition-all duration-300">
            <div className="absolute top-0 left-0 w-1 h-full bg-amber-500" />
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Products</CardTitle>
              <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                <Package className="w-5 h-5 text-amber-600" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl lg:text-3xl font-bold text-foreground font-display">
                {stats.totalProducts}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Chart + Recent Orders */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="col-span-1 shadow-sm border-border/50 flex flex-col">
            <CardHeader>
              <CardTitle className="font-display">Orders by Status</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-[280px]">
              {chartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [`${value} Orders`, "Count"]}
                      contentStyle={{ borderRadius: "12px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                  No order data available
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="col-span-1 lg:col-span-2 shadow-sm border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="font-display">Recent Orders</CardTitle>
              <Link href="/orders" className="text-sm font-medium text-primary flex items-center hover:underline">
                View all <ArrowRight className="ml-1 w-4 h-4" />
              </Link>
            </CardHeader>
            <CardContent>
              {stats.recentOrders.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-border/50">
                  <Table>
                    <TableHeader className="bg-muted/30">
                      <TableRow>
                        <TableHead className="font-medium text-foreground">Order</TableHead>
                        <TableHead className="font-medium text-foreground">Customer</TableHead>
                        <TableHead className="font-medium text-foreground">Date</TableHead>
                        <TableHead className="font-medium text-foreground">Status</TableHead>
                        <TableHead className="text-right font-medium text-foreground">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.recentOrders.map((order) => (
                        <TableRow key={order.id} className="hover:bg-muted/30 transition-colors">
                          <TableCell>
                            <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
                              {order.orderNumber}
                            </Link>
                          </TableCell>
                          <TableCell className="font-medium text-foreground">{order.customerName || "Unknown"}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(order.orderDate)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right font-bold text-foreground">
                            {formatCurrency(order.totalAmount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-8 text-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                  <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="font-medium text-foreground">No orders yet</p>
                  <p className="text-sm mt-1 mb-4">Create your first sales order to see it here.</p>
                  <Button onClick={() => setIsNewOrderOpen(true)} size="sm">
                    <Plus className="w-4 h-4 mr-1" /> Create Order
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* New Order Dialog */}
      <Dialog open={isNewOrderOpen} onOpenChange={setIsNewOrderOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">New Sales Order</DialogTitle>
            <DialogDescription>
              Select a customer to create a draft order. You can add products on the next screen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="new-order-customer">Customer (optional)</Label>
              <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                <SelectTrigger id="new-order-customer">
                  <SelectValue placeholder="Choose a customer..." />
                </SelectTrigger>
                <SelectContent>
                  {customers?.map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNewOrderOpen(false); setSelectedCustomerId(""); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateOrder} disabled={createOrderMutation.isPending}>
              {createOrderMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Return Dialog */}
      <Dialog open={isNewReturnOpen} onOpenChange={setIsNewReturnOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-amber-500" /> New Return
            </DialogTitle>
            <DialogDescription>
              Select the original order being returned. A return order will be created so you can record the items coming back.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="return-order">Original Order</Label>
              <Select value={returnOrderId} onValueChange={setReturnOrderId}>
                <SelectTrigger id="return-order">
                  <SelectValue placeholder="Select original order..." />
                </SelectTrigger>
                <SelectContent>
                  {orders?.filter(o => !o.notes?.startsWith("RETURN")).map((o) => (
                    <SelectItem key={o.id} value={o.id.toString()}>
                      {o.orderNumber} — {o.customerName ?? "No customer"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="return-reason">Reason for Return</Label>
              <Textarea
                id="return-reason"
                placeholder="e.g. Faulty item, wrong product shipped..."
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIsNewReturnOpen(false); setReturnOrderId(""); setReturnReason(""); }}>
              Cancel
            </Button>
            <Button onClick={handleCreateReturn} disabled={!returnOrderId || createOrderMutation.isPending} variant="default">
              {createOrderMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</> : "Create Return"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
