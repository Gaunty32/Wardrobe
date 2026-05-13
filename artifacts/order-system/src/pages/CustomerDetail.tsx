import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, toTitleCase } from "@/lib/utils";
import { sortSizes, sortBySize } from "@/lib/sizeUtils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Edit2, Trash2, Loader2, X, Building2, MapPin, Users, History, Layers, Shirt, UserCheck, Boxes, PoundSterling, ShoppingBag, Check, ChevronsUpDown, Palette, Ruler, Sparkles, TrendingUp, AlertCircle, ImageIcon, Upload, Eye, Globe, Copy, CheckCircle2, LogIn, UserX, CreditCard, Phone, Package, Tag, ChevronDown, ChevronRight, Smartphone } from "lucide-react";

function formatUKPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("07")) return `${d.slice(0,5)} ${d.slice(5,8)} ${d.slice(8)}`;
  if (d.length === 11 && d.startsWith("01")) return `${d.slice(0,5)} ${d.slice(5)}`;
  if (d.length === 11 && d.startsWith("02")) return `${d.slice(0,3)} ${d.slice(3,7)} ${d.slice(7)}`;
  if (d.length === 11 && d.startsWith("03")) return `${d.slice(0,4)} ${d.slice(4,7)} ${d.slice(7)}`;
  return raw;
}
import { loadStripe } from "@stripe/stripe-js";
import { Elements, CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useGetCustomer, useListProducts } from "@workspace/api-client-react";
import { useUpload } from "@workspace/object-storage-web";
import { Link } from "wouter";

const API_BASE = "/api";

const DEFAULT_CLOTHING_SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL"];

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try { const j = JSON.parse(text); if (j?.error) message = j.error; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return null;
  return res.json();
}

function useSubResource<T>(customerId: number | null, key: string) {
  return useQuery<T[]>({
    queryKey: ["customer", customerId, key],
    queryFn: () => apiFetch(`/customers/${customerId}/${key}`),
    enabled: !!customerId,
  });
}

function SubTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <Table>{children}</Table>
    </div>
  );
}

function EmptyState({ icon: Icon, label, onAdd }: { icon: React.ElementType; label: string; onAdd: () => void }) {
  return (
    <div className="py-12 text-center text-muted-foreground">
      <Icon className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm">No {label} yet</p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onAdd}>
        <Plus className="w-3 h-3 mr-1" /> Add {label}
      </Button>
    </div>
  );
}

// ─── Delivery Addresses Tab ───────────────────────────────────────────────────

function AddressesTab({ customerId, customer }: { customerId: number; customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: addresses, isLoading } = useSubResource<any>(customerId, "addresses");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { label: "", line1: "", line2: "", city: "", postcode: "", country: "United Kingdom", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "addresses"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/addresses/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/addresses`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save address", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => {
    setForm({
      label: "",
      line1: customer?.address || "",
      line2: "",
      city: customer?.city || "",
      postcode: customer?.postcode || "",
      country: "United Kingdom",
      notes: "",
    });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (a: any) => { setForm({ label: a.label||"", line1: a.line1||"", line2: a.line2||"", city: a.city||"", postcode: a.postcode||"", country: a.country||"United Kingdom", notes: a.notes||"" }); setEditing(a); setOpen(true); };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Address</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !addresses?.length ? <EmptyState icon={MapPin} label="delivery addresses" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Label</TableHead>
            <TableHead>Address</TableHead>
            <TableHead className="hidden md:table-cell">City</TableHead>
            <TableHead className="hidden md:table-cell">Postcode</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {addresses.map((a: any) => (
              <TableRow key={a.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{a.label || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{[a.line1, a.line2].filter(Boolean).join(', ') || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.city || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{a.postcode || '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(a)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this address?") && del.mutate(a.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Address" : "Add Delivery Address"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Label (e.g. Warehouse, Head Office)</Label>
              <Input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Address Line 1</Label>
              <Input value={form.line1} onChange={e => setForm({ ...form, line1: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Address Line 2</Label>
              <Input value={form.line2} onChange={e => setForm({ ...form, line2: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Postcode</Label><Input value={form.postcode} onChange={e => setForm({ ...form, postcode: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Country</Label><Input value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Contacts Tab ─────────────────────────────────────────────────────────────

function ContactsTab({ customerId, customer }: { customerId: number; customer: any }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: contacts, isLoading } = useSubResource<any>(customerId, "contacts");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { firstName: "", lastName: "", jobTitle: "", email: "", phone: "", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "contacts"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/contacts/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/contacts`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save contact", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => {
    setForm({
      firstName: customer?.contactFirstName || "",
      lastName: customer?.contactLastName || "",
      jobTitle: "",
      email: customer?.email || "",
      phone: customer?.phone || "",
      notes: "",
    });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (c: any) => { setForm({ firstName: c.firstName||"", lastName: c.lastName||"", jobTitle: c.jobTitle||"", email: c.email||"", phone: c.phone||"", notes: c.notes||"" }); setEditing(c); setOpen(true); };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Contact</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !contacts?.length ? <EmptyState icon={Users} label="contacts" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Job Title</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {contacts.map((c: any) => (
              <TableRow key={c.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{toTitleCase([c.firstName, c.lastName].filter(Boolean).join(' '))}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.jobTitle || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email?.toLowerCase() || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {c.phone ? (
                    <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 hover:text-primary transition-colors">
                      <Phone className="w-3 h-3 shrink-0" /> {formatUKPhone(c.phone)}
                    </a>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(c)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this contact?") && del.mutate(c.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Contact" : "Add Contact"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Job Title</Label><Input value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.firstName}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Order History Tab ────────────────────────────────────────────────────────

function OrderHistoryTab({ customerId }: { customerId: number }) {
  const { data: orders, isLoading } = useSubResource<any>(customerId, "orders");

  const statusColour: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700",
    confirmed: "bg-blue-100 text-blue-700",
    in_production: "bg-yellow-100 text-yellow-700",
    dispatched: "bg-purple-100 text-purple-700",
    delivered: "bg-green-100 text-green-700",
    cancelled: "bg-red-100 text-red-700",
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  if (!orders?.length) return (
    <div className="py-12 text-center text-muted-foreground">
      <History className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
      <p className="text-sm">No orders found for this customer</p>
    </div>
  );

  return (
    <SubTable>
      <TableHeader><TableRow className="hover:bg-transparent">
        <TableHead>Order</TableHead>
        <TableHead>Date</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Total</TableHead>
      </TableRow></TableHeader>
      <TableBody>
        {orders.map((o: any) => (
          <TableRow key={o.id} className="hover:bg-muted/30">
            <TableCell>
              <Link href={`/orders/${o.id}`} className="text-primary hover:underline font-medium">{o.orderNumber}</Link>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDate(o.createdAt)}</TableCell>
            <TableCell>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium tracking-wide ${statusColour[o.status] || statusColour.draft}`}>
                {o.status ? (o.status.replace(/_/g, ' ').charAt(0).toUpperCase() + o.status.replace(/_/g, ' ').slice(1).toLowerCase()) : ''}
              </span>
            </TableCell>
            <TableCell className="text-right font-medium">{formatCurrency(o.totalAmount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </SubTable>
  );
}

// ─── Processes Tab ────────────────────────────────────────────────────────────

const PROCESS_TYPES = ["embroidery", "print", "DTF", "other"] as const;

interface ProcessStockItem { id: number; name: string; sku: string | null; unitCost: number; supplierId: number | null; stockQuantity: number; }

const blankDtf = { supplierId: "", unitCost: "", sku: "", orderQty: "0" };

function ProcessesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: processes, isLoading } = useSubResource<any>(customerId, "processes");
  const { data: allProcessStock } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock", "customer", customerId],
    queryFn: () => apiFetch(`/process-stock?customerId=${customerId}`),
  });
  const { data: suppliers } = useQuery<any[]>({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch("/suppliers"),
  });
  const [isFetchingSku, setIsFetchingSku] = useState(false);

  const fetchAndSetSku = async () => {
    setIsFetchingSku(true);
    try {
      const { sku } = await apiFetch<{ sku: string }>("/process-stock/suggest-sku");
      setDtfForm(f => ({ ...f, sku }));
    } catch {
      // leave blank, server will generate on save
    } finally {
      setIsFetchingSku(false);
    }
  };
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", type: "", placement: "", price: "", processStockId: "", imageUrl: "", notes: "" };
  const [form, setForm] = useState(blank);
  const [dtfForm, setDtfForm] = useState(blankDtf);
  const [isSaving, setIsSaving] = useState(false);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => {
      setForm(f => ({ ...f, imageUrl: `/api/storage${res.objectPath}` }));
      toast({ title: "Image uploaded" });
    },
    onError: () => toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" }),
  });

  const invStock = () => qc.invalidateQueries({ queryKey: ["process-stock", "customer", customerId] });
  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "processes"] });
  const invPO = () => qc.invalidateQueries({ queryKey: ["purchase-orders"] });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/processes/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const typeColour: Record<string, string> = { embroidery: "bg-purple-100 text-purple-700", print: "bg-blue-100 text-blue-700", other: "bg-gray-100 text-gray-700" };

  const openAdd = () => { setForm(blank); setDtfForm(blankDtf); setEditing(null); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({
      name: p.name || "",
      type: p.type || "",
      placement: p.placement || "",
      price: p.price != null ? String(p.price) : "",
      processStockId: p.processStockId != null ? String(p.processStockId) : "",
      imageUrl: p.imageUrl || "",
      notes: p.notes || "",
    });
    if (p.type === "DTF" && p.processStockId && allProcessStock) {
      const stockItem = allProcessStock.find((s: ProcessStockItem) => s.id === p.processStockId);
      setDtfForm(stockItem ? {
        supplierId: stockItem.supplierId != null ? String(stockItem.supplierId) : "",
        unitCost: stockItem.unitCost != null ? String(stockItem.unitCost) : "",
        sku: stockItem.sku || "",
        orderQty: "0",
      } : blankDtf);
    } else {
      setDtfForm(blankDtf);
    }
    setEditing(p);
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || isSaving) return;
    setIsSaving(true);
    try {
      let stockId: number | null = form.processStockId ? parseInt(form.processStockId, 10) : null;

      if (form.type === "DTF") {
        const stockPayload = {
          name: form.name.trim(),
          sku: dtfForm.sku.trim() || null,
          supplierId: dtfForm.supplierId ? parseInt(dtfForm.supplierId, 10) : null,
          unitCost: dtfForm.unitCost ? parseFloat(dtfForm.unitCost) : 0,
          customerId,
        };
        if (stockId) {
          await apiFetch(`/process-stock/${stockId}`, { method: "PATCH", body: JSON.stringify(stockPayload) });
        } else {
          const newStock = await apiFetch("/process-stock", { method: "POST", body: JSON.stringify({ ...stockPayload, stockQuantity: 0 }) });
          stockId = newStock.id;
        }
        const orderQty = parseInt(dtfForm.orderQty || "0", 10);
        if (orderQty > 0) {
          const supplier = suppliers?.find((s: any) => s.id === parseInt(dtfForm.supplierId || "0", 10));
          await apiFetch("/purchasing/purchase-orders/for-process-stock", {
            method: "POST",
            body: JSON.stringify({
              supplierId: dtfForm.supplierId ? parseInt(dtfForm.supplierId, 10) : null,
              supplierName: supplier?.name || "Unknown Supplier",
              supplierEmail: supplier?.email || null,
              notes: `Process stock reorder: ${form.name.trim()}`,
              items: [{
                productName: form.name.trim(),
                supplierCode: dtfForm.sku.trim() || null,
                supplierPrice: dtfForm.unitCost ? parseFloat(dtfForm.unitCost) : null,
                quantityOrdered: orderQty,
              }],
            }),
          });
          invPO();
        }
      }

      const processPayload = {
        name: form.name,
        type: form.type || null,
        placement: form.placement || null,
        price: form.price ? parseFloat(form.price) : null,
        processStockId: stockId,
        imageUrl: form.imageUrl || null,
        notes: form.notes || null,
      };
      await (editing
        ? apiFetch(`/customers/${customerId}/processes/${editing.id}`, { method: "PATCH", body: JSON.stringify(processPayload) })
        : apiFetch(`/customers/${customerId}/processes`, { method: "POST", body: JSON.stringify(processPayload) })
      );

      inv();
      invStock();
      const orderQty = parseInt(dtfForm.orderQty || "0", 10);
      toast({
        title: "Saved",
        description: form.type === "DTF" && orderQty > 0 ? "Draft purchase order created in Purchasing." : undefined,
      });
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Error saving process", description: e.message || "Could not save process", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const getStockName = (id: number | null) => {
    if (!id || !allProcessStock) return null;
    const s = allProcessStock.find(s => s.id === id);
    if (!s) return null;
    return s.sku ? `${s.sku} — ${s.name}` : s.name;
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Process</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !processes?.length ? <EmptyState icon={Layers} label="processes" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead className="w-20">Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Placement</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="hidden lg:table-cell">Process Stock</TableHead>
            <TableHead className="w-12">Image</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {processes.map((p: any) => (
              <TableRow key={p.id} className="group hover:bg-muted/30">
                <TableCell>
                  {p.code && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                      {p.code}
                    </span>
                  )}
                </TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  {p.type && <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${typeColour[p.type] || typeColour.other}`}>{p.type}</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{p.placement || '—'}</TableCell>
                <TableCell className="text-right text-sm font-medium tabular-nums">
                  {p.price != null ? formatCurrency(p.price) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {p.processStockId ? (
                    <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                      <Boxes className="w-3 h-3" />{getStockName(p.processStockId) ?? `#${p.processStockId}`}
                    </span>
                  ) : <span className="text-muted-foreground text-sm">—</span>}
                </TableCell>
                <TableCell>
                  {p.imageUrl ? (
                    <a href={p.imageUrl} target="_blank" rel="noopener noreferrer" title="View process image">
                      <img src={p.imageUrl} alt={p.name} className="w-10 h-10 object-contain bg-white rounded border border-border hover:opacity-80 transition-opacity p-0.5" />
                    </a>
                  ) : (
                    <span className="text-muted-foreground/30"><ImageIcon className="w-4 h-4" /></span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(p)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this process?") && del.mutate(p.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? "Edit Process" : "Add Process"}
              {editing?.code && (
                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  {editing.code}
                </span>
              )}
              {!editing && (
                <span className="text-xs font-normal text-muted-foreground">Code will be assigned on save</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Left Chest Embroidery Logo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type || "none"} onValueChange={v => {
                  const newType = v === "none" ? "" : v;
                  setForm(f => ({ ...f, type: newType, processStockId: newType === "DTF" ? f.processStockId : "" }));
                  if (newType === "DTF" && !editing) {
                    setDtfForm(blankDtf);
                    fetchAndSetSku();
                  }
                }}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    {PROCESS_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2"><Label>Placement</Label>
                <Input placeholder="e.g. Left Chest" value={form.placement} onChange={e => setForm({ ...form, placement: e.target.value })} /></div>
            </div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Price (£)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.price}
                onChange={e => setForm({ ...form, price: e.target.value })}
              />
            </div>
            {form.type === "DTF" && (
              <div className="rounded-md border border-amber-200 bg-amber-50/40 p-3 grid gap-3">
                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide flex items-center gap-1.5">
                  <Boxes className="w-3 h-3" /> DTF Stock Details
                  {form.processStockId && (() => {
                    const s = allProcessStock?.find(x => x.id === parseInt(form.processStockId));
                    return s ? (
                      <span className={cn("ml-auto font-normal text-[11px] px-1.5 py-0.5 rounded-full", s.stockQuantity === 0 ? "bg-amber-200 text-amber-800" : "bg-green-100 text-green-700")}>
                        {s.stockQuantity === 0 ? "⚠ No stock" : `${s.stockQuantity} in stock`}
                      </span>
                    ) : null;
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Supplier</Label>
                    <Select value={dtfForm.supplierId || "none"} onValueChange={v => setDtfForm(f => ({ ...f, supplierId: v === "none" ? "" : v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Select supplier" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No supplier</SelectItem>
                        {suppliers?.map((s: any) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Unit Cost</Label>
                    <Input className="h-8 text-sm" type="number" min="0" step="0.01" placeholder="0.00"
                      value={dtfForm.unitCost} onChange={e => setDtfForm(f => ({ ...f, unitCost: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Product Code (SKU)</Label>
                    <div className="relative">
                      <Input className="h-8 text-sm font-mono" placeholder={isFetchingSku ? "Fetching…" : "e.g. PS0005"}
                        value={dtfForm.sku} onChange={e => setDtfForm(f => ({ ...f, sku: e.target.value }))}
                        disabled={isFetchingSku} />
                      {isFetchingSku && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs flex items-center gap-1"><ShoppingBag className="w-3 h-3" /> Draft PO Qty <span className="font-normal text-muted-foreground">(0 = skip)</span></Label>
                    <Input className="h-8 text-sm" type="number" min="0" step="1" placeholder="0"
                      value={dtfForm.orderQty} onChange={e => setDtfForm(f => ({ ...f, orderQty: e.target.value }))} />
                  </div>
                </div>
              </div>
            )}
            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Reference Image</Label>
              {form.imageUrl ? (
                <div className="relative group w-full">
                  <img src={form.imageUrl} alt="Process reference" className="w-full h-36 object-contain rounded-md border border-border bg-muted/30" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center gap-2">
                    <a href={form.imageUrl} target="_blank" rel="noopener noreferrer">
                      <Button type="button" size="sm" variant="secondary" className="h-7 gap-1 text-xs"><Eye className="w-3 h-3" /> View</Button>
                    </a>
                    <Button type="button" size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={() => setForm(f => ({ ...f, imageUrl: "" }))}><X className="w-3 h-3" /> Remove</Button>
                  </div>
                </div>
              ) : (
                <label className={cn(
                  "flex flex-col items-center justify-center h-24 rounded-md border-2 border-dashed border-border cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors",
                  isUploading && "opacity-50 pointer-events-none"
                )}>
                  {isUploading ? (
                    <><Loader2 className="w-5 h-5 animate-spin text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Uploading…</span></>
                  ) : (
                    <><Upload className="w-5 h-5 text-muted-foreground mb-1" /><span className="text-xs text-muted-foreground">Click to upload image</span><span className="text-[10px] text-muted-foreground/60">JPG, PNG, GIF, WebP</span></>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={isUploading}
                    onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                  />
                </label>
              )}
            </div>

            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving || !form.name || isUploading}>
              {isSaving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving...</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Finishes Tab ─────────────────────────────────────────────────────────────

function FinishesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: finishes, isLoading } = useSubResource<any>(customerId, "finishes");
  const { data: processes } = useSubResource<any>(customerId, "processes");
  const { data: allProducts } = useListProducts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "finishes"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/finishes/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/finishes`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save finish", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/finishes/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const addProcess = useMutation({
    mutationFn: ({ finishId, processId }: { finishId: number; processId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/processes/${processId}`, { method: "POST" }),
    onSuccess: () => inv(),
    onError: () => toast({ title: "Error", description: "Could not add process", variant: "destructive" }),
  });

  const removeProcess = useMutation({
    mutationFn: ({ finishId, processId }: { finishId: number; processId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/processes/${processId}`, { method: "DELETE" }),
    onSuccess: () => inv(),
  });

  const addGarment = useMutation({
    mutationFn: ({ finishId, productId, colour }: { finishId: number; productId: number; colour?: string | null }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/products/${productId}`, { method: "POST", body: JSON.stringify({ colour: colour ?? null }) }),
    onSuccess: () => inv(),
    onError: () => toast({ title: "Error", description: "Could not add garment", variant: "destructive" }),
  });

  const removeGarment = useMutation({
    mutationFn: ({ finishId, garmentId }: { finishId: number; garmentId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/garments/${garmentId}`, { method: "DELETE" }),
    onSuccess: () => inv(),
  });

  const typeColour: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700",
    print: "bg-blue-100 text-blue-700",
    transfer: "bg-orange-100 text-orange-700",
    other: "bg-gray-100 text-gray-700",
  };

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (f: any) => { setForm({ name: f.name||"", notes: [f.description, f.notes].filter(Boolean).join("\n").trim() }); setEditing(f); setOpen(true); };

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [garmentPopover, setGarmentPopover] = useState<Set<number>>(new Set());
  const [garmentSearch, setGarmentSearch] = useState<Record<number, string>>({});
  const toggleGarmentPopover = (id: number) => setGarmentPopover(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const [garmentPending, setGarmentPending] = useState<Record<number, { product: any; variants: any[] }>>({});

  const selectGarmentProduct = async (finishId: number, product: any) => {
    setGarmentSearch(prev => ({ ...prev, [finishId]: "" }));
    try {
      const variants = await apiFetch(`/products/${product.id}/variants`);
      const colours = [...new Set((variants as any[]).map((v: any) => v.colour).filter(Boolean))];
      if (colours.length === 0) {
        addGarment.mutate({ finishId, productId: product.id, colour: null });
        toggleGarmentPopover(finishId);
      } else {
        setGarmentPending(prev => ({ ...prev, [finishId]: { product, variants: colours as string[] } }));
      }
    } catch {
      addGarment.mutate({ finishId, productId: product.id, colour: null });
      toggleGarmentPopover(finishId);
    }
  };

  const confirmGarmentColour = (finishId: number, colour: string | null) => {
    const pending = garmentPending[finishId];
    if (!pending) return;
    addGarment.mutate({ finishId, productId: pending.product.id, colour });
    setGarmentPending(prev => { const n = { ...prev }; delete n[finishId]; return n; });
    toggleGarmentPopover(finishId);
  };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Finish</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !finishes?.length ? <EmptyState icon={Shirt} label="finishes" onAdd={openAdd} />
        : <div className="border border-border/50 rounded-lg overflow-hidden divide-y divide-border/40">
          {finishes.map((f: any) => {
            const isOpen = expanded.has(f.id);
            const attachedProcessIds = new Set(f.processes?.map((p: any) => p.processId));
            const availableProcesses = (processes || []).filter((p: any) => !attachedProcessIds.has(p.id));
            const attachedProductIds = new Set(f.garments?.map((g: any) => g.productId));
            const availableProducts = (allProducts || []).filter((p: any) => !attachedProductIds.has(p.id));
            const processCount = f.processes?.length ?? 0;
            const garmentCount = f.garments?.length ?? 0;

            return (
              <div key={f.id} className="bg-background">
                {/* Collapsed header row */}
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer select-none" onClick={() => toggle(f.id)}>
                  <span className={`transition-transform duration-150 text-muted-foreground ${isOpen ? "rotate-90" : ""}`}>
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                  </span>
                  {f.code && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded font-mono text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200 shrink-0">
                      {f.code}
                    </span>
                  )}
                  <span className="font-medium text-foreground flex-1 truncate">{f.name}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {processCount > 0 && (
                      <span className="text-xs text-muted-foreground">{processCount} process{processCount !== 1 ? "es" : ""}</span>
                    )}
                    {garmentCount > 0 && (
                      <span className="text-xs text-muted-foreground">{garmentCount} garment{garmentCount !== 1 ? "s" : ""}</span>
                    )}
                    {f.totalCost > 0 && (
                      <span className="text-xs font-semibold text-emerald-700 tabular-nums">£{f.totalCost.toFixed(2)}</span>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-blue-600 hover:bg-blue-50" onClick={e => { e.stopPropagation(); openEdit(f); }}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-50" onClick={e => { e.stopPropagation(); confirm("Delete this finish?") && del.mutate(f.id); }}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>

                {/* Expanded body */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 bg-muted/10 space-y-4 border-t border-border/30">
                    {/* Processes */}
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Processes</p>
                      {f.processes?.length > 0 ? (
                        <div className="space-y-1">
                          {f.processes.map((p: any) => (
                            <div key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 bg-background border border-border/40 text-sm">
                              <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${typeColour[p.type] || typeColour.other}`}>
                                {p.type || "—"}
                              </span>
                              <span className="font-medium flex-1 truncate">{p.name}</span>
                              {p.placement && <span className="text-muted-foreground text-xs hidden sm:block shrink-0">{p.placement}</span>}
                              {p.price != null && <span className="tabular-nums text-xs font-semibold shrink-0">{formatCurrency(p.price)}</span>}
                              <button onClick={() => removeProcess.mutate({ finishId: f.id, processId: p.processId })} className="text-muted-foreground hover:text-red-500 transition-colors shrink-0">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                          {f.totalCost > 0 && (
                            <div className="flex justify-end pr-6 pt-0.5">
                              <span className="text-xs font-semibold text-emerald-700">Total: {formatCurrency(f.totalCost)}</span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No processes added yet</p>
                      )}
                      {availableProcesses.length > 0 && (
                        <div className="mt-2">
                          <Select onValueChange={(v) => addProcess.mutate({ finishId: f.id, processId: Number(v) })}>
                            <SelectTrigger className="h-7 text-xs w-auto border-dashed text-muted-foreground">
                              <Plus className="w-3 h-3 mr-1" /><span>Add process</span>
                            </SelectTrigger>
                            <SelectContent>
                              {availableProcesses.map((p: any) => (
                                <SelectItem key={p.id} value={String(p.id)}>
                                  {p.name}{p.price != null ? ` — ${formatCurrency(p.price)}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {!processes?.length && <p className="text-xs text-muted-foreground italic mt-1">Set up processes in the Processes tab first</p>}
                    </div>

                    {/* Garments */}
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Garments</p>
                      <div className="flex flex-wrap gap-1.5">
                        {f.garments?.map((g: any) => (
                          <span key={g.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                            {g.sku && <span className="font-mono text-[10px] text-blue-500">{g.sku}</span>}
                            <span>{g.name}</span>
                            {g.colour && <span className="bg-blue-100 text-blue-600 px-1 rounded text-[10px] font-semibold">{g.colour}</span>}
                            <button onClick={() => removeGarment.mutate({ finishId: f.id, garmentId: g.id })} className="hover:opacity-70 ml-0.5"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                        <Popover open={garmentPopover.has(f.id)} onOpenChange={open => { if (!open) { toggleGarmentPopover(f.id); setGarmentPending(prev => { const n = { ...prev }; delete n[f.id]; return n; }); } else { toggleGarmentPopover(f.id); } }}>
                          <PopoverTrigger asChild>
                            <button className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors">
                              <Plus className="w-3 h-3" />Add garment
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="p-0 w-80" align="start">
                            {garmentPending[f.id] ? (
                              /* Step 2: pick colour */
                              <div className="p-3 space-y-3">
                                <div className="flex items-center gap-2">
                                  <button onClick={() => setGarmentPending(prev => { const n = { ...prev }; delete n[f.id]; return n; })} className="text-muted-foreground hover:text-foreground">
                                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6"/></svg>
                                  </button>
                                  <div>
                                    <p className="text-xs font-semibold text-foreground">{garmentPending[f.id].product.sku && <span className="font-mono mr-1">{garmentPending[f.id].product.sku}</span>}{garmentPending[f.id].product.name}</p>
                                    <p className="text-[11px] text-muted-foreground">Select a colour</p>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(garmentPending[f.id].variants as string[]).map((col: string) => (
                                    <button
                                      key={col}
                                      onClick={() => confirmGarmentColour(f.id, col)}
                                      className="px-2.5 py-1 rounded-full text-xs font-medium border border-border hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors"
                                    >
                                      {col}
                                    </button>
                                  ))}
                                  <button
                                    onClick={() => confirmGarmentColour(f.id, null)}
                                    className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-border text-muted-foreground hover:bg-muted transition-colors"
                                  >
                                    Any / no colour
                                  </button>
                                </div>
                              </div>
                            ) : (
                              /* Step 1: search products */
                              <Command>
                                <CommandInput
                                  placeholder="Search by code or name…"
                                  value={garmentSearch[f.id] || ""}
                                  onValueChange={v => setGarmentSearch(prev => ({ ...prev, [f.id]: v }))}
                                />
                                <CommandList>
                                  <CommandEmpty>No products found</CommandEmpty>
                                  <CommandGroup>
                                    {availableProducts
                                      .filter((p: any) => {
                                        const q = (garmentSearch[f.id] || "").toLowerCase();
                                        if (!q) return true;
                                        return (p.sku || "").toLowerCase().includes(q) || (p.name || "").toLowerCase().includes(q);
                                      })
                                      .map((p: any) => (
                                        <CommandItem
                                          key={p.id}
                                          value={`${p.sku || ""} ${p.name}`}
                                          onSelect={() => selectGarmentProduct(f.id, p)}
                                        >
                                          {p.sku && <span className="font-mono font-semibold text-xs text-foreground mr-1.5 shrink-0">{p.sku}</span>}
                                          <span className="text-muted-foreground truncate">{p.name}</span>
                                        </CommandItem>
                                      ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            )}
                          </PopoverContent>
                        </Popover>
                        {!f.garments?.length && !availableProducts?.length && <p className="text-xs text-muted-foreground italic">No garments — add products first</p>}
                        {!f.garments?.length && availableProducts?.length > 0 && <p className="text-xs text-muted-foreground italic">No garments assigned yet</p>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editing ? "Edit Finish" : "Add Finish"}
              {editing?.code && (
                <span className="inline-flex items-center px-2 py-0.5 rounded font-mono text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                  {editing.code}
                </span>
              )}
              {!editing && (
                <span className="text-xs font-normal text-muted-foreground">Code will be assigned on save</span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Full Company Branding Package" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={3} placeholder="Description, placement details, internal notes..." value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Shared: Manager Combobox ─────────────────────────────────────────────────

function ManagerCombobox({ employees, value, onChange }: {
  employees: any[];
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = employees.find(e => e.id === value);
  const label = selected ? [selected.firstName, selected.lastName].filter(Boolean).join(" ") : "No manager";
  const filtered = search.trim()
    ? employees.filter(e => [e.firstName, e.lastName, e.jobTitle].filter(Boolean).join(" ").toLowerCase().includes(search.toLowerCase()))
    : employees;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm hover:bg-muted/40 focus:outline-none focus:ring-1 focus:ring-ring",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="w-4 h-4 shrink-0 opacity-50 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[--radix-popover-trigger-width]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search employees…" value={search} onValueChange={setSearch} />
          <CommandList className="max-h-56">
            <CommandEmpty>No employees found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => { onChange(null); setOpen(false); setSearch(""); }}>
                <Check className={cn("w-4 h-4 mr-2 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                <span className="text-muted-foreground">No manager</span>
              </CommandItem>
              {filtered.map(e => {
                const name = [e.firstName, e.lastName].filter(Boolean).join(" ");
                return (
                  <CommandItem key={e.id} value={String(e.id)} onSelect={() => { onChange(e.id); setOpen(false); setSearch(""); }}>
                    <Check className={cn("w-4 h-4 mr-2 shrink-0", value === e.id ? "opacity-100" : "opacity-0")} />
                    <span>{name}{e.jobTitle ? <span className="ml-1.5 text-muted-foreground text-xs">— {e.jobTitle}</span> : null}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ─── Teams Tab ────────────────────────────────────────────────────────────────

function TeamsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: teams, isLoading } = useSubResource<any>(customerId, "teams");
  const { data: employees } = useSubResource<any>(customerId, "employees");
  const activeEmployees: any[] = (employees ?? []).filter((e: any) => e.isActive !== false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "", managerId: null as number | null };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "teams"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/teams/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/teams`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save team", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/teams/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (t: any) => { setForm({ name: t.name || "", description: t.description || "", managerId: t.managerId ?? null }); setEditing(t); setOpen(true); };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Teams group employees — each team can have a designated manager.</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Team</Button>
      </div>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !teams?.length ? <EmptyState icon={Users} label="teams" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Team Name</TableHead>
            <TableHead className="hidden sm:table-cell">Team Manager</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {teams.map((t: any) => (
              <TableRow key={t.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                  {t.managerName ? (
                    <span className="inline-flex items-center gap-1.5">
                      <UserCheck className="w-3.5 h-3.5 text-indigo-500" />{t.managerName}
                    </span>
                  ) : <span className="text-muted-foreground/50">—</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{t.description || '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(t)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this team?") && del.mutate(t.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Team" : "Add Team"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Team Name *</Label>
              <Input placeholder="e.g. Warehouse, Admin, Field Sales" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label>Team Manager</Label>
              <ManagerCombobox
                employees={activeEmployees}
                value={form.managerId}
                onChange={v => setForm({ ...form, managerId: v })}
              />
            </div>
            <div className="grid gap-2">
              <Label>Description</Label>
              <Textarea rows={2} placeholder="Optional description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.name}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: roles, isLoading } = useSubResource<any>(customerId, "roles");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "", annualAllowance: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "roles"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/roles/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/roles`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save role", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/roles/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (r: any) => {
    setForm({
      name: r.name || "",
      description: r.description || "",
      annualAllowance: r.annual_allowance != null ? String(r.annual_allowance) : "",
    });
    setEditing(r);
    setOpen(true);
  };

  const handleSave = () => {
    const payload: any = { name: form.name, description: form.description || null };
    payload.annualAllowance = form.annualAllowance.trim() !== "" ? parseFloat(form.annualAllowance) : null;
    save.mutate(payload);
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Roles define job types — each role can have its own wardrobe in the Wardrobe tab.</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Role</Button>
      </div>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !roles?.length ? <EmptyState icon={Layers} label="roles" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Role Name</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <TableHead className="hidden sm:table-cell text-right">Annual Allowance</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {roles.map((r: any) => (
              <TableRow key={r.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.description || '—'}</TableCell>
                <TableCell className="hidden sm:table-cell text-right text-sm text-muted-foreground">
                  {r.annual_allowance != null ? `£${parseFloat(r.annual_allowance).toFixed(2)}` : <span className="text-muted-foreground/40">No limit</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(r)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this role?") && del.mutate(r.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Role" : "Add Role"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Role Name *</Label><Input placeholder="e.g. Manager, Driver, Sales Rep" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Description</Label><Textarea rows={2} placeholder="Optional description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                Annual Allowance (£)
                <span className="text-muted-foreground font-normal text-xs ml-1">— leave blank for no limit</span>
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 250.00"
                  className="pl-7"
                  value={form.annualAllowance}
                  onChange={e => setForm({ ...form, annualAllowance: e.target.value })}
                />
              </div>
              <p className="text-xs text-muted-foreground">Default budget for all employees in this role. Can be overridden per employee.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || !form.name}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Employees Tab ────────────────────────────────────────────────────────────

function EmployeesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const { data: roles } = useSubResource<any>(customerId, "roles");
  const { data: teams } = useSubResource<any>(customerId, "teams");

  const { data: employees, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "employees", showInactive],
    queryFn: () => apiFetch(`/customers/${customerId}/employees${showInactive ? "?showInactive=true" : ""}`),
    enabled: !!customerId,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [sizes, setSizes] = useState<{ label: string; size: string }[]>([]);
  const [nameSearch, setNameSearch] = useState("");
  const [empRoleFilter, setEmpRoleFilter] = useState<number | null | "all">("all");
  const [empManagerFilter, setEmpManagerFilter] = useState<number | null | "all">("all");
  const [dupWarning, setDupWarning] = useState<string | null>(null);

  const blank = { firstName: "", lastName: "", employeeNumber: "", jobTitle: "", roleId: null as number | null, teamId: null as number | null, managerId: null as number | null, email: "", phone: "", notes: "" };
  const [form, setForm] = useState<typeof blank>(blank);

  const inv = () => {
    qc.invalidateQueries({ queryKey: ["customer", customerId, "employees"] });
    qc.invalidateQueries({ queryKey: ["customer", customerId, "employees", true] });
    qc.invalidateQueries({ queryKey: ["customer", customerId, "employees", false] });
  };

  const save = useMutation({
    mutationFn: async (data: any) => {
      const emp = editing
        ? await apiFetch(`/customers/${customerId}/employees/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : await apiFetch(`/customers/${customerId}/employees`, { method: "POST", body: JSON.stringify(data) });
      const empAny = emp as any;
      const empId = empAny.id;
      if (editing) {
        await apiFetch(`/customers/${customerId}/employees/${empId}/sizes`, { method: "DELETE" }).catch(() => {});
        const existingSizes = editing.sizes || [];
        for (const s of existingSizes) {
          await apiFetch(`/customers/${customerId}/employees/${empId}/sizes/${s.id}`, { method: "DELETE" }).catch(() => {});
        }
      }
      for (const s of sizes) {
        if (s.label && s.size) {
          await apiFetch(`/customers/${customerId}/employees/${empId}/sizes`, { method: "POST", body: JSON.stringify(s) });
        }
      }
      return emp;
    },
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: (err: any) => toast({ title: "Could not save employee", description: err?.message ?? "An unexpected error occurred", variant: "destructive" }),
  });

  const setActive = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/customers/${customerId}/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => { inv(); toast({ title: "Updated" }); },
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setSizes([]); setEditing(null); setOpen(true); };
  const openEdit = (e: any) => {
    setForm({
      firstName: e.firstName || "", lastName: e.lastName || "",
      employeeNumber: e.employeeNumber || "",
      jobTitle: e.jobTitle || "", roleId: e.roleId ?? null, teamId: e.teamId ?? null, managerId: e.managerId ?? null,
      email: e.email || "", phone: e.phone || "",
      notes: e.notes || "",
    });
    setSizes((e.sizes || []).map((s: any) => ({ label: s.label, size: s.size })));
    setEditing(e);
    setOpen(true);
  };

  const addSizeRow = () => setSizes(s => [...s, { label: "", size: "" }]);
  const updateSize = (i: number, field: "label" | "size", val: string) =>
    setSizes(s => s.map((row, idx) => idx === i ? { ...row, [field]: val } : row));
  const removeSize = (i: number) => setSizes(s => s.filter((_, idx) => idx !== i));

  const activeCount = employees?.filter(e => e.isActive).length ?? 0;
  const inactiveCount = employees?.filter(e => !e.isActive).length ?? 0;

  const handleSave = () => {
    if (!dupWarning) {
      const nameToCheck = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' ').toLowerCase();
      const dup = (employees ?? []).find((e: any) => {
        if (editing && e.id === editing.id) return false;
        const existing = [e.firstName, e.lastName].filter(Boolean).join(' ').toLowerCase();
        return existing === nameToCheck;
      });
      if (dup) {
        setDupWarning([dup.firstName, dup.lastName].filter(Boolean).join(' '));
        return;
      }
    }
    setDupWarning(null);
    save.mutate(form);
  };

  const filteredEmployees = (employees ?? []).filter((e: any) => {
    const fullName = [e.firstName, e.lastName].filter(Boolean).join(' ').toLowerCase();
    const matchesName = !nameSearch.trim() || fullName.includes(nameSearch.toLowerCase().trim());
    const matchesRole = empRoleFilter === "all" || e.roleId === empRoleFilter;
    const matchesManager = empManagerFilter === "all" || e.managerId === empManagerFilter;
    return matchesName && matchesRole && matchesManager;
  });

  return (
    <>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowInactive(false)}
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
              !showInactive ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}
          >
            Active {activeCount > 0 && `(${activeCount})`}
          </button>
          <button
            onClick={() => setShowInactive(true)}
            className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors",
              showInactive ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}
          >
            All incl. inactive {inactiveCount > 0 && `(+${inactiveCount} hidden)`}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              className="h-8 w-48 rounded-md border border-input bg-transparent pl-7 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Search by name..."
              value={nameSearch}
              onChange={e => setNameSearch(e.target.value)}
            />
            <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </div>
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Employee</Button>
        </div>
      </div>

      {(roles as any[])?.length > 0 && (
        <div className="flex items-center gap-1.5 mb-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Role:</span>
          <button onClick={() => setEmpRoleFilter("all")} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empRoleFilter === "all" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>All</button>
          <button onClick={() => setEmpRoleFilter(null)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empRoleFilter === null ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>No role</button>
          {(roles as any[]).map((r: any) => (
            <button key={r.id} onClick={() => setEmpRoleFilter(r.id)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empRoleFilter === r.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>{r.name}</button>
          ))}
        </div>
      )}
      {(employees as any[])?.some((e: any) => e.managerId) && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Manager:</span>
          <button onClick={() => setEmpManagerFilter("all")} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empManagerFilter === "all" ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>All</button>
          <button onClick={() => setEmpManagerFilter(null)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empManagerFilter === null ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>No manager</button>
          {(employees as any[])?.filter((e: any, i: number, arr: any[]) => e.managerId && arr.findIndex((m: any) => m.id === e.managerId) >= 0).reduce((acc: any[], e: any) => {
            const mgr = (employees as any[]).find((m: any) => m.id === e.managerId);
            if (mgr && !acc.find((a: any) => a.id === mgr.id)) acc.push(mgr);
            return acc;
          }, []).map((mgr: any) => (
            <button key={mgr.id} onClick={() => setEmpManagerFilter(mgr.id)} className={cn("px-2.5 py-1 rounded-full text-xs font-medium transition-colors", empManagerFilter === mgr.id ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>{[mgr.firstName, mgr.lastName].filter(Boolean).join(" ")}</button>
          ))}
        </div>
      )}

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !employees?.length ? <EmptyState icon={UserCheck} label="employees" onAdd={openAdd} />
        : filteredEmployees.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">No employees match your search.</div>
        )
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Team Manager</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead className="text-right w-28">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filteredEmployees.map((e: any) => (
              <TableRow key={e.id} className={cn("group hover:bg-muted/30", !e.isActive && "opacity-50")}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium">{[e.firstName, e.lastName].filter(Boolean).join(' ')}{e.employeeNumber && <span className="ml-2 text-[10px] font-mono text-muted-foreground">{e.employeeNumber}</span>}</p>
                      {!e.isActive && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-100 rounded px-1">Inactive</span>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                  {e.managerName
                    ? <span className="inline-flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5 text-indigo-500 shrink-0" />{e.managerName}</span>
                    : <span className="text-muted-foreground/40">—</span>}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.email || '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!e.isActive ? (
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-green-600 hover:bg-green-50 px-2" onClick={() => setActive.mutate({ id: e.id, isActive: true })}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:bg-amber-50" title="Deactivate" onClick={() => confirm("Deactivate this employee? They will be hidden from orders but kept for reporting.") && setActive.mutate({ id: e.id, isActive: false })}>
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(e)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Permanently delete this employee?") && del.mutate(e.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setDupWarning(null); } }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => { setDupWarning(null); setForm({ ...form, firstName: e.target.value }); }} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => { setDupWarning(null); setForm({ ...form, lastName: e.target.value }); }} /></div>
            </div>
            <div className="grid gap-2"><Label>Employee Number</Label><Input placeholder="e.g. EMP-001" value={form.employeeNumber} onChange={e => setForm({ ...form, employeeNumber: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Job Title</Label><Input placeholder="e.g. Sales Manager" value={form.jobTitle} onChange={e => setForm({ ...form, jobTitle: e.target.value })} /></div>
              <div className="grid gap-2">
                <Label>Role</Label>
                <Select value={form.roleId ? form.roleId.toString() : "none"} onValueChange={v => setForm({ ...form, roleId: v === "none" ? null : Number(v) })}>
                  <SelectTrigger><SelectValue placeholder="No role" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No role</SelectItem>
                    {(roles as any[])?.map((r: any) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Team Manager</Label>
              <ManagerCombobox
                employees={(employees as any[])?.filter((e: any) => e.id !== editing?.id && e.isActive !== false) ?? []}
                value={form.managerId}
                onChange={v => setForm({ ...form, managerId: v })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
            </div>

            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-sm font-medium">Preferred Sizes</Label>
                <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={addSizeRow}><Plus className="w-3 h-3 mr-1" />Add size</Button>
              </div>
              {sizes.length === 0 && <p className="text-xs text-muted-foreground italic">No sizes saved — click "Add size" to add one.</p>}
              <div className="grid gap-2">
                {sizes.map((s, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <Input className="flex-1" placeholder="Label (e.g. Shirt)" value={s.label} onChange={e => updateSize(i, "label", e.target.value)} />
                    <Input className="flex-1" placeholder="Size (e.g. L)" value={s.size} onChange={e => updateSize(i, "size", e.target.value)} />
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 shrink-0" onClick={() => removeSize(i)}><X className="w-3 h-3" /></Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-2"><Label>Notes</Label><Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          {dupWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              <span>An employee named <strong>{dupWarning}</strong> already exists. This may be intentional — click <strong>Save anyway</strong> to proceed, or edit the name above.</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setDupWarning(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || !form.firstName}>
              {save.isPending ? "Saving..." : dupWarning ? "Save anyway" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Wardrobe (Finished Items) Tab ───────────────────────────────────────────

interface WardrobeGroup {
  key: string;
  items: FinishedItem[];
  name: string;
  roleId: number | null;
  roleName: string | null;
  productId: number;
  productName: string | null;
  productSku: string | null;
  finishId: number | null;
  finishName: string | null;
  colour: string | null;
  unitPrice: number;
  specialPrice: number | null;
  totalStock: number;
  sizes: (string | null)[];
}

interface FinishedItem {
  id: number;
  customerId: number;
  roleId: number | null;
  roleName: string | null;
  name: string;
  productId: number;
  productName: string | null;
  productSku: string | null;
  finishId: number | null;
  finishName: string | null;
  colour: string | null;
  size: string | null;
  unitPrice: number;
  specialPrice: number | null;
  stockQuantity: number;
  notes: string | null;
}

// ─── Portal Access Tab ────────────────────────────────────────────────────────

const PORTAL_ROLES = [
  { value: "manager", label: "Manager", description: "Can submit orders directly to SBS and approve dept manager orders" },
  { value: "dept_manager", label: "Dept Manager", description: "Can create orders for their team (pending manager approval)" },
  { value: "member", label: "Member", description: "View-only access" },
] as const;

function roleBadge(role: string) {
  if (role === "manager") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">Manager</span>;
  if (role === "dept_manager") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">Dept Manager</span>;
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Member</span>;
}

function PortalAccessTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSelection, setInviteSelection] = useState<string>(""); // "emp:{id}" | "other" | ""
  const [inviteRole, setInviteRole] = useState<"manager" | "dept_manager" | "member">("member");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ inviteUrl: string; email: string } | null>(null);
  const [mobileEmailOpen, setMobileEmailOpen] = useState(false);
  const [mobileEmailAddr, setMobileEmailAddr] = useState("");
  const [mobileEmailName, setMobileEmailName] = useState("");
  const [copied, setCopied] = useState(false);
  const [previewHref, setPreviewHref] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);
  const [empPickerSearch, setEmpPickerSearch] = useState("");
  const [pickedEmployeeId, setPickedEmployeeId] = useState<number | null>(null);
  const [pickerRole, setPickerRole] = useState<"member" | "dept_manager" | "manager">("member");
  const [editEmailUser, setEditEmailUser] = useState<any | null>(null);
  const [editEmailValue, setEditEmailValue] = useState("");

  const { data: portalUsers, isLoading } = useQuery<any[]>({
    queryKey: ["portal-users", customerId],
    queryFn: () => apiFetch(`/portal/admin/users/${customerId}`),
  });

  const { data: customerDetail } = useQuery<any>({
    queryKey: ["portal-customer-detail", customerId],
    queryFn: () => apiFetch(`/portal/admin/customer-detail/${customerId}`),
  });
  const employees: any[] = customerDetail?.employees ?? [];
  const existingEmails = new Set((portalUsers ?? []).map((u: any) => u.email));
  const suggestedEmployees = employees.filter(e => e.email && !existingEmails.has(e.email));

  const sendInvite = useMutation({
    mutationFn: () => apiFetch("/portal/admin/invite", {
      method: "POST",
      body: JSON.stringify({ customerId, email: inviteEmail, portalRole: inviteRole }),
    }),
    onSuccess: (data: any) => {
      setInviteResult(data);
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const sendMobileInstructions = useMutation({
    mutationFn: ({ email, name }: { email: string; name: string }) =>
      apiFetch(`/portal/admin/send-mobile-instructions/${customerId}`, {
        method: "POST", body: JSON.stringify({ email, name }),
      }),
    onSuccess: (data: any) => {
      toast({ title: "Email sent", description: `Mobile app instructions sent to ${data.sentTo}` });
      setMobileEmailOpen(false);
      setMobileEmailAddr(""); setMobileEmailName("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const revokeUser = useMutation({
    mutationFn: (userId: number) => apiFetch(`/portal/admin/users/${userId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Access revoked" });
    },
  });

  const changeRole = useMutation({
    mutationFn: ({ userId, portalRole }: { userId: number; portalRole: string }) =>
      apiFetch(`/portal/admin/users/${userId}/role`, {
        method: "PATCH",
        body: JSON.stringify({ portalRole }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Role updated" });
    },
  });

  const changeEmail = useMutation({
    mutationFn: ({ userId, email }: { userId: number; email: string }) =>
      apiFetch(`/portal/admin/users/${userId}/email`, {
        method: "PATCH",
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-users", customerId] });
      toast({ title: "Email updated" });
      setEditEmailUser(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const copyLink = (url: string) => {
    const fullUrl = window.location.origin + url;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const openPreview = async (role: "manager" | "dept_manager" | "member" = "manager", employeeId?: number | null) => {
    setPreviewLoading(true);
    // Open a blank tab synchronously (within the click handler) so the browser
    // doesn't treat it as a popup. We navigate it to the real URL once we have the token.
    const newWindow = window.open("", "_blank");
    try {
      const data: any = await apiFetch(`/portal/admin/preview/${customerId}?role=${role}`, {
        method: "POST",
        body: JSON.stringify({ employeeId: employeeId ?? null }),
      });
      const href = window.location.origin + data.previewUrl;
      if (newWindow && !newWindow.closed) {
        newWindow.location.href = href;
      } else {
        // Fallback: popup was blocked — show the dialog with the link
        setPreviewHref(href);
      }
    } catch {
      if (newWindow && !newWindow.closed) newWindow.close();
      toast({ title: "Could not open preview", variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  };

  const statusBadge = (u: any) => {
    if (u.status === "active") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">Active</span>;
    if (u.status === "invited") return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">Invited</span>;
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">{u.status}</span>;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Portal Access</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Manage who can log into the customer ordering portal for this account.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("member"); setPickedEmployeeId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Employee
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("dept_manager"); setPickedEmployeeId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Team Manager
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setPickerRole("manager"); setPickedEmployeeId(null); setEmpPickerSearch(""); setEmpPickerOpen(true); }} disabled={previewLoading}>
            <Eye className="w-3.5 h-3.5" /> Preview as Manager
          </Button>

          {/* Employee picker — choose which employee to preview as */}
          <Dialog open={empPickerOpen} onOpenChange={v => { if (!v) setEmpPickerOpen(false); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Eye className="w-4 h-4" />
                  {pickerRole === "manager" ? "Preview as Manager" : pickerRole === "dept_manager" ? "Preview as Team Manager" : "Preview as Employee"}
                </DialogTitle>
                <DialogDescription>
                  {pickerRole === "manager"
                    ? "Choose which manager to view the portal as — you'll see all orders and the approval queue."
                    : pickerRole === "dept_manager"
                    ? "Choose which team manager to view the portal as — they'll see their own orders and My Team page."
                    : "Choose which employee to view the portal as — their wardrobe and sizes will be shown."}
                </DialogDescription>
              </DialogHeader>
              <div className="py-1 space-y-2">
                <Input
                  placeholder="Search by name, job title…"
                  value={empPickerSearch}
                  onChange={e => setEmpPickerSearch(e.target.value)}
                  autoFocus
                />
                <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                  <button
                    type="button"
                    onClick={() => setPickedEmployeeId(null)}
                    className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2", pickedEmployeeId === null && "bg-primary/10")}
                  >
                    <Check className={cn("w-3.5 h-3.5 shrink-0 text-primary", pickedEmployeeId === null ? "opacity-100" : "opacity-0")} />
                    <div>
                      <p className="font-medium">
                        {pickerRole === "manager" ? "Generic manager" : pickerRole === "dept_manager" ? "Generic team manager" : "Generic employee"}
                      </p>
                      <p className="text-xs text-muted-foreground">No specific person — no wardrobe pre-filter</p>
                    </div>
                  </button>
                  {employees
                    .filter((e: any) => {
                      // "Preview as Team Manager" — only show employees with Team Manager role
                      if (pickerRole === "dept_manager") {
                        if (!(e.role_name ?? "").toLowerCase().includes("team manager")) return false;
                      }
                      const term = empPickerSearch.toLowerCase().trim();
                      if (!term) return true;
                      return [e.name, e.first_name, e.last_name, e.job_title, e.role_name, e.email].filter(Boolean).join(" ").toLowerCase().includes(term);
                    })
                    .map((e: any) => {
                      const name = e.name || [e.first_name, e.last_name].filter(Boolean).join(" ") || "—";
                      const subtitle = [e.job_title, e.role_name, e.manager_name].filter(Boolean).join(" · ");
                      return (
                        <button
                          key={e.id}
                          type="button"
                          onClick={() => setPickedEmployeeId(e.id)}
                          className={cn("w-full text-left px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors flex items-center gap-2", pickedEmployeeId === e.id && "bg-primary/10")}
                        >
                          <Check className={cn("w-3.5 h-3.5 shrink-0 text-primary", pickedEmployeeId === e.id ? "opacity-100" : "opacity-0")} />
                          <div className="min-w-0">
                            <p className="font-medium truncate">{name}</p>
                            {subtitle && <p className="text-xs text-muted-foreground truncate">{subtitle}</p>}
                          </div>
                        </button>
                      );
                    })}
                  {employees.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">No active employees found.<br /><span className="text-xs">Add employees in the Employees tab first.</span></p>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEmpPickerOpen(false)}>Cancel</Button>
                <Button
                  disabled={previewLoading}
                  onClick={() => {
                    setEmpPickerOpen(false);
                    openPreview(pickerRole, pickedEmployeeId);
                  }}
                >
                  {previewLoading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Opening…</> : "Open Preview"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Preview link dialog — opens after token is generated */}
          <Dialog open={!!previewHref} onOpenChange={(o) => { if (!o) setPreviewHref(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Eye className="w-4 h-4" /> Portal Preview Ready</DialogTitle>
                <DialogDescription>Click the button below to open the portal preview. The link expires in 2 hours.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3 pt-1">
                <Button
                  className="w-full gap-2"
                  onClick={() => {
                    const href = previewHref;
                    setPreviewHref(null);
                    if (href) window.open(href, "_blank", "noopener,noreferrer");
                  }}
                >
                  <Eye className="w-4 h-4" /> Open Portal Preview
                </Button>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2">
                  <span className="text-xs text-muted-foreground truncate flex-1 font-mono">{previewHref}</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    onClick={() => { navigator.clipboard.writeText(previewHref ?? ""); toast({ title: "Link copied" }); }}
                  >
                    Copy
                  </button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setMobileEmailAddr(""); setMobileEmailName(""); setMobileEmailOpen(true); }}>
            <Smartphone className="w-3.5 h-3.5" /> Send App Instructions
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setInviteResult(null); setInviteEmail(""); setInviteRole("member"); setInviteOpen(true); }}>
            <LogIn className="w-3.5 h-3.5" /> Invite User
          </Button>

          {/* Mobile instructions dialog */}
          <Dialog open={mobileEmailOpen} onOpenChange={v => { if (!v) setMobileEmailOpen(false); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><Smartphone className="w-4 h-4" /> Send Mobile App Instructions</DialogTitle>
                <DialogDescription>Send an email explaining how to add the portal to their phone home screen like a native app.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3 py-1">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Recipient name</Label>
                  <Input placeholder="e.g. Jane Smith" value={mobileEmailName} onChange={e => setMobileEmailName(e.target.value)} />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Email address *</Label>
                  <Input type="email" placeholder="contact@customer.com" value={mobileEmailAddr} onChange={e => setMobileEmailAddr(e.target.value)} />
                </div>
                {suggestedEmployees.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    <span className="text-[10px] text-muted-foreground w-full">Quick-fill from employees:</span>
                    {suggestedEmployees.slice(0, 5).map((e: any) => (
                      <button key={e.id} type="button" onClick={() => { setMobileEmailAddr(e.email); setMobileEmailName([e.firstName, e.lastName].filter(Boolean).join(" ")); }}
                        className="text-[10px] px-2 py-0.5 rounded-full bg-muted hover:bg-muted/80 border border-border text-muted-foreground transition-colors">
                        {[e.firstName, e.lastName].filter(Boolean).join(" ")}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setMobileEmailOpen(false)}>Cancel</Button>
                <Button onClick={() => sendMobileInstructions.mutate({ email: mobileEmailAddr, name: mobileEmailName })} disabled={!mobileEmailAddr || sendMobileInstructions.isPending}>
                  {sendMobileInstructions.isPending ? "Sending…" : "Send Email"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : !portalUsers?.length ? (
        <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed border-border rounded-lg">
          <Globe className="w-8 h-8 text-muted-foreground/30 mb-2" />
          <p className="text-sm font-medium text-muted-foreground">No portal users yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Invite a customer contact to give them portal access</p>
        </div>
      ) : (
        <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Email</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">Last Login</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {portalUsers.map((u: any) => (
              <TableRow key={u.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium text-sm">{u.email?.toLowerCase()}</TableCell>
                <TableCell>{statusBadge(u)}</TableCell>
                <TableCell>
                  <Select
                    value={u.portal_role ?? "member"}
                    onValueChange={(v) => changeRole.mutate({ userId: u.id, portalRole: v })}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manager" className="text-xs">Manager</SelectItem>
                      <SelectItem value="dept_manager" className="text-xs">Dept Manager</SelectItem>
                      <SelectItem value="member" className="text-xs">Member</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {u.last_login_at ? formatDate(u.last_login_at) : <span className="text-muted-foreground/50">Never</span>}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 text-primary hover:bg-primary/10"
                      onClick={() => { setInviteEmail(u.email); setInviteRole(u.portal_role ?? "member"); setInviteResult(null); setInviteOpen(true); }}>
                      <LogIn className="w-3 h-3" /> Send link
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                      title="Edit email address"
                      onClick={() => { setEditEmailUser(u); setEditEmailValue(u.email ?? ""); }}>
                      <Edit2 className="w-3 h-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50"
                      onClick={() => confirm(`Revoke portal access for ${u.email}?`) && revokeUser.mutate(u.id)}>
                      <UserX className="w-3 h-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>
      )}

      {/* Edit email dialog */}
      <Dialog open={!!editEmailUser} onOpenChange={v => { if (!v) setEditEmailUser(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Email Address</DialogTitle>
            <DialogDescription>Update the email address for this portal user. They will need to use the new address to log in.</DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">Current email</Label>
              <p className="text-sm text-muted-foreground font-mono">{editEmailUser?.email}</p>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">New email *</Label>
              <Input
                type="email"
                placeholder="new@example.com"
                value={editEmailValue}
                onChange={e => setEditEmailValue(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && editEmailValue && editEmailUser) changeEmail.mutate({ userId: editEmailUser.id, email: editEmailValue }); }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditEmailUser(null)}>Cancel</Button>
            <Button
              onClick={() => editEmailUser && changeEmail.mutate({ userId: editEmailUser.id, email: editEmailValue })}
              disabled={!editEmailValue || editEmailValue === editEmailUser?.email || changeEmail.isPending}
            >
              {changeEmail.isPending ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Saving…</> : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Invite portal user dialog */}
      <Dialog open={inviteOpen} onOpenChange={v => { if (!v) { setInviteOpen(false); setInviteResult(null); setInviteSelection(""); setInviteEmail(""); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Invite Customer to Portal
            </DialogTitle>
          </DialogHeader>

          {!inviteResult ? (
            <div className="grid gap-4 py-2">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-blue-50 border border-blue-200">
                <Globe className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <p className="text-xs text-blue-800">
                  Generates a sign-in link for the customer. If email is working, we'll send it automatically — otherwise you can copy and share the link yourself.
                </p>
              </div>
              <div className="grid gap-2">
                <Label>Recipient *</Label>
                {suggestedEmployees.length > 0 ? (
                  <Select
                    value={inviteSelection}
                    onValueChange={val => {
                      setInviteSelection(val);
                      if (val === "other") {
                        setInviteEmail("");
                      } else {
                        const emp = suggestedEmployees.find((e: any) => String(e.id) === val);
                        setInviteEmail(emp?.email ?? "");
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an employee…" />
                    </SelectTrigger>
                    <SelectContent>
                      {suggestedEmployees.map((emp: any) => (
                        <SelectItem key={emp.id} value={String(emp.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{emp.name}</span>
                            {emp.email && <span className="text-muted-foreground text-xs">{emp.email.toLowerCase()}</span>}
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="other">
                        <span className="text-muted-foreground">Other (enter email manually)…</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="email" placeholder="contact@customer.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
                )}
              </div>
              {suggestedEmployees.length > 0 && inviteSelection === "other" && (
                <div className="grid gap-2">
                  <Label>Email Address *</Label>
                  <Input type="email" placeholder="contact@customer.com" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} autoFocus />
                </div>
              )}
              <div className="grid gap-2">
                <Label>Portal Role</Label>
                <Select value={inviteRole} onValueChange={(v: any) => setInviteRole(v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PORTAL_ROLES.map(r => (
                      <SelectItem key={r.value} value={r.value}>
                        <div>
                          <div className="font-medium">{r.label}</div>
                          <div className="text-xs text-muted-foreground">{r.description}</div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 py-2">
              {inviteResult.emailSent ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                  <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Email sent to {inviteResult.email}</p>
                    <p className="text-xs text-green-700 mt-0.5">The invite link has been emailed. Copy the link below as a backup in case it goes to spam.</p>
                  </div>
                </div>
              ) : inviteResult.emailError ? (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-red-50 border border-red-200">
                  <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">Email failed — copy and share the link manually</p>
                    <p className="text-xs text-red-700 mt-0.5 font-mono">{inviteResult.emailError}</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-amber-800">Email not configured — copy and share the link manually</p>
                    <p className="text-xs text-amber-700 mt-0.5">Send this link to {inviteResult.email} via Teams, Slack, or another channel.</p>
                  </div>
                </div>
              )}
              <div className="grid gap-2">
                <Label>Invite Link</Label>
                <div className="flex gap-2">
                  <Input readOnly value={window.location.origin + inviteResult.inviteUrl} className="font-mono text-xs" />
                  <Button variant="outline" size="sm" className="shrink-0 gap-1" onClick={() => copyLink(inviteResult.inviteUrl)}>
                    {copied ? <><CheckCircle2 className="w-3 h-3 text-green-600" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInviteOpen(false); setInviteResult(null); }}>
              {inviteResult ? "Close" : "Cancel"}
            </Button>
            {!inviteResult && (
              <Button onClick={() => sendInvite.mutate()} disabled={!inviteEmail || sendInvite.isPending}>
                {sendInvite.isPending ? "Generating…" : "Generate Sign-in Link"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}

function WardrobeStockCell({ item, onSave }: { item: FinishedItem; onSave: (qty: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(item.stockQuantity));
  const low = item.stockQuantity <= 5;
  const commit = () => {
    const num = parseInt(draft, 10);
    if (!isNaN(num) && num >= 0 && num !== item.stockQuantity) onSave(num);
    else setDraft(String(item.stockQuantity));
    setEditing(false);
  };
  if (editing) {
    return (
      <input
        type="number" min={0} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setDraft(String(item.stockQuantity)); setEditing(false); } }}
        className="w-16 text-right border rounded px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        autoFocus
      />
    );
  }
  return (
    <button
      onClick={() => { setDraft(String(item.stockQuantity)); setEditing(true); }}
      className={cn("tabular-nums font-mono text-sm px-2 py-0.5 rounded hover:bg-muted transition-colors", low ? "text-amber-700 font-semibold" : "text-muted-foreground")}
      title="Click to update stock"
    >
      {low && item.stockQuantity <= 0 ? "0" : item.stockQuantity}
    </button>
  );
}

function WardrobeTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: products } = useListProducts();
  const { data: items, isLoading } = useSubResource<FinishedItem>(customerId, "finished-items");
  const { data: finishes } = useSubResource<any>(customerId, "finishes");
  const { data: roles } = useSubResource<any>(customerId, "roles");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinishedItem | null>(null);
  const [editingGroup, setEditingGroup] = useState<WardrobeGroup | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<number | null | "all">("all");
  const [variantColours, setVariantColours] = useState<string[]>([]);
  const [variantSizes, setVariantSizes] = useState<string[]>([]);
  const [selectedColours, setSelectedColours] = useState<string[]>([]);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [freeTextColours, setFreeTextColours] = useState<string[]>([""]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const blank = { name: "", roleId: null as number | null, productId: 0, finishId: null as number | null, colour: "", size: "", unitPrice: "", specialPrice: "", stockQuantity: "0", notes: "" };
  const [form, setForm] = useState<typeof blank>(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "finished-items"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/finished-items/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/finished-items`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: (e: any) => toast({ title: "Error", description: e.message || "Could not save item", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/finished-items/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const dup = useMutation({
    mutationFn: (item: FinishedItem) => apiFetch(`/customers/${customerId}/finished-items`, {
      method: "POST",
      body: JSON.stringify({
        name: `${item.name} (copy)`,
        roleId: item.roleId ?? null,
        productId: item.productId,
        finishId: item.finishId ?? null,
        colour: item.colour ?? null,
        size: item.size ?? null,
        unitPrice: item.unitPrice,
        specialPrice: item.specialPrice ?? null,
        notes: item.notes ?? null,
      }),
    }),
    onSuccess: () => { inv(); toast({ title: "Item duplicated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message || "Could not duplicate", variant: "destructive" }),
  });

  const toggleExpanded = (key: string) => setExpandedGroups(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const openAdd = () => { setForm(blank); setEditing(null); setEditingGroup(null); setProductSearchOpen(false); setProductSearch(""); setVariantColours([]); setVariantSizes([]); setSelectedColours([]); setSelectedSizes([]); setFreeTextColours([""]); setOpen(true); };

  const toggleColour = (col: string) => {
    setSelectedColours(prev => {
      const next = prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col];
      if (next.length > 0 && selectedSizes.length === 0 && variantSizes.length > 0) {
        setSelectedSizes(variantSizes);
      }
      return next;
    });
  };

  const toggleSize = (sz: string) => {
    setSelectedSizes(prev => prev.includes(sz) ? prev.filter(s => s !== sz) : [...prev, sz]);
  };
  const openEdit = (item: FinishedItem) => {
    setForm({
      name: item.name,
      roleId: item.roleId ?? null,
      productId: item.productId,
      finishId: item.finishId ?? null,
      colour: item.colour ?? "",
      size: item.size ?? "",
      unitPrice: item.unitPrice.toFixed(2),
      specialPrice: item.specialPrice != null ? item.specialPrice.toFixed(2) : "",
      stockQuantity: String(item.stockQuantity ?? 0),
      notes: item.notes ?? "",
    });
    setEditing(item);
    setEditingGroup(null);
    setProductSearchOpen(false);
    setVariantColours([]);
    setVariantSizes([]);
    setSelectedColours([]);
    setSelectedSizes([]);
    setFreeTextColours([""]);
    // Load variant colours and sizes (also from attributes for products without size variants)
    Promise.all([
      apiFetch<any[]>(`/products/${item.productId}/variants`),
      apiFetch<any[]>(`/products/${item.productId}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const sizes = sortSizes([...new Set([...attrSizes, ...variantSizes])]);
      setVariantColours(colours);
      setVariantSizes(sizes);
    }).catch(() => {});
    setOpen(true);
  };

  const selectedProduct = products?.find(p => p.id === form.productId);

  const handleProductSelect = (productId: number) => {
    const prod = products?.find(p => p.id === productId);
    if (!prod) return;
    setProductSearchOpen(false);
    // WooCommerce product prices include the first logo/finish.
    // If a finish with extra logos is already selected, keep those additions.
    setForm(f => {
      const newBase = prod.unitPrice;
      const newPrice = calcPriceForFinish(newBase, f.finishId);
      return { ...f, productId: prod.id, unitPrice: newPrice.toFixed(2), colour: "", size: "", name: f.name || prod.name };
    });
    setVariantColours([]);
    setVariantSizes([]);
    setSelectedColours([]);
    setSelectedSizes([]);
    Promise.all([
      apiFetch<any[]>(`/products/${prod.id}/variants`),
      apiFetch<any[]>(`/products/${prod.id}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const sizes = sortSizes([...new Set([...attrSizes, ...variantSizes])]);
      setVariantColours(colours);
      setVariantSizes(sizes);
    }).catch(() => {});
  };

  const calcPriceForFinish = (basePrice: number, finishId: number | null): number => {
    if (!finishId) return basePrice;
    const finish = finishes?.find((f: any) => f.id === finishId);
    if (!finish || !finish.processes?.length) return basePrice;
    // WooCommerce price already includes the cheapest (first) logo.
    // Add the cost of any additional logos on top.
    const prices: number[] = finish.processes.map((p: any) => p.price ?? 0).sort((a: number, b: number) => a - b);
    const included = prices[0]; // cheapest = already baked into WooCommerce price
    const extra = finish.totalCost - included;
    return basePrice + Math.max(0, extra);
  };

  const handleFinishChange = (value: string) => {
    const base = selectedProduct?.unitPrice ?? parseFloat(form.unitPrice) ?? 0;
    if (value === "none") {
      setForm(f => ({ ...f, finishId: null, unitPrice: base.toFixed(2) }));
    } else {
      const finishId = Number(value);
      const newPrice = calcPriceForFinish(base, finishId);
      setForm(f => ({ ...f, finishId, unitPrice: newPrice.toFixed(2) }));
    }
  };

  const handleSave = async () => {
    if (!form.productId || !form.unitPrice) return;
    const effectiveName = form.name.trim() || selectedProduct?.name || "";
    const base = {
      name: effectiveName,
      roleId: form.roleId || null,
      productId: form.productId,
      finishId: form.finishId || null,
      unitPrice: parseFloat(form.unitPrice),
      specialPrice: form.specialPrice ? parseFloat(form.specialPrice) : null,
      stockQuantity: parseInt(form.stockQuantity, 10) || 0,
      notes: form.notes || null,
    };

    // Group edit: update shared fields on all items in the group (preserve each item's size)
    if (editingGroup) {
      setSaving(true);
      try {
        await Promise.all(editingGroup.items.map(item =>
          apiFetch(`/customers/${customerId}/finished-items/${item.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...base, colour: form.colour || null, size: item.size }),
          })
        ));
        inv();
        toast({ title: `Group updated (${editingGroup.items.length} items)` });
        setOpen(false); setEditing(null); setEditingGroup(null);
      } catch (e: any) {
        toast({ title: "Error", description: e.message || "Could not save", variant: "destructive" });
      } finally { setSaving(false); }
      return;
    }

    // Single item edit
    if (editing) {
      save.mutate({ ...base, colour: form.colour || null, size: form.size || null });
      return;
    }

    // Add mode: build colour list from chips (variant) or free-text inputs
    let colours: (string | null)[];
    if (variantColours.length > 0) {
      colours = selectedColours.length > 0 ? selectedColours : [null as string | null];
    } else {
      const free = freeTextColours.filter(Boolean);
      colours = free.length > 0 ? free : [form.colour || null];
    }
    const sizes = selectedSizes.length > 0 ? selectedSizes : [null as string | null];
    const combos = colours.flatMap(col => sizes.map(sz => ({ colour: col, size: sz })));

    if (combos.length === 1) {
      save.mutate({ ...base, colour: combos[0].colour, size: combos[0].size });
      return;
    }

    setSaving(true);
    try {
      await Promise.all(combos.map(({ colour, size }) =>
        apiFetch(`/customers/${customerId}/finished-items`, {
          method: "POST",
          body: JSON.stringify({ ...base, colour, size }),
        })
      ));
      inv();
      toast({ title: `${combos.length} items added` });
      setOpen(false);
      setEditing(null);
    } catch (e: any) {
      toast({ title: "Error", description: e.message || "Could not save items", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const filteredItems = items?.filter(item => {
    if (roleFilter === "all") return true;
    if (roleFilter === null) return item.roleId === null;
    return item.roleId === roleFilter;
  }) ?? [];

  const groups = useMemo<WardrobeGroup[]>(() => {
    const map = new Map<string, WardrobeGroup>();
    for (const item of filteredItems) {
      const key = [item.name, item.roleId ?? "", item.productId, item.finishId ?? "", item.colour ?? ""].join("|");
      if (!map.has(key)) {
        map.set(key, { key, items: [], name: item.name, roleId: item.roleId, roleName: item.roleName, productId: item.productId, productName: item.productName, productSku: item.productSku, finishId: item.finishId, finishName: item.finishName, colour: item.colour, unitPrice: item.unitPrice, specialPrice: item.specialPrice, totalStock: 0, sizes: [] });
      }
      const g = map.get(key)!;
      g.items.push(item);
      g.totalStock += (item.stockQuantity ?? 0);
      g.sizes.push(item.size);
    }
    return [...map.values()];
  }, [filteredItems]);

  const openGroupEdit = (group: WardrobeGroup) => {
    const first = group.items[0];
    setForm({ name: group.name, roleId: group.roleId ?? null, productId: group.productId, finishId: group.finishId ?? null, colour: group.colour ?? "", size: "", unitPrice: group.unitPrice.toFixed(2), specialPrice: group.specialPrice != null ? group.specialPrice.toFixed(2) : "", stockQuantity: "0", notes: first.notes ?? "" });
    setEditing(first);
    setEditingGroup(group);
    setProductSearchOpen(false);
    setVariantColours([]); setVariantSizes([]); setSelectedColours([]); setSelectedSizes([]);
    Promise.all([apiFetch<any[]>(`/products/${group.productId}/variants`), apiFetch<any[]>(`/products/${group.productId}/attributes`)]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const vs = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const as2 = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      setVariantColours(colours);
      setVariantSizes([...new Set([...as2, ...vs])]);
    }).catch(() => {});
    setOpen(true);
  };

  const WardrobeItemRow = ({ item }: { item: FinishedItem }) => (
    <TableRow key={item.id} className="group hover:bg-muted/30">
      <TableCell className="font-medium">
        <div>
          <p>{item.name}</p>
          {item.roleName && <span className="text-[10px] font-medium text-primary/70 bg-primary/5 border border-primary/10 rounded px-1">{item.roleName}</span>}
        </div>
      </TableCell>
      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
        {item.productName || "—"}
        {item.productSku && <span className="ml-1 text-xs text-muted-foreground/60">({item.productSku})</span>}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
        {item.finishName
          ? <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{item.finishName}</span>
          : <span className="text-muted-foreground/50">Plain</span>}
      </TableCell>
      <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatCurrency(item.unitPrice)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {item.specialPrice != null
          ? <span className="font-semibold text-emerald-600">{formatCurrency(item.specialPrice)}</span>
          : <span className="text-muted-foreground/40 text-xs">—</span>}
      </TableCell>
      <TableCell className="text-right">
        <WardrobeStockCell item={item} onSave={(qty) => save.mutate({ name: item.name, roleId: item.roleId, productId: item.productId, finishId: item.finishId, colour: item.colour, size: item.size, unitPrice: item.unitPrice, specialPrice: item.specialPrice, stockQuantity: qty, notes: item.notes })} />
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" title="Duplicate item" onClick={() => dup.mutate(item)} disabled={dup.isPending}><Copy className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this finished item?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

  const WardrobeGroupRow = ({ group }: { group: WardrobeGroup }) => {
    const isMulti = group.items.length > 1;
    const isExpanded = expandedGroups.has(group.key);
    const deleteGroup = () => {
      const msg = isMulti ? `Delete all ${group.items.length} sizes of "${group.name}"?` : `Delete "${group.name}"?`;
      if (!confirm(msg)) return;
      group.items.forEach(item => del.mutate(item.id));
    };
    return (
      <>
        <TableRow className="group hover:bg-muted/30">
          <TableCell className="font-medium">
            <div className="flex items-center gap-1">
              {isMulti && (
                <button className="text-muted-foreground hover:text-foreground shrink-0" onClick={() => toggleExpanded(group.key)} title={isExpanded ? "Collapse" : "Expand sizes"}>
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              )}
              <div>
                <p>{group.name}</p>
                {group.roleName && <span className="text-[10px] font-medium text-primary/70 bg-primary/5 border border-primary/10 rounded px-1">{group.roleName}</span>}
              </div>
            </div>
          </TableCell>
          <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
            {group.productName || "—"}
            {group.productSku && <span className="ml-1 text-xs text-muted-foreground/60">({group.productSku})</span>}
          </TableCell>
          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
            {group.finishName
              ? <span className="inline-flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{group.finishName}</span>
              : <span className="text-muted-foreground/50">Plain</span>}
          </TableCell>
          <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
            {isMulti ? (
              <div className="space-y-0.5">
                {group.colour && <span className="text-foreground/70">{group.colour}</span>}
                <div className="flex flex-wrap gap-0.5">
                  {sortSizes(group.sizes.filter(Boolean)).map((sz, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border font-medium text-foreground/60">{sz}</span>
                  ))}
                  {group.sizes.some(s => !s) && <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted border border-border font-medium text-foreground/60">—</span>}
                </div>
              </div>
            ) : (
              [group.colour, group.items[0].size].filter(Boolean).join(" / ") || "—"
            )}
          </TableCell>
          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{formatCurrency(group.unitPrice)}</TableCell>
          <TableCell className="text-right tabular-nums">
            {group.specialPrice != null
              ? <span className="font-semibold text-emerald-600">{formatCurrency(group.specialPrice)}</span>
              : <span className="text-muted-foreground/40 text-xs">—</span>}
          </TableCell>
          <TableCell className="text-right">
            {isMulti ? (
              <span className="tabular-nums text-sm text-muted-foreground">{group.totalStock}</span>
            ) : (
              <WardrobeStockCell item={group.items[0]} onSave={(qty) => save.mutate({ name: group.name, roleId: group.roleId, productId: group.productId, finishId: group.finishId, colour: group.colour, size: group.items[0].size, unitPrice: group.unitPrice, specialPrice: group.specialPrice, stockQuantity: qty, notes: group.items[0].notes })} />
            )}
          </TableCell>
          <TableCell className="text-right">
            <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isMulti && <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" title="Duplicate" onClick={() => dup.mutate(group.items[0])} disabled={dup.isPending}><Copy className="w-3 h-3" /></Button>}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" title={isMulti ? "Edit group" : "Edit"} onClick={() => isMulti ? openGroupEdit(group) : openEdit(group.items[0])}><Edit2 className="w-3 h-3" /></Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={deleteGroup}><Trash2 className="w-3 h-3" /></Button>
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && sortBySize(group.items, (i: any) => i.size).map(item => (
          <TableRow key={item.id} className="bg-muted/20 hover:bg-muted/30 group">
            <TableCell colSpan={3} className="pl-8 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-muted border border-border font-medium text-foreground/60">{item.size || "—"}</span>
              </span>
            </TableCell>
            <TableCell className="hidden md:table-cell" />
            <TableCell colSpan={2} />
            <TableCell className="text-right">
              <WardrobeStockCell item={item} onSave={(qty) => save.mutate({ name: item.name, roleId: item.roleId, productId: item.productId, finishId: item.finishId, colour: item.colour, size: item.size, unitPrice: item.unitPrice, specialPrice: item.specialPrice, stockQuantity: qty, notes: item.notes })} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this size?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </>
    );
  };

  return (
    <>
      <div className="flex justify-between items-center mb-3 flex-wrap gap-2">
        <p className="text-sm text-muted-foreground">Pre-configured items — company-wide or specific to a role.</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Item</Button>
      </div>

      {(roles as any[])?.length > 0 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button onClick={() => setRoleFilter("all")} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === "all" ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>All</button>
          <button onClick={() => setRoleFilter(null)} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === null ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>Company-wide</button>
          {(roles as any[]).map((r: any) => (
            <button key={r.id} onClick={() => setRoleFilter(r.id)} className={cn("px-3 py-1 rounded-full text-xs font-medium transition-colors", roleFilter === r.id ? "bg-primary text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>{r.name}</button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !filteredItems.length ? (
        <EmptyState icon={ShoppingBag} label="finished items" onAdd={openAdd} />
      ) : (
        <SubTable>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead className="hidden sm:table-cell">Product</TableHead>
              <TableHead className="hidden md:table-cell">Finish</TableHead>
              <TableHead className="hidden md:table-cell">Colour / Size</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Special Price</TableHead>
              <TableHead className="text-right">In Stock</TableHead>
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(group => <WardrobeGroupRow key={group.key} group={group} />)}
          </TableBody>
        </SubTable>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); setEditingGroup(null); } }}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingGroup
                ? `Edit Group — ${editingGroup.items.length} sizes`
                : editing ? "Edit Finished Item" : "Add Finished Item"}
            </DialogTitle>
            {editingGroup && <p className="text-xs text-muted-foreground pt-1">Changes to name, role, product, finish, colour, and price will apply to all {editingGroup.items.length} sizes.</p>}
          </DialogHeader>
          <div className="grid gap-4 py-2">

            <div className="grid gap-2">
              <Label>Name <span className="text-muted-foreground font-normal text-xs">(defaults to product name)</span></Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Optional — leave blank to use product name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="grid gap-2">
              <Label>Assign to Role</Label>
              <Select value={form.roleId ? form.roleId.toString() : "none"} onValueChange={v => setForm(f => ({ ...f, roleId: v === "none" ? null : Number(v) }))}>
                <SelectTrigger><SelectValue placeholder="Company-wide (no role)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Company-wide (no role)</SelectItem>
                  {(roles as any[])?.map((r: any) => <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Company-wide items appear for all orders; role items are shown when ordering for that role.</p>
            </div>

            <div className="grid gap-2">
              <Label>Product *</Label>
              <Popover open={productSearchOpen} onOpenChange={setProductSearchOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                    {selectedProduct ? selectedProduct.name : "Search products..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                  <Command shouldFilter={false}>
                    <CommandInput
                      placeholder="Type product name or SKU..."
                      value={productSearch}
                      onValueChange={setProductSearch}
                    />
                    <CommandList>
                      <CommandEmpty>No products found.</CommandEmpty>
                      <CommandGroup>
                        {(products ?? [])
                          .filter(p => {
                            const q = productSearch.toLowerCase();
                            if (!q) return true;
                            return (p.name ?? "").toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
                          })
                          .map(p => (
                            <CommandItem key={p.id} value={String(p.id)} onSelect={() => { handleProductSelect(p.id); setProductSearch(""); }}>
                              <Check className={cn("mr-2 h-4 w-4", form.productId === p.id ? "opacity-100" : "opacity-0")} />
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

            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> Finish</Label>
              <Select
                value={form.finishId ? form.finishId.toString() : "none"}
                onValueChange={handleFinishChange}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Plain (no finish)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Plain (no finish)</SelectItem>
                  {(finishes as any[])?.map((f: any) => (
                    <SelectItem key={f.id} value={f.id.toString()}>
                      {f.name}
                      {f.totalCost > 0 && <span className="ml-2 text-xs text-muted-foreground">+{formatCurrency(f.totalCost)}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Palette className="w-3 h-3" /> Colour</Label>
              {editing ? (
                /* Edit mode — single value */
                variantColours.length > 0 ? (
                  <Select value={form.colour || "__none__"} onValueChange={v => setForm(f => ({ ...f, colour: v === "__none__" ? "" : v }))}>
                    <SelectTrigger><SelectValue placeholder="Any colour" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Any colour</SelectItem>
                      {variantColours.map(col => <SelectItem key={col} value={col}>{col}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <input className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="e.g. Navy Blue (optional)" value={form.colour} onChange={e => setForm(f => ({ ...f, colour: e.target.value }))} />
                )
              ) : (
                /* Add mode — multi-select chips (variant) or dynamic free-text rows */
                variantColours.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {variantColours.map(col => (
                      <button key={col} type="button"
                        onClick={() => toggleColour(col)}
                        className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedColours.includes(col) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                      >{col}</button>
                    ))}
                    {variantColours.length > 1 && (
                      <button type="button" onClick={() => setSelectedColours(selectedColours.length === variantColours.length ? [] : [...variantColours])}
                        className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                        {selectedColours.length === variantColours.length ? "None" : "All"}
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {freeTextColours.map((col, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          placeholder="e.g. Navy Blue (optional)"
                          value={col}
                          onChange={e => {
                            const next = freeTextColours.map((c, idx) => idx === i ? e.target.value : c);
                            setFreeTextColours(next);
                            if (next.filter(Boolean).length > 0 && selectedSizes.length === 0 && variantSizes.length > 0) setSelectedSizes(variantSizes);
                          }}
                        />
                        {freeTextColours.length > 1 && (
                          <button type="button" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md border border-input text-muted-foreground hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-colors" onClick={() => setFreeTextColours(prev => prev.filter((_, idx) => idx !== i))}><X className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors py-0.5" onClick={() => setFreeTextColours(prev => [...prev, ""])}>
                      <Plus className="w-3 h-3" /> Add another colour
                    </button>
                  </div>
                )
              )}
            </div>

            {!editingGroup && <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Size</Label>
              {editing ? (
                /* Edit mode — single value */
                <Select value={form.size || "__none__"} onValueChange={v => setForm(f => ({ ...f, size: v === "__none__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="Any size" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Any size</SelectItem>
                    {(variantSizes.length > 0 ? variantSizes : DEFAULT_CLOTHING_SIZES).map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                /* Add mode — multi-select chips */
                <div className="flex flex-wrap gap-1.5">
                  {(variantSizes.length > 0 ? variantSizes : DEFAULT_CLOTHING_SIZES).map(sz => (
                    <button key={sz} type="button"
                      onClick={() => toggleSize(sz)}
                      className={cn("px-2.5 py-1 rounded-full text-xs font-medium border transition-colors", selectedSizes.includes(sz) ? "bg-primary text-white border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}
                    >{sz}</button>
                  ))}
                  <button type="button" onClick={() => { const all = variantSizes.length > 0 ? variantSizes : DEFAULT_CLOTHING_SIZES; setSelectedSizes(selectedSizes.length === all.length ? [] : [...all]); }}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/50 transition-colors">
                    {selectedSizes.length === (variantSizes.length > 0 ? variantSizes : DEFAULT_CLOTHING_SIZES).length ? "None" : "All"}
                  </button>
                </div>
              )}
              {!editing && !editingGroup && (() => {
                const colCount = variantColours.length > 0 ? (selectedColours.length || 1) : (freeTextColours.filter(Boolean).length || 1);
                const szCount = selectedSizes.length || 1;
                const total = colCount * szCount;
                return (colCount > 1 || szCount > 1) && (
                  <p className="text-xs text-muted-foreground">
                    Will create <strong>{total}</strong> wardrobe item{total > 1 ? "s" : ""}.
                  </p>
                );
              })()}
            </div>}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Unit Price *</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={form.unitPrice}
                  onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">WooCommerce price includes the first logo. Extra logos in the finish are added on top. Override manually if needed.</p>
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><PoundSterling className="w-3 h-3" /> Special Price</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Optional override"
                  value={form.specialPrice}
                  onChange={e => setForm(f => ({ ...f, specialPrice: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Customer-specific price override.</p>
              </div>
              {!editingGroup && <div className="grid gap-2">
                <Label className="flex items-center gap-1">Stock Qty</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={form.stockQuantity}
                  onChange={e => setForm(f => ({ ...f, stockQuantity: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Finished (branded) units in stock.</p>
              </div>}
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); setEditingGroup(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || saving || !form.productId || !form.unitPrice}>
              {(save.isPending || saving) ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Payment Methods Tab ──────────────────────────────────────────────────────

let stripePromise: ReturnType<typeof loadStripe> | null = null;
async function getStripePromise() {
  if (!stripePromise) {
    const res = await fetch("/api/stripe/publishable-key");
    if (!res.ok) throw new Error("Failed to load Stripe key");
    const { publishableKey } = await res.json();
    stripePromise = loadStripe(publishableKey);
  }
  return stripePromise;
}

function AddCardForm({ customerId, onSuccess }: { customerId: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setLoading(true);
    try {
      const { clientSecret } = await apiFetch(`/stripe/customers/${customerId}/setup-intent`, { method: "POST" });
      const card = elements.getElement(CardElement);
      if (!card) throw new Error("Card element not found");
      const result = await stripe.confirmCardSetup(clientSecret, { payment_method: { card } });
      if (result.error) throw new Error(result.error.message);
      toast({ title: "Card saved", description: "Payment method added successfully." });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-md border border-input bg-background p-3">
        <CardElement options={{ style: { base: { fontSize: "15px", color: "#1a1a1a", "::placeholder": { color: "#9ca3af" } } } }} />
      </div>
      <Button type="submit" disabled={!stripe || loading} className="w-full">
        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : <><CreditCard className="w-4 h-4 mr-2" /> Save Card</>}
      </Button>
    </form>
  );
}

function PaymentMethodsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [stripeReady, setStripeReady] = useState<ReturnType<typeof loadStripe> | null>(null);

  const { data, isLoading, error } = useQuery<{ paymentMethods: any[] }>({
    queryKey: ["stripe-payment-methods", customerId],
    queryFn: () => apiFetch(`/stripe/customers/${customerId}/payment-methods`),
    retry: false,
  });

  const deleteMut = useMutation({
    mutationFn: (pmId: string) => apiFetch(`/stripe/customers/${customerId}/payment-methods/${pmId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stripe-payment-methods", customerId] });
      toast({ title: "Card removed" });
    },
    onError: () => toast({ title: "Failed to remove card", variant: "destructive" }),
  });

  const openAdd = async () => {
    try {
      const sp = await getStripePromise();
      setStripeReady(sp);
      setShowAdd(true);
    } catch {
      toast({ title: "Stripe not available", description: "Could not connect to Stripe.", variant: "destructive" });
    }
  };

  const cardBrand = (brand: string) => brand.charAt(0).toUpperCase() + brand.slice(1);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-base">Saved Payment Methods</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Card details are stored securely by Stripe. SBS never sees raw card numbers.</p>
        </div>
        <Button size="sm" onClick={openAdd}>
          <Plus className="w-4 h-4 mr-1" /> Add Card
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : error ? (
        <div className="py-8 text-center text-muted-foreground">
          <AlertCircle className="w-8 h-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm">Could not load payment methods. Make sure Stripe is connected.</p>
        </div>
      ) : !data?.paymentMethods?.length ? (
        <div className="py-8 text-center text-muted-foreground">
          <CreditCard className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
          <p className="text-sm">No cards saved yet</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={openAdd}><Plus className="w-3 h-3 mr-1" /> Add Card</Button>
        </div>
      ) : (
        <div className="space-y-2">
          {data.paymentMethods.map((pm: any) => (
            <div key={pm.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
              <div className="flex items-center gap-3">
                <CreditCard className="w-5 h-5 text-muted-foreground" />
                <div>
                  <div className="font-medium text-sm">{cardBrand(pm.card.brand)} •••• {pm.card.last4}</div>
                  <div className="text-xs text-muted-foreground">Expires {pm.card.exp_month}/{pm.card.exp_year}</div>
                </div>
              </div>
              <Button
                variant="ghost" size="icon"
                className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                onClick={() => { if (confirm("Remove this card?")) deleteMut.mutate(pm.id); }}
                disabled={deleteMut.isPending}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CreditCard className="w-4 h-4" /> Add Payment Card</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Card details are sent directly to Stripe and never touch our servers.</p>
          {stripeReady && (
            <Elements stripe={stripeReady}>
              <AddCardForm
                customerId={customerId}
                onSuccess={() => {
                  setShowAdd(false);
                  qc.invalidateQueries({ queryKey: ["stripe-payment-methods", customerId] });
                }}
              />
            </Elements>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Bespoke Products Tab ─────────────────────────────────────────────────────

function BespokeProductsTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [variantForm, setVariantForm] = useState<{ colour: string; size: string; price: string }>({ colour: "", size: "", price: "" });
  const [addingVariantFor, setAddingVariantFor] = useState<number | null>(null);

  const blankForm = { name: "", sku: "", description: "", unitPrice: "", category: "", supplierCode: "", supplierPrice: "" };
  const [form, setForm] = useState(blankForm);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-products"] });

  const { data: products, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "bespoke-products"],
    queryFn: () => apiFetch(`/customers/${customerId}/bespoke-products`),
  });

  const variantQueries = useQuery<Record<number, any[]>>({
    queryKey: ["customer", customerId, "bespoke-product-variants", expanded],
    queryFn: async () => {
      const results: Record<number, any[]> = {};
      await Promise.all(
        [...expanded].map(async (productId) => {
          const v = await apiFetch<any[]>(`/customers/${customerId}/bespoke-products/${productId}/variants`);
          results[productId] = v;
        })
      );
      return results;
    },
    enabled: expanded.size > 0,
  });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/bespoke-products/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/bespoke-products`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); setForm(blankForm); },
    onError: () => toast({ title: "Error saving product", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/bespoke-products/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Product deleted" }); },
    onError: () => toast({ title: "Error deleting product", variant: "destructive" }),
  });

  const addVariant = useMutation({
    mutationFn: ({ productId, data }: { productId: number; data: any }) =>
      apiFetch(`/customers/${customerId}/bespoke-products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-product-variants"] }); setAddingVariantFor(null); setVariantForm({ colour: "", size: "", price: "" }); toast({ title: "Variant added" }); },
    onError: () => toast({ title: "Error adding variant", variant: "destructive" }),
  });

  const deleteVariant = useMutation({
    mutationFn: ({ productId, variantId }: { productId: number; variantId: number }) =>
      apiFetch(`/customers/${customerId}/bespoke-products/${productId}/variants/${variantId}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["customer", customerId, "bespoke-product-variants"] }); toast({ title: "Variant removed" }); },
    onError: () => toast({ title: "Error removing variant", variant: "destructive" }),
  });

  const openAdd = () => { setForm(blankForm); setEditing(null); setOpen(true); };
  const openEdit = (p: any) => {
    setForm({ name: p.name || "", sku: p.sku || "", description: p.description || "", unitPrice: String(p.unitPrice || ""), category: p.category || "", supplierCode: p.supplierCode || "", supplierPrice: p.supplierPrice != null ? String(p.supplierPrice) : "" });
    setEditing(p);
    setOpen(true);
  };

  const toggleExpand = (id: number) => setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleSave = () => {
    save.mutate({
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      unitPrice: parseFloat(form.unitPrice) || 0,
      category: form.category.trim() || null,
      supplierCode: form.supplierCode.trim() || null,
      supplierPrice: form.supplierPrice ? parseFloat(form.supplierPrice) : null,
    });
  };

  const variantData = variantQueries.data ?? {};

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-muted-foreground">Products exclusive to this customer — visible on their portal, not on WooCommerce.</p>
        </div>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Product</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !products?.length ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
          <Package className="w-10 h-10 opacity-30" />
          <p className="text-sm">No bespoke products yet. Add one to make it available on this customer's portal.</p>
          <Button size="sm" variant="outline" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add first product</Button>
        </div>
      ) : (
        <div className="border border-border/50 rounded-lg overflow-hidden divide-y divide-border/40">
          {products.map((p: any) => {
            const isExpanded = expanded.has(p.id);
            const variants: any[] = variantData[p.id] ?? [];
            return (
              <div key={p.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <button className="text-muted-foreground hover:text-foreground transition-colors" onClick={() => toggleExpand(p.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.name}</span>
                      {p.sku && <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{p.sku}</span>}
                      {p.category && <Badge variant="outline" className="text-xs">{p.category}</Badge>}
                      <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-200">Bespoke</Badge>
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{p.description}</p>}
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className="font-semibold text-sm">£{parseFloat(p.unitPrice).toFixed(2)}</span>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(p)}><Edit2 className="w-3.5 h-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:bg-red-50" onClick={() => { if (confirm("Delete this bespoke product?")) del.mutate(p.id); }}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="bg-muted/20 px-6 pb-4 pt-2 border-t border-border/30">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Variants (Colours / Sizes)</p>
                      <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setAddingVariantFor(addingVariantFor === p.id ? null : p.id)}>
                        <Plus className="w-3 h-3 mr-1" /> Add Variant
                      </Button>
                    </div>

                    {addingVariantFor === p.id && (
                      <div className="flex gap-2 mb-3 flex-wrap">
                        <Input placeholder="Colour" className="h-7 text-xs flex-1 min-w-24" value={variantForm.colour} onChange={e => setVariantForm(v => ({ ...v, colour: e.target.value }))} />
                        <Input placeholder="Size" className="h-7 text-xs flex-1 min-w-20" value={variantForm.size} onChange={e => setVariantForm(v => ({ ...v, size: e.target.value }))} />
                        <Input placeholder="Price (£)" type="number" className="h-7 text-xs flex-1 min-w-20" value={variantForm.price} onChange={e => setVariantForm(v => ({ ...v, price: e.target.value }))} />
                        <Button size="sm" className="h-7 text-xs px-3" onClick={() => addVariant.mutate({ productId: p.id, data: { colour: variantForm.colour || null, size: variantForm.size || null, price: variantForm.price ? parseFloat(variantForm.price) : null } })}>
                          {addVariant.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
                        </Button>
                      </div>
                    )}

                    {variantQueries.isLoading && expanded.has(p.id) ? (
                      <div className="py-2 text-xs text-muted-foreground">Loading...</div>
                    ) : variants.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">No variants — orders use the product's default price of £{parseFloat(p.unitPrice).toFixed(2)}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {variants.map((v: any) => (
                          <div key={v.id} className="flex items-center gap-1.5 bg-white border border-border/50 rounded-md px-2 py-1 text-xs">
                            {v.colour && <span className="flex items-center gap-1"><Palette className="w-3 h-3 text-muted-foreground" />{v.colour}</span>}
                            {v.size && <span className="flex items-center gap-1"><Ruler className="w-3 h-3 text-muted-foreground" />{v.size}</span>}
                            {v.price != null && <span className="font-semibold">£{parseFloat(v.price).toFixed(2)}</span>}
                            <button className="text-red-400 hover:text-red-600 ml-0.5" onClick={() => deleteVariant.mutate({ productId: p.id, variantId: v.id })}><X className="w-3 h-3" /></button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) { setEditing(null); setForm(blankForm); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Package className="w-4 h-4" /> {editing ? "Edit Bespoke Product" : "Add Bespoke Product"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Product Name *</Label>
                <Input placeholder="e.g. Company Polo Shirt" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <Label>SKU / Code</Label>
                <Input placeholder="e.g. CUST-001" value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} />
              </div>
              <div>
                <Label>Category</Label>
                <Input placeholder="e.g. Polo Shirts" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <Label>Unit Price (£) *</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.unitPrice} onChange={e => setForm(f => ({ ...f, unitPrice: e.target.value }))} />
              </div>
              <div>
                <Label>Supplier Code</Label>
                <Input placeholder="e.g. FCC1919" value={form.supplierCode} onChange={e => setForm(f => ({ ...f, supplierCode: e.target.value }))} />
              </div>
              <div>
                <Label>Supplier Cost (£)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.supplierPrice} onChange={e => setForm(f => ({ ...f, supplierPrice: e.target.value }))} />
              </div>
              <div className="col-span-2">
                <Label>Description</Label>
                <Textarea placeholder="Optional description of the product" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name.trim() || !form.unitPrice || save.isPending}>
              {save.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Saving...</> : "Save Product"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Main CustomerDetail Page ─────────────────────────────────────────────────

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const customerId = Number(id);
  const [, navigate] = useLocation();

  const { data: customer, isLoading } = useGetCustomer(customerId);

  // Must be declared before any early returns to comply with React's Rules of Hooks.
  const xeroContactId = customer ? ((customer as any).xeroContactId as string | null) : null;
  const { data: xeroBalance, isLoading: xeroBalanceLoading } = useQuery<{
    arOutstanding: number; arOverdue: number; apOutstanding: number; apOverdue: number;
  }>({
    queryKey: ["xero-balance-customer", customerId],
    queryFn: () => apiFetch(`/xero/balance/customer/${customerId}`),
    enabled: !!xeroContactId,
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const { data: invoiceSummary } = useQuery<{
    balanceDue: string;
    overdueTotal: string;
    unpaidCount: number;
    overdueCount: number;
    overdueInvoices: Array<{
      id: number;
      orderNumber: string;
      amount: string;
      invoicedAt: string;
      daysOverdue: number;
      xeroInvoiceId: string | null;
      xeroInvoiceStatus: string | null;
    }>;
  }>({
    queryKey: ["customer-invoice-summary", customerId],
    queryFn: () => apiFetch(`/customers/${customerId}/invoice-summary`),
    enabled: !!customerId,
    staleTime: 1000 * 60 * 2,
    retry: false,
  });

  const queryClient = useQueryClient();
  const [logoUrl, setLogoUrl] = useState<string>("");
  const [logoSaving, setLogoSaving] = useState(false);
  const { toast } = useToast();
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  const { uploadFile: uploadLogoFile, isUploading: isLogoUploading } = useUpload({
    onSuccess: async (res) => {
      const url = `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}`;
      setLogoUrl(url);
      try {
        await apiFetch(`/customers/${customerId}`, {
          method: "PATCH",
          body: JSON.stringify({ logoUrl: url }),
        });
        queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
        toast({ title: "Logo uploaded and saved" });
      } catch {
        toast({ title: "Uploaded but failed to save", variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Upload failed", description: "Could not upload logo", variant: "destructive" }),
  });

  useEffect(() => {
    setLogoUrl((customer as any)?.logoUrl || "");
  }, [customer]);

  const saveLogo = async () => {
    setLogoSaving(true);
    try {
      await apiFetch(`/customers/${customerId}`, {
        method: "PATCH",
        body: JSON.stringify({ logoUrl: logoUrl.trim() || null }),
      });
      queryClient.invalidateQueries({ queryKey: ["customer", customerId] });
      toast({ title: "Logo saved" });
    } catch {
      toast({ title: "Failed to save logo", variant: "destructive" });
    } finally {
      setLogoSaving(false);
    }
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!customer) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Customer not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/customers")}>Back to Customers</Button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => navigate("/customers")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 flex items-start justify-between gap-6">
            {/* Left: name + contact info + logo URL input */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                {!(customer as any).logoUrl && <Building2 className="w-6 h-6 text-muted-foreground shrink-0" />}
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{toTitleCase(customer.name)}</h1>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
                {(customer.contactFirstName || customer.contactLastName) && (
                  <span>Contact: {toTitleCase([customer.contactFirstName, customer.contactLastName].filter(Boolean).join(' '))}</span>
                )}
                {customer.email && <span>{customer.email.toLowerCase()}</span>}
                {customer.phone && (
                  <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 font-medium text-foreground hover:text-primary transition-colors">
                    <Phone className="w-3.5 h-3.5 shrink-0" /> {formatUKPhone(customer.phone)}
                  </a>
                )}
                {(customer as any).address && <span>{(customer as any).address}</span>}
                {customer.state && <span>{customer.state}</span>}
                {(customer.city || (customer as any).postcode) && (
                  <span>
                    {customer.city}{(customer as any).postcode ? ` ${(customer as any).postcode}` : ''}
                  </span>
                )}
                {(customer as any).defaultShippingService && <span className="inline-flex items-center gap-1">📦 {(customer as any).defaultShippingService}</span>}
              </div>
              <div className="flex items-center gap-2 mt-3">
                <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                <Input
                  value={logoUrl}
                  onChange={e => setLogoUrl(e.target.value)}
                  placeholder="Customer logo URL (https://...)"
                  className="h-7 text-xs w-56"
                />
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*,.pdf,.eps,.ai"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogoFile(f); e.target.value = ""; }}
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 shrink-0"
                  disabled={isLogoUploading}
                  onClick={() => logoFileInputRef.current?.click()}
                  title="Upload a logo file from your computer"
                >
                  {isLogoUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                  {isLogoUploading ? "Uploading…" : "Upload"}
                </Button>
                {logoUrl !== ((customer as any).logoUrl || "") && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={saveLogo} disabled={logoSaving}>
                    {logoSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </Button>
                )}
                {logoUrl && logoUrl === ((customer as any).logoUrl || "") && (
                  <span className="text-xs text-muted-foreground/60">Saved · shows on portal</span>
                )}
              </div>
            </div>

            {/* Right: large logo preview */}
            <div className="shrink-0 flex flex-col items-center gap-1.5">
              {logoUrl ? (
                /\.(pdf|eps|ai)(\?|$)/i.test(logoUrl) ? (
                  <div className="h-28 w-40 rounded-xl border border-border/40 bg-muted/10 p-2 shadow-sm flex flex-col items-center justify-center gap-2">
                    <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
                    <span className="text-[11px] text-muted-foreground text-center font-medium px-2 break-all line-clamp-2">
                      {logoUrl.split("/").pop()}
                    </span>
                    <span className="text-[10px] text-muted-foreground/50">Stored · not previewable</span>
                  </div>
                ) : (
                  <img
                    src={logoUrl}
                    alt="Logo preview"
                    className="h-28 w-auto max-w-[220px] object-contain rounded-xl border border-border/40 bg-muted/10 p-2 shadow-sm"
                    onError={e => { (e.target as HTMLImageElement).style.opacity = "0.2"; }}
                    onLoad={e => { (e.target as HTMLImageElement).style.opacity = "1"; }}
                  />
                )
              ) : (
                <div className="h-28 w-40 rounded-xl border-2 border-dashed border-border/40 flex flex-col items-center justify-center gap-2 bg-muted/20">
                  <ImageIcon className="w-8 h-8 text-muted-foreground/25" />
                  <span className="text-xs text-muted-foreground/40">No logo</span>
                </div>
              )}
              <span className="text-[10px] text-muted-foreground/40">Portal preview</span>
            </div>
          </div>
        </div>

        {/* Invoice balance summary */}
        {(invoiceSummary || xeroContactId) && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              {/* Balance Due chip */}
              {invoiceSummary && (
                <div className={cn(
                  "flex items-center gap-3 px-4 py-3 rounded-lg border text-sm",
                  parseFloat(invoiceSummary.balanceDue) > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"
                )}>
                  <TrendingUp className={cn("w-4 h-4", parseFloat(invoiceSummary.balanceDue) > 0 ? "text-amber-600" : "text-green-600")} />
                  <div>
                    <div className="font-semibold text-foreground">{formatCurrency(parseFloat(invoiceSummary.balanceDue))} balance due</div>
                    <div className="text-xs text-muted-foreground">{invoiceSummary.unpaidCount} unpaid invoice{invoiceSummary.unpaidCount !== 1 ? "s" : ""}</div>
                  </div>
                </div>
              )}
              {/* Overdue chip */}
              {invoiceSummary && invoiceSummary.overdueCount > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-red-50 border-red-200 text-sm">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <div>
                    <div className="font-semibold text-red-700">{formatCurrency(parseFloat(invoiceSummary.overdueTotal))} overdue</div>
                    <div className="text-xs text-red-500">{invoiceSummary.overdueCount} invoice{invoiceSummary.overdueCount !== 1 ? "s" : ""} past 14 days</div>
                  </div>
                </div>
              )}
              {/* Xero live balance chip */}
              {xeroContactId && (
                xeroBalanceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground px-3 py-3">
                    <Loader2 className="w-4 h-4 animate-spin" /> Xero balance…
                  </div>
                ) : xeroBalance ? (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-muted/30 border-border/50 text-sm">
                    <TrendingUp className="w-4 h-4 text-muted-foreground" />
                    <div>
                      <div className="font-semibold text-foreground">{formatCurrency(xeroBalance.arOutstanding)} AR (Xero)</div>
                      <div className="text-xs text-muted-foreground">Live from Xero</div>
                    </div>
                  </div>
                ) : null
              )}
            </div>

            {/* Overdue invoices list */}
            {invoiceSummary && invoiceSummary.overdueInvoices.length > 0 && (
              <div className="rounded-lg border border-red-200 bg-red-50/50 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-red-200 bg-red-50">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm font-semibold text-red-700">Overdue Invoices</span>
                </div>
                <div className="divide-y divide-red-100">
                  {invoiceSummary.overdueInvoices.map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between px-4 py-2.5 hover:bg-red-50 cursor-pointer transition-colors"
                      onClick={() => navigate(`/orders/${inv.id}`)}
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-medium text-foreground">{inv.orderNumber}</span>
                        <span className="text-xs text-red-600 font-medium">
                          {inv.daysOverdue} day{inv.daysOverdue !== 1 ? "s" : ""} overdue
                        </span>
                        {inv.xeroInvoiceStatus && (
                          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{inv.xeroInvoiceStatus}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold text-red-700">{formatCurrency(parseFloat(inv.amount))}</span>
                        <span className="text-xs text-muted-foreground">{formatDate(inv.invoicedAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Tabs defaultValue="employees">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="employees" className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Employees</TabsTrigger>
            <TabsTrigger value="roles" className="flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Roles</TabsTrigger>
            <TabsTrigger value="teams" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Teams</TabsTrigger>
            <TabsTrigger value="wardrobe" className="flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Wardrobe</TabsTrigger>
            <TabsTrigger value="addresses" className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Delivery Addresses</TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Contacts</TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Order History</TabsTrigger>
            <TabsTrigger value="processes" className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Processes</TabsTrigger>
            <TabsTrigger value="finishes" className="flex items-center gap-1.5"><Shirt className="w-3.5 h-3.5" /> Finishes</TabsTrigger>
            <TabsTrigger value="bespoke" className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Bespoke Products</TabsTrigger>
            <TabsTrigger value="portal" className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" /> Portal Access</TabsTrigger>
            <TabsTrigger value="payments" className="flex items-center gap-1.5"><CreditCard className="w-3.5 h-3.5" /> Payment Methods</TabsTrigger>
          </TabsList>

          <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
            <TabsContent value="employees" className="mt-0"><EmployeesTab customerId={customerId} /></TabsContent>
            <TabsContent value="roles" className="mt-0"><RolesTab customerId={customerId} /></TabsContent>
            <TabsContent value="teams" className="mt-0"><TeamsTab customerId={customerId} /></TabsContent>
            <TabsContent value="wardrobe" className="mt-0"><WardrobeTab customerId={customerId} /></TabsContent>
            <TabsContent value="addresses" className="mt-0"><AddressesTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="contacts" className="mt-0"><ContactsTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="orders" className="mt-0"><OrderHistoryTab customerId={customerId} /></TabsContent>
            <TabsContent value="processes" className="mt-0"><ProcessesTab customerId={customerId} /></TabsContent>
            <TabsContent value="finishes" className="mt-0"><FinishesTab customerId={customerId} /></TabsContent>
            <TabsContent value="bespoke" className="mt-0"><BespokeProductsTab customerId={customerId} /></TabsContent>
            <TabsContent value="portal" className="mt-0"><PortalAccessTab customerId={customerId} /></TabsContent>
            <TabsContent value="payments" className="mt-0"><PaymentMethodsTab customerId={customerId} /></TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
