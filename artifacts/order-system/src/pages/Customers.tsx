import { useState, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { useUpload } from "@workspace/object-storage-web";
import { 
  useListCustomers, 
  useCreateCustomer, 
  useUpdateCustomer, 
  useDeleteCustomer,
  getListCustomersQueryKey,
  Customer
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { toTitleCase } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, Users, Loader2, Phone, LayoutGrid, List, Mail, Upload, X } from "lucide-react";

function formatUKPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("07")) {
    return `${digits.slice(0,5)} ${digits.slice(5,8)} ${digits.slice(8)}`;
  }
  if (digits.length === 11 && digits.startsWith("01")) {
    return `${digits.slice(0,5)} ${digits.slice(5)}`;
  }
  if (digits.length === 11 && digits.startsWith("02")) {
    return `${digits.slice(0,3)} ${digits.slice(3,7)} ${digits.slice(7)}`;
  }
  if (digits.length === 11 && digits.startsWith("03")) {
    return `${digits.slice(0,4)} ${digits.slice(4,7)} ${digits.slice(7)}`;
  }
  return raw;
}

const SHIPPING_SERVICES = [
  "DPD",
  "Local Delivery",
  "Office Collection",
  "Warehouse Collection",
  "Courier",
];

function CustomerTile({ customer, onEdit, onDelete, onClick }: {
  customer: Customer;
  onEdit: () => void;
  onDelete: () => void;
  onClick: () => void;
}) {
  const contactName = [customer.contactFirstName, customer.contactLastName].filter(Boolean).join(" ");
  const initials = customer.name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();

  return (
    <div
      className="group relative bg-background border border-border/50 rounded-xl p-5 flex flex-col gap-3 cursor-pointer hover:shadow-md hover:border-primary/30 transition-all"
      onClick={onClick}
    >
      {/* Actions */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={onEdit}>
          <Edit2 className="w-3.5 h-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500 hover:text-red-600 hover:bg-red-50" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Logo / Avatar */}
      <div className="flex items-center gap-3">
        {(customer as any).logoUrl ? (
          <img
            src={(customer as any).logoUrl}
            alt={customer.name}
            className="h-12 w-auto max-w-[120px] object-contain rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-lg font-bold text-primary">{initials}</span>
          </div>
        )}
      </div>

      {/* Company name */}
      <div>
        <p className="font-semibold text-foreground text-sm leading-tight line-clamp-2">{toTitleCase(customer.name)}</p>
      </div>

      {/* Contact details */}
      <div className="flex flex-col gap-1.5 mt-auto">
        {contactName && (
          <p className="text-xs text-muted-foreground truncate">{toTitleCase(contactName)}</p>
        )}
        {customer.email && (
          <a
            href={`mailto:${customer.email}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors truncate"
            onClick={e => e.stopPropagation()}
          >
            <Mail className="w-3 h-3 shrink-0" />
            <span className="truncate">{customer.email.toLowerCase()}</span>
          </a>
        )}
        {customer.phone && (
          <a
            href={`tel:${customer.phone.replace(/\s/g, "")}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Phone className="w-3 h-3 shrink-0" />
            <span>{formatUKPhone(customer.phone)}</span>
          </a>
        )}
      </div>
    </div>
  );
}

export default function Customers() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "tile">(() => {
    return (localStorage.getItem("customersViewMode") as "list" | "tile") ?? "tile";
  });
  
  const initialForm = { name: "", contactFirstName: "", contactLastName: "", email: "", phone: "", address: "", city: "", state: "", postcode: "", notes: "", defaultShippingService: "", logoUrl: "", highLevelContactId: "" };
  const [formData, setFormData] = useState(initialForm);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading } = useUpload({
    onSuccess: (res) => setFormData((f) => ({ ...f, logoUrl: `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}` })),
    onError: (err) => toast({ title: "Upload failed", description: err.message, variant: "destructive" }),
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allCustomers, isLoading } = useListCustomers();
  const customers = useMemo(() => {
    if (!allCustomers) return allCustomers;
    if (!search.trim()) return allCustomers;
    const term = search.trim().toLowerCase();
    return allCustomers.filter((c) =>
      c.name.toLowerCase().includes(term) ||
      (c.email ?? "").toLowerCase().includes(term) ||
      (c.phone ?? "").toLowerCase().includes(term) ||
      (c.contactFirstName ?? "").toLowerCase().includes(term) ||
      (c.contactLastName ?? "").toLowerCase().includes(term)
    );
  }, [allCustomers, search]);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const deleteMutation = useDeleteCustomer();

  const openCreateDialog = () => {
    setFormData(initialForm);
    setIsCreateOpen(true);
  };

  const openEditDialog = (customer: Customer) => {
    setFormData({
      name: toTitleCase(customer.name),
      contactFirstName: toTitleCase(customer.contactFirstName || ""),
      contactLastName: toTitleCase(customer.contactLastName || ""),
      email: (customer.email || "").toLowerCase(),
      phone: customer.phone || "",
      address: toTitleCase(customer.address || ""),
      city: toTitleCase(customer.city || ""),
      state: toTitleCase(customer.state || ""),
      postcode: customer.postcode || "",
      notes: customer.notes || "",
      defaultShippingService: (customer as any).defaultShippingService || "",
      logoUrl: (customer as any).logoUrl || "",
      highLevelContactId: (customer as any).highLevelContactId || "",
    });
    setEditingCustomer(customer);
  };

  const handleSave = () => {
    if (!formData.name) {
      toast({ title: "Validation Error", description: "Customer name is required", variant: "destructive" });
      return;
    }

    if (editingCustomer) {
      updateMutation.mutate(
        { id: editingCustomer.id, data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer updated successfully." });
            setEditingCustomer(null);
          }
        }
      );
    } else {
      createMutation.mutate(
        { data: formData },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer added successfully." });
            setIsCreateOpen(false);
          }
        }
      );
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this customer? This cannot be undone.")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
            toast({ title: "Success", description: "Customer deleted successfully." });
          }
        }
      );
    }
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Customers</h1>
            <p className="text-muted-foreground mt-1">Manage your client relationships.</p>
          </div>
          <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> Add Customer
          </Button>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search customers..."
                  className="pl-9 bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-1 border border-border/50 rounded-lg p-1 bg-background">
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${viewMode === "list" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setViewMode("list"); localStorage.setItem("customersViewMode", "list"); }}
                  title="List view"
                >
                  <List className="w-4 h-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${viewMode === "tile" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={() => { setViewMode("tile"); localStorage.setItem("customersViewMode", "tile"); }}
                  title="Tile view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className={viewMode === "tile" ? "p-6" : "p-0"}>
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : customers && customers.length > 0 ? (
              viewMode === "tile" ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {customers.map((customer) => (
                    <CustomerTile
                      key={customer.id}
                      customer={customer}
                      onClick={() => navigate(`/customers/${customer.id}`)}
                      onEdit={() => openEditDialog(customer)}
                      onDelete={() => handleDelete(customer.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>Company Name</TableHead>
                        <TableHead className="hidden lg:table-cell">Primary Contact</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="hidden md:table-cell">Telephone</TableHead>
                        <TableHead className="w-[100px] text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {customers.map((customer) => (
                        <TableRow key={customer.id} className="group hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/customers/${customer.id}`)}>
                          <TableCell className="font-medium text-foreground text-primary hover:underline">{toTitleCase(customer.name)}</TableCell>
                          <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                            {customer.contactFirstName || customer.contactLastName
                              ? toTitleCase(`${customer.contactFirstName || ''} ${customer.contactLastName || ''}`.trim())
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {customer.email ? customer.email.toLowerCase() : <span className="text-muted-foreground/50">No email</span>}
                          </TableCell>
                          <TableCell className="hidden md:table-cell" onClick={e => e.stopPropagation()}>
                            {customer.phone ? (
                              <a
                                href={`tel:${customer.phone.replace(/\s/g, "")}`}
                                className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary transition-colors group/tel"
                              >
                                <Phone className="w-3.5 h-3.5 text-muted-foreground group-hover/tel:text-primary shrink-0" />
                                {formatUKPhone(customer.phone)}
                              </a>
                            ) : (
                              <span className="text-sm text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => openEditDialog(customer)}>
                                <Edit2 className="w-4 h-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDelete(customer.id)}>
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <Users className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No customers found</h3>
                <p className="mt-1">Add your first customer to get started.</p>
                <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Customer</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen || !!editingCustomer} onOpenChange={(open) => {
          if (!open) { setIsCreateOpen(false); setEditingCustomer(null); }
        }}>
          <DialogContent
            className="sm:max-w-[600px]"
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="font-display text-xl">{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Company / Full Name *</Label>
                <Input id="name" value={formData.name} onChange={(e) => setFormData({...formData, name: e.target.value})} />
              </div>

              <div className="grid gap-2 mt-1">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Primary Contact</h4>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="contactFirstName">First Name</Label>
                  <Input id="contactFirstName" value={formData.contactFirstName} onChange={(e) => setFormData({...formData, contactFirstName: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contactLastName">Last Name</Label>
                  <Input id="contactLastName" value={formData.contactLastName} onChange={(e) => setFormData({...formData, contactLastName: e.target.value})} />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" value={formData.email} onChange={(e) => setFormData({...formData, email: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input id="phone" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} />
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Address</h4>
              </div>
              
              <div className="grid gap-2">
                <Label htmlFor="address">Street Address</Label>
                <Input id="address" value={formData.address} onChange={(e) => setFormData({...formData, address: e.target.value})} />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="state">Address Line 2</Label>
                <Input id="state" placeholder="Estate, district, etc." value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input id="postcode" value={formData.postcode} onChange={(e) => setFormData({...formData, postcode: e.target.value})} />
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Logo</h4>
              </div>

              <div className="flex items-center gap-4">
                <div
                  className="relative h-16 w-16 rounded-lg border-2 border-dashed border-border flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer hover:bg-muted/50 transition-colors flex-shrink-0"
                  onClick={() => logoFileInputRef.current?.click()}
                  title="Click to upload logo"
                >
                  {formData.logoUrl ? (
                    <UploadedImage src={formData.logoUrl} alt="Logo" className="h-full w-full object-contain p-1" fallback={<Upload className="w-5 h-5 text-muted-foreground" />} />
                  ) : isUploading ? (
                    <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*,.pdf,.eps,.ai"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={isUploading}
                    onClick={() => logoFileInputRef.current?.click()}
                  >
                    {isUploading ? <><Loader2 className="w-3 h-3 mr-2 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3 mr-2" />{formData.logoUrl ? "Replace Logo" : "Upload Logo"}</>}
                  </Button>
                  {formData.logoUrl && (
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 w-fit"
                      onClick={() => setFormData((f) => ({ ...f, logoUrl: "" }))}
                    >
                      <X className="w-3 h-3" /> Remove logo
                    </button>
                  )}
                  {!formData.logoUrl && (
                    <p className="text-xs text-muted-foreground">PNG, JPG, SVG, WebP, PDF or EPS. Click the square or the button to pick a file.</p>
                  )}
                </div>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Integrations</h4>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="highLevelContactId">High Level Contact ID</Label>
                <Input
                  id="highLevelContactId"
                  placeholder="abc123xyz"
                  value={formData.highLevelContactId}
                  onChange={(e) => setFormData({...formData, highLevelContactId: e.target.value})}
                />
                <p className="text-xs text-muted-foreground">Used to trigger High Level automation when sending collection order invoices. Find this in the contact's URL in High Level.</p>
              </div>

              <div className="grid gap-2 mt-2">
                <h4 className="text-sm font-semibold text-muted-foreground tracking-wide">Shipping</h4>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="defaultShippingService">Default Shipping Service</Label>
                <Select
                  value={formData.defaultShippingService || "none"}
                  onValueChange={(v) => setFormData({...formData, defaultShippingService: v === "none" ? "" : v})}
                >
                  <SelectTrigger id="defaultShippingService">
                    <SelectValue placeholder="Select a carrier..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {SHIPPING_SERVICES.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Pre-fills the shipping service when creating orders for this customer.</p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingCustomer(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Customer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
