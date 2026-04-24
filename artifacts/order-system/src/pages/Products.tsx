import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useUpload } from "@workspace/object-storage-web";
import Layout from "@/components/Layout";
import {
  useListProducts,
  useListSuppliers,
  useCreateProduct,
  useUpdateProduct,
  useDeleteProduct,
  getListProductsQueryKey,
  Product,
  Supplier
} from "@workspace/api-client-react";
import { useListCustomers } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Edit2, Trash2, PackageSearch, Package, Loader2, ArrowLeft, ImageOff, Globe, Lock, Upload, X, Copy, Wand2 } from "lucide-react";
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
  const [selectedTopCat, setSelectedTopCat] = useState<ProductCategory | null>(null);
  const [selectedSubCat, setSelectedSubCat] = useState<ProductCategory | null>(null);
  const [websiteFilter, setWebsiteFilter] = useState<"all" | "website" | "internal" | "bespoke">("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);

  const [formData, setFormData] = useState({
    name: "", sku: "", category: "", description: "", unitPrice: 0, stockQuantity: 0,
    supplierId: "none", supplierCode: "", supplierPrice: "", imageUrl: "",
    customerId: "none" as string, supplierCurrency: "GBP",
  });
  const imageInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading: isImageUploading } = useUpload({
    onSuccess: (res) => setFormData((f) => ({ ...f, imageUrl: `/api/storage${res.objectPath}` })),
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: products, isLoading: productsLoading } = useListProducts({ search });
  const { data: suppliers = [] } = useListSuppliers();
  const { data: customers = [] } = useListCustomers();
  const { data: storedCategories = [], isLoading: categoriesLoading } = useQuery<ProductCategory[]>({
    queryKey: ["product-categories"],
    queryFn: () => apiFetch("/product-categories"),
  });

  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const deleteMutation = useDeleteProduct();

  const allProducts: ProductWithCategory[] = (products || []) as ProductWithCategory[];

  // ── Category hierarchy helpers ──────────────────────────────────────────────
  const subcategoriesOf = (parent: ProductCategory): ProductCategory[] =>
    storedCategories.filter((c) => c.parentWooId != null && c.parentWooId === parent.wooId);

  // All category names that "belong" to a top-level cat (itself + all descendants)
  function allNamesUnder(cat: ProductCategory): Set<string> {
    const names = new Set<string>([cat.name]);
    for (const sub of subcategoriesOf(cat)) {
      names.add(sub.name);
      for (const subsub of subcategoriesOf(sub)) names.add(subsub.name);
    }
    return names;
  }

  // Top-level stored categories (no parent)
  const topLevelStored = storedCategories.filter((c) => !c.parentWooId);

  // Subcategories currently in scope (when a top cat is selected)
  const currentSubs = selectedTopCat ? subcategoriesOf(selectedTopCat) : [];

  // Names of all stored categories (to detect product-derived ones not in DB)
  const storedCatNames = new Set(storedCategories.map((c) => c.name));

  // Product-derived categories not in the WooCommerce DB (internal-only)
  const allProductCatNames = [...new Set(allProducts.map((p) => (p as any).category?.trim()).filter(Boolean))];
  const internalOnlyCatNames = allProductCatNames.filter((n) => !storedCatNames.has(n)).sort();

  // Build top-level grid entries: WooCommerce top-level + internal-only
  type CatEntry = ProductCategory & { liveCount: number; isInternal: boolean };

  const topLevelEntries: CatEntry[] = [
    ...topLevelStored.map((cat) => ({
      ...cat,
      liveCount: allProducts.filter((p) => allNamesUnder(cat).has((p as any).category ?? "")).length,
      isInternal: false,
    })),
    ...internalOnlyCatNames.map((name, i) => ({
      id: -(i + 1),
      wooId: null,
      name,
      slug: null,
      imageUrl: null,
      parentWooId: null,
      productCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      liveCount: allProducts.filter((p) => (p as any).category === name).length,
      isInternal: true,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Subcategory grid entries with live counts
  const subEntries: CatEntry[] = currentSubs.map((cat) => ({
    ...cat,
    liveCount: allProducts.filter((p) => (p as any).category === cat.name).length,
    isInternal: false,
  })).sort((a, b) => a.name.localeCompare(b.name));

  // ── Filtered product list ───────────────────────────────────────────────────
  const filteredProducts = allProducts
    .filter((p) => {
      const pCat: string = (p as any).category ?? "";
      if (selectedSubCat) return pCat === selectedSubCat.name;
      if (selectedTopCat) {
        // If drilling into a top cat that has subs, show all matching (websiteFilter shows this)
        return allNamesUnder(selectedTopCat).has(pCat);
      }
      return true;
    })
    .filter((p) => {
      if (websiteFilter === "website") return !!(p as any).wooCommerceId;
      if (websiteFilter === "internal") return !(p as any).wooCommerceId && !(p as any).isBespoke;
      if (websiteFilter === "bespoke") return !!(p as any).isBespoke;
      return true;
    });

  const openCreateDialog = () => {
    const defaultCat = selectedSubCat?.name ?? (selectedTopCat && currentSubs.length === 0 ? selectedTopCat.name : "");
    setFormData({
      name: "", sku: "",
      category: defaultCat,
      description: "", unitPrice: 0, stockQuantity: 0,
      supplierId: "none", supplierCode: "", supplierPrice: "", imageUrl: "",
      customerId: "none", supplierCurrency: "GBP",
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
      supplierId: product.supplierId ? String(product.supplierId) : "none",
      supplierCode: (product as any).supplierCode || "",
      supplierPrice: (product as any).supplierPrice != null ? String((product as any).supplierPrice) : "",
      imageUrl: (product as any).imageUrl || "",
      customerId: (product as any).customerId ? String((product as any).customerId) : "none",
      supplierCurrency: (product as any).supplierCurrency || "GBP",
    });
    setEditingProduct(product);
  };

  const handleSave = () => {
    if (!formData.name || formData.unitPrice < 0) {
      toast({ title: "Validation Error", description: "Name and valid price are required", variant: "destructive" });
      return;
    }
    const customerId = formData.customerId !== "none" ? Number(formData.customerId) : null;
    const payload = {
      ...formData,
      category: formData.category.trim() || null,
      supplierId: formData.supplierId !== "none" ? Number(formData.supplierId) : null,
      supplierCode: formData.supplierCode || null,
      supplierPrice: formData.supplierPrice !== "" ? parseFloat(formData.supplierPrice) : null,
      imageUrl: formData.imageUrl || null,
      customerId,
      isBespoke: customerId != null,
    };
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

  const handleDuplicate = async (id: number) => {
    try {
      const res = await fetch(`${BASE}/api/products/${id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: "Product duplicated", description: `Created "${created.name}" (${created.sku || "no SKU"})` });
    } catch {
      toast({ title: "Duplicate failed", variant: "destructive" });
    }
  };

  const autoFillBspSku = async () => {
    try {
      const res = await fetch(`${BASE}/api/products/next-bsp-sku`);
      const data = await res.json();
      setFormData((f) => ({ ...f, sku: data.sku }));
    } catch {
      toast({ title: "Could not generate SKU", variant: "destructive" });
    }
  };

  const isSearching = search.trim().length > 0;
  const showTopGrid = !isSearching && !selectedTopCat && websiteFilter === "all";
  const showSubGrid = !isSearching && !!selectedTopCat && currentSubs.length > 0 && !selectedSubCat && websiteFilter === "all";
  const showProductTable = !showTopGrid && !showSubGrid;

  // Breadcrumb helpers
  const activeCatTitle = selectedSubCat?.name ?? selectedTopCat?.name ?? "Products";
  const showBackToTop = !!selectedTopCat && !selectedSubCat;
  const showBackToSub = !!selectedSubCat;

  function CategoryGrid({ entries, onSelect }: { entries: (ProductCategory & { liveCount: number; isInternal: boolean })[]; onSelect: (c: ProductCategory & { liveCount: number; isInternal: boolean }) => void }) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {entries.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onSelect(cat)}
            className="group relative rounded-xl overflow-hidden border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-primary/40 transition-all duration-200 aspect-[4/3] text-left"
          >
            {cat.imageUrl ? (
              <img
                src={cat.imageUrl}
                alt={cat.name}
                className="absolute inset-0 w-full h-full object-contain p-3 transition-transform duration-300 group-hover:scale-105"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted flex items-center justify-center">
                <ImageOff className="w-10 h-10 text-muted-foreground/30" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-3">
              <p className="text-white font-semibold text-sm leading-tight line-clamp-2 drop-shadow">{cat.name}</p>
              <p className="text-white/70 text-xs mt-0.5">{cat.liveCount} products</p>
            </div>
          </button>
        ))}
      </div>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            {/* Breadcrumb back navigation */}
            {(showBackToTop || showBackToSub) && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <button
                  onClick={() => { setSelectedTopCat(null); setSelectedSubCat(null); }}
                  className="hover:text-foreground transition-colors"
                >All categories</button>
                {selectedTopCat && (
                  <>
                    <span className="mx-1">/</span>
                    {selectedSubCat ? (
                      <button
                        onClick={() => setSelectedSubCat(null)}
                        className="hover:text-foreground transition-colors"
                      >{selectedTopCat.name}</button>
                    ) : (
                      <span className="text-foreground font-medium">{selectedTopCat.name}</span>
                    )}
                  </>
                )}
                {selectedSubCat && (
                  <>
                    <span className="mx-1">/</span>
                    <span className="text-foreground font-medium">{selectedSubCat.name}</span>
                  </>
                )}
              </div>
            )}
            {!selectedTopCat && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Products</h1>
                <p className="text-muted-foreground mt-1">
                  {allProducts.length} product{allProducts.length !== 1 ? "s" : ""} across {topLevelEntries.length} categor{topLevelEntries.length !== 1 ? "ies" : "y"}
                </p>
              </div>
            )}
            {selectedTopCat && !selectedSubCat && currentSubs.length === 0 && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{selectedTopCat.name}</h1>
                <p className="text-muted-foreground mt-1">{filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</p>
              </div>
            )}
            {selectedSubCat && (
              <div>
                <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{selectedSubCat.name}</h1>
                <p className="text-muted-foreground mt-1">{filteredProducts.length} product{filteredProducts.length !== 1 ? "s" : ""}</p>
              </div>
            )}
          </div>
          <Button onClick={openCreateDialog} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
            <Plus className="w-4 h-4 mr-2" /> Add Product
          </Button>
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => { setSearch(e.target.value); }}
            />
          </div>

          {/* Website / Internal / Bespoke filter */}
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-0.5 gap-0.5">
            {(["all", "website", "internal", "bespoke"] as const).map((f) => (
              <button
                key={f}
                onClick={() => { setWebsiteFilter(f); setSelectedTopCat(null); setSelectedSubCat(null); }}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  websiteFilter === f
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f === "website" && <Globe className="w-3 h-3" />}
                {f === "internal" && <Lock className="w-3 h-3" />}
                {f === "bespoke" && <Package className="w-3 h-3" />}
                {f === "all" ? "All" : f === "website" ? "Website" : f === "internal" ? "Internal only" : "Bespoke"}
              </button>
            ))}
          </div>
        </div>

        {productsLoading || (showTopGrid && categoriesLoading) ? (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : showTopGrid ? (
          /* ── Top-level category grid ── */
          topLevelEntries.length === 0 ? (
            <div className="py-20 text-center text-muted-foreground">
              <PackageSearch className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
              <h3 className="text-lg font-medium text-foreground">No products yet</h3>
              <p className="mt-1">Add your first product or run a WooCommerce sync.</p>
              <Button onClick={openCreateDialog} variant="outline" className="mt-6">Add Product</Button>
            </div>
          ) : (
            <CategoryGrid
              entries={topLevelEntries}
              onSelect={(cat) => {
                setSelectedTopCat(cat);
                setSelectedSubCat(null);
              }}
            />
          )
        ) : showSubGrid ? (
          /* ── Subcategory grid ── */
          <CategoryGrid
            entries={subEntries}
            onSelect={(cat) => setSelectedSubCat(cat)}
          />
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
                onDuplicate={handleDuplicate}
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
        <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
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
                <div className="flex gap-2">
                  <Input id="sku" value={formData.sku} onChange={(e) => setFormData({ ...formData, sku: e.target.value })} placeholder="e.g. POL-001" className="flex-1" />
                  {formData.customerId !== "none" && (
                    <Button type="button" variant="outline" size="sm" onClick={autoFillBspSku} className="gap-1.5 text-xs whitespace-nowrap text-purple-700 border-purple-200 hover:bg-purple-50">
                      <Wand2 className="w-3.5 h-3.5" /> Auto BSP
                    </Button>
                  )}
                </div>
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
                  {storedCategories.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                  {internalOnlyCatNames.map((n) => (
                    <option key={n} value={n} />
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

            {/* ── Product image ── */}
            <div className="grid gap-2">
              <Label>Product Image</Label>
              {formData.imageUrl ? (
                <div className="flex items-start gap-3">
                  <img
                    src={formData.imageUrl}
                    alt="Product"
                    className="w-20 h-20 object-cover rounded-lg border border-border/50 flex-shrink-0"
                  />
                  <div className="flex flex-col gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={isImageUploading}
                      className="text-xs text-primary hover:underline disabled:opacity-50"
                    >
                      {isImageUploading ? "Uploading…" : "Replace image"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData((f) => ({ ...f, imageUrl: "" }))}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={isImageUploading}
                  className="flex flex-col items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                  {isImageUploading ? (
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  ) : (
                    <Upload className="w-5 h-5 text-muted-foreground" />
                  )}
                  <span className="text-xs text-muted-foreground">{isImageUploading ? "Uploading…" : "Click to upload product image"}</span>
                </button>
              )}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
              />
            </div>

            <div className="border-t border-border/40 pt-3 mt-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Bespoke Assignment</p>
              <div className="grid gap-2">
                <Label>Assign to Customer (Bespoke)</Label>
                <Select value={formData.customerId} onValueChange={(v) => setFormData({ ...formData, customerId: v })}>
                  <SelectTrigger><SelectValue placeholder="— Standard product (all customers) —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Standard product (all customers) —</SelectItem>
                    {(customers as any[]).map((c: any) => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formData.customerId !== "none" && (
                  <p className="text-xs text-purple-600">This product will be marked bespoke and only visible to this customer on their portal.</p>
                )}
              </div>
            </div>

            <div className="border-t border-border/40 pt-3 mt-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Supplier</p>
              <div className="grid gap-2 mb-3">
                <Label>Preferred Supplier</Label>
                <Select value={formData.supplierId} onValueChange={(v) => {
                  const sup = (suppliers as any[]).find((s: any) => String(s.id) === v);
                  setFormData({ ...formData, supplierId: v, supplierCurrency: sup?.currency ?? "GBP" });
                }}>
                  <SelectTrigger><SelectValue placeholder="— None —" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {(suppliers as Supplier[]).map((s) => (
                      <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Supplier Code</Label>
                  <Input value={formData.supplierCode} onChange={(e) => setFormData({ ...formData, supplierCode: e.target.value })} placeholder="e.g. FCC2105" />
                </div>
                <div className="grid gap-2">
                  <Label>Supplier Price ({formData.supplierCurrency === "USD" ? "$" : formData.supplierCurrency === "EUR" ? "€" : "£"})</Label>
                  <Input type="number" min="0" step="0.01" value={formData.supplierPrice} onChange={(e) => setFormData({ ...formData, supplierPrice: e.target.value })} placeholder="0.00" />
                </div>
              </div>
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
  onDuplicate,
  onNavigate,
}: {
  products: ProductWithCategory[];
  onEdit: (p: ProductWithCategory) => void;
  onDelete: (id: number) => void;
  onDuplicate: (id: number) => void;
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
              <TableCell className="font-medium text-foreground hover:text-primary transition-colors">
                <div className="flex items-center gap-2 flex-wrap">
                  {product.name}
                  {(product as any).isBespoke ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex-shrink-0">
                      <Package className="w-2.5 h-2.5" /> Bespoke{(product as any).customerName ? ` · ${(product as any).customerName}` : ""}
                    </span>
                  ) : (product as any).wooCommerceId ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 flex-shrink-0">
                      <Globe className="w-2.5 h-2.5" /> Website
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border flex-shrink-0">
                      <Lock className="w-2.5 h-2.5" /> Internal
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm hidden md:table-cell max-w-[200px] truncate">{product.description || "—"}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(product.unitPrice)}</TableCell>
              <TableCell className="text-right">
                <span className={product.stockQuantity != null && product.stockQuantity <= 5 ? "text-red-600 font-bold" : ""}>
                  {product.stockQuantity ?? "—"}
                </span>
              </TableCell>
              <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" title="Duplicate product" onClick={() => onDuplicate(product.id)}>
                    <Copy className="w-4 h-4" />
                  </Button>
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
