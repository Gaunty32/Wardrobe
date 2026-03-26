import { useState } from "react";
import Layout from "@/components/Layout";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListSuppliers } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, Loader2, Boxes, AlertTriangle } from "lucide-react";

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

interface ProcessStockItem {
  id: number;
  name: string;
  sku: string | null;
  description: string | null;
  unitCost: number;
  stockQuantity: number;
  supplierId: number | null;
  supplierCode: string | null;
  supplierName: string | null;
  notes: string | null;
}

const BLANK_FORM = {
  name: "",
  sku: "",
  description: "",
  unitCost: "",
  stockQuantity: "0",
  supplierId: "" as string,
  supplierCode: "",
  notes: "",
};

export default function ProcessStock() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessStockItem | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });

  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: suppliers } = useListSuppliers();

  const { data: items, isLoading } = useQuery<ProcessStockItem[]>({
    queryKey: ["process-stock", search],
    queryFn: () => apiFetch(`/process-stock${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  });

  const inv = () => qc.invalidateQueries({ queryKey: ["process-stock"] });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      editing
        ? apiFetch(`/process-stock/${editing.id}`, { method: "PATCH", body: JSON.stringify(data) })
        : apiFetch("/process-stock", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      inv();
      toast({ title: "Saved", description: editing ? "Stock item updated." : "Stock item created." });
      setOpen(false);
      setEditing(null);
    },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/process-stock/${id}`, { method: "DELETE" }),
    onSuccess: () => { inv(); toast({ title: "Deleted" }); },
    onError: (e) => toast({ title: "Error", description: (e as Error).message, variant: "destructive" }),
  });

  const openCreate = () => {
    setForm({ ...BLANK_FORM });
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (item: ProcessStockItem) => {
    setForm({
      name: item.name,
      sku: item.sku ?? "",
      description: item.description ?? "",
      unitCost: item.unitCost.toString(),
      stockQuantity: item.stockQuantity.toString(),
      supplierId: item.supplierId?.toString() ?? "",
      supplierCode: item.supplierCode ?? "",
      notes: item.notes ?? "",
    });
    setEditing(item);
    setOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: "Validation Error", description: "Name is required", variant: "destructive" });
      return;
    }
    saveMutation.mutate({
      name: form.name.trim(),
      sku: form.sku.trim() || null,
      description: form.description.trim() || null,
      unitCost: parseFloat(form.unitCost) || 0,
      stockQuantity: parseInt(form.stockQuantity, 10) || 0,
      supplierId: form.supplierId ? parseInt(form.supplierId, 10) : null,
      supplierCode: form.supplierCode.trim() || null,
      notes: form.notes.trim() || null,
    });
  };

  const handleDelete = (item: ProcessStockItem) => {
    if (confirm(`Delete "${item.name}"? This cannot be undone.`)) {
      deleteMutation.mutate(item.id);
    }
  };

  const lowStock = (qty: number) => qty <= 5;

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Process Stock</h1>
            <p className="text-muted-foreground mt-1">Physical materials used in decoration processes — print, embroidery, etc.</p>
          </div>
          <Button onClick={openCreate} className="shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all">
            <Plus className="w-4 h-4 mr-2" /> Add Stock Item
          </Button>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-4 border-b border-border/40 bg-muted/10">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
                className="pl-9 bg-background"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : items && items.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-[100px]">SKU</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="hidden md:table-cell">Supplier</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">In Stock</TableHead>
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id} className="group hover:bg-muted/30">
                        <TableCell className="font-mono text-xs text-muted-foreground">{item.sku || "—"}</TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">{item.name}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>
                          )}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {item.supplierName ? (
                            <div>
                              <p className="text-sm">{item.supplierName}</p>
                              {item.supplierCode && <p className="text-xs text-muted-foreground font-mono">{item.supplierCode}</p>}
                            </div>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">{formatCurrency(item.unitCost)}</TableCell>
                        <TableCell className="text-right">
                          {lowStock(item.stockQuantity) ? (
                            <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 gap-1 font-semibold">
                              <AlertTriangle className="w-3 h-3" />{item.stockQuantity}
                            </Badge>
                          ) : (
                            <span className="font-semibold tabular-nums">{item.stockQuantity}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50" onClick={() => openEdit(item)}>
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50" onClick={() => handleDelete(item)}>
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
                <Boxes className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="text-lg font-medium text-foreground">No process stock items</h3>
                <p className="mt-1">Add the physical materials you source from suppliers for decoration.</p>
                <Button onClick={openCreate} variant="outline" className="mt-6">Add Stock Item</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setEditing(null); } }}>
          <DialogContent className="sm:max-w-[520px]">
            <DialogHeader>
              <DialogTitle className="font-display">{editing ? "Edit Stock Item" : "Add Process Stock Item"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Name *</Label>
                <Input
                  placeholder="e.g. A4 Transfer Print Sheet"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>SKU / Ref</Label>
                  <Input
                    placeholder="e.g. PRT-A4-WHT"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Unit Cost (£)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.unitCost}
                    onChange={(e) => setForm({ ...form, unitCost: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Supplier</Label>
                  <Select value={form.supplierId || "none"} onValueChange={(v) => setForm({ ...form, supplierId: v === "none" ? "" : v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No supplier</SelectItem>
                      {suppliers?.map(s => (
                        <SelectItem key={s.id} value={s.id.toString()}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Supplier Code</Label>
                  <Input
                    placeholder="Supplier's ref / code"
                    value={form.supplierCode}
                    onChange={(e) => setForm({ ...form, supplierCode: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Stock Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.stockQuantity}
                  onChange={(e) => setForm({ ...form, stockQuantity: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  placeholder="Brief description of this stock item"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  placeholder="Internal notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); setEditing(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending || !form.name.trim()}>
                {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />Saving...</> : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
