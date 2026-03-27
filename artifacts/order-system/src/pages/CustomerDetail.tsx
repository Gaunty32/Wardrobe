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
import { ArrowLeft, Plus, Edit2, Trash2, Loader2, X, Building2, MapPin, Users, History, Layers, Shirt, UserCheck, Boxes, PoundSterling, ShoppingBag, Check, ChevronsUpDown, Palette, Ruler, Sparkles } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { useGetCustomer, useListProducts } from "@workspace/api-client-react";
import { Link } from "wouter";

const API_BASE = "/api";

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

function AddressesTab({ customerId }: { customerId: number }) {
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

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
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

function ContactsTab({ customerId }: { customerId: number }) {
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

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
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

const PROCESS_TYPES = ["embroidery", "print", "other"] as const;

interface ProcessStockItem { id: number; name: string; sku: string | null; unitCost: number; }

function ProcessesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: processes, isLoading } = useSubResource<any>(customerId, "processes");
  const { data: allProcessStock } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock"],
    queryFn: () => apiFetch("/process-stock"),
  });
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", type: "", placement: "", price: "", processStockId: "", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "processes"] });

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
      notes: form.notes || null,
    });
  };

  const getStockName = (id: number | null) => {
    if (!id || !allProcessStock) return null;
    return allProcessStock.find(s => s.id === id)?.name ?? null;
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
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="hidden md:table-cell">Placement</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="hidden lg:table-cell">Process Stock</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {processes.map((p: any) => (
              <TableRow key={p.id} className="group hover:bg-muted/30">
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
          <DialogHeader><DialogTitle>{editing ? "Edit Process" : "Add Process"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Left Chest Embroidery Logo" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Type</Label>
                <Select value={form.type || "none"} onValueChange={v => setForm({ ...form, type: v === "none" ? "" : v })}>
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
            <div className="grid grid-cols-2 gap-4">
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
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><Boxes className="w-3 h-3" /> Process Stock Item</Label>
                <Select value={form.processStockId || "none"} onValueChange={v => setForm({ ...form, processStockId: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Link stock item" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {allProcessStock?.map(s => (
                      <SelectItem key={s.id} value={s.id.toString()}>
                        {s.name}{s.sku ? ` (${s.sku})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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

// ─── Finishes Tab ─────────────────────────────────────────────────────────────

function FinishesTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: finishes, isLoading } = useSubResource<any>(customerId, "finishes");
  const { data: processes } = useSubResource<any>(customerId, "processes");
  const { data: allProducts } = useListProducts();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { name: "", description: "", notes: "" };
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
    mutationFn: ({ finishId, productId }: { finishId: number; productId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/products/${productId}`, { method: "POST" }),
    onSuccess: () => inv(),
    onError: () => toast({ title: "Error", description: "Could not add garment", variant: "destructive" }),
  });

  const removeGarment = useMutation({
    mutationFn: ({ finishId, productId }: { finishId: number; productId: number }) =>
      apiFetch(`/customers/${customerId}/finishes/${finishId}/products/${productId}`, { method: "DELETE" }),
    onSuccess: () => inv(),
  });

  const typeColour: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700",
    print: "bg-blue-100 text-blue-700",
    transfer: "bg-orange-100 text-orange-700",
    other: "bg-gray-100 text-gray-700",
  };

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (f: any) => { setForm({ name: f.name||"", description: f.description||"", notes: f.notes||"" }); setEditing(f); setOpen(true); };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Finish</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !finishes?.length ? <EmptyState icon={Shirt} label="finishes" onAdd={openAdd} />
        : <div className="grid gap-4">
          {finishes.map((f: any) => {
            const attachedProcessIds = new Set(f.processes?.map((p: any) => p.processId));
            const availableProcesses = (processes || []).filter((p: any) => !attachedProcessIds.has(p.id));
            const attachedProductIds = new Set(f.garments?.map((g: any) => g.productId));
            const availableProducts = (allProducts || []).filter((p: any) => !attachedProductIds.has(p.id));

            return (
              <Card key={f.id} className="border-border/50">
                <CardContent className="p-4 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="font-semibold text-foreground">{f.name}</h4>
                      {f.description && <p className="text-sm text-muted-foreground mt-0.5">{f.description}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {f.totalCost > 0 && (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-semibold tabular-nums">
                          <PoundSterling className="w-3 h-3 mr-0.5" />{f.totalCost.toFixed(2)} total
                        </Badge>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(f)}><Edit2 className="w-3 h-3" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this finish?") && del.mutate(f.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </div>

                  {/* Processes section */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Processes</p>
                    {f.processes?.length > 0 ? (
                      <div className="border border-border/50 rounded-md overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40">
                            <tr>
                              <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Process</th>
                              <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground hidden sm:table-cell">Placement</th>
                              <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">Price</th>
                              <th className="w-8"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {f.processes.map((p: any) => (
                              <tr key={p.id} className="bg-background">
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-2">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${typeColour[p.type] || typeColour.other}`}>
                                      {p.type || "other"}
                                    </span>
                                    <span className="font-medium text-foreground">{p.name}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{p.placement || "—"}</td>
                                <td className="px-3 py-2 text-right tabular-nums font-medium">
                                  {p.price != null ? formatCurrency(p.price) : <span className="text-muted-foreground">—</span>}
                                </td>
                                <td className="px-2 py-2">
                                  <button
                                    onClick={() => removeProcess.mutate({ finishId: f.id, processId: p.processId })}
                                    className="text-muted-foreground hover:text-red-500 transition-colors"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                            {f.totalCost > 0 && (
                              <tr className="bg-muted/20 font-semibold">
                                <td className="px-3 py-2 text-sm" colSpan={2}>Total finish cost</td>
                                <td className="px-3 py-2 text-right tabular-nums text-emerald-700 hidden sm:table-cell">{formatCurrency(f.totalCost)}</td>
                                <td></td>
                              </tr>
                            )}
                          </tbody>
                        </table>
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
                    {!processes?.length && (
                      <p className="text-xs text-muted-foreground italic mt-1">Set up processes in the Processes tab first</p>
                    )}
                  </div>

                  {/* Garments section */}
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Garments</p>
                    <div className="flex flex-wrap gap-1.5">
                      {f.garments?.map((g: any) => (
                        <span key={g.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                          {g.name}
                          {g.sku && <span className="text-blue-400 text-[10px]">({g.sku})</span>}
                          <button
                            onClick={() => removeGarment.mutate({ finishId: f.id, productId: g.productId })}
                            className="hover:opacity-70 ml-0.5"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                      {availableProducts.length > 0 && (
                        <Select onValueChange={(v) => addGarment.mutate({ finishId: f.id, productId: Number(v) })}>
                          <SelectTrigger className="h-6 text-xs px-2 w-auto border-dashed text-muted-foreground">
                            <Plus className="w-3 h-3 mr-1" /><span>Add garment</span>
                          </SelectTrigger>
                          <SelectContent>
                            {availableProducts.map((p: any) => (
                              <SelectItem key={p.id} value={String(p.id)}>
                                {p.name}{p.sku ? ` (${p.sku})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {!f.garments?.length && !availableProducts?.length && (
                        <p className="text-xs text-muted-foreground italic">No garments — add products first</p>
                      )}
                      {!f.garments?.length && availableProducts?.length > 0 && (
                        <p className="text-xs text-muted-foreground italic">No garments assigned yet</p>
                      )}
                    </div>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Finish" : "Add Finish"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2"><Label>Name *</Label>
              <Input placeholder="e.g. Full Company Branding Package" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Description</Label>
              <Textarea rows={2} placeholder="Brief description of this finish" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid gap-2"><Label>Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
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
  const { data: employees, isLoading } = useSubResource<any>(customerId, "employees");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const blank = { firstName: "", lastName: "", email: "", phone: "", department: "", notes: "" };
  const [form, setForm] = useState(blank);

  const inv = () => qc.invalidateQueries({ queryKey: ["customer", customerId, "employees"] });

  const save = useMutation({
    mutationFn: (data: any) => editing
      ? apiFetch(`/customers/${customerId}/employees/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
      : apiFetch(`/customers/${customerId}/employees`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { inv(); toast({ title: "Saved" }); setOpen(false); setEditing(null); },
    onError: () => toast({ title: "Error", description: "Could not save employee", variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: (id: number) => apiFetch(`/customers/${customerId}/employees/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
  });

  const openAdd = () => { setForm(blank); setEditing(null); setOpen(true); };
  const openEdit = (e: any) => { setForm({ firstName: e.firstName||"", lastName: e.lastName||"", email: e.email||"", phone: e.phone||"", department: e.department||"", notes: e.notes||"" }); setEditing(e); setOpen(true); };

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Employee</Button>
      </div>
      {isLoading ? <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        : !employees?.length ? <EmptyState icon={UserCheck} label="employees" onAdd={openAdd} />
        : <SubTable>
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Department</TableHead>
            <TableHead>Email</TableHead>
            <TableHead className="hidden md:table-cell">Phone</TableHead>
            <TableHead className="w-20 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {employees.map((e: any) => (
              <TableRow key={e.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{[e.firstName, e.lastName].filter(Boolean).join(' ')}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.department || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{e.email || '—'}</TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{e.phone || '—'}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(e)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this employee?") && del.mutate(e.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </SubTable>}

      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First Name *</Label><Input value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} /></div>
              <div className="grid gap-2"><Label>Last Name</Label><Input value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} /></div>
            </div>
            <div className="grid gap-2"><Label>Department</Label><Input value={form.department} onChange={e => setForm({ ...form, department: e.target.value })} /></div>
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

// ─── Wardrobe (Finished Items) Tab ───────────────────────────────────────────

interface FinishedItem {
  id: number;
  customerId: number;
  name: string;
  productId: number;
  productName: string | null;
  productSku: string | null;
  finishId: number | null;
  finishName: string | null;
  colour: string | null;
  size: string | null;
  unitPrice: number;
  notes: string | null;
}

function WardrobeTab({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: products } = useListProducts();
  const { data: items, isLoading } = useSubResource<FinishedItem>(customerId, "finished-items");
  const { data: finishes } = useSubResource<any>(customerId, "finishes");

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FinishedItem | null>(null);
  const [productSearchOpen, setProductSearchOpen] = useState(false);

  const blank = { name: "", productId: 0, finishId: null as number | null, colour: "", size: "", unitPrice: "", notes: "" };
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

  const openAdd = () => { setForm(blank); setEditing(null); setProductSearchOpen(false); setOpen(true); };
  const openEdit = (item: FinishedItem) => {
    setForm({
      name: item.name,
      productId: item.productId,
      finishId: item.finishId ?? null,
      colour: item.colour ?? "",
      size: item.size ?? "",
      unitPrice: item.unitPrice.toFixed(2),
      notes: item.notes ?? "",
    });
    setEditing(item);
    setProductSearchOpen(false);
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
    setForm(f => ({ ...f, productId: prod.id, unitPrice: newPrice.toFixed(2) }));
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
      productId: form.productId,
      finishId: form.finishId || null,
      colour: form.colour || null,
      size: form.size || null,
      unitPrice: parseFloat(form.unitPrice),
      notes: form.notes || null,
    });
  };

  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-muted-foreground">Pre-built items that default when creating orders for this customer.</p>
        <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4 mr-1" /> Add Finished Item</Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : !items?.length ? (
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
              <TableHead className="w-20 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(item => (
              <TableRow key={item.id} className="group hover:bg-muted/30">
                <TableCell className="font-medium">{item.name}</TableCell>
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
                <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(item.unitPrice)}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}><Edit2 className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:bg-red-50" onClick={() => confirm("Delete this finished item?") && del.mutate(item.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
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
              <Label>Product *</Label>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><Palette className="w-3 h-3" /> Colour</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. Navy Blue"
                  value={form.colour}
                  onChange={e => setForm(f => ({ ...f, colour: e.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label className="flex items-center gap-1"><Ruler className="w-3 h-3" /> Size</Label>
                <input
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="e.g. M"
                  value={form.size}
                  onChange={e => setForm(f => ({ ...f, size: e.target.value }))}
                />
              </div>
            </div>

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
              <p className="text-xs text-muted-foreground">Auto-calculated from product + finish — adjust if needed.</p>
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

        <Tabs defaultValue="addresses">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-wrap gap-1 bg-muted/50 p-1">
            <TabsTrigger value="addresses" className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5" /> Delivery Addresses</TabsTrigger>
            <TabsTrigger value="contacts" className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5" /> Contacts</TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center gap-1.5"><History className="w-3.5 h-3.5" /> Order History</TabsTrigger>
            <TabsTrigger value="processes" className="flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" /> Processes</TabsTrigger>
            <TabsTrigger value="finishes" className="flex items-center gap-1.5"><Shirt className="w-3.5 h-3.5" /> Finishes</TabsTrigger>
            <TabsTrigger value="wardrobe" className="flex items-center gap-1.5"><ShoppingBag className="w-3.5 h-3.5" /> Wardrobe</TabsTrigger>
            <TabsTrigger value="employees" className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Employees</TabsTrigger>
          </TabsList>

          <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
            <TabsContent value="addresses" className="mt-0"><AddressesTab customerId={customerId} /></TabsContent>
            <TabsContent value="contacts" className="mt-0"><ContactsTab customerId={customerId} /></TabsContent>
            <TabsContent value="orders" className="mt-0"><OrderHistoryTab customerId={customerId} /></TabsContent>
            <TabsContent value="processes" className="mt-0"><ProcessesTab customerId={customerId} /></TabsContent>
            <TabsContent value="finishes" className="mt-0"><FinishesTab customerId={customerId} /></TabsContent>
            <TabsContent value="wardrobe" className="mt-0"><WardrobeTab customerId={customerId} /></TabsContent>
            <TabsContent value="employees" className="mt-0"><EmployeesTab customerId={customerId} /></TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
