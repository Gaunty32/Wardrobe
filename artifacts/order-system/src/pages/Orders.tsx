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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShoppingCart, Loader2, ArrowRight, ChevronsUpDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Orders() {
  const [, setLocation] = useLocation();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customerComboOpen, setCustomerComboOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: orders, isLoading } = useListOrders({ status: statusFilter === "all" ? undefined : statusFilter });
  const { data: customers = [] } = useListCustomers();
  const createMutation = useCreateOrder();

  const selectedCustomer = customers.find(c => c.id.toString() === selectedCustomerId);

  const handleCreateOrder = () => {
    if (!selectedCustomerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }

    createMutation.mutate(
      { 
        data: { 
          customerId: parseInt(selectedCustomerId, 10),
          orderDate: new Date().toISOString(),
        } 
      },
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
                      <TableRow key={order.id} className="group hover:bg-muted/30 cursor-pointer" onClick={() => setLocation(`/orders/${order.id}`)}>
                        <TableCell>
                          <span className="font-semibold text-primary">{order.orderNumber}</span>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{formatDate(order.orderDate)}</TableCell>
                        <TableCell className="font-medium text-foreground">{order.customerName || 'Unknown'}</TableCell>
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
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No orders found</h3>
                <p className="mt-1">There are no orders matching your criteria.</p>
                <Button onClick={openCreate} variant="outline" className="mt-6">Create First Order</Button>
              </div>
            )}
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
                    {selectedCustomer ? selectedCustomer.name : "Search customers…"}
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
                              <p className="font-medium">{c.name}</p>
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
