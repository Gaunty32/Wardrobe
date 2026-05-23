import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { useRoute, useLocation } from "wouter";
import {
  useGetOrder,
  useUpdateOrder,
  useAddOrderItem,
  useDeleteOrderItem,
  useListProducts,
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  UpdateOrderBodyStatus
} from "@workspace/api-client-react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmOrderDialog } from "@/components/ConfirmOrderDialog";
import { SendAcknowledgementDialog } from "@/components/SendAcknowledgementDialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { sortSizesWithOrder } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Minus, Trash2, FileText, PackageX, Loader2, Check, ChevronsUpDown, ChevronLeft, Palette, Ruler, Sparkles, User, Archive, Link as LinkIcon, ShoppingBag, Package, ClipboardList, PackageCheck, Printer, CheckCircle2, Clock, TriangleAlert, Calendar, Pencil, BookOpen, ExternalLink, MapPin, Wand2, Truck, Globe, XCircle, X, Mail, Lock, LockOpen, Download, MessageSquare, Paperclip, Search, RotateCcw, Lightbulb, BadgePercent } from "lucide-react";
import { OrderMessages } from "@/components/OrderMessages";
import { FileDropZone, FileDropZoneContent } from "@/components/FileDropZone";
import { Link } from "wouter";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

const DEFAULT_CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

function getStoredActor(): string {
  return localStorage.getItem("sbs_actor_name") || "";
}

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = getStoredActor();
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { "x-actor": actor } : {}),
      ...opts?.headers,
    },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProductAttribute { id: number; productId: number; type: string; value: string; }
interface ProductVariant { id: number; productId: number; colour: string | null; size: string | null; stockQty: number | null; price: number | null; }
interface CustomerFinish { id: number; customerId: number; name: string; description: string | null; totalCost: number; processes: { id: number; name: string; price: number | null }[]; }
interface EmployeeSize { id: number; label: string; size: string; }
interface CustomerEmployee { id: number; customerId: number; firstName: string; lastName: string | null; jobTitle: string | null; roleId: number | null; roleName: string | null; department: string | null; sizes: EmployeeSize[]; }
interface CustomerFinishedItem { id: number; name: string; productId: number; roleId: number | null; roleName: string | null; productName: string | null; productSku: string | null; finishId: number | null; finishName: string | null; colour: string | null; size: string | null; unitPrice: number; specialPrice: number | null; notes: string | null; }
interface DeliveryAddress { id: number; customerId: number; label: string | null; line1: string | null; line2: string | null; city: string | null; county: string | null; postcode: string | null; country: string | null; isDefault: boolean; }

function PoNumberInline({ orderId, current }: { orderId: number; current: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ poNumber: value || null }),
      });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    } catch {
      toast({ title: "Could not save PO number", variant: "destructive" });
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5">
        <input
          autoFocus
          className="text-sm border rounded px-2 py-0.5 font-mono w-44 outline-none focus:ring-1 focus:ring-primary/40"
          placeholder="e.g. PO-2026-0042"
          value={value}
          onChange={e => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        />
      </div>
    );
  }

  return (
    <button
      className="flex items-center gap-1.5 mt-1.5 group"
      onClick={() => setEditing(true)}
      title="Click to edit PO number"
    >
      {current ? (
        <span className="text-sm font-mono text-muted-foreground group-hover:text-foreground transition-colors">
          PO: {current}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/60 group-hover:text-muted-foreground transition-colors italic">
          + Add PO number
        </span>
      )}
      <Pencil className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
    </button>
  );
}

function AttentionOfCard({ orderId, current }: { orderId: number; current: string | null }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, {
        method: "PATCH",
        body: JSON.stringify({ attentionOf: value || null }),
      });
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
    } catch {
      toast({ title: "Could not save attention of field", variant: "destructive" });
    }
  };

  return (
    <Card className="shadow-sm border-border/50">
      <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
        <div className="flex items-center justify-between">
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" /> For the Attention Of
          </CardTitle>
          {!editing && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(true); }}>
              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="py-4">
        {editing ? (
          <div className="space-y-2">
            <input
              autoFocus
              className="text-sm border rounded px-2 py-1.5 w-full outline-none focus:ring-1 focus:ring-primary/40"
              placeholder="e.g. John Smith"
              value={value}
              onChange={e => setValue(e.target.value)}
              onBlur={save}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setValue(current ?? ""); } }}
            />
            <p className="text-xs text-muted-foreground">This name appears on the delivery note</p>
          </div>
        ) : (
          <p className={`text-sm ${current ? "text-foreground" : "text-muted-foreground italic"}`}>
            {current ?? "Not set"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

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

function useCustomerDeliveryAddresses(customerId: number | null) {
  return useQuery<DeliveryAddress[]>({
    queryKey: ["customer-delivery-addresses", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/delivery-addresses`),
    enabled: customerId !== null && customerId > 0,
  });
}

/** Returns the unit price for a given total quantity from a price-break table.
 *  Returns the price for the highest tier whose min qty is ≤ totalQty.
 *  Returns null if no tier matches (quantity below minimum). */
function getBreakPrice(
  priceBreaks: { qty: number; price: number }[] | null | undefined,
  totalQty: number,
): number | null {
  if (!priceBreaks || priceBreaks.length === 0) return null;
  const sorted = [...priceBreaks].sort((a, b) => a.qty - b.qty);
  let result: number | null = null;
  for (const tier of sorted) {
    if (totalQty >= tier.qty) result = tier.price;
  }
  return result;
}

/** Returns a friendly price-break suggestion toast payload, or null if none applies.
 *  totalQty = existing order qty + qty just added.
 *  priorQty = existing order qty before this add (used to detect newly crossed tiers). */
function getPriceBreakSuggestion(
  productName: string,
  totalQty: number,
  priorQty: number,
  priceBreaks: { qty: number; price: number }[],
  unitPrice: number,
): { title: string; description: string } | null {
  if (!priceBreaks.length) return null;
  const sorted = [...priceBreaks].sort((a, b) => a.qty - b.qty);

  // Celebrate if they just crossed into a new tier
  const justUnlocked = sorted.filter(pb => pb.qty <= totalQty && pb.qty > priorQty);
  if (justUnlocked.length > 0) {
    const best = justUnlocked[justUnlocked.length - 1];
    return {
      title: "Bulk rate unlocked!",
      description: `${productName} are now £${best.price.toFixed(2)} each at this quantity.`,
    };
  }

  // Suggest the next reachable tier
  const nextTier = sorted.find(pb => pb.qty > totalQty);
  if (!nextTier) return null;
  const saving = unitPrice - nextTier.price;
  if (saving < 0.01) return null;

  const needed = nextTier.qty - totalQty;
  const isClose = needed <= Math.ceil(nextTier.qty * 0.35);
  if (isClose) {
    return {
      title: "Almost there!",
      description: `Add just ${needed} more ${productName} to unlock £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
    };
  }
  return {
    title: "Bulk discount tip",
    description: `Did you know? Order ${nextTier.qty}+ ${productName} and the price drops to £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
  };
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
  recipientEmployeeId: null as number | null,
  quantity: 1,
  unitPrice: "",
  baseUnitPrice: "",
  vatRate: 0.20,
  fromWardrobe: false,
};

export default function OrderDetail() {
  const [, params] = useRoute("/orders/:id");
  const orderId = params?.id ? parseInt(params.id, 10) : 0;
  const [, navigate] = useLocation();

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const sizeOrder = useSizeOrder();

  const { data: order, isLoading: isOrderLoading } = useGetOrder(orderId);
  const { data: products } = useListProducts();

  const updateOrderMutation = useUpdateOrder();
  const addItemMutation = useAddOrderItem();
  const deleteItemMutation = useDeleteOrderItem();

  const deleteOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/orders/${orderId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      if (order?.customerId) {
        queryClient.invalidateQueries({ queryKey: ["customer", order.customerId, "orders"] });
      }
      toast({ title: "Order deleted" });
      navigate("/orders");
    },
    onError: (e: Error) => toast({ title: "Could not delete order", description: e.message, variant: "destructive" }),
  });

  const customerId = order?.customerId ?? null;

  const { data: customerFinishes } = useCustomerFinishes(customerId);
  const { data: customerEmployees, refetch: refetchEmployees } = useCustomerEmployees(customerId);
  const { data: customerFinishedItems } = useCustomerFinishedItems(customerId);
  const { data: customerDeliveryAddresses } = useCustomerDeliveryAddresses(customerId);

  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<"wardrobe" | "custom">("wardrobe");
  const [item, setItem] = useState({ ...EMPTY_ITEM });
  const [sizeRows, setSizeRows] = useState<Array<{ size: string; qty: number }>>([{ size: "", qty: 1 }]);
  const [isAddingMulti, setIsAddingMulti] = useState(false);
  const [priceOverrideEnabled, setPriceOverrideEnabled] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<CustomerEmployee | null>(null);
  const [isNewPerson, setIsNewPerson] = useState(false);
  const [lastOrderedSizes, setLastOrderedSizes] = useState<{
    byProductId: Record<string, { size: string; colour: string | null; productName: string }>;
    byProductName: Record<string, { size: string; colour: string | null; productId: number | null }>;
  }>({ byProductId: {}, byProductName: {} });

  // ── Wardrobe tab: person-first picker state ────────────────────────────────
  // null = no person selected yet (show person picker)
  // "stock" = ordering as bulk stock
  // CustomerEmployee = ordering for a specific person
  const [wardrobeRecipient, setWardrobeRecipient] = useState<null | "stock" | CustomerEmployee>(null);
  const [wardrobeItemSizes, setWardrobeItemSizes] = useState<Record<number, string>>({});
  const [wardrobeItemQtys, setWardrobeItemQtys] = useState<Record<number, number>>({});

  const [isSendToProductionOpen, setIsSendToProductionOpen] = useState(false);
  const [productionNotes, setProductionNotes] = useState("");

  // ── Actor name (who is using the system) ──────────────────────────────────
  const [actorName, setActorName] = useState<string>(() => getStoredActor());
  const [actorEditing, setActorEditing] = useState(false);
  const [actorDraft, setActorDraft] = useState("");
  const saveActorName = () => {
    const trimmed = actorDraft.trim();
    localStorage.setItem("sbs_actor_name", trimmed);
    setActorName(trimmed);
    setActorEditing(false);
  };

  interface OrderLog { id: number; orderId: number; action: string; actor: string; details: string | null; createdAt: string; }
  const { data: orderLogs = [], refetch: refetchLogs } = useQuery<OrderLog[]>({
    queryKey: ["order-logs", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/logs`),
    enabled: orderId > 0,
    refetchInterval: 30000,
  });

  interface OrderEmailLog { id: number; orderId: number; emailType: string; toEmail: string; subject: string | null; sentBy: string | null; sentAt: string; success: boolean; error: string | null; }
  const { data: emailLogs = [], refetch: refetchEmailLogs } = useQuery<OrderEmailLog[]>({
    queryKey: ["order-email-logs", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/email-logs`),
    enabled: orderId > 0,
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [deleteOrderConfirmOpen, setDeleteOrderConfirmOpen] = useState(false);

  const updateDeliveryAddressMutation = useMutation({
    mutationFn: (addressId: number | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ deliveryAddressId: addressId }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Delivery address updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Auto-set delivery address when order has none but customer has a default
  useEffect(() => {
    if (!order || order.deliveryAddressId || !customerDeliveryAddresses?.length) return;
    const def = customerDeliveryAddresses.find(a => a.isDefault) ?? customerDeliveryAddresses[0];
    if (def) {
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ deliveryAddressId: def.id }) })
        .then(() => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }))
        .catch(() => {});
    }
  }, [order?.deliveryAddressId, customerDeliveryAddresses?.length]);

  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");

  const updateNotesMutation = useMutation({
    mutationFn: (notes: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ notes: notes || null }) }),
    onSuccess: (_data, notes) => {
      queryClient.setQueryData(getGetOrderQueryKey(orderId), (old: any) =>
        old ? { ...old, notes: notes ?? null } : old
      );
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingNotes(false);
      toast({ title: "Notes saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [uploading, setUploading] = useState(false);
  const [editingItemPrice, setEditingItemPrice] = useState<{ id: number; value: string } | null>(null);
  const [lineFilter, setLineFilter] = useState("");
  const [lineSort, setLineSort] = useState<{ col: "product" | "finish" | "recipient" | "price" | "qty" | "total"; dir: "asc" | "desc" } | null>(null);

  function toggleSort(col: typeof lineSort extends null ? never : (typeof lineSort)["col"]) {
    setLineSort(prev =>
      prev?.col === col
        ? prev.dir === "asc" ? { col, dir: "desc" } : null
        : { col, dir: "asc" }
    );
  }

  const filteredItems = (() => {
    const allItems: any[] = (order as any)?.items ?? [];
    const q = lineFilter.toLowerCase().trim();
    let result = q
      ? allItems.filter((oi: any) =>
          oi.productName?.toLowerCase().includes(q) ||
          oi.recipientName?.toLowerCase().includes(q) ||
          oi.colour?.toLowerCase().includes(q) ||
          oi.size?.toLowerCase().includes(q)
        )
      : allItems;

    if (lineSort) {
      result = [...result].sort((a, b) => {
        let av: any, bv: any;
        switch (lineSort.col) {
          case "product":  av = (a.productName ?? "").toLowerCase(); bv = (b.productName ?? "").toLowerCase(); break;
          case "finish":   av = (a.finishName ?? "").toLowerCase(); bv = (b.finishName ?? "").toLowerCase(); break;
          case "recipient":av = (a.recipientName ?? "").toLowerCase(); bv = (b.recipientName ?? "").toLowerCase(); break;
          case "price":    av = a.unitPrice ?? 0; bv = b.unitPrice ?? 0; break;
          case "qty":      av = a.quantity ?? 0; bv = b.quantity ?? 0; break;
          case "total":    av = a.lineTotal ?? 0; bv = b.lineTotal ?? 0; break;
        }
        if (av < bv) return lineSort.dir === "asc" ? -1 : 1;
        if (av > bv) return lineSort.dir === "asc" ? 1 : -1;
        return 0;
      });
    }
    return result;
  })();

  const updateItemPriceMutation = useMutation({
    mutationFn: ({ itemId, unitPrice }: { itemId: number; unitPrice: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ unitPrice }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingItemPrice(null);
    },
    onError: (e: Error) => toast({ title: "Failed to update price", description: e.message, variant: "destructive" }),
  });

  const updateItemVatRateMutation = useMutation({
    mutationFn: ({ itemId, vatRate }: { itemId: number; vatRate: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ vatRate }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }),
    onError: (e: Error) => toast({ title: "Failed to update VAT rate", description: e.message, variant: "destructive" }),
  });

  const [editingSizeColour, setEditingSizeColour] = useState<{ itemId: number; size: string; colour: string } | null>(null);
  const updateItemSizeColourMutation = useMutation({
    mutationFn: ({ itemId, size, colour }: { itemId: number; size: string; colour: string }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ size: size || null, colour: colour || null }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }); setEditingSizeColour(null); },
    onError: (e: Error) => toast({ title: "Failed to update size/colour", description: e.message, variant: "destructive" }),
  });

  const updateAttachmentsMutation = useMutation({
    mutationFn: (attachments: Array<{ name: string; objectPath: string }>) =>
      apiFetch(`/orders/${orderId}/attachments`, { method: "PATCH", body: JSON.stringify({ attachments }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) }),
    onError: (e: Error) => toast({ title: "Error saving attachments", description: e.message, variant: "destructive" }),
  });

  const currentAttachments: Array<{ name: string; objectPath: string }> =
    Array.isArray((order as any)?.attachments) ? (order as any).attachments : [];

  const uploadFiles = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const added: Array<{ name: string; objectPath: string }> = [];
      for (const file of files) {
        const meta = await apiFetch<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        await fetch(meta.uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        added.push({ name: file.name, objectPath: meta.objectPath });
      }
      await updateAttachmentsMutation.mutateAsync([...currentAttachments, ...added]);
    } catch {
      toast({ title: "Upload failed", description: "Could not upload file. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    uploadFiles(files);
  };

  const removeAttachment = (idx: number) => {
    updateAttachmentsMutation.mutate(currentAttachments.filter((_, i) => i !== idx));
  };

  const [editingRequiredDate, setEditingRequiredDate] = useState(false);
  const [requiredDateValue, setRequiredDateValue] = useState("");

  const updateRequiredDateMutation = useMutation({
    mutationFn: (date: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ requiredDate: date || null }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingRequiredDate(false);
      toast({ title: "Required date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const SHIPPING_OPTIONS = [
    { value: "free_local", label: "Free Local Delivery" },
    { value: "local_delivery", label: "Local Delivery" },
    { value: "office_collection", label: "Office Collection" },
    { value: "warehouse_collection", label: "Warehouse Collection" },
    { value: "courier", label: "Courier" },
  ];

  const [editingShippingMethod, setEditingShippingMethod] = useState(false);

  const updateShippingMethodMutation = useMutation({
    mutationFn: (method: string | null) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ shippingMethod: method }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingShippingMethod(false);
      toast({ title: "Shipping method updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editingCarriage, setEditingCarriage] = useState(false);
  const [carriageInput, setCarriageInput] = useState("");

  const updateCarriageMutation = useMutation({
    mutationFn: (amount: number) =>
      apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ carriageAmount: amount }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      setEditingCarriage(false);
      toast({ title: "Carriage updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  interface PackItem { orderItemId: number; productName: string; colour: string | null; size: string | null; quantity: number; isComplete: boolean; worksheetNumber: string | null; }
  interface PackRecipient { recipientType: "stock" | "person"; recipientName: string | null; employeeId: number | null; jobTitle: string | null; department: string | null; allComplete: boolean; items: PackItem[]; }
  interface PackStatus { orderId: number; orderNumber: string; customerName: string | null; recipients: PackRecipient[]; }

  interface OrderBackorderLine { id: number; poId: number; poNumber: string; supplierName: string; productName: string; colour: string | null; size: string | null; supplierCode: string | null; quantityOrdered: number; quantityDelivered: number; remaining: number; estimatedDueDate: string | null; orderItemId: number | null; }

  const { data: packStatus, refetch: refetchPackStatus } = useQuery<PackStatus>({
    queryKey: ["pack-status", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/pack-status`),
    enabled: orderId > 0,
  });

  const { data: orderBackorders = [] } = useQuery<OrderBackorderLine[]>({
    queryKey: ["order-backorders", orderId],
    queryFn: () => apiFetch(`/orders/${orderId}/backorders`),
    enabled: orderId > 0,
    refetchInterval: 60000,
  });

  const printLabel = (recipient: PackRecipient) => {
    const win = window.open("", "_blank", "width=600,height=900");
    if (!win) return;
    const lines = recipient.items.map(i => `<tr><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px">${i.productName}</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px;color:#555">${[i.colour, i.size].filter(Boolean).join(" / ") || "—"}</td><td style="padding:3px 6px;border-bottom:1px solid #eee;font-size:13px;text-align:center;font-weight:bold">${i.quantity}</td></tr>`).join("");
    win.document.write(`<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><title>Pack Label — ${recipient.recipientName}</title>
      <style>
        @page { size: 4in 6in; margin: 0; }
        body { margin: 0; font-family: Arial, sans-serif; width: 4in; height: 6in; display: flex; flex-direction: column; box-sizing: border-box; padding: 0; }
        * { box-sizing: border-box; }
      </style>
    </head><body>
      <div style="background:#1e3a5f;color:white;padding:10px 14px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;opacity:.8">Select Branding Solutions</div><div style="font-size:11px;font-weight:bold;margin-top:2px">Order: ${order?.orderNumber ?? ""}${(order as any)?.poNumber ? ` &bull; PO: ${(order as any).poNumber}` : ""}</div></div>
        <div style="font-size:10px;opacity:.7;text-align:right">${order?.customerName ?? ""}</div>
      </div>
      <div style="padding:14px;background:#f0f4fa;border-bottom:2px solid #1e3a5f">
        <div style="font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1">${recipient.recipientName}</div>
        ${recipient.jobTitle ? `<div style="font-size:13px;color:#444;margin-top:3px">${recipient.jobTitle}</div>` : ""}
        ${recipient.department ? `<div style="font-size:11px;color:#888">${recipient.department}</div>` : ""}
      </div>
      <div style="padding:10px 14px;flex:1">
        <div style="font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:#888;margin-bottom:6px">Pack Contents</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#e8edf5">
            <th style="padding:4px 6px;text-align:left;font-size:11px;color:#555">Product</th>
            <th style="padding:4px 6px;text-align:left;font-size:11px;color:#555">Variant</th>
            <th style="padding:4px 6px;text-align:center;font-size:11px;color:#555">Qty</th>
          </tr></thead>
          <tbody>${lines}</tbody>
        </table>
      </div>
      <div style="padding:10px 14px;border-top:1px solid #ddd;display:flex;justify-content:space-between;align-items:center">
        <div style="font-size:9px;color:#aaa">Packed by:</div>
        <div style="width:100px;border-bottom:1px solid #ccc;height:16px"></div>
        <div style="font-size:9px;color:#aaa">Date:</div>
        <div style="width:70px;border-bottom:1px solid #ccc;height:16px"></div>
      </div>
    </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const [sendAckOpen, setSendAckOpen] = useState(false);

  const sendToProductionMutation = useMutation({
    mutationFn: async (itemIds: number[]) => {
      return apiFetch("/worksheets", {
        method: "POST",
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.orderNumber,
          customerId: order.customerId,
          customerName: order.customerName,
          notes: productionNotes || null,
          itemIds,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pack-status", orderId] });
      queryClient.invalidateQueries({ queryKey: ["order-logs", orderId] });
      toast({ title: "Sent to Production", description: "Worksheet created in Pre-Production." });
      setIsSendToProductionOpen(false);
      setProductionNotes("");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const confirmPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/confirm`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order confirmed", description: "Order moved to draft — ready to process." });
      navigate("/orders");
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/reject`, { method: "POST", body: JSON.stringify({ reason: "" }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order rejected", description: "Order has been cancelled." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unconfirmPortalOrderMutation = useMutation({
    mutationFn: () => apiFetch(`/portal/admin/orders/${order.id}/unconfirm`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey({ id: order.id }) });
      queryClient.invalidateQueries({ queryKey: ["portal-pending-orders"] });
      toast({ title: "Order unconfirmed", description: "Order returned to portal pending — ready to review again." });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: productAttributes } = useProductAttributes(item.productId);
  const { data: productVariants } = useProductVariants(item.productId);

  const colours = [...new Set((productAttributes ?? []).filter(a => a.type === "colour").map(a => a.value))];
  const sizes = sortSizesWithOrder([...new Set((productAttributes ?? []).filter(a => a.type === "size").map(a => a.value))], sizeOrder);

  useEffect(() => {
    // Skip variant price lookup for wardrobe items — they use the customer's special/wardrobe price
    if (item.fromWardrobe) return;
    if (item.productId && productVariants) {
      const match = productVariants.find(v => v.colour === item.colour && v.size === item.size);
      if (match?.price != null) {
        const base = match.price!.toString();
        const total = (match.price! + item.finishCost).toString();
        setItem(i => ({ ...i, baseUnitPrice: base, unitPrice: total }));
      }
    }
  }, [item.colour, item.size, item.productId, item.fromWardrobe, productVariants]);

  // Fetch last-ordered sizes from order history when an employee is selected
  useEffect(() => {
    if (!selectedEmployee || !customerId) {
      setLastOrderedSizes({ byProductId: {}, byProductName: {} });
      return;
    }
    apiFetch<{ byProductId: Record<string, any>; byProductName: Record<string, any> }>(
      `/customers/${customerId}/employees/${selectedEmployee.id}/last-sizes`
    ).then(setLastOrderedSizes).catch(() => {});
  }, [selectedEmployee?.id, customerId]);

  // Auto-suggest size when employee + product are both selected (order history takes priority over profile)
  useEffect(() => {
    if (!selectedEmployee || !item.productName || item.size) return;
    // 1. Check order history by product ID
    const byId = item.productId ? lastOrderedSizes.byProductId[item.productId] : null;
    if (byId?.size) { setItem(i => ({ ...i, size: byId.size })); return; }
    // 2. Check order history by product name
    const byName = lastOrderedSizes.byProductName[item.productName];
    if (byName?.size) { setItem(i => ({ ...i, size: byName.size })); return; }
    // 3. Fall back to manually saved profile sizes
    const savedSize = selectedEmployee.sizes?.find(s => s.label === item.productName);
    if (savedSize) setItem(i => ({ ...i, size: savedSize.size }));
  }, [selectedEmployee?.id, item.productName, item.productId, lastOrderedSizes]);

  // Auto-update unit price when total quantity changes for products with price breaks
  useEffect(() => {
    if (item.fromWardrobe || !item.productId) return;
    const prod = products?.find(p => p.id === item.productId);
    if (!prod) return;
    const priceBreaks = (prod as any).priceBreaks as { qty: number; price: number }[] | null;
    if (!priceBreaks || priceBreaks.length === 0) return;
    const totalQty = sizes.length > 0
      ? sizeRows.reduce((s, r) => s + (r.qty || 0), 0)
      : item.quantity;
    const tierPrice = getBreakPrice(priceBreaks, totalQty);
    const newPrice = tierPrice !== null ? tierPrice.toFixed(2) : prod.unitPrice.toString();
    setItem(i => ({ ...i, unitPrice: newPrice, baseUnitPrice: newPrice }));
  }, [sizeRows, item.quantity, item.productId, item.fromWardrobe, products]);

  const handleProductSelect = (productId: number) => {
    const prod = products?.find(p => p.id === productId);
    if (!prod) return;
    const priceBreaks = (prod as any).priceBreaks as { qty: number; price: number }[] | null;
    const initialPrice = (priceBreaks && priceBreaks.length > 0)
      ? (getBreakPrice(priceBreaks, 1) ?? prod.unitPrice).toString()
      : prod.unitPrice.toString();
    const prodVatRate = typeof (prod as any).vatRate === "number" ? (prod as any).vatRate : parseFloat(String((prod as any).vatRate ?? 0.20));
    setItem({ ...EMPTY_ITEM, productId: prod.id, productName: prod.name, unitPrice: initialPrice, baseUnitPrice: initialPrice, vatRate: isNaN(prodVatRate) ? 0.20 : prodVatRate });
    setSizeRows([{ size: "", qty: 1 }]);
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
    if (value === "__new__") {
      setSelectedEmployee(null);
      setIsNewPerson(true);
      setItem(i => ({ ...i, recipientName: "" }));
    } else {
      const emp = customerEmployees?.find(e => e.id.toString() === value);
      if (emp) {
        const name = [emp.firstName, emp.lastName].filter(Boolean).join(" ");
        setSelectedEmployee(emp);
        setIsNewPerson(false);
        setItem(i => ({ ...i, recipientName: name, recipientEmployeeId: emp.id }));
      }
    }
  };

  const resetDialog = () => {
    setItem({ ...EMPTY_ITEM });
    setSizeRows([{ size: "", qty: 1 }]);
    setSelectedEmployee(null);
    setIsNewPerson(false);
    setIsAddItemOpen(false);
    setDialogTab("wardrobe");
    setWardrobeRecipient(null);
    setWardrobeItemSizes({});
    setWardrobeItemQtys({});
  };

  // Select a person (or stock) in the wardrobe tab — fetches last sizes and pre-fills
  const handleWardrobePersonSelect = async (recipient: "stock" | CustomerEmployee) => {
    setWardrobeRecipient(recipient);
    setWardrobeItemSizes({});
    setWardrobeItemQtys({});
    if (recipient === "stock" || !customerId || typeof recipient === "string") return;
    try {
      const lastSizes = await apiFetch<{
        byProductId: Record<string, { size: string; colour: string | null }>;
        byProductName: Record<string, { size: string; colour: string | null }>;
      }>(`/customers/${customerId}/employees/${recipient.id}/last-sizes`);

      const newSizes: Record<number, string> = {};
      for (const fi of (customerFinishedItems ?? [])) {
        const byId = fi.productId ? lastSizes.byProductId[String(fi.productId)]?.size : null;
        const byName = lastSizes.byProductName[fi.productName ?? fi.name]?.size;
        const saved = recipient.sizes?.find(s => s.label === (fi.productName ?? fi.name))?.size;
        const pre = byId ?? byName ?? saved ?? fi.size ?? "";
        if (pre) newSizes[fi.id] = pre;
      }
      setWardrobeItemSizes(newSizes);
    } catch { /* size pre-fill is best-effort */ }
  };

  // Add a single wardrobe item directly (without closing the dialog so staff can add more)
  const handleWardrobeItemAdd = (fi: CustomerFinishedItem) => {
    const size = wardrobeItemSizes[fi.id] ?? "";
    const qty = wardrobeItemQtys[fi.id] ?? 1;
    const effectivePrice = fi.specialPrice ?? fi.unitPrice;
    const isPersonRecipient = wardrobeRecipient !== null && wardrobeRecipient !== "stock";
    const recipientName = isPersonRecipient
      ? [(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")
      : "";
    const recipientEmployeeId = isPersonRecipient ? (wardrobeRecipient as CustomerEmployee).id : null;

    addItemMutation.mutate(
      {
        id: orderId,
        data: {
          productId: fi.productId,
          productName: fi.productName ?? fi.name,
          colour: fi.colour ?? null,
          size: size || null,
          finishId: fi.finishId ?? null,
          finishName: fi.finishName ?? null,
          recipientType: isPersonRecipient ? "person" : "stock",
          recipientName: isPersonRecipient ? recipientName : null,
          recipientEmployeeId: isPersonRecipient ? recipientEmployeeId : null,
          quantity: qty,
          unitPrice: effectivePrice,
        } as Parameters<typeof addItemMutation.mutate>[0]["data"],
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          toast({ title: "Item Added", description: `${fi.productName ?? fi.name} added to the order.` });
          // Reset qty for this item only; keep size so same person's next line is fast
          setWardrobeItemQtys(s => { const n = { ...s }; delete n[fi.id]; return n; });
        },
        onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleWardrobeSelect = (fi: CustomerFinishedItem) => {
    const effectivePrice = fi.specialPrice ?? fi.unitPrice;
    setPriceOverrideEnabled(false);
    setItem({
      ...EMPTY_ITEM,
      productId: fi.productId,
      productName: fi.productName ?? fi.name,
      colour: fi.colour ?? "",
      size: fi.size ?? "",
      finishId: fi.finishId ?? null,
      finishName: fi.finishName ?? null,
      finishCost: 0,
      unitPrice: effectivePrice.toString(),
      baseUnitPrice: effectivePrice.toString(),
      fromWardrobe: true,
    });
  };

  const doAddItem = (overrides: Record<string, unknown> = {}) => {
    if (!item.productId || !item.productName) return;
    const price = parseFloat(item.unitPrice);
    if (isNaN(price)) return;
    const addedQty = (overrides.quantity as number) ?? item.quantity;

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
          recipientEmployeeId: item.recipientType === "person" ? (item.recipientEmployeeId ?? null) : null,
          quantity: item.quantity,
          unitPrice: price,
          vatRate: item.vatRate,
          ...overrides,
        } as Parameters<typeof addItemMutation.mutate>[0]["data"]
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          refetchEmployees();
          toast({ title: "Item Added", description: `${item.productName} added to order.` });

          // Price-break suggestion
          const prod = products?.find(p => p.id === item.productId);
          const breaks: { qty: number; price: number }[] = Array.isArray((prod as any)?.priceBreaks)
            ? (prod as any).priceBreaks : [];
          if (breaks.length > 0) {
            const existingQty = (order?.items ?? [])
              .filter((oi: any) => oi.productId === item.productId)
              .reduce((s: number, oi: any) => s + (Number(oi.quantity) || 0), 0);
            const totalQty = existingQty + addedQty;
            const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
            if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
          }

          resetDialog();
        },
        onError: (err) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleAddItem = async () => {
    if (!item.productId || !item.productName) return;
    const price = parseFloat(item.unitPrice);
    if (isNaN(price)) return;

    // Custom-tab validations only (wardrobe tab sets colour/size on selection)
    if (dialogTab === "custom") {
      if (colours.length > 0 && !item.colour) {
        toast({ title: "Colour required", description: "Please select a colour before adding to the order.", variant: "destructive" });
        return;
      }
      if (sizes.length > 0) {
        const missingSizes = sizeRows.some(r => !r.size);
        if (missingSizes) {
          toast({ title: "Size required", description: "Please select a size for every row before adding.", variant: "destructive" });
          return;
        }
      }
    }

    // ── Multi-size: add one line per row, no individual stock checks ──
    if (dialogTab === "custom" && sizes.length > 0 && sizeRows.length > 1) {
      setIsAddingMulti(true);
      try {
        for (const row of sizeRows) {
          await apiFetch(`/orders/${orderId}/items`, {
            method: "POST",
            body: JSON.stringify({
              productId: item.productId,
              productName: item.productName,
              colour: item.colour || null,
              size: row.size || null,
              finishId: item.finishId ?? null,
              finishName: item.finishName ?? null,
              recipientType: item.recipientType,
              recipientName: item.recipientType === "person" ? (item.recipientName || null) : null,
              recipientEmployeeId: item.recipientType === "person" ? (item.recipientEmployeeId ?? null) : null,
              quantity: row.qty,
              unitPrice: price,
            }),
          });
        }
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
        refetchEmployees();
        toast({ title: "Items Added", description: `${sizeRows.length} size lines added to order.` });

        // Price-break suggestion for multi-size
        const prod = products?.find(p => p.id === item.productId);
        const breaks: { qty: number; price: number }[] = Array.isArray((prod as any)?.priceBreaks)
          ? (prod as any).priceBreaks : [];
        if (breaks.length > 0) {
          const existingQty = (order?.items ?? [])
            .filter((oi: any) => oi.productId === item.productId)
            .reduce((s: number, oi: any) => s + (Number(oi.quantity) || 0), 0);
          const addedQty = sizeRows.reduce((s, r) => s + (r.qty || 0), 0);
          const totalQty = existingQty + addedQty;
          const suggestion = getPriceBreakSuggestion(item.productName, totalQty, existingQty, breaks, price);
          if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 500);
        }

        resetDialog();
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      } finally {
        setIsAddingMulti(false);
      }
      return;
    }

    // ── Single item: add directly (stock is allocated at confirmation) ──
    // Wardrobe tab: size/qty already set on item. Custom tab: use sizeRows[0].
    const useRowSize = dialogTab === "custom" && sizes.length > 0;
    const singleSize = useRowSize ? (sizeRows[0]?.size || null) : (item.size || null);
    const singleQty = useRowSize ? (sizeRows[0]?.qty ?? item.quantity) : item.quantity;
    doAddItem({ size: singleSize, quantity: singleQty });
  };

  const handleDeleteItem = (itemId: number) => {
    if (!confirm("Remove this item from the order?")) return;
    deleteItemMutation.mutate(
      { id: orderId, itemId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Item removed" });
        }
      }
    );
  };

  const postToXeroMutation = useMutation({
    mutationFn: () => apiFetch<{ xeroInvoiceId: string; xeroInvoiceStatus: string }>(`/xero/invoices/${orderId}`, { method: "POST" }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Invoice posted to Xero", description: `Invoice ${res.xeroInvoiceId} created as ${res.xeroInvoiceStatus}.` });
    },
    onError: (e: Error) => toast({ title: "Xero error", description: e.message, variant: "destructive" }),
  });

  const saveInvoiceDateMutation = useMutation({
    mutationFn: (dateStr: string) => apiFetch(`/invoices/${orderId}/invoice-date`, { method: "PATCH", body: JSON.stringify({ invoiceDate: dateStr }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
      toast({ title: "Invoice date updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleStatusChange = (newStatus: UpdateOrderBodyStatus) => {
    updateOrderMutation.mutate(
      { id: orderId, data: { status: newStatus } },
      {
        onSuccess: (data: any) => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
          queryClient.invalidateQueries({ queryKey: ["order-logs", orderId] });
          if (newStatus === "confirmed" && data?.allocation) {
            const { allocated, purchaseRequired } = data.allocation;
            const parts: string[] = [];
            if (allocated > 0) parts.push(`${allocated} line${allocated !== 1 ? "s" : ""} allocated from stock`);
            if (purchaseRequired > 0) parts.push(`${purchaseRequired} line${purchaseRequired !== 1 ? "s" : ""} flagged for purchasing`);
            toast({ title: "Order Confirmed", description: parts.length ? parts.join(" · ") : "Order confirmed." });
          } else {
            toast({ title: "Status Updated", description: `Order is now ${newStatus}` });
          }
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
              <PoNumberInline orderId={orderId} current={(order as any).poNumber ?? null} />
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setSendAckOpen(true)}
              title="Send order acknowledgement email to customer"
            >
              <Mail className="w-4 h-4" />
              Send Ack
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setDeleteOrderConfirmOpen(true)}
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </Button>
            {/* Xero badge — shown in header only when already posted */}
            {(order as any).xeroInvoiceId && (
              <Badge variant="outline" className="gap-1.5 text-indigo-700 border-indigo-300 bg-indigo-50">
                <BookOpen className="w-3.5 h-3.5" />
                Xero: {(order as any).xeroInvoiceStatus ?? "DRAFT"}
              </Badge>
            )}
            <Select value={order.status} onValueChange={(val) => {
              if (val === "confirmed" && order.status !== "confirmed") {
                setConfirmDialogOpen(true);
              } else {
                handleStatusChange(val as UpdateOrderBodyStatus);
              }
            }}>
              <SelectTrigger className="w-[160px] bg-background">
                <SelectValue placeholder="Update Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="quote">Quote</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Portal order awaiting confirmation banner */}
        {order.status === "portal_pending" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <Globe className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-900 text-sm">Portal order awaiting confirmation</p>
                <p className="text-amber-700 text-xs mt-0.5">
                  This order was submitted via the customer portal. Review the items, then confirm or reject it below.
                </p>
                {(order as any).portalNotes && (
                  <p className="text-amber-800 text-xs mt-1.5 italic">Customer note: "{(order as any).portalNotes}"</p>
                )}
                {Array.isArray((order as any).attachments) && (order as any).attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(order as any).attachments.map((att: { name: string; objectPath: string }, i: number) => (
                      <a
                        key={i}
                        href={`${API_BASE}/storage${att.objectPath}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-50 transition-colors"
                      >
                        <Download className="w-3 h-3 shrink-0" />
                        {att.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                disabled={rejectPortalOrderMutation.isPending || confirmPortalOrderMutation.isPending}
                onClick={() => rejectPortalOrderMutation.mutate()}
              >
                {rejectPortalOrderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />}
                Reject
              </Button>
              <Button
                size="sm"
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                disabled={confirmPortalOrderMutation.isPending || rejectPortalOrderMutation.isPending}
                onClick={() => confirmPortalOrderMutation.mutate()}
              >
                {confirmPortalOrderMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Confirm Order
              </Button>
            </div>
          </div>
        )}

        {/* ── Unconfirm banner (confirmed portal orders not yet in production) */}
        {(order as any).source === "portal" && order.status === "confirmed" && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/60 px-5 py-3.5 flex items-center gap-3">
            <RotateCcw className="w-4 h-4 text-blue-500 shrink-0" />
            <p className="text-sm text-blue-800 flex-1">
              This order was confirmed from the customer portal.
              If you confirmed it by mistake, you can send it back for review.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 shrink-0"
                  disabled={unconfirmPortalOrderMutation.isPending}
                >
                  {unconfirmPortalOrderMutation.isPending
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <RotateCcw className="w-3.5 h-3.5" />}
                  Unconfirm
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Unconfirm this order?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will move the order back to "Portal Pending", restore any stock that was allocated,
                    and remove the auto-generated worksheet (if it hasn't been started).
                    The customer will not be notified.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => unconfirmPortalOrderMutation.mutate()}>
                    Yes, unconfirm
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {/* ── Order Lifecycle Progress ───────────────────────────────────── */}
        {(() => {
          const hasWorksheet = packStatus?.recipients.some(r => r.items.some(i => i.worksheetNumber));
          const isConfirmed = order.status !== "draft" && order.status !== "portal_pending";
          const isCancelled = order.status === "cancelled";
          const isDispatched = !!(order as any).dispatchedAt;
          const isInvoiced = !!(order as any).invoiceEmailSentAt;

          const steps: Array<{ label: string; sublabel?: string; done: boolean; active: boolean; icon: string }> = [
            { label: "Order Created", sublabel: formatDate(order.orderDate), done: true, active: false, icon: "created" },
            { label: isCancelled ? "Cancelled" : "Confirmed", sublabel: isCancelled ? "" : (isConfirmed ? "" : "Awaiting confirmation"), done: isConfirmed || isCancelled, active: !isConfirmed && !isCancelled, icon: "confirmed" },
            { label: "In Production", sublabel: hasWorksheet ? "Worksheet created" : "Pending", done: !!hasWorksheet, active: isConfirmed && !hasWorksheet && !isCancelled, icon: "production" },
            { label: "Dispatched", sublabel: isDispatched ? formatDate((order as any).dispatchedAt) : "Pending", done: isDispatched, active: !!hasWorksheet && !isDispatched && !isCancelled, icon: "dispatched" },
            { label: "Invoice Sent", sublabel: isInvoiced ? formatDate((order as any).invoiceEmailSentAt) : "Pending", done: isInvoiced, active: isDispatched && !isInvoiced && !isCancelled, icon: "invoiced" },
          ];

          return (
            <div className="rounded-xl border border-border/50 bg-card shadow-sm px-5 py-4">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Order Progress</span>
              </div>
              <div className="relative flex items-start justify-between gap-0">
                {steps.map((step, idx) => (
                  <div key={idx} className="flex flex-col items-center flex-1 relative">
                    {idx < steps.length - 1 && (
                      <div className={`absolute top-4 left-[50%] w-full h-0.5 -z-0 ${steps[idx + 1].done || (step.done) ? "bg-green-400" : "bg-border"}`} style={{ left: "50%", width: "100%" }} />
                    )}
                    <div className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all ${
                      isCancelled && idx === 1 ? "border-red-400 bg-red-50 text-red-600"
                      : step.done ? "border-green-500 bg-green-500 text-white"
                      : step.active ? "border-primary bg-primary/10 text-primary animate-pulse"
                      : "border-border bg-muted text-muted-foreground"
                    }`}>
                      {isCancelled && idx === 1 ? <XCircle className="w-4 h-4" /> : step.done ? <Check className="w-4 h-4" /> : <span>{idx + 1}</span>}
                    </div>
                    <div className="mt-2 text-center px-1">
                      <div className={`text-xs font-semibold ${isCancelled && idx === 1 ? "text-red-600" : step.done ? "text-green-700" : step.active ? "text-primary" : "text-muted-foreground"}`}>{step.label}</div>
                      {step.sublabel && <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{step.sublabel}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 shadow-sm border-border/50 flex flex-col overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10 gap-3 flex-wrap">
              <div className="min-w-0">
                <CardTitle className="font-display">
                  Line Items
                  {lineFilter.trim() && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({filteredItems.length} of {(order.items ?? []).length})
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Products included in this order</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter by name or recipient…"
                    value={lineFilter}
                    onChange={e => setLineFilter(e.target.value)}
                    className="pl-8 pr-3 py-1 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring w-52"
                  />
                </div>
                {order.status !== "portal_pending" && order.items && order.items.filter((oi: { purchaseRequired?: boolean }) => !oi.purchaseRequired).length > 0 && (
                  <Button size="sm" variant="outline" className="gap-1.5 border-green-400 text-green-700 hover:bg-green-50" onClick={() => setIsSendToProductionOpen(true)}>
                    <ClipboardList className="w-4 h-4" />
                    Send to Production ({order.items.filter((oi: { purchaseRequired?: boolean }) => !oi.purchaseRequired).length})
                  </Button>
                )}
                <Button size="sm" onClick={() => setIsAddItemOpen(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Item
                </Button>
              </div>
            </CardHeader>
            {orderBackorders.length > 0 && (
              <div className="mx-6 mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-800 font-semibold text-sm">
                  <TriangleAlert className="w-4 h-4 flex-shrink-0" />
                  Part-shipped — {orderBackorders.length} item{orderBackorders.length !== 1 ? "s" : ""} on backorder
                </div>
                <p className="text-xs text-amber-700">This order will be part-shipped. The following items are awaiting stock and will be dispatched separately — the customer should be notified.</p>
                <div className="space-y-1.5">
                  {orderBackorders.map((b) => (
                    <div key={b.id} className="flex items-center justify-between gap-3 text-xs bg-white/70 rounded px-3 py-1.5 border border-amber-200">
                      <span className="font-medium text-foreground">
                        {b.supplierCode && <span className="font-mono text-primary mr-1.5">{b.supplierCode}</span>}
                        {b.productName}
                        {(b.colour || b.size) && <span className="text-muted-foreground ml-1.5">{[b.colour, b.size].filter(Boolean).join(" / ")}</span>}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0 text-amber-700">
                        <span className="font-semibold">{b.remaining} pending</span>
                        {b.estimatedDueDate && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(b.estimatedDueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                        <span className="text-muted-foreground">via {b.poNumber}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <CardContent className="p-0 flex-1">
              {order.items && order.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(["product", "finish", "recipient"] as const).map(col => (
                          <TableHead key={col}>
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none capitalize"
                              onClick={() => toggleSort(col)}
                            >
                              {col}
                              <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
                                {lineSort?.col === col ? (lineSort.dir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </button>
                          </TableHead>
                        ))}
                        {(["price", "qty", "total"] as const).map((col, i) => (
                          <TableHead key={col} className={i === 1 ? "text-center" : "text-right"}>
                            <button
                              className="inline-flex items-center gap-1 hover:text-foreground transition-colors select-none capitalize ml-auto"
                              onClick={() => toggleSort(col)}
                            >
                              {col}
                              <span className="text-muted-foreground/60 text-[10px] w-3 text-center">
                                {lineSort?.col === col ? (lineSort.dir === "asc" ? "↑" : "↓") : "↕"}
                              </span>
                            </button>
                          </TableHead>
                        ))}
                        <TableHead className="w-[72px] text-right text-muted-foreground font-normal text-xs">GP%</TableHead>
                        <TableHead className="w-[90px] text-right text-muted-foreground font-normal text-xs">VAT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((orderItem) => (
                        <TableRow key={orderItem.id}>
                          <TableCell>
                            <p className="font-medium text-foreground">
                              {orderItem.productName}
                              {(orderItem as { productSku?: string | null }).productSku && (
                                <span className="ml-1.5 text-xs font-mono text-muted-foreground font-normal">
                                  {(orderItem as { productSku?: string | null }).productSku}
                                </span>
                              )}
                            </p>
                            <div className="flex flex-wrap gap-1 mt-1 group/badges">
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
                              {(orderItem.colour || orderItem.size) && (
                                <button
                                  className="opacity-0 group-hover/badges:opacity-100 transition-opacity inline-flex items-center px-1 py-0.5 rounded text-xs text-muted-foreground hover:text-primary hover:bg-muted"
                                  title="Edit size / colour"
                                  onClick={() => setEditingSizeColour({ itemId: orderItem.id, size: orderItem.size ?? "", colour: orderItem.colour ?? "" })}
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              )}
                              {(orderItem as { purchaseRequired?: boolean }).purchaseRequired && (
                                <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-300 gap-1 font-normal">
                                  <ShoppingBag className="w-3 h-3" />
                                  Purchase × {(orderItem as { purchaseQuantity?: number }).purchaseQuantity ?? 0}
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
                          <TableCell className="text-right tabular-nums">
                            {editingItemPrice?.id === orderItem.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-muted-foreground text-xs">£</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={editingItemPrice.value}
                                  onChange={e => setEditingItemPrice(p => p && ({ ...p, value: e.target.value }))}
                                  onKeyDown={e => {
                                    if (e.key === "Enter") {
                                      const v = parseFloat(editingItemPrice.value);
                                      if (!isNaN(v) && v >= 0) updateItemPriceMutation.mutate({ itemId: orderItem.id, unitPrice: v });
                                    }
                                    if (e.key === "Escape") setEditingItemPrice(null);
                                  }}
                                  className="h-7 w-24 text-right text-sm px-2"
                                  autoFocus
                                />
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-green-600 hover:bg-green-50"
                                  disabled={updateItemPriceMutation.isPending}
                                  onClick={() => {
                                    const v = parseFloat(editingItemPrice.value);
                                    if (!isNaN(v) && v >= 0) updateItemPriceMutation.mutate({ itemId: orderItem.id, unitPrice: v });
                                  }}
                                >
                                  {updateItemPriceMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6 text-muted-foreground hover:bg-muted"
                                  onClick={() => setEditingItemPrice(null)}
                                >
                                  <XCircle className="w-3 h-3" />
                                </Button>
                              </div>
                            ) : (
                              <button
                                className="group inline-flex items-center gap-1.5 hover:text-primary transition-colors"
                                onClick={() => setEditingItemPrice({ id: orderItem.id, value: String(orderItem.unitPrice) })}
                                title="Click to override price"
                              >
                                {formatCurrency(orderItem.unitPrice)}
                                <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                              </button>
                            )}
                          </TableCell>
                          <TableCell className="text-center font-semibold">{orderItem.quantity}</TableCell>
                          <TableCell className="text-right font-bold text-primary tabular-nums">{formatCurrency(orderItem.lineTotal)}</TableCell>
                          <TableCell className="text-right">
                            {(() => {
                              const item = orderItem as any;
                              const garmentCost: number | null = item.garmentCost ?? null;
                              const processCost: number = item.processCost ?? 0;
                              if (garmentCost == null) return <span className="text-xs text-muted-foreground/40">—</span>;
                              const totalCost = garmentCost + processCost;
                              const lineTotal = parseFloat(String(orderItem.lineTotal)) || 0;
                              if (lineTotal <= 0) return <span className="text-xs text-muted-foreground/40">—</span>;
                              const gp = ((lineTotal - totalCost) / lineTotal) * 100;
                              const color = gp >= 70 ? "text-green-700 bg-green-50 border-green-200"
                                          : gp >= 30 ? "text-amber-700 bg-amber-50 border-amber-200"
                                          : "text-red-700 bg-red-50 border-red-200";
                              return (
                                <span className={`inline-block text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded border ${color}`}
                                  title={`Garment: ${formatCurrency(garmentCost)}${processCost > 0 ? ` · Process: ${formatCurrency(processCost)}` : ""} · Total cost: ${formatCurrency(totalCost)}`}>
                                  {gp.toFixed(1)}%
                                </span>
                              );
                            })()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(() => {
                                const vr = (orderItem as any).vatRate ?? 0.20;
                                const pct = Math.round(vr * 100);
                                return (
                                  <select
                                    value={String(vr)}
                                    onChange={e => updateItemVatRateMutation.mutate({ itemId: orderItem.id, vatRate: parseFloat(e.target.value) })}
                                    className="text-xs rounded px-1 py-0.5 border border-border/50 bg-transparent text-muted-foreground hover:text-foreground cursor-pointer focus:outline-none"
                                    title="VAT rate"
                                  >
                                    <option value="0.2">20% VAT</option>
                                    <option value="0.05">5% VAT</option>
                                    <option value="0">0% VAT</option>
                                  </select>
                                );
                              })()}
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => handleDeleteItem(orderItem.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
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
              <div className="p-4 bg-muted/20 border-t border-border/40 flex justify-end items-center gap-4 flex-wrap">
                {lineFilter.trim() && filteredItems.length !== order.items.length && (
                  <span className="text-sm text-muted-foreground">
                    Filtered: <span className="font-semibold text-foreground">{formatCurrency(filteredItems.reduce((s, oi) => s + (parseFloat(String(oi.lineTotal)) || 0), 0))}</span>
                  </span>
                )}
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
                  <Paperclip className="w-4 h-4 mr-2 text-muted-foreground" /> Attachments
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4 space-y-2">
                {currentAttachments.length > 0 && (
                  <ul className="space-y-1.5">
                    {currentAttachments.map((att, i) => (
                      <li key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                        <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <a
                          href={`${API_BASE}/storage${att.objectPath}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm flex-1 min-w-0 truncate hover:underline text-foreground"
                        >
                          {att.name}
                        </a>
                        <a
                          href={`${API_BASE}/storage${att.objectPath}`}
                          download={att.name}
                          className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          aria-label="Download"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => removeAttachment(i)}
                          disabled={updateAttachmentsMutation.isPending}
                          className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          aria-label="Remove attachment"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <FileDropZone
                  onFile={(file) => uploadFiles([file])}
                  disabled={uploading || updateAttachmentsMutation.isPending}
                  className="py-5 px-4"
                >
                  <FileDropZoneContent
                    uploading={uploading}
                    label="Drag a file here, or click to browse"
                  />
                </FileDropZone>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <Calendar className="w-4 h-4 mr-2 text-muted-foreground" /> Required Date
                  </CardTitle>
                  {!editingRequiredDate && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      const defaultDate = order.requiredDate
                        ? new Date(order.requiredDate).toISOString().split("T")[0]
                        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
                      setRequiredDateValue(defaultDate);
                      setEditingRequiredDate(true);
                    }}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4">
                {editingRequiredDate ? (
                  <div className="space-y-2">
                    <Input
                      type="date"
                      value={requiredDateValue}
                      onChange={(e) => setRequiredDateValue(e.target.value)}
                      className="text-sm"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => updateRequiredDateMutation.mutate(requiredDateValue || null)} disabled={updateRequiredDateMutation.isPending}>Save</Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingRequiredDate(false)}>Cancel</Button>
                    </div>
                    {(order as { requiredDate?: string | null }).requiredDate && (
                      <Button size="sm" variant="ghost" className="w-full h-7 text-xs text-muted-foreground" onClick={() => updateRequiredDateMutation.mutate(null)}>Clear date</Button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm">
                    {(order as { requiredDate?: string | null }).requiredDate ? (
                      <span className="font-medium">{formatDate((order as { requiredDate: string }).requiredDate)}</span>
                    ) : (
                      <span className="text-muted-foreground italic">Not set</span>
                    )}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <Truck className="w-4 h-4 mr-2 text-muted-foreground" /> Shipping
                  </CardTitle>
                  {!editingShippingMethod && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingShippingMethod(true)}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {/* Shipping method */}
                {editingShippingMethod ? (
                  <div className="space-y-2">
                    <Select
                      value={(order as any).shippingMethod ?? ""}
                      onValueChange={(v) => updateShippingMethodMutation.mutate(v || null)}
                    >
                      <SelectTrigger className="text-sm"><SelectValue placeholder="Select method…" /></SelectTrigger>
                      <SelectContent>
                        {SHIPPING_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingShippingMethod(false)}>Cancel</Button>
                      {(order as any).shippingMethod && (
                        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs text-muted-foreground" onClick={() => updateShippingMethodMutation.mutate(null)}>Clear</Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm">
                    {(order as any).shippingMethod
                      ? <span className="font-medium">{SHIPPING_OPTIONS.find(o => o.value === (order as any).shippingMethod)?.label ?? (order as any).shippingMethod}</span>
                      : <span className="text-muted-foreground italic">Not set</span>
                    }
                  </p>
                )}

                {/* Carriage amount */}
                <div className="border-t pt-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Carriage (exc. VAT)</p>
                    {!editingCarriage && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setCarriageInput(parseFloat((order as any).carriageAmount ?? "0").toFixed(2)); setEditingCarriage(true); }}>
                        <Pencil className="w-3 h-3 text-muted-foreground" />
                      </Button>
                    )}
                  </div>
                  {editingCarriage ? (
                    <form
                      className="flex items-center gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const v = parseFloat(carriageInput);
                        if (!isNaN(v) && v >= 0) updateCarriageMutation.mutate(v);
                      }}
                    >
                      <div className="relative flex-1">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={carriageInput}
                          onChange={(e) => setCarriageInput(e.target.value)}
                          className="w-full h-8 pl-6 pr-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                      </div>
                      <Button type="submit" size="icon" className="h-8 w-8" disabled={updateCarriageMutation.isPending}>
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingCarriage(false)}>
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </form>
                  ) : (
                    <p className="text-sm font-medium">
                      £{parseFloat((order as any).carriageAmount ?? "0").toFixed(2)}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <CardTitle className="font-display text-lg flex items-center">
                  <MapPin className="w-4 h-4 mr-2 text-muted-foreground" /> Delivery Address
                </CardTitle>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {(customerDeliveryAddresses?.length ?? 0) > 0 ? (
                  <Select
                    value={(order as any).deliveryAddressId?.toString() ?? "none"}
                    onValueChange={(v) => updateDeliveryAddressMutation.mutate(v === "none" ? null : parseInt(v, 10))}
                  >
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Select address…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {customerDeliveryAddresses?.map(a => (
                        <SelectItem key={a.id} value={a.id.toString()}>
                          {a.label ? `${a.label} — ` : ""}{[a.line1, a.city, a.postcode].filter(Boolean).join(", ")}
                          {a.isDefault ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
                {(() => {
                  const addr = (order as any).deliveryAddress as DeliveryAddress | null | undefined;
                  const fallback = (order as any).customerMainAddress as { line1: string; city: string | null; postcode: string | null } | null | undefined;
                  if (!addr) {
                    if (fallback) {
                      return (
                        <div className="text-sm space-y-0.5 pt-1">
                          <p className="text-muted-foreground">{fallback.line1}</p>
                          <p className="text-muted-foreground">{[fallback.city, fallback.postcode].filter(Boolean).join(", ")}</p>
                          <p className="text-[11px] text-amber-600 mt-1">Using account address — add a delivery address to the customer profile to override</p>
                        </div>
                      );
                    }
                    return (customerDeliveryAddresses?.length ?? 0) === 0
                      ? <p className="text-sm text-muted-foreground italic">No addresses on file for this customer</p>
                      : null;
                  }
                  return (
                    <div className="text-sm space-y-0.5 pt-1">
                      {addr.label && <p className="font-medium text-foreground">{addr.label}</p>}
                      {addr.line1 && <p className="text-muted-foreground">{addr.line1}</p>}
                      {addr.line2 && <p className="text-muted-foreground">{addr.line2}</p>}
                      <p className="text-muted-foreground">{[addr.city, addr.county, addr.postcode].filter(Boolean).join(", ")}</p>
                      {addr.country && addr.country !== "United Kingdom" && <p className="text-muted-foreground">{addr.country}</p>}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            <AttentionOfCard
              orderId={orderId}
              current={
                (order as any).attentionOf ??
                (order.source === "portal" ? ((order as any).portalSubmittedByName ?? null) : null)
              }
            />

            {/* Invoicing card — show once dispatched/shipped */}
            {((order as any).xeroInvoiceId || order.status === "shipped" || order.status === "dispatched") && (() => {
              const rawInvoiceDate: string | null = (order as any).invoiceDate ?? null;
              const rawOrderDate: string | null = (order as any).orderDate ?? null;
              const invoiceDateValue = rawInvoiceDate
                ? new Date(rawInvoiceDate).toISOString().slice(0, 10)
                : new Date().toISOString().slice(0, 10);
              const crossMonth = rawOrderDate && rawInvoiceDate && (() => {
                const od = new Date(rawOrderDate);
                const id = new Date(rawInvoiceDate);
                return od.getMonth() !== id.getMonth() || od.getFullYear() !== id.getFullYear();
              })();
              return (
                <Card className="shadow-sm border-border/50">
                  <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                    <CardTitle className="font-display text-lg flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-500" /> Invoicing
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-4 space-y-3">
                    {/* Invoice date field */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice Date</label>
                      {crossMonth && (
                        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                          <span>Order placed in a different month — invoice date set to order date to keep records in the same period.</span>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="date"
                          defaultValue={invoiceDateValue}
                          key={invoiceDateValue}
                          className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onChange={(e) => {
                            if (e.target.value) saveInvoiceDateMutation.mutate(e.target.value);
                          }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">Used on the invoice email and Xero entry.</p>
                    </div>

                    {/* Xero status / action */}
                    {(order as any).xeroInvoiceId ? (
                      <div className="space-y-1 text-sm pt-1 border-t border-border/40">
                        <div className="flex items-center gap-2 pt-2">
                          <Badge variant="outline" className="gap-1.5 text-indigo-700 border-indigo-300 bg-indigo-50">
                            <BookOpen className="w-3 h-3" /> {(order as any).xeroInvoiceStatus ?? "DRAFT"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">Xero invoice ID: {(order as any).xeroInvoiceId}</p>
                      </div>
                    ) : (
                      <div className="pt-1 border-t border-border/40">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50 w-full mt-2"
                          onClick={() => postToXeroMutation.mutate()}
                          disabled={postToXeroMutation.isPending}
                        >
                          {postToXeroMutation.isPending
                            ? <><Loader2 className="w-4 h-4 animate-spin" />Posting…</>
                            : <><BookOpen className="w-4 h-4" />Post to Xero</>}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            <Card className="shadow-sm border-border/50">
              <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
                <div className="flex items-center justify-between">
                  <CardTitle className="font-display text-lg flex items-center">
                    <FileText className="w-4 h-4 mr-2 text-muted-foreground" /> Notes
                  </CardTitle>
                  {!editingNotes && (
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      setNotesValue(order.notes ?? "");
                      setEditingNotes(true);
                    }}>
                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="py-4 space-y-3">
                {(order as any).portalNotes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <p className="text-xs font-medium text-amber-700 mb-1">Customer note (via portal)</p>
                    <p className="text-sm text-amber-900 whitespace-pre-wrap">{(order as any).portalNotes}</p>
                  </div>
                )}
                {editingNotes ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full text-sm rounded-md border border-input bg-background px-3 py-2 min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-ring"
                      value={notesValue}
                      onChange={e => setNotesValue(e.target.value)}
                      placeholder="Add notes for this order…"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="flex-1 h-7 text-xs" onClick={() => updateNotesMutation.mutate(notesValue || null)} disabled={updateNotesMutation.isPending}>
                        {updateNotesMutation.isPending ? <><Loader2 className="w-3 h-3 animate-spin" /> Saving…</> : "Save"}
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs" onClick={() => setEditingNotes(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="text-sm cursor-pointer hover:bg-muted/40 transition-colors bg-muted/30 p-3 rounded-lg border border-border/50 min-h-[80px]"
                    onClick={() => { setNotesValue(order.notes ?? ""); setEditingNotes(true); }}
                  >
                    {order.notes
                      ? <span className="whitespace-pre-wrap">{order.notes}</span>
                      : <span className="text-muted-foreground italic">No notes for this order. Click to add.</span>
                    }
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        </div>

        {/* ── Internal Messages ─────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <CardTitle className="font-display flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              Internal Messages
            </CardTitle>
            <CardDescription>Staff notes and discussion about this job — not visible to the customer</CardDescription>
          </CardHeader>
          <CardContent className="py-5">
            <OrderMessages orderId={orderId} />
          </CardContent>
        </Card>

        {/* ── Email Log ────────────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="font-display text-lg">Order Acknowledgement</CardTitle>
                <CardDescription>
                  {emailLogs.length === 0
                    ? "No acknowledgement has been sent yet"
                    : `${emailLogs.length} email${emailLogs.length !== 1 ? "s" : ""} sent`}
                </CardDescription>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              onClick={() => setSendAckOpen(true)}
            >
              <Mail className="w-3.5 h-3.5" />
              {emailLogs.length === 0 ? "Send Acknowledgement" : "Resend"}
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {emailLogs.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                Use the button above to send the order acknowledgement to the customer.
              </p>
            ) : (
              <ul className="divide-y divide-border/40">
                {emailLogs.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${log.success ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
                      {log.success
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                        : <XCircle className="w-3.5 h-3.5 text-red-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{log.success ? "Sent" : "Failed"} to {log.toEmail}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.sentAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {log.subject && <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.subject}</p>}
                      <div className="flex items-center gap-3 mt-1">
                        {log.sentBy && log.sentBy !== "System" && (
                          <span className="text-xs text-muted-foreground/70">by {log.sentBy}</span>
                        )}
                        {!log.success && log.error && (
                          <span className="text-xs text-red-500">{log.error}</span>
                        )}
                        <a
                          href={`/api/orders/${orderId}/acknowledgement.eml`}
                          download
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                          title="Download as .eml to open in email client"
                        >
                          <Download className="w-3 h-3" /> Download .eml
                        </a>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Activity Log ─────────────────────────────────────────────────── */}
        <Card className="shadow-sm border-border/50">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/40 py-4 bg-muted/10">
            <div className="flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-primary" />
              <div>
                <CardTitle className="font-display text-lg">Activity Log</CardTitle>
                <CardDescription>Full history of actions on this order</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {actorEditing ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    className="text-sm border rounded px-2 py-1 w-36 outline-none focus:ring-1 focus:ring-primary/40"
                    placeholder="Your name"
                    value={actorDraft}
                    onChange={e => setActorDraft(e.target.value)}
                    onBlur={saveActorName}
                    onKeyDown={e => { if (e.key === "Enter") saveActorName(); if (e.key === "Escape") setActorEditing(false); }}
                  />
                  <Button size="sm" variant="ghost" onClick={saveActorName} className="h-7 px-2 text-xs">Save</Button>
                </div>
              ) : (
                <button
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setActorDraft(actorName); setActorEditing(true); }}
                  title="Set your name so actions are logged under your name"
                >
                  <User className="w-3.5 h-3.5" />
                  {actorName ? <><span className="font-medium text-foreground">{actorName}</span> <span className="opacity-60">(change)</span></> : <span className="italic">Set your name</span>}
                </button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => refetchLogs()} title="Refresh log">
                <ClipboardList className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {orderLogs.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground">
                <Clock className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm">No activity recorded yet</p>
                <p className="text-xs mt-1 opacity-60">Actions like confirming or dispatching will appear here</p>
              </div>
            ) : (
              <div className="relative">
                <div className="absolute left-[2.75rem] top-0 bottom-0 w-px bg-border/50" />
                <ul className="py-3 space-y-0">
                  {orderLogs.map((log, idx) => (
                    <li key={log.id} className={`relative flex gap-4 px-5 py-3 ${idx % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                        <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-foreground">{log.action}</span>
                          <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <User className="w-3 h-3 text-muted-foreground/60" />
                          <span className="text-xs text-muted-foreground">{log.actor === "System" ? <span className="italic">System</span> : <span className="font-medium">{log.actor}</span>}</span>
                        </div>
                        {log.details && <p className="text-xs text-muted-foreground/70 mt-1 leading-snug">{log.details}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isAddItemOpen} onOpenChange={(open) => { if (!open) resetDialog(); else setIsAddItemOpen(true); }}>
          <DialogContent className={cn("max-h-[90vh] flex flex-col overflow-hidden", dialogTab === "wardrobe" ? "max-w-2xl" : "max-w-lg")}>
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
                  /* No wardrobe configured */
                  <div className="py-10 text-center text-muted-foreground">
                    <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">No wardrobe items yet</p>
                    <p className="text-xs mt-1 text-muted-foreground/70">Go to this customer's Wardrobe tab to build their wardrobe.</p>
                  </div>
                ) : wardrobeRecipient === null ? (
                  /* ── Step 1: Pick a person ── */
                  <div className="space-y-3 pb-2">
                    <p className="text-sm text-muted-foreground">Who is this order for?</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <button
                        onClick={() => handleWardrobePersonSelect("stock")}
                        className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group"
                      >
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3 group-hover:bg-muted/70 transition-colors">
                          <Archive className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <p className="font-semibold text-sm">Bulk Stock</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">No specific recipient</p>
                      </button>
                      {customerEmployees?.map(emp => {
                        const initials = [emp.firstName?.[0], emp.lastName?.[0]].filter(Boolean).join("").toUpperCase();
                        return (
                          <button
                            key={emp.id}
                            onClick={() => handleWardrobePersonSelect(emp)}
                            className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group"
                          >
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm mb-3 group-hover:bg-primary/15 transition-colors">
                              {initials || <User className="w-4 h-4" />}
                            </div>
                            <p className="font-semibold text-sm leading-tight">{[emp.firstName, emp.lastName].filter(Boolean).join(" ")}</p>
                            {(emp.roleName || emp.jobTitle) && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.roleName ?? emp.jobTitle}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  /* ── Step 2: Items for the selected person ── */
                  <div className="space-y-2 pb-2">
                    {/* Header / breadcrumb */}
                    <div className="flex items-center gap-3 pb-1 border-b border-border/50">
                      <button
                        onClick={() => { setWardrobeRecipient(null); setWardrobeItemSizes({}); setWardrobeItemQtys({}); }}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                      </button>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {wardrobeRecipient === "stock" ? (
                          <>
                            <Archive className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium">Bulk Stock</span>
                          </>
                        ) : (
                          <>
                            <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium truncate">
                              {[(wardrobeRecipient as CustomerEmployee).firstName, (wardrobeRecipient as CustomerEmployee).lastName].filter(Boolean).join(" ")}
                            </span>
                            {(wardrobeRecipient as CustomerEmployee).roleName && (
                              <span className="text-xs text-muted-foreground shrink-0">{(wardrobeRecipient as CustomerEmployee).roleName}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Item rows */}
                    {customerFinishedItems
                      .filter(fi =>
                        wardrobeRecipient === "stock" ||
                        fi.roleId === null ||
                        fi.roleId === (wardrobeRecipient as CustomerEmployee).roleId
                      )
                      .map(fi => {
                        const effectivePrice = fi.specialPrice ?? fi.unitPrice;
                        const currentSize = wardrobeItemSizes[fi.id] ?? "";
                        const currentQty = wardrobeItemQtys[fi.id] ?? 1;
                        return (
                          <div key={fi.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm leading-tight">{fi.name}</p>
                                {fi.roleName && (
                                  <span className="text-[10px] font-medium text-primary/70 bg-primary/10 rounded px-1 shrink-0">{fi.roleName}</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                {fi.productName}
                                {fi.colour && <span> · {fi.colour}</span>}
                                {fi.finishName && <span> · <Sparkles className="w-2.5 h-2.5 inline text-amber-500" /> {fi.finishName}</span>}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {/* Size input */}
                              <Input
                                placeholder="Size"
                                value={currentSize}
                                onChange={e => setWardrobeItemSizes(s => ({ ...s, [fi.id]: e.target.value }))}
                                className="w-20 text-center text-sm h-8 px-2"
                              />
                              {/* Qty stepper */}
                              <div className="flex items-center gap-0.5">
                                <button
                                  onClick={() => setWardrobeItemQtys(s => ({ ...s, [fi.id]: Math.max(1, (s[fi.id] ?? 1) - 1) }))}
                                  className="w-7 h-7 rounded border flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="w-7 text-center text-sm font-medium tabular-nums">{currentQty}</span>
                                <button
                                  onClick={() => setWardrobeItemQtys(s => ({ ...s, [fi.id]: (s[fi.id] ?? 1) + 1 }))}
                                  className="w-7 h-7 rounded border flex items-center justify-center hover:bg-muted transition-colors text-muted-foreground"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                              {/* Price */}
                              <span className="text-xs font-semibold tabular-nums text-muted-foreground w-14 text-right hidden sm:block">
                                {formatCurrency(effectivePrice * currentQty)}
                              </span>
                              {/* Add button */}
                              <Button
                                size="sm"
                                disabled={addItemMutation.isPending}
                                onClick={() => handleWardrobeItemAdd(fi)}
                                className="h-8 px-3 shrink-0"
                              >
                                Add
                              </Button>
                            </div>
                          </div>
                        );
                      })}
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
                  {item.productId && (colours.length > 0 || sizes.length > 0) && (() => {
                    const historyById = item.productId ? lastOrderedSizes.byProductId[item.productId] : null;
                    const historyByName = lastOrderedSizes.byProductName[item.productName];
                    const historySize = historyById?.size ?? historyByName?.size ?? null;
                    const profileSize = selectedEmployee?.sizes?.find(s => s.label === item.productName)?.size ?? null;
                    const suggestedSize = historySize ?? profileSize;
                    const isFromHistory = !!historySize;
                    return (
                      <div className="grid gap-4">
                        {colours.length > 0 && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                              <Palette className="w-3 h-3" /> Colour <span className="text-destructive ml-0.5">*</span>
                            </Label>
                            <Select value={item.colour || ""} onValueChange={v => setItem(i => ({ ...i, colour: v }))}>
                              <SelectTrigger className={!item.colour ? "border-destructive/50" : ""}>
                                <SelectValue placeholder="Select a colour…" />
                              </SelectTrigger>
                              <SelectContent>
                                {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        {sizes.length > 0 && (
                          <div className="grid gap-2">
                            <Label className="flex items-center gap-1">
                              <Ruler className="w-3 h-3" /> Sizes <span className="text-destructive ml-0.5">*</span>
                            </Label>
                            <div className="flex flex-col gap-2">
                              {sizeRows.map((row, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <Select value={row.size || ""} onValueChange={v => setSizeRows(r => r.map((x, i) => i === idx ? { ...x, size: v } : x))}>
                                    <SelectTrigger className={`flex-1 ${!row.size ? "border-destructive/50" : ""}`}>
                                      <SelectValue placeholder="Select size…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {sizes.map(s => (
                                        <SelectItem key={s} value={s}>
                                          <span className="flex items-center gap-2">
                                            {s}
                                            {s === suggestedSize && (
                                              <span className="text-[10px] text-emerald-700 font-medium">
                                                {isFromHistory ? "last ordered" : "saved size"}
                                              </span>
                                            )}
                                          </span>
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  <Input
                                    type="number" min="1"
                                    value={row.qty}
                                    onChange={e => setSizeRows(r => r.map((x, i) => i === idx ? { ...x, qty: Math.max(1, parseInt(e.target.value, 10) || 1) } : x))}
                                    className="w-20 text-center"
                                  />
                                  {sizeRows.length > 1 && (
                                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-destructive" onClick={() => setSizeRows(r => r.filter((_, i) => i !== idx))}>
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                              <Button variant="outline" size="sm" className="w-fit gap-1.5 text-xs" onClick={() => setSizeRows(r => [...r, { size: "", qty: 1 }])}>
                                <Plus className="w-3 h-3" /> Add another size
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                      onValueChange={(v) => {
                        setItem(i => ({ ...i, recipientType: v as "stock" | "person", recipientName: "" }));
                        if (v !== "person") { setSelectedEmployee(null); setIsNewPerson(false); }
                      }}
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
                          <Select onValueChange={handleEmployeeSelect} value={selectedEmployee ? selectedEmployee.id.toString() : isNewPerson ? "__new__" : ""}>
                            <SelectTrigger><SelectValue placeholder="Pick from employees..." /></SelectTrigger>
                            <SelectContent>
                              {customerEmployees.map(e => (
                                <SelectItem key={e.id} value={e.id.toString()}>
                                  <div className="flex flex-col items-start">
                                    <span>{[e.firstName, e.lastName].filter(Boolean).join(" ")}</span>
                                    {(e.jobTitle || e.roleName) && <span className="text-xs text-muted-foreground">{[e.jobTitle, e.roleName].filter(Boolean).join(" · ")}</span>}
                                  </div>
                                </SelectItem>
                              ))}
                              <SelectItem value="__new__">+ Add new person...</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        {selectedEmployee?.sizes && selectedEmployee.sizes.length > 0 && (
                          <div className="rounded-md bg-blue-50 border border-blue-100 px-3 py-2 text-xs text-blue-700">
                            <p className="font-medium mb-1">Saved sizes for {selectedEmployee.firstName}:</p>
                            <div className="flex flex-wrap gap-2">
                              {selectedEmployee.sizes.map(s => (
                                <span key={s.id} className="bg-white border border-blue-200 rounded px-2 py-0.5 font-medium">{s.label}: {s.size}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        <Input
                          placeholder={customerEmployees && customerEmployees.length > 0 ? "Or type a name..." : "Recipient name"}
                          value={item.recipientName}
                          onChange={e => setItem(i => ({ ...i, recipientName: e.target.value }))}
                        />
                      </div>
                    )}
                  </div>

                  {/* Qty + Price — qty hidden when using per-row size quantities */}
                  <div className={`grid gap-4 ${sizes.length > 0 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {sizes.length === 0 && (
                      <div className="grid gap-2">
                        <Label htmlFor="qty">Quantity</Label>
                        <Input id="qty" type="number" min="1" value={item.quantity} onChange={e => setItem(i => ({ ...i, quantity: Math.max(1, parseInt(e.target.value, 10) || 1) }))} />
                      </div>
                    )}
                    <div className="grid gap-2">
                      <Label htmlFor="price">Unit Price (£)</Label>
                      <Input id="price" type="number" step="0.01" min="0" value={item.unitPrice} onChange={e => setItem(i => ({ ...i, unitPrice: e.target.value }))} />
                    </div>
                  </div>

                  {/* VAT Rate */}
                  <div className="grid gap-2">
                    <Label className="text-sm">VAT Rate</Label>
                    <RadioGroup
                      value={String(item.vatRate)}
                      onValueChange={(v) => setItem(i => ({ ...i, vatRate: parseFloat(v) }))}
                      className="flex gap-4"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.2" id="vat-20" />
                        <Label htmlFor="vat-20" className="font-normal cursor-pointer">20% (standard)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0.05" id="vat-5" />
                        <Label htmlFor="vat-5" className="font-normal cursor-pointer">5% (reduced)</Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="0" id="vat-0" />
                        <Label htmlFor="vat-0" className="font-normal cursor-pointer">0% (zero-rated)</Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {/* Price break info for products with tiered pricing */}
                  {item.productId && (() => {
                    const prod = products?.find(p => p.id === item.productId);
                    const priceBreaks = (prod as any)?.priceBreaks as { qty: number; price: number }[] | null;
                    const minOrderQty = (prod as any)?.minOrderQty as number | null;
                    if (!priceBreaks || priceBreaks.length === 0) return null;
                    const totalQty = sizes.length > 0 ? sizeRows.reduce((s, r) => s + (r.qty || 0), 0) : item.quantity;
                    const sorted = [...priceBreaks].sort((a, b) => a.qty - b.qty);
                    const nextTier = sorted.find(t => t.qty > totalQty);
                    const activeTier = sorted.filter(t => t.qty <= totalQty).at(-1);
                    const belowMin = minOrderQty != null && totalQty < minOrderQty;
                    return (
                      <div className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-indigo-800">Price tiers (total qty):</span>
                          {sorted.map(t => (
                            <span key={t.qty} className={`px-1.5 py-0.5 rounded font-medium ${t === activeTier ? "bg-indigo-600 text-white" : "bg-white border border-indigo-200 text-indigo-700"}`}>
                              {t.qty}+ = £{t.price.toFixed(2)}
                            </span>
                          ))}
                        </div>
                        {belowMin && (
                          <p className="text-amber-700 font-medium">⚠ Min. order qty is {minOrderQty} — current total is {totalQty}.</p>
                        )}
                        {nextTier && !belowMin && (
                          <p className="text-indigo-600">Add {nextTier.qty - totalQty} more to unlock £{nextTier.price.toFixed(2)}/unit.</p>
                        )}
                      </div>
                    );
                  })()}

                  {item.unitPrice && (
                    <div className="flex justify-end text-sm text-muted-foreground">
                      {sizes.length > 0 && sizeRows.length > 0 ? (
                        <>
                          {sizeRows.length > 1 && <span className="mr-2 text-xs">{sizeRows.length} lines ·</span>}
                          Order total: <span className="font-semibold text-foreground ml-1">{formatCurrency(sizeRows.reduce((s, r) => s + r.qty * (parseFloat(item.unitPrice) || 0), 0))}</span>
                        </>
                      ) : (
                        <>Line total: <span className="font-semibold text-foreground ml-1">{formatCurrency((parseFloat(item.unitPrice) || 0) * item.quantity)}</span></>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter className="shrink-0 border-t border-border/40 pt-4 mt-2">
              <Button variant="outline" onClick={resetDialog}>Cancel</Button>
              <Button
                onClick={handleAddItem}
                disabled={
                  !item.productId || !item.unitPrice || addItemMutation.isPending || isAddingMulti ||
                  (colours.length > 0 && dialogTab === "custom" && !item.colour) ||
                  (sizes.length > 0 && dialogTab === "custom" && sizeRows.some(r => !r.size))
                }
              >
                {(addItemMutation.isPending || isAddingMulti)
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Adding...</>
                  : sizeRows.length > 1
                    ? `Add ${sizeRows.length} lines to Order`
                    : "Add to Order"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isSendToProductionOpen} onOpenChange={setIsSendToProductionOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-700">
              <ClipboardList className="w-5 h-5" />
              Send to Production
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              This will create a production worksheet for all items that don't need purchasing. It will appear in <strong>Pre-Production</strong> until the garments arrive, then move to Work in Progress when decoration begins.
            </p>
            {order.items && (
              <div className="rounded-lg border border-green-200 bg-green-50 divide-y divide-green-100 text-sm">
                {order.items.filter((oi: { purchaseRequired?: boolean }) => !oi.purchaseRequired).map((oi: { id: number; productName: string; colour?: string; size?: string; quantity: number }) => (
                  <div key={oi.id} className="flex items-center justify-between px-3 py-2">
                    <span className="font-medium">{oi.productName}</span>
                    <span className="text-muted-foreground text-xs">{[oi.colour, oi.size].filter(Boolean).join(" / ")} × {oi.quantity}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Production Notes (optional)</Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Any special instructions for the production team..."
                value={productionNotes}
                onChange={(e) => setProductionNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSendToProductionOpen(false)}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white gap-1.5"
              onClick={() => {
                if (!order.items) return;
                const eligibleIds = order.items
                  .filter((oi: { purchaseRequired?: boolean }) => !oi.purchaseRequired)
                  .map((oi: { id: number }) => oi.id);
                sendToProductionMutation.mutate(eligibleIds);
              }}
              disabled={sendToProductionMutation.isPending}
            >
              {sendToProductionMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><ClipboardList className="w-4 h-4" /> Create Worksheet</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmOrderDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        order={{
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName ?? null,
          status: order.status,
          totalAmount: order.totalAmount,
          requiredDate: (order as any).requiredDate ?? null,
          shippingMethod: (order as any).shippingMethod ?? null,
          items: order.items,
        }}
        onConfirmed={() => {
          queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(orderId) });
        }}
      />

      <SendAcknowledgementDialog
        open={sendAckOpen}
        onOpenChange={setSendAckOpen}
        order={{
          id: order.id,
          orderNumber: order.orderNumber,
          customerName: order.customerName ?? null,
          totalAmount: order.totalAmount,
          status: order.status,
        }}
        onSent={() => {
          queryClient.invalidateQueries({ queryKey: ["order-email-logs", orderId] });
        }}
      />

      {/* Delete order confirmation */}
      <Dialog open={deleteOrderConfirmOpen} onOpenChange={setDeleteOrderConfirmOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <Trash2 className="w-5 h-5" />
              Delete Order {order.orderNumber}?
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <p className="text-sm text-muted-foreground">
              This will permanently delete the order and all its line items. This cannot be undone.
            </p>
            <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm">
              <p className="font-medium text-red-800">{order.customerName}</p>
              <p className="text-red-600 text-xs mt-0.5">{order.items?.length ?? 0} item{(order.items?.length ?? 0) !== 1 ? "s" : ""} · {formatCurrency(order.totalAmount)}</p>
            </div>
            {order.status === "confirmed" && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                This order is confirmed — any stock that was allocated to it will be returned to your stock levels.
              </p>
            )}
            {(order.status === "shipped" || order.status === "delivered") && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                This order has already been {order.status} — stock will not be restored.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOrderConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteOrderMutation.mutate()}
              disabled={deleteOrderMutation.isPending}
            >
              {deleteOrderMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />Deleting…</> : "Yes, delete order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit size / colour */}
      <Dialog open={!!editingSizeColour} onOpenChange={open => { if (!open) setEditingSizeColour(null); }}>
        <DialogContent className="sm:max-w-[340px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Ruler className="w-4 h-4" /> Correct size / colour
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-colour">Colour</Label>
              <Input
                id="edit-colour"
                value={editingSizeColour?.colour ?? ""}
                onChange={e => setEditingSizeColour(s => s && ({ ...s, colour: e.target.value }))}
                placeholder="e.g. Navy/Burgundy"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-size">Size</Label>
              <Input
                id="edit-size"
                value={editingSizeColour?.size ?? ""}
                onChange={e => setEditingSizeColour(s => s && ({ ...s, size: e.target.value }))}
                placeholder="e.g. 2XL"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingSizeColour(null)}>Cancel</Button>
            <Button
              disabled={updateItemSizeColourMutation.isPending}
              onClick={() => editingSizeColour && updateItemSizeColourMutation.mutate(editingSizeColour)}
            >
              {updateItemSizeColourMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
