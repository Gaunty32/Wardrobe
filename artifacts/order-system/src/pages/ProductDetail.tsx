import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Package, Palette, Ruler, Loader2, X, Plus, Save, Truck } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { useGetProduct, useUpdateProduct, getListProductsQueryKey, useListSuppliers } from "@workspace/api-client-react";
import { useQueryClient as useQC } from "@tanstack/react-query";

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

function TagInput({
  type,
  productId,
  attributes,
  onRefresh,
}: {
  type: string;
  productId: number;
  attributes: any[];
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [inputVal, setInputVal] = useState("");

  const items = attributes.filter(a => a.type === type);

  const addAttr = useMutation({
    mutationFn: (value: string) =>
      apiFetch(`/products/${productId}/attributes`, {
        method: "POST",
        body: JSON.stringify({ type, value }),
      }),
    onSuccess: () => { onRefresh(); setInputVal(""); },
    onError: () => toast({ title: "Error", description: "Could not add attribute", variant: "destructive" }),
  });

  const delAttr = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/products/${productId}/attributes/${id}`, { method: "DELETE" }),
    onSuccess: () => onRefresh(),
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputVal.trim()) {
      e.preventDefault();
      addAttr.mutate(inputVal.trim());
    }
  };

  const typeLabel = type === "colour" ? "Colour" : "Size";
  const colour: Record<string, string> = {
    colour: "bg-pink-100 text-pink-800 border-pink-200",
    size: "bg-blue-100 text-blue-800 border-blue-200",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No {typeLabel.toLowerCase()}s added yet</p>
        )}
        {items.map((a) => (
          <span
            key={a.id}
            className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium border ${colour[type] || 'bg-gray-100 text-gray-800 border-gray-200'}`}
          >
            {a.value}
            <button
              onClick={() => delAttr.mutate(a.id)}
              className="hover:opacity-60 transition-opacity ml-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`Add ${typeLabel.toLowerCase()}… (press Enter)`}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="max-w-xs"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => inputVal.trim() && addAttr.mutate(inputVal.trim())}
          disabled={addAttr.isPending || !inputVal.trim()}
        >
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: product, isLoading } = useGetProduct(productId);
  const { data: suppliers } = useListSuppliers({});
  const updateMutation = useUpdateProduct();

  const { data: attributes, refetch: refetchAttrs } = useQuery({
    queryKey: ["product", productId, "attributes"],
    queryFn: () => apiFetch(`/products/${productId}/attributes`),
    enabled: !!productId,
  });

  const [details, setDetails] = useState<{
    name: string;
    sku: string;
    description: string;
    unitPrice: number;
    stockQuantity: number;
    supplierId: string;
    supplierCode: string;
  } | null>(null);

  const [detailsDirty, setDetailsDirty] = useState(false);

  const initDetails = (p: any) => ({
    name: p.name,
    sku: p.sku || "",
    description: p.description || "",
    unitPrice: p.unitPrice,
    stockQuantity: p.stockQuantity || 0,
    supplierId: p.supplierId ? String(p.supplierId) : "",
    supplierCode: p.supplierCode || "",
  });

  if (!details && product) {
    setDetails(initDetails(product));
  }

  const handleDetailChange = (field: string, value: any) => {
    setDetails(prev => prev ? { ...prev, [field]: value } : prev);
    setDetailsDirty(true);
  };

  const saveDetails = () => {
    if (!details || !details.name) {
      toast({ title: "Validation Error", description: "Product name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate(
      {
        id: productId,
        data: {
          name: details.name,
          sku: details.sku || null,
          description: details.description || null,
          unitPrice: Number(details.unitPrice),
          stockQuantity: Number(details.stockQuantity) || null,
          supplierId: details.supplierId ? Number(details.supplierId) : null,
          supplierCode: details.supplierCode || null,
        },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
          toast({ title: "Product saved" });
          setDetailsDirty(false);
        },
        onError: () => toast({ title: "Error", description: "Could not save product", variant: "destructive" }),
      }
    );
  };

  if (isLoading || !details) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!product) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-muted-foreground">Product not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate("/products")}>Back to Products</Button>
        </div>
      </Layout>
    );
  }

  const supplier = suppliers?.find(s => s.id === product.supplierId);

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex items-start gap-4">
          <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => navigate("/products")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <Package className="w-6 h-6 text-muted-foreground" />
              <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{product.name}</h1>
              {product.sku && <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">{product.sku}</span>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{formatCurrency(product.unitPrice)}</span>
              {supplier && <span><Truck className="w-3.5 h-3.5 inline mr-1" />{supplier.name}</span>}
              {product.supplierCode && <span>Supplier code: {product.supplierCode}</span>}
            </div>
          </div>
        </div>

        <Tabs defaultValue="details">
          <TabsList className="w-full justify-start bg-muted/50 p-1">
            <TabsTrigger value="details" className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Details</TabsTrigger>
            <TabsTrigger value="colours" className="flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" /> Colours</TabsTrigger>
            <TabsTrigger value="sizes" className="flex items-center gap-1.5"><Ruler className="w-3.5 h-3.5" /> Sizes</TabsTrigger>
          </TabsList>

          <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
            {/* ── Details ── */}
            <TabsContent value="details" className="mt-0">
              <div className="grid gap-5 max-w-2xl">
                <div className="grid gap-2">
                  <Label>Product Name *</Label>
                  <Input value={details.name} onChange={e => handleDetailChange("name", e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>SKU</Label>
                    <Input value={details.sku} onChange={e => handleDetailChange("sku", e.target.value)} placeholder="e.g. POLO-001" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Unit Price (£) *</Label>
                    <Input type="number" min="0" step="0.01" value={details.unitPrice} onChange={e => handleDetailChange("unitPrice", parseFloat(e.target.value) || 0)} />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Stock Quantity</Label>
                  <Input type="number" value={details.stockQuantity} onChange={e => handleDetailChange("stockQuantity", parseInt(e.target.value, 10) || 0)} />
                </div>
                <div className="grid gap-2">
                  <Label>Description</Label>
                  <Textarea rows={3} value={details.description} onChange={e => handleDetailChange("description", e.target.value)} />
                </div>

                <div className="border-t border-border/40 pt-4 mt-1">
                  <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Supplier</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label>Supplier</Label>
                      <Select value={details.supplierId} onValueChange={v => handleDetailChange("supplierId", v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— No supplier —</SelectItem>
                          {suppliers?.map(s => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Supplier Code</Label>
                      <Input value={details.supplierCode} onChange={e => handleDetailChange("supplierCode", e.target.value)} placeholder="e.g. SUP-4521" />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button onClick={saveDetails} disabled={updateMutation.isPending || !detailsDirty}>
                    <Save className="w-4 h-4 mr-2" />
                    {updateMutation.isPending ? "Saving…" : "Save Changes"}
                  </Button>
                </div>
              </div>
            </TabsContent>

            {/* ── Colours ── */}
            <TabsContent value="colours" className="mt-0">
              <div className="mb-4">
                <h3 className="font-semibold text-foreground">Available Colours</h3>
                <p className="text-sm text-muted-foreground mt-1">Add all the colour options available for this product.</p>
              </div>
              <TagInput
                type="colour"
                productId={productId}
                attributes={attributes || []}
                onRefresh={refetchAttrs}
              />
            </TabsContent>

            {/* ── Sizes ── */}
            <TabsContent value="sizes" className="mt-0">
              <div className="mb-4">
                <h3 className="font-semibold text-foreground">Available Sizes</h3>
                <p className="text-sm text-muted-foreground mt-1">Add all the size options available for this product (e.g. XS, S, M, L, XL, XXL).</p>
              </div>
              <TagInput
                type="size"
                productId={productId}
                attributes={attributes || []}
                onRefresh={refetchAttrs}
              />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </Layout>
  );
}
