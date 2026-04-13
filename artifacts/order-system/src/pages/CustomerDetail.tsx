import { useState } from "react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Edit2, Trash2, Loader2, X, Building2, MapPin, Users, History, Layers, Shirt, UserCheck, Boxes, PoundSterling, ShoppingBag, Check, ChevronsUpDown, Palette, Ruler, Sparkles, TrendingUp, AlertCircle, ImageIcon, Upload, Eye } from "lucide-react";
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
  if (!res.ok) throw new Error(await res.text());
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
  const blank = { label: "", line1: "", line2: "", city: "", county: "", postcode: "", country: "United Kingdom", notes: "" };
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
      county: customer?.state || "",
      postcode: customer?.postcode || "",
      country: "United Kingdom",
      notes: "",
    });
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (a: any) => { setForm({ label: a.label||"", line1: a.line1||"", line2: a.line2||"", city: a.city||"", county: a.county||"", postcode: a.postcode||"", country: a.country||"United Kingdom", notes: a.notes||"" }); setEditing(a); setOpen(true); };

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
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>City</Label><Input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
              <div className="grid gap-2"><Label>County</Label><Input value={form.county} onChange={e => setForm({ ...form, county: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
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
                <TableCell className="font-medium">{[c.firstName, c.lastName].filter(Boolean).join(' ')}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.jobTitle || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{c.email || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.phone || '—'}</TableCell>
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
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wide ${statusColour[o.status] || statusColour.draft}`}>
                {o.status?.replace(/_/g, ' ')}
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

interface ProcessStockItem { id: number; name: string; sku: string | null; unitCost: number; }

function ProcessesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: processes, isLoading } = useSubResource<any>(customerId, "processes");
  const { data: allProcessStock } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock", "customer", customerId],
    queryFn: () => apiFetch(`/process-stock?customerId=${customerId}`),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", type: "", placement: "", price: "", processStockId: "", imageUrl: "", notes: "" };
  const [form, setForm] = useState(blank);

  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => {
      setForm(f => ({ ...f, imageUrl: `/api/storage${res.objectPath}` }));
      toast({ title: "Image uploaded" });
    },
    onError: () => toast({ title: "Upload failed", description: "Could not upload image", variant: "destructive" }),
  });

  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ name: "", sku: "" });

  const invStock = () => qc.invalidateQueries({ queryKey: ["process-stock", "customer", customerId] });
  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "processes"] });

  const quickAdd = useMutation({
    mutationFn: (data: { name: string; sku: string | null }) =>
      apiFetch("/process-stock", { method: "POST", body: JSON.stringify({ ...data, customerId, unitCost: 0, stockQuantity: 0 }) }),
    onSuccess: (newItem: any) => {
      invStock();
      setForm(f => ({ ...f, processStockId: String(newItem.id) }));
      setQuickAddOpen(false);
      setQuickAddForm({ name: "", sku: "" });
      toast({ title: "Stock item created", description: `${newItem.name} added and selected.` });
    },
    onError: () => toast({ title: "Error", description: "Could not create stock item", variant: "destructive" }),
  });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/processes/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/processes`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save process", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/processes/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const typeColour: Record<string, string> = { embroidery: "bg-purple-100 text-purple-700", print: "bg-blue-100 text-blue-700", other: "bg-gray-100 text-gray-700" };

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
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
    setEditing(p);
    setOpen(true);
  };

  const handleSave = () => {
    save.mutate({
      name: form.name,
      type: form.type || null,
      placement: form.placement || null,
      price: form.price ? parseFloat(form.price) : null,
      processStockId: form.processStockId ? parseInt(form.processStockId, 10) : null,
      imageUrl: form.imageUrl || null,
      notes: form.notes || null,
    });
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
                      <img src={p.imageUrl} alt={p.name} className="w-8 h-8 object-cover rounded border border-border hover:opacity-80 transition-opacity" />
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
                  setForm({ ...form, type: newType, processStockId: newType === "DTF" ? form.processStockId : "" });
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
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-1"><Boxes className="w-3 h-3" /> Process Stock Item</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs text-primary hover:bg-primary/10 gap-1"
                    onClick={() => { setQuickAddForm({ name: "", sku: "" }); setQuickAddOpen(true); }}>
                    <Plus className="w-3 h-3" /> New
                  </Button>
                </div>
                <Select value={form.processStockId || "none"} onValueChange={v => setForm({ ...form, processStockId: v === "none" ? "" : v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Link stock item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allProcessStock?.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.sku ? `${s.sku} — ${s.name}` : s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><ImageIcon className="w-3 h-3" /> Reference Image</Label>
              {form.imageUrl ? (
                <div className="relative group w-full">
                  <img src={form.imageUrl} alt="Process reference" className="w-full h-36 object-cover rounded-md border border-border" />
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
            <Button onClick={handleSave} disabled={save.isPending || !form.name || isUploading}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-add process stock item */}
      <Dialog open={quickAddOpen} onOpenChange={v => { if (!v) setQuickAddOpen(false); }}>
        <DialogContent className="sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Boxes className="w-4 h-4" /> Add Process Stock Item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Name *</Label>
              <Input
                placeholder="e.g. Netty Stars Large Logo"
                value={quickAddForm.name}
                onChange={e => setQuickAddForm(f => ({ ...f, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label>Product Code</Label>
              <Input
                placeholder="e.g. FCC4998"
                value={quickAddForm.sku}
                onChange={e => setQuickAddForm(f => ({ ...f, sku: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickAddOpen(false)}>Cancel</Button>
            <Button
              disabled={quickAdd.isPending || !quickAddForm.name.trim()}
              onClick={() => quickAdd.mutate({ name: quickAddForm.name.trim(), sku: quickAddForm.sku.trim() || null })}
            >
              {quickAdd.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Creating...</> : "Create & Select"}
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

// ─── Roles Tab ────────────────────────────────────────────────────────────────

function RolesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: roles, isLoading } = useSubResource<any>(customerId, "roles");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "" };
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
  const openEdit = (r: any) => { setForm({ name: r.name || "", description: r.description || "" }); setEditing(r); setOpen(true); };

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
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {roles.map((r: any) => (
              <TableRow key={r.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{r.description || '—'}</TableCell>
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

// ─── Employees Tab ────────────────────────────────────────────────────────────

function EmployeesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const { data: roles } = useSubResource<any>(customerId, "roles");

  const { data: employees, isLoading } = useQuery<any[]>({
    queryKey: ["customer", customerId, "employees", showInactive],
    queryFn: () => apiFetch(`/customers/${customerId}/employees${showInactive ? "?showInactive=true" : ""}`),
    enabled: !!customerId,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [sizes, setSizes] = useState<{ label: string; size: string }[]>([]);

  const blank = { firstName: "", lastName: "", jobTitle: "", roleId: null as number | null, email: "", phone: "", department: "", notes: "" };
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
    onError: () => toast({ title: "Error", description: "Could not save employee", variant: "destructive" }),
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
      jobTitle: e.jobTitle || "", roleId: e.roleId ?? null,
      email: e.email || "", phone: e.phone || "",
      department: e.department || "", notes: e.notes || "",
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

  return (
    <>
      <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
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
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Employee</Button>
      </div>

      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !employees?.length ? <EmptyState icon={UserCheck} label="employees" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="hidden sm:table-cell">Job Title / Role</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead className="text-right w-28">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {employees.map((e: any) => (
              <TableRow key={e.id} className={cn("group hover:bg-muted/30", !e.isActive && "opacity-50")}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="font-medium">{[e.firstName, e.lastName].filter(Boolean).join(' ')}</p>
                      {!e.isActive && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-100 rounded px-1">Inactive</span>}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                  <div>
                    {e.jobTitle && <p>{e.jobTitle}</p>}
                    {e.roleName && <p className="text-xs text-primary/70">{e.roleName}</p>}
                    {!e.jobTitle && !e.roleName && '—'}
                  </div>
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

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>
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
            <div className="grid gap-2"><Label>Department</Label><Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></div>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.firstName}>{save.isPending ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Wardrobe (Finished Items) Tab ───────────────────────────────────────────

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
  notes: string | null;
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
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<number | null | "all">("all");
  const [variantColours, setVariantColours] = useState<string[]>([]);
  const [variantSizes, setVariantSizes] = useState<string[]>([]);

  const blank = { name: "", roleId: null as number | null, productId: 0, finishId: null as number | null, colour: "", size: "", unitPrice: "", specialPrice: "", notes: "" };
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

  const openAdd = () => { setForm(blank); setEditing(null); setProductSearchOpen(false); setProductSearch(""); setVariantColours([]); setVariantSizes([]); setOpen(true); };
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
      notes: item.notes ?? "",
    });
    setEditing(item);
    setProductSearchOpen(false);
    setVariantColours([]);
    setVariantSizes([]);
    // Load variant colours and sizes (also from attributes for products without size variants)
    Promise.all([
      apiFetch<any[]>(`/products/${item.productId}/variants`),
      apiFetch<any[]>(`/products/${item.productId}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const sizes = [...new Set([...attrSizes, ...variantSizes])];
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
    const currentFinishCost = form.finishId
      ? ((finishes as any[])?.find((f: any) => f.id === form.finishId)?.totalCost ?? 0)
      : 0;
    const newPrice = prod.unitPrice + currentFinishCost;
    setForm(f => ({ ...f, productId: prod.id, unitPrice: newPrice.toFixed(2), colour: "", size: "" }));
    setVariantColours([]);
    setVariantSizes([]);
    Promise.all([
      apiFetch<any[]>(`/products/${prod.id}/variants`),
      apiFetch<any[]>(`/products/${prod.id}/attributes`),
    ]).then(([variants, attrs]) => {
      const colours = [...new Set(variants.map((x: any) => x.colour).filter(Boolean))] as string[];
      const variantSizes = variants.map((x: any) => x.size).filter(Boolean) as string[];
      const attrSizes = attrs.filter((a: any) => a.type === "size").map((a: any) => a.value) as string[];
      const sizes = [...new Set([...attrSizes, ...variantSizes])];
      setVariantColours(colours);
      setVariantSizes(sizes);
    }).catch(() => {});
  };

  const handleFinishChange = (value: string) => {
    const base = selectedProduct?.unitPrice ?? parseFloat(form.unitPrice) ?? 0;
    if (value === "none") {
      setForm(f => ({ ...f, finishId: null, unitPrice: base.toFixed(2) }));
    } else {
      const finish = (finishes as any[])?.find((f: any) => f.id.toString() === value);
      const total = base + (finish?.totalCost ?? 0);
      setForm(f => ({ ...f, finishId: Number(value), unitPrice: total.toFixed(2) }));
    }
  };

  const handleSave = () => {
    if (!form.name || !form.productId || !form.unitPrice) return;
    save.mutate({
      name: form.name,
      roleId: form.roleId || null,
      productId: form.productId,
      finishId: form.finishId || null,
      colour: form.colour || null,
      size: form.size || null,
      unitPrice: parseFloat(form.unitPrice),
      specialPrice: form.specialPrice ? parseFloat(form.specialPrice) : null,
      notes: form.notes || null,
    });
  };

  const filteredItems = items?.filter(item => {
    if (roleFilter === "all") return true;
    if (roleFilter === null) return item.roleId === null;
    return item.roleId === roleFilter;
  }) ?? [];

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
        <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this finished item?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
        </div>
      </TableCell>
    </TableRow>
  );

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
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map(item => <WardrobeItemRow key={item.id} item={item} />)}
          </TableBody>
        </SubTable>
      )}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Finished Item" : "Add Finished Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">

            <div className="grid gap-2">
              <Label>Name *</Label>
              <input
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="e.g. Navy Polo — Full Logo"
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
              {variantColours.length > 0 ? (
                <Select value={form.colour || "__all__"} onValueChange={v => setForm(f => ({ ...f, colour: v === "__all__" ? "" : v }))}>
                  <SelectTrigger><SelectValue placeholder="All colours" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All colours</SelectItem>
                    {variantColours.map(col => <SelectItem key={col} value={col}>{col}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. Navy Blue (optional)"
                  value={form.colour}
                  onChange={e => setForm(f => ({ ...f, colour: e.target.value }))}
                />
              )}
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Size</Label>
              <Select value={form.size || "__all__"} onValueChange={v => setForm(f => ({ ...f, size: v === "__all__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="All sizes" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All sizes</SelectItem>
                  {(variantSizes.length > 0 ? variantSizes : DEFAULT_CLOTHING_SIZES).map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

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
                <p className="text-xs text-muted-foreground">Auto-calculated from product + finish.</p>
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
            </div>

            <div className="grid gap-2">
              <Label>Notes</Label>
              <Textarea rows={2} placeholder="Optional notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={save.isPending || !form.name || !form.productId || !form.unitPrice}>
              {save.isPending ? "Saving..." : "Save"}
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
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Building2 className="w-6 h-6 text-muted-foreground" />
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{customer.name}</h1>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
              {(customer.contactFirstName || customer.contactLastName) && (
                <span>Contact: {[customer.contactFirstName, customer.contactLastName].filter(Boolean).join(' ')}</span>
              )}
              {customer.email && <span>{customer.email}</span>}
              {customer.phone && <span>{customer.phone}</span>}
              {customer.city && <span>{customer.city}{customer.state ? `, ${customer.state}` : ''}</span>}
            </div>
          </div>
        </div>

        {/* Xero balance card — only shown when customer is linked to Xero */}
        {xeroContactId && (
          <div className="flex flex-wrap gap-4 px-0">
            {xeroBalanceLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading Xero balance…
              </div>
            ) : xeroBalance ? (
              <>
                <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${xeroBalance.arOutstanding > 0 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200"}`}>
                  <TrendingUp className={`w-4 h-4 ${xeroBalance.arOutstanding > 0 ? "text-amber-600" : "text-green-600"}`} />
                  <div>
                    <div className="font-semibold text-foreground">
                      {formatCurrency(xeroBalance.arOutstanding)} outstanding
                    </div>
                    <div className="text-xs text-muted-foreground">Accounts Receivable (Xero)</div>
                  </div>
                  {xeroBalance.arOverdue > 0 && (
                    <div className="flex items-center gap-1 ml-2 text-red-600 text-xs font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {formatCurrency(xeroBalance.arOverdue)} overdue
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        )}

        <Tabs defaultValue="employees">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="employees" className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Employees</TabsTrigger>
            <TabsTrigger value="roles" className="flex items-center gap-1.5"><Boxes className="w-3.5 h-3.5" /> Roles</TabsTrigger>
            <TabsTrigger value="wardrobe" className="flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Wardrobe</TabsTrigger>
            <TabsTrigger value="addresses" className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Delivery Addresses</TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Contacts</TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Order History</TabsTrigger>
            <TabsTrigger value="processes" className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Processes</TabsTrigger>
            <TabsTrigger value="finishes" className="flex items-center gap-1.5"><Shirt className="w-3.5 h-3.5" /> Finishes</TabsTrigger>
          </TabsList>

          <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
            <TabsContent value="employees" className="mt-0"><EmployeesTab customerId={customerId} /></TabsContent>
            <TabsContent value="roles" className="mt-0"><RolesTab customerId={customerId} /></TabsContent>
            <TabsContent value="wardrobe" className="mt-0"><WardrobeTab customerId={customerId} /></TabsContent>
            <TabsContent value="addresses" className="mt-0"><AddressesTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="contacts" className="mt-0"><ContactsTab customerId={customerId} customer={customer} /></TabsContent>
            <TabsContent value="orders" className="mt-0"><OrderHistoryTab customerId={customerId} /></TabsContent>
            <TabsContent value="processes" className="mt-0"><ProcessesTab customerId={customerId} /></TabsContent>
            <TabsContent value="finishes" className="mt-0"><FinishesTab customerId={customerId} /></TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
