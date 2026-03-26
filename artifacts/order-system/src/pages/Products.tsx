import { useState } from "react";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import {
  useListProducts,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListProductsQueryKey,
  Product
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, PackageSearch, Loader2, Tag, ChevronRight } from "lucide-react";

const UNCATEGORISED = "Uncategorised";

type ProductWithCategory = Product & { category?: string | null };

export default function Products() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);

  const [formData, setFormData] = useState({
    name: "", sku: "", category: "", description: "", unitPrice: 0, stockQuantity: 0
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: products, isLoading } = useListProducts({ search });
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const openCreateDialog = () => {
    setFormData({ name: "", sku: "", category: selectedCategory && selectedCategory !== UNCATEGORISED ? selectedCategory : "", description: "", unitPrice: 0, stockQuantity: 0 });
    setIsCreateOpen(true);
  };

  const openEditDialog = (product: ProductWithCategory) => {
    setFormData({
      name: product.name,
      sku: product.sku || "",
      category: (product as any).category || "",
      description: product.description || "",
      unitPrice: product.unitPrice,
      stockQuantity: product.stockQuantity || 0,
    });
    setEditingProduct(product);
  };

  const handleSave = () => {
    if (!formData.name || formData.unitPrice < 0) {
      toast({ title: "Validation Error", description: "Name and valid price are required", variant: "destructive" });
      return;
    }
    const payload = { ...formData, category: formData.category.trim() || null };

    if (editingProduct) {
      updateMutation.mutate(
        { id: editingProduct.id, data: payload as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Product updated" });
            setEditingProduct(null);
          }
        }
      );
    } else {
      createMutation.mutate(
        { data: payload as any },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Product created" });
            setIsCreateOpen(false);
          }
        }
      );
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteMutation.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
            toast({ title: "Product deleted" });
          }
        }
      );
    }
  };

  const allProducts: ProductWithCategory[] = (products || []) as ProductWithCategory[];

  const categories = [
    ...new Set(
      allProducts.map((p) => (p as any).category?.trim() || UNCATEGORISED)
    ),
  ].sort((a, b) => (a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b)));

  const filtered = selectedCategory
    ? allProducts.filter((p) =>
        selectedCategory === UNCATEGORISED
          ? !(p as any).category
          : (p as any).category === selectedCategory
      )
    : allProducts;

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Products</h1>
            <p className="text-muted-foreground mt-1">
              {allProducts.length} product{allProducts.length !== 1 ? "s" : ""} across {categories.length} categor{categories.length !== 1 ? "ies" : "y"}
            </p>
          </div>
          <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> Add Product
          </Button>
        </div>

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-3 border-b border-border/40 bg-muted/10">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="relative max-w-sm w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  className="pl-9 bg-background"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              {!search && categories.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedCategory(null)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      selectedCategory === null
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    All
                  </button>
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                        selectedCategory === cat
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:bg-muted/80"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filtered.length > 0 ? (
              selectedCategory || search ? (
                <ProductTable
                  products={filtered}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                  onNavigate={(id) => navigate(`/products/${id}`)}
                />
              ) : (
                <div className="divide-y divide-border/40">
                  {categories.map((cat) => {
                    const catProducts = allProducts.filter((p) =>
                      cat === UNCATEGORISED ? !(p as any).category : (p as any).category === cat
                    );
                    if (!catProducts.length) return null;
                    return (
                      <div key={cat}>
                        <button
                          className="w-full flex items-center justify-between px-5 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
                          onClick={() => setSelectedCategory(cat)}
                        >
                          <div className="flex items-center gap-2">
                            <Tag className="w-3.5 h-3.5 text-primary" />
                            <span className="text-sm font-semibold text-foreground">{cat}</span>
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                              {catProducts.length}
                            </Badge>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </button>
                        <ProductTable
                          products={catProducts}
                          onEdit={openEditDialog}
                          onDelete={handleDelete}
                          onNavigate={(id) => navigate(`/products/${id}`)}
                        />
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No products found</h3>
                <p className="mt-1">Get started by adding your first product to inventory.</p>
                <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={isCreateOpen || !!editingProduct} onOpenChange={(open) => {
          if (!open) { setIsCreateOpen(false); setEditingProduct(null); }
        }}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">
                {editingProduct ? "Edit Product" : "Add New Product"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Product Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Premium Polo Shirt"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="sku">SKU</Label>
                  <Input
                    id="sku"
                    value={formData.sku}
                    onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                    placeholder="e.g. POL-001"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    placeholder="e.g. Polo Shirts"
                    list="category-suggestions"
                  />
                  <datalist id="category-suggestions">
                    {categories.filter(c => c !== UNCATEGORISED).map(c => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="price">Unit Price (£) *</Label>
                  <Input
                    id="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.unitPrice || ""}
                    onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="stock">Stock Quantity</Label>
                  <Input
                    id="stock"
                    type="number"
                    value={formData.stockQuantity || ""}
                    onChange={(e) => setFormData({ ...formData, stockQuantity: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  className="resize-none"
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateOpen(false); setEditingProduct(null); }}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Product"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}

function ProductTable({
  products,
  onEdit,
  onDelete,
  onNavigate,
}: {
  products: ProductWithCategory[];
  onEdit: (p: ProductWithCategory) => void;
  onDelete: (id: number) => void;
  onNavigate: (id: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[100px]">SKU</TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead className="hidden md:table-cell">Description</TableHead>
            <TableHead className="text-right">Price</TableHead>
            <TableHead className="text-right">Stock</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow
              key={product.id}
              className="group hover:bg-muted/30 cursor-pointer"
              onClick={() => onNavigate(product.id)}
            >
              <TableCell className="font-mono text-xs text-muted-foreground">{product.sku || "—"}</TableCell>
              <TableCell className="font-medium text-foreground hover:text-primary transition-colors">
                {product.name}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm hidden md:table-cell max-w-[200px] truncate">
                {product.description || "—"}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.unitPrice)}</TableCell>
              <TableCell className="text-right">
                <span className={product.stockQuantity != null && product.stockQuantity <= 5 ? "text-red-600 font-bold" : ""}>
                  {product.stockQuantity ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => onEdit(product)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => onDelete(product.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
