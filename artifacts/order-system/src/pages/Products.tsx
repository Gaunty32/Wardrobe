import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, PackageSearch, Package, Loader2, ArrowLeft, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const UNCATEGORISED = "Uncategorised";

interface ProductCategory {
  id: number;
  wooId: number | null;
  name: string;
  slug: string | null;
  imageUrl: string | null;
  productCount: number;
}

type ProductWithCategory = Product & { category?: string | null };

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

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

  const { data: products, isLoading: productsLoading } = useListProducts({ search });
  const { data: storedCategories = [], isLoading: categoriesLoading } = useQuery<ProductCategory[]>({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/product-categories"),
  });

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const allProducts: ProductWithCategory[] = (products || []) as ProductWithCategory[];

  // Derive category names from products (for categories not yet in the DB)
  const productCategoryNames = [
    ...new Set(allProducts.map((p) => (p as any).category?.trim() || UNCATEGORISED)),
  ].sort((a, b) => (a === UNCATEGORISED ? 1 : b === UNCATEGORISED ? -1 : a.localeCompare(b)));

  // Merge stored categories with product-derived categories, computing live counts
  const categoriesWithCounts: (ProductCategory & { liveCount: number })[] = productCategoryNames.map((name) => {
    const stored = storedCategories.find((c) => c.name === name);
    const liveCount = allProducts.filter((p) =>
      name === UNCATEGORISED ? !(p as any).category : (p as any).category === name
    ).length;
    return {
      id: stored?.id ?? -1,
      wooId: stored?.wooId ?? null,
      name,
      slug: stored?.slug ?? null,
      imageUrl: stored?.imageUrl ?? null,
      productCount: stored?.productCount ?? liveCount,
      liveCount,
    };
  });

  const filteredProducts = selectedCategory
    ? allProducts.filter((p) =>
        selectedCategory === UNCATEGORISED
          ? !(p as any).category
          : (p as any).category === selectedCategory
      )
    : allProducts;

  const openCreateDialog = () => {
    setFormData({
      name: "", sku: "",
      category: selectedCategory && selectedCategory !== UNCATEGORISED ? selectedCategory : "",
      description: "", unitPrice: 0, stockQuantity: 0,
    });
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
      updateMutation.mutate({ id: editingProduct.id, data: payload as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product updated" });
          setEditingProduct(null);
        }
      });
    } else {
      createMutation.mutate({ data: payload as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product created" });
          setIsCreateOpen(false);
        }
      });
    }
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this product?")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product deleted" });
        }
      });
    }
  };

  const isSearching = search.trim().length > 0;
  const showGrid = !isSearching && !selectedCategory;

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            {selectedCategory && (
              <button
                onClick={() => setSelectedCategory(null)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                All categories
              </button>
            )}
            {!selectedCategory && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Products</h1>
                <p className="text-muted-foreground mt-1">
                  {allProducts.length} product{allProducts.length !== 1 ? "s" : ""} across {categoriesWithCounts.length} categor{categoriesWithCounts.length !== 1 ? "ies" : "y"}
                </p>
              </div>
            )}
            {selectedCategory && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{selectedCategory}</h1>
                <p className="text-muted-foreground mt-1">{filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </div>
          <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> Add Product
          </Button>
        </div>

        {/* Search bar — always visible */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search products..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (e.target.value) setSelectedCategory(null); }}
          />
        </div>

        {productsLoading || (showGrid && categoriesLoading) ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : showGrid ? (
          /* ── Category grid ── */
          categoriesWithCounts.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground">No products yet</h3>
              <p className="mt-1">Add your first product or run a WooCommerce sync.</p>
              <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {categoriesWithCounts.map((cat) => (
                <button
                  key={cat.name}
                  onClick={() => setSelectedCategory(cat.name)}
                  className="group relative rounded-xl overflow-hidden border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-200 aspect-[4/3] text-left"
                >
                  {cat.imageUrl ? (
                    <img
                      src={cat.imageUrl}
                      alt={cat.name}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center">
                      <ImageOff className="w-10 h-10 text-muted-foreground/30" />
                    </div>
                  )}
                  {/* Overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                  {/* Text */}
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="text-white font-semibold text-sm leading-tight line-clamp-2 drop-shadow">
                      {cat.name}
                    </p>
                    <p className="text-white/70 text-xs mt-0.5">{cat.liveCount} products</p>
                  </div>
                </button>
              ))}
            </div>
          )
        ) : (
          /* ── Product table ── */
          filteredProducts.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground border rounded-xl bg-card">
              <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground">No products found</h3>
              <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
            </div>
          ) : (
            <div className="border rounded-xl overflow-hidden bg-card shadow-sm">
              <ProductTable
                products={filteredProducts}
                onEdit={openEditDialog}
                onDelete={handleDelete}
                onNavigate={(id) => navigate(`/products/${id}`)}
              />
            </div>
          )
        )}
      </div>

      {/* Create / Edit dialog */}
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
              <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Premium Polo Shirt" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="sku">SKU</Label>
                <Input id="sku" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} placeholder="e.g. POL-001" />
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
                  {categoriesWithCounts.filter((c) => c.name !== UNCATEGORISED).map((c) => (
                    <option key={c.name} value={c.name} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="price">Unit Price (£) *</Label>
                <Input id="price" type="number" min="0" step="0.01" value={formData.unitPrice || ""} onChange={(e) => setFormData({ ...formData, unitPrice: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="stock">Stock Quantity</Label>
                <Input id="stock" type="number" value={formData.stockQuantity || ""} onChange={(e) => setFormData({ ...formData, stockQuantity: parseInt(e.target.value, 10) || 0 })} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" className="resize-none" rows={3} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
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
            <TableHead className="w-[48px]"></TableHead>
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
              <TableCell className="py-2 pl-4 pr-0">
                {(product as any).imageUrl ? (
                  <img src={(product as any).imageUrl} alt={product.name} className="w-9 h-9 rounded object-cover border border-border/50" />
                ) : (
                  <div className="w-9 h-9 rounded bg-muted border border-border/50 flex items-center justify-center">
                    <Package className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{product.sku || "—"}</TableCell>
              <TableCell className="font-medium text-foreground hover:text-primary transition-colors">{product.name}</TableCell>
              <TableCell className="text-muted-foreground text-sm hidden md:table-cell max-w-[200px] truncate">{product.description || "—"}</TableCell>
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
