import { useState, useEffect } from "react";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Trash2, FileText, PackageX, Loader2, Check, ChevronsUpDown, Palette, Ruler, Sparkles, User, Archive, Link as LinkIcon, ShoppingBag, Package } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProductAttribute { id: number; productId: number; type: string; value: string; }
interface ProductVariant { id: number; productId: number; colour: string | null; size: string | null; stockQty: number | null; price: number | null; }
interface CustomerFinish { id: number; customerId: number; name: string; description: string | null; totalCost: number; processes: { id: number; name: string; price: number | null }[]; }
interface CustomerEmployee { id: number; customerId: number; firstName: string; lastName: string | null; department: string | null; }
interface CustomerFinishedItem { id: number; name: string; productId: number; productName: string | null; productSku: string | null; finishId: number | null; finishName: string | null; colour: string | null; size: string | null; unitPrice: number; notes: string | null; }

function useProductAttributes(productId: number | null) {
  return useQuery<ProductAttribute[]>({
    queryKey: ["product-attributes", productId],
    queryFn: () => apiFetch(`/products/${productId}/attributes`),
    enabled: productId !== null && productId > 0,
  });
}

function useProductVariants(productId: number | null) {
  return useQuery<ProductVariant[]>({
    queryKey: ["product-variants-detail", productId],
    queryFn: () => apiFetch(`/products/${productId}/variants`),
    enabled: productId !== null && productId > 0,
  });
}

function useCustomerFinishes(customerId: number | null) {
  return useQuery<CustomerFinish[]>({
    queryKey: ["customer-finishes", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/finishes`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerEmployees(customerId: number | null) {
  return useQuery<CustomerEmployee[]>({
    queryKey: ["customer-employees", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/employees`),
    enabled: customerId !== null && customerId > 0,
  });
}

function useCustomerFinishedItems(customerId: number | null) {
  return useQuery<CustomerFinishedItem[]>({
    queryKey: ["customer-finished-items", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/finished-items`),
    enabled: customerId !== null && customerId > 0,
  });
}

const EMPTY_ITEM = {
  productId: null as number | null,
  productName: "",
  colour: "",
  size: "",
  finishId: null as number | null,
  finishName: null as string | null,
  finishCost: 0,
  recipientType: "stock" as "stock" | "person",
  recipientName: "",
  quantity: 1,
  unitPrice: "",
  baseUnitPrice: "",
};

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

  const customerId = order?.customerId ?? null;

  const { data: customerFinishes } = useCustomerFinishes(customerId);
  const { data: customerEmployees } = useCustomerEmployees(customerId);
  const { data: customerFinishedItems } = useCustomerFinishedItems(customerId);

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"wardrobe" | "custom">("wardrobe");
  const [item, setItem] = useState({ ...EMPTY_ITEM });

  const { data: productAttributes } = useProductAttributes(item.productId);
  const { data: productVariants } = useProductVariants(item.productId);

  const colours = [...new Set((productAttributes ?? []).filter(a => a.type === "colour").map(a => a.value))];
  const sizes = [...new Set((productAttributes ?? []).filter(a => a.type === "size").map(a => a.value))];

  useEffect(() => {
    if (item.productId && productVariants) {
      const match = productVariants.find(v => v.colour === item.colour && v.size === item.size);
      if (match?.price != null) {
        const base = match.price!.toString();
        const total = (match.price! + item.finishCost).toString();
        setItem(i => ({ ...i, baseUnitPrice: base, unitPrice: total }));
      }
    }
  }, [item.colour, item.size, item.productId, productVariants]);

  const handleProductSelect = (productId: number) => {
    const prod = products?.find(p => p.id === productId);
    if (!prod) return;
    setItem({ ...EMPTY_ITEM, productId: prod.id, productName: prod.name, unitPrice: prod.unitPrice.toString(), baseUnitPrice: prod.unitPrice.toString() });
    setProductSearchOpen(false);
  };

  const handleFinishSelect = (value: string) => {
    if (value === "plain") {
      const base = item.baseUnitPrice || item.unitPrice;
      setItem(i => ({ ...i, finishId: null, finishName: null, finishCost: 0, unitPrice: base, baseUnitPrice: base }));
    } else {
      const finish = customerFinishes?.find(f => f.id.toString() === value);
      if (finish) {
        const base = parseFloat(item.baseUnitPrice || item.unitPrice) || 0;
        const total = base + finish.totalCost;
        setItem(i => ({ ...i, finishId: finish.id, finishName: finish.name, finishCost: finish.totalCost, unitPrice: total.toFixed(2) }));
      }
    }
  };

  const handleEmployeeSelect = (value: string) => {
    if (value === "__custom__") {
      setItem(i => ({ ...i, recipientName: "" }));
    } else {
      const emp = customerEmployees?.find(e => e.id.toString() === value);
      if (emp) {
        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        setItem(i => ({ ...i, recipientName: name }));
      }
    }
  };

  const resetDialog = () => {
    setItem({ ...EMPTY_ITEM });
    setIsAddItemOpen(false);
    setDialogTab("wardrobe");
  };

  const handleWardrobeSelect = (fi: CustomerFinishedItem) => {
    setItem({
      ...EMPTY_ITEM,
      productId: fi.productId,
      productName: fi.name,
      colour: fi.colour ?? "",
      size: fi.size ?? "",
      finishId: fi.finishId ?? null,
      finishName: fi.finishName ?? null,
      finishCost: 0,
      unitPrice: fi.unitPrice.toString(),
      baseUnitPrice: fi.unitPrice.toString(),
    });
  };

  const handleAddItem = () => {
    if (!item.productId || !item.productName) return;
    const price = parseFloat(item.unitPrice);
    if (isNaN(price)) return;

    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: item.productId,
          productName: item.productName,
          colour: item.colour || null,
          size: item.size || null,
          finishId: item.finishId ?? null,
          finishName: item.finishName ?? null,
          recipientType: item.recipientType,
          recipientName: item.recipientType === "person" ? (item.recipientName || null) : null,
          quantity: item.quantity,
          unitPrice: price,
        }
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Added", description: `${item.productName} added to order.` });
          resetDialog();
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleDeleteItem = (itemId: number) => {
    if (!confirm("Remove this item from the order?")) return;
    deleteItemMutation.mutate(
      { id: orderId, itemId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Removed" });
        }
      }
    );
  };

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

  const selectedProduct = products?.find(p => p.id === item.productId);

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
                        <TableHead>Finish</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="w-[50px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {order.items.map((orderItem) => (
                        <TableRow key={orderItem.id}>
                          <TableCell>
                            <p className="font-medium text-foreground">{orderItem.productName}</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {orderItem.colour && (
                                <Badge variant="outline" className="text-xs gap-1 font-normal">
                                  <Palette className="w-3 h-3" />{orderItem.colour}
                                </Badge>
                              )}
                              {orderItem.size && (
                                <Badge variant="outline" className="text-xs gap-1 font-normal">
                                  <Ruler className="w-3 h-3" />{orderItem.size}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {orderItem.finishName ? (
                              <Badge variant="secondary" className="text-xs gap-1 font-normal">
                                <Sparkles className="w-3 h-3" />{orderItem.finishName}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">Plain</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {orderItem.recipientType === "person" && orderItem.recipientName ? (
                              <Badge variant="outline" className="text-xs gap-1 border-blue-200 text-blue-700 bg-blue-50 font-normal">
                                <User className="w-3 h-3" />{orderItem.recipientName}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs gap-1 border-muted-foreground/20 text-muted-foreground font-normal">
                                <Archive className="w-3 h-3" />Stock
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{formatCurrency(orderItem.unitPrice)}</TableCell>
                          <TableCell className="text-center font-semibold">{orderItem.quantity}</TableCell>
                          <TableCell className="text-right font-bold text-primary tabular-nums">{formatCurrency(orderItem.lineTotal)}</TableCell>
                          <TableCell className="text-right">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDeleteItem(orderItem.id)}>
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

          <div className="flex flex-col gap-6">
            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg">Customer Info</CardTitle>
              </CardHeader>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold font-display">
                    {order.customerName ? order.customerName.charAt(0).toUpperCase() : "?"}
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{order.customerName || "Unknown Customer"}</p>
                    {order.customerId && (
                      <Link href="/customers" className="text-sm text-primary hover:underline flex items-center gap-1">
                        <LinkIcon className="w-3 h-3" />View profile
                      </Link>
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
              </CardContent>
            </Card>
          </div>
        </div>

        <Dialog open={isAddItemOpen} onOpenChange={(open) => { if (!open) resetDialog(); else setIsAddItemOpen(true); }}>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
            <DialogHeader className="shrink-0">
              <DialogTitle className="font-display">Add Line Item</DialogTitle>
            </DialogHeader>

            <Tabs value={dialogTab} onValueChange={(v) => { setDialogTab(v as "wardrobe" | "custom"); if (v === "custom") setItem({ ...EMPTY_ITEM }); }} className="flex flex-col flex-1 overflow-hidden">
              <TabsList className="shrink-0 w-full grid grid-cols-2">
                <TabsTrigger value="wardrobe" className="flex items-center gap-1.5">
                  <ShoppingBag className="w-3.5 h-3.5" /> Wardrobe
                  {(customerFinishedItems?.length ?? 0) > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                      {customerFinishedItems!.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5" /> Custom Item
                </TabsTrigger>
              </TabsList>

              {/* ── WARDROBE TAB ───────────────────────────────────────────── */}
              <TabsContent value="wardrobe" className="flex-1 overflow-y-auto mt-0 pt-3 data-[state=inactive]:hidden">
                {!customerFinishedItems?.length ? (
                  <div className="py-10 text-center text-muted-foreground">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No wardrobe items yet</p>
                    <p className="text-xs mt-1 text-muted-foreground/70">Go to this customer's Wardrobe tab to build their wardrobe.</p>
                  </div>
                ) : (
                  <div className="grid gap-2 pb-2">
                    {customerFinishedItems.map(fi => {
                      const isSelected = item.productId === fi.productId && item.productName === fi.name && item.unitPrice === fi.unitPrice.toString();
                      return (
                        <button
                          key={fi.id}
                          type="button"
                          className={cn(
                            "w-full text-left rounded-lg border px-4 py-3 transition-all hover:bg-muted/40",
                            isSelected
                              ? "border-primary bg-primary/5 ring-1 ring-primary/50"
                              : "border-border hover:border-muted-foreground/30"
                          )}
                          onClick={() => handleWardrobeSelect(fi)}
                        >
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                                <p className="font-medium text-sm truncate">{fi.name}</p>
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {fi.productName}
                                {fi.colour && <span> · {fi.colour}</span>}
                                {fi.size && <span> · {fi.size}</span>}
                                {fi.finishName && <span className="text-amber-600"> · <Sparkles className="w-2.5 h-2.5 inline -mt-0.5" /> {fi.finishName}</span>}
                              </p>
                            </div>
                            <span className="text-sm font-semibold shrink-0">{formatCurrency(fi.unitPrice)}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Qty + Recipient shown once a wardrobe item is selected */}
                {item.productId && dialogTab === "wardrobe" && (
                  <div className="border-t border-border/50 pt-4 mt-2 grid gap-4">
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-sm flex items-center justify-between">
                      <span className="font-medium truncate">{item.productName}</span>
                      <span className="font-semibold ml-3 shrink-0">{formatCurrency(parseFloat(item.unitPrice) || 0)} ea</span>
                    </div>

                    <div className="grid gap-3">
                      <Label>Ordered for</Label>
                      <RadioGroup
                        value={item.recipientType}
                        onValueChange={(v) => setItem(i => ({ ...i, recipientType: v as "stock" | "person", recipientName: "" }))}
                        className="flex gap-6"
                      >
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="stock" id="w-for-stock" />
                          <Label htmlFor="w-for-stock" className="font-normal cursor-pointer flex items-center gap-1">
                            <Archive className="w-3.5 h-3.5 text-muted-foreground" /> Stock
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <RadioGroupItem value="person" id="w-for-person" />
                          <Label htmlFor="w-for-person" className="font-normal cursor-pointer flex items-center gap-1">
                            <User className="w-3.5 h-3.5 text-muted-foreground" /> Specific person
                          </Label>
                        </div>
                      </RadioGroup>
                      {item.recipientType === "person" && (
                        <div className="grid gap-2">
                          {customerEmployees && customerEmployees.length > 0 && (
                            <Select onValueChange={handleEmployeeSelect} defaultValue="">
                              <SelectTrigger><SelectValue placeholder="Pick from employees..." /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__custom__">Enter name manually</SelectItem>
                                {customerEmployees.map(e => (
                                  <SelectItem key={e.id} value={e.id.toString()}>
                                    {[e.firstName, e.lastName].filter(Boolean).join(" ")}
                                    {e.department ? ` — ${e.department}` : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <Input placeholder="Recipient name" value={item.recipientName} onChange={e => setItem(i => ({ ...i, recipientName: e.target.value }))} />
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label htmlFor="w-qty">Quantity</Label>
                        <Input id="w-qty" type="number" min="1" value={item.quantity} onChange={e => setItem(i => ({ ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="w-price">Unit Price (£)</Label>
                        <Input id="w-price" type="number" step="0.01" min="0" value={item.unitPrice} onChange={e => setItem(i => ({ ...i, unitPrice: e.target.value }))} />
                      </div>
                    </div>

                    {item.unitPrice && item.quantity && (
                      <div className="flex justify-end text-sm text-muted-foreground">
                        Line total: <span className="font-semibold text-foreground ml-1">{formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}</span>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ── CUSTOM ITEM TAB ────────────────────────────────────────── */}
              <TabsContent value="custom" className="flex-1 overflow-y-auto mt-0 pt-3 data-[state=inactive]:hidden">
                <div className="grid gap-5">
                  {/* Product picker */}
                  <div className="grid gap-2">
                    <Label>Product</Label>
                    <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                      <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                          {selectedProduct ? selectedProduct.name : "Search products..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Type product name or SKU..." />
                          <CommandList>
                            <CommandEmpty>No products found.</CommandEmpty>
                            <CommandGroup>
                              {products?.map(p => (
                                <CommandItem key={p.id} value={`${p.name} ${p.sku ?? ""}`} onSelect={() => handleProductSelect(p.id)}>
                                  <Check className={cn("mr-2 h-4 w-4", item.productId === p.id ? "opacity-100" : "opacity-0")} />
                                  <span className="flex-1">{p.name}</span>
                                  {p.sku && <span className="text-xs text-muted-foreground mr-2">{p.sku}</span>}
                                  <span className="text-xs font-semibold">{formatCurrency(p.unitPrice)}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>

                  {/* Colour + Size */}
                  {item.productId && (colours.length > 0 || sizes.length > 0) && (
                    <div className="grid grid-cols-2 gap-4">
                      {colours.length > 0 && (
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-1"><Palette className="w-3 h-3" /> Colour</Label>
                          <Select value={item.colour || "none"} onValueChange={v => setItem(i => ({ ...i, colour: v === "none" ? "" : v }))}>
                            <SelectTrigger><SelectValue placeholder="Any colour" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Any / Not specified</SelectItem>
                              {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {sizes.length > 0 && (
                        <div className="grid gap-2">
                          <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Size</Label>
                          <Select value={item.size || "none"} onValueChange={v => setItem(i => ({ ...i, size: v === "none" ? "" : v }))}>
                            <SelectTrigger><SelectValue placeholder="Any size" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Any / Not specified</SelectItem>
                              {sizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Finish */}
                  <div className="grid gap-2">
                    <Label className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Finish</Label>
                    <Select value={item.finishId ? item.finishId.toString() : "plain"} onValueChange={handleFinishSelect}>
                      <SelectTrigger><SelectValue placeholder="Plain (no finish)" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="plain">Plain (no finish)</SelectItem>
                        {customerFinishes?.map(f => (
                          <SelectItem key={f.id} value={f.id.toString()}>
                            <span className="flex items-center gap-2">
                              {f.name}
                              {f.totalCost > 0 && <span className="text-xs text-muted-foreground">+{formatCurrency(f.totalCost)}</span>}
                            </span>
                          </SelectItem>
                        ))}
                        {(!customerFinishes || customerFinishes.length === 0) && (
                          <SelectItem value="plain" disabled>No finishes set up for this customer</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    {item.finishId && item.finishCost > 0 && (
                      <div className="text-xs text-muted-foreground bg-muted/30 rounded px-3 py-2 space-y-0.5">
                        <div className="flex justify-between"><span>Garment</span><span className="tabular-nums">{formatCurrency(parseFloat(item.baseUnitPrice) || 0)}</span></div>
                        <div className="flex justify-between text-emerald-700"><span>Finish ({item.finishName})</span><span className="tabular-nums">+{formatCurrency(item.finishCost)}</span></div>
                        <div className="flex justify-between font-semibold text-foreground border-t border-border/40 pt-0.5 mt-0.5"><span>Unit price</span><span className="tabular-nums">{formatCurrency(parseFloat(item.unitPrice) || 0)}</span></div>
                      </div>
                    )}
                  </div>

                  {/* Recipient */}
                  <div className="grid gap-3">
                    <Label>Ordered for</Label>
                    <RadioGroup
                      value={item.recipientType}
                      onValueChange={(v) => setItem(i => ({ ...i, recipientType: v as "stock" | "person", recipientName: "" }))}
                      className="flex gap-6"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="stock" id="for-stock" />
                        <Label htmlFor="for-stock" className="font-normal cursor-pointer flex items-center gap-1"><Archive className="w-3.5 h-3.5 text-muted-foreground" /> Stock</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="person" id="for-person" />
                        <Label htmlFor="for-person" className="font-normal cursor-pointer flex items-center gap-1"><User className="w-3.5 h-3.5 text-muted-foreground" /> Specific person</Label>
                      </div>
                    </RadioGroup>
                    {item.recipientType === "person" && (
                      <div className="grid gap-2">
                        {customerEmployees && customerEmployees.length > 0 && (
                          <Select onValueChange={handleEmployeeSelect} defaultValue="">
                            <SelectTrigger><SelectValue placeholder="Pick from employees..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__custom__">Enter name manually</SelectItem>
                              {customerEmployees.map(e => (
                                <SelectItem key={e.id} value={e.id.toString()}>
                                  {[e.firstName, e.lastName].filter(Boolean).join(" ")}
                                  {e.department ? ` — ${e.department}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Input placeholder="Recipient name" value={item.recipientName} onChange={e => setItem(i => ({ ...i, recipientName: e.target.value }))} />
                      </div>
                    )}
                  </div>

                  {/* Qty + Price */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="qty">Quantity</Label>
                      <Input id="qty" type="number" min="1" value={item.quantity} onChange={e => setItem(i => ({ ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="price">Unit Price (£)</Label>
                      <Input id="price" type="number" step="0.01" min="0" value={item.unitPrice} onChange={e => setItem(i => ({ ...i, unitPrice: e.target.value }))} />
                    </div>
                  </div>

                  {item.unitPrice && item.quantity && (
                    <div className="flex justify-end text-sm text-muted-foreground">
                      Line total: <span className="font-semibold text-foreground ml-1">{formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}</span>
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="shrink-0 border-t border-border/40 pt-4 mt-2">
              <Button variant="outline" onClick={resetDialog}>Cancel</Button>
              <Button
                onClick={handleAddItem}
                disabled={!item.productId || !item.unitPrice || addItemMutation.isPending}
              >
                {addItemMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Adding...</> : "Add to Order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
