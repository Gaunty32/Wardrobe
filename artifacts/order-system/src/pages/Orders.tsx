import { useState } from "react";
import Layout from "@/components/Layout";
import { Link, useLocation } from "wouter";
import { 
  useListOrders, 
  useCreateOrder, 
  useListCustomers,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, ShoppingCart, Loader2, ArrowRight } from "lucide-react";

export default function Orders() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: orders, isLoading } = useListOrders({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: customers } = useListCustomers();
  const createMutation = useCreateOrder();

  const handleCreateOrder = () => {
    if (!selectedCustomerId) {
      toast({ title: "Error", description: "Please select a customer to create an order.", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      { 
        data: { 
          customerId: parseInt(selectedCustomerId, 10),
          orderDate: new Date().toISOString(),
          items: [] // Empty to start, user will add on detail page
        } 
      },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Order Created", description: "Taking you to order details..." });
          setLocation(`/orders/${newOrder.id}`);
        }
      }
    );
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Sales Orders</h1>
            <p className="text-muted-foreground mt-1">Manage and track customer orders.</p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> New Order
          </Button>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-4">
            <div className="w-full max-w-xs">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Filter by status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : orders && orders.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Order #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className="group hover:bg-muted/30">
                        <TableCell>
                          <Link href={`/orders/${order.id}`} className="font-semibold text-primary hover:underline">
                            {order.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(order.orderDate)}</TableCell>
                        <TableCell className="font-medium text-foreground">{order.customerName || 'Unknown Customer'}</TableCell>
                        <TableCell><StatusBadge status={order.status} /></TableCell>
                        <TableCell className="text-right font-semibold text-foreground">
                          {formatCurrency(order.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Link href={`/orders/${order.id}`}>
                            <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                              View <ArrowRight className="w-4 h-4 ml-1" />
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No orders found</h3>
                <p className="mt-1">There are no orders matching your criteria.</p>
                <Button onClick={() => setIsCreateOpen(true)} variant="outline" className="mt-6">Create First Order</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Create New Order</DialogTitle>
              <DialogDescription>
                Select a customer to start a new draft order. You can add products on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="customer">Select Customer</Label>
                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger id="customer">
                    <SelectValue placeholder="Choose a customer..." />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map(c => (
                      <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateOrder} disabled={createMutation.isPending || !selectedCustomerId}>
                {createMutation.isPending ? "Creating..." : "Create & Continue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
