import { useState } from "react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
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
import { Plus, Search, Edit2, Trash2, Users, Loader2, Phone } from "lucide-react";

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
  "Royal Mail",
  "Evri (Hermes)",
  "DHL",
  "FedEx",
  "UPS",
  "TNT",
  "Yodel",
  "ParcelForce",
  "Amazon Logistics",
  "Click & Collect",
  "Courier",
  "Other",
];

export default function Customers() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  
  const initialForm = { name: "", contactFirstName: "", contactLastName: "", email: "", phone: "", address: "", city: "", state: "", postcode: "", notes: "", defaultShippingService: "" };
  const [formData, setFormData] = useState(initialForm);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: customers, isLoading } = useListCustomers({ search });
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
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search customers..." 
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : customers && customers.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Company Name</TableHead>
                      <TableHead className="hidden lg:table-cell">Primary Contact</TableHead>
                      <TableHead>Contact Info</TableHead>
                      <TableHead className="hidden md:table-cell">Location</TableHead>
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
                        <TableCell>
                          <div className="flex flex-col text-sm text-muted-foreground">
                            <span>{customer.email ? customer.email.toLowerCase() : 'No email'}</span>
                            {customer.phone ? (
                              <a href={`tel:${customer.phone.replace(/\s/g, "")}`} className="flex items-center gap-1 hover:text-primary transition-colors" onClick={e => e.stopPropagation()}>
                                <Phone className="w-3 h-3 shrink-0" /> {formatUKPhone(customer.phone)}
                              </a>
                            ) : (
                              <span className="text-muted-foreground/50">No phone</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                          {customer.city ? `${customer.city}, ${customer.state || ''}` : '-'}
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
          <DialogContent className="sm:max-w-[600px]">
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

              <div className="grid grid-cols-3 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="city">City</Label>
                  <Input id="city" value={formData.city} onChange={(e) => setFormData({...formData, city: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="state">County</Label>
                  <Input id="state" value={formData.state} onChange={(e) => setFormData({...formData, state: e.target.value})} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input id="postcode" value={formData.postcode} onChange={(e) => setFormData({...formData, postcode: e.target.value})} />
                </div>
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
