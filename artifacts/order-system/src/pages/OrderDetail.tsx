import { useState } from "react";
import Layout from "@/components/Layout";
import { useRoute } from "wouter";
import { 
  useGetOrder, 
  useUpdateOrder,
  useAddOrderItem,
  useDeleteOrderItem,
  useListProducts,
  getGetOrderQueryKey,
  UpdateOrderBodyStatus
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, Save, FileText, PackageX, Loader2 } from "lucide-react";
import { Link } from "wouter";

export default function OrderDetail() {
  const [, params] = useRoute("/orders/:id");
  const orderId = params?.id ? parseInt(params.id, 10) : 0;
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: order, isLoading: isOrderLoading } = useGetOrder(orderId);
  const { data: products } = useListProducts();
  
  const updateOrderMutation = useUpdateOrder();
  const addItemMutation = useAddOrderItem();
  const deleteItemMutation = useDeleteOrderItem();

  // Add Item State
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const [priceOverride, setPriceOverride] = useState<string>("");

  if (isOrderLoading) {
    return (
      <Layout>
        <div className="flex h-[50vh] items-center justify-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="py-12 text-center text-red-500">Order not found.</div>
      </Layout>
    );
  }

  const handleStatusChange = (newStatus: UpdateOrderBodyStatus) => {
    updateOrderMutation.mutate(
      { id: orderId, data: { status: newStatus } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Status Updated", description: `Order is now ${newStatus}` });
        }
      }
    );
  };

  const handleProductSelect = (productIdStr: string) => {
    setSelectedProductId(productIdStr);
    const prod = products?.find(p => p.id.toString() === productIdStr);
    if (prod) {
      setPriceOverride(prod.unitPrice.toString());
    }
  };

  const handleAddItem = () => {
    if (!selectedProductId) return;
    const prod = products?.find(p => p.id.toString() === selectedProductId);
    if (!prod) return;

    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: prod.id,
          productName: prod.name,
          quantity: quantity,
          unitPrice: parseFloat(priceOverride) || prod.unitPrice
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Added", description: `${prod.name} added to order.` });
          setIsAddItemOpen(false);
          setSelectedProductId("");
          setQuantity(1);
        }
      }
    );
  };

  const handleDeleteItem = (itemId: number) => {
    if (confirm("Remove this item from the order?")) {
      deleteItemMutation.mutate(
        { id: orderId, itemId },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
            toast({ title: "Item Removed" });
          }
        }
      );
    }
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <Link href="/orders" className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors text-muted-foreground">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-display font-bold text-foreground tracking-tight">Order {order.orderNumber}</h1>
                <StatusBadge status={order.status} className="mt-1" />
              </div>
              <p className="text-muted-foreground mt-1">{formatDate(order.orderDate)} &bull; {order.customerName}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <Select value={order.status} onValueChange={(val) => handleStatusChange(val as UpdateOrderBodyStatus)}>
              <SelectTrigger className="w-[160px] bg-background">
                <SelectValue placeholder="Update Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Items Section */}
          <Card className="lg:col-span-2 shadow-sm border-border/50 flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10">
              <div>
                <CardTitle className="font-display">Line Items</CardTitle>
                <CardDescription>Products included in this order</CardDescription>
              </div>
              <Button size="sm" onClick={() => setIsAddItemOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add Item
              </Button>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              {order.items && order.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.productName}</TableCell>
                          <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                          <TableCell className="text-center font-semibold">{item.quantity}</TableCell>
                          <TableCell className="text-right font-bold text-primary">{formatCurrency(item.lineTotal)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDeleteItem(item.id)}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="py-16 flex flex-col items-center justify-center text-muted-foreground">
                  <PackageX className="w-12 h-12 mb-3 text-muted-foreground/30" />
                  <p className="font-medium text-foreground">No items added</p>
                  <p className="text-sm">Click "Add Item" to add products to this order.</p>
                </div>
              )}
            </CardContent>
            {order.items && order.items.length > 0 && (
              <div className="p-4 bg-muted/20 border-t border-border/40 flex justify-end items-center gap-4">
                <span className="text-muted-foreground font-medium">Order Total:</span>
                <span className="text-2xl font-bold font-display text-foreground">{formatCurrency(order.totalAmount)}</span>
              </div>
            )}
          </Card>

          {/* Sidebar Section */}
          <div className="flex flex-col gap-6">
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg">Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold font-display">
                    {order.customerName ? order.customerName.charAt(0).toUpperCase() : '?'}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{order.customerName || 'Unknown Customer'}</p>
                    {order.customerId && (
                      <Link href={`/customers`} className="text-sm text-primary hover:underline">View profile</Link>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg flex items-center">
                  <FileText className="w-4 h-4 mr-2 text-muted-foreground" /> Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <div className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50 min-h-[100px]">
                  {order.notes || "No notes for this order."}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button variant="outline" size="sm">Edit Notes</Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Add Item Dialog */}
        <Dialog open={isAddItemOpen} onOpenChange={setIsAddItemOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display">Add Line Item</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="product">Product</Label>
                <Select value={selectedProductId} onValueChange={handleProductSelect}>
                  <SelectTrigger id="product">
                    <SelectValue placeholder="Select a product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map(p => (
                      <SelectItem key={p.id} value={p.id.toString()}>{p.name} ({formatCurrency(p.unitPrice)})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="qty">Quantity</Label>
                  <Input 
                    id="qty" 
                    type="number" 
                    min="1" 
                    value={quantity} 
                    onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)} 
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="price">Unit Price ($)</Label>
                  <Input 
                    id="price" 
                    type="number" 
                    step="0.01" 
                    value={priceOverride} 
                    onChange={(e) => setPriceOverride(e.target.value)} 
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddItemOpen(false)}>Cancel</Button>
              <Button onClick={handleAddItem} disabled={!selectedProductId || addItemMutation.isPending}>
                {addItemMutation.isPending ? "Adding..." : "Add to Order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
