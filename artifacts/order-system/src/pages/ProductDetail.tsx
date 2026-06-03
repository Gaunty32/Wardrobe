import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUpload } from "@workspace/object-storage-web";
import Layout from "@/components/Layout";
import { UploadedImage } from "@/components/UploadedImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Package, Loader2, X, Plus, Save, Trash2, Edit2, AlertCircle,
  Layers, Palette, Ruler, Upload, Camera, Wrench
} from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { sortBySizeWithOrder, sizeRank } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { useGetProduct, useUpdateProduct, getListProductsQueryKey, useListSuppliers } from "@workspace/api-client-react";

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

// ── Tag Input ──────────────────────────────────────────────────────────────
function TagInput({
  type, productId, attributes, onRefresh,
}: {
  type: "colour" | "size" | "sleeve"; productId: number; attributes: any[]; onRefresh: () => void;
}) {
  const { toast } = useToast();
  const [inputVal, setInputVal] = useState("");
  const items = attributes.filter(a => a.type === type);

  const addMut = useMutation({
    mutationFn: (value: string) => apiFetch(`/products/${productId}/attributes`, {
      method: "POST", body: JSON.stringify({ type, value }),
    }),
    onSuccess: () => { onRefresh(); setInputVal(""); },
    onError: () => toast({ title: "Error adding attribute", variant: "destructive" }),
  });

  const delMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/products/${productId}/attributes/${id}`, { method: "DELETE" }),
    onSuccess: onRefresh,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && inputVal.trim()) { e.preventDefault(); addMut.mutate(inputVal.trim()); }
  };

  const colourMap: Record<string, string> = {
    colour: "bg-pink-100 text-pink-800 border-pink-200",
    size:   "bg-blue-100 text-blue-800 border-blue-200",
    sleeve: "bg-amber-100 text-amber-800 border-amber-200",
  };

  const emptyLabel = type === "colour" ? "colours" : type === "size" ? "sizes" : "sleeve types";
  const placeholder = type === "colour" ? "colour" : type === "size" ? "size" : "e.g. Long Sleeve";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground italic">No {emptyLabel} added yet</p>
        )}
        {items.map(a => (
          <span key={a.id} className={`inline-flex items-center gap-1.5 pr-2 py-1 rounded-full text-sm font-medium border ${colourMap[type]} ${a.imageUrl ? "pl-1" : "pl-3"}`}>
            {type === "colour" && a.imageUrl && (
              <img src={a.imageUrl} alt={a.value} className="w-5 h-5 rounded-full object-cover border border-white/60 flex-shrink-0" />
            )}
            {a.value}
            <button onClick={() => delMut.mutate(a.id)} className="hover:opacity-60 ml-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          placeholder={`Add ${placeholder}… (press Enter)`}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className="max-w-xs"
        />
        <Button size="sm" variant="outline" onClick={() => inputVal.trim() && addMut.mutate(inputVal.trim())} disabled={addMut.isPending || !inputVal.trim()}>
          <Plus className="w-4 h-4 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

// ── Supplier select ────────────────────────────────────────────────────────
function SupplierSelect({ value, onChange, suppliers, placeholder = "Select supplier…", className }: {
  value: string; onChange: (v: string) => void; suppliers: any[]; placeholder?: string; className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 text-sm"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">— None —</SelectItem>
        {suppliers.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ── Variant row ─────────────────────────────────────────────────────────────
function VariantRow({ variant, suppliers, productId, onRefresh, onColourImageUpload, productSupplierId, productSecondaryId }: {
  variant: any; suppliers: any[]; productId: number; onRefresh: () => void;
  onColourImageUpload: (colour: string | null, imageUrl: string) => void;
  productSupplierId?: number | null; productSecondaryId?: number | null;
}) {
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [stock, setStock] = useState(String(variant.stockQuantity));
  const [editStock, setEditStock] = useState(String(variant.stockQuantity));
  const [primaryId, setPrimaryId] = useState(variant.primarySupplierId ? String(variant.primarySupplierId) : "none");
  const [variantSupplierCode, setVariantSupplierCode] = useState(variant.supplierCode || "");
  const [variantSupplierPrice, setVariantSupplierPrice] = useState(variant.supplierPrice != null ? String(variant.supplierPrice) : "");
  const [secondaryId, setSecondaryId] = useState(variant.secondarySupplierId ? String(variant.secondarySupplierId) : "none");
  const [secondarySupplierCode, setSecondarySupplierCode] = useState(variant.secondarySupplierCode || "");
  const [secondarySupplierPrice, setSecondarySupplierPrice] = useState(variant.secondarySupplierPrice != null ? String(variant.secondarySupplierPrice) : "");
  const [showVariantSecondary, setShowVariantSecondary] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState(variant.imageUrl || "");
  const variantImageRef = useRef<HTMLInputElement>(null);
  const quickImageRef = useRef<HTMLInputElement>(null);

  // Upload used inside the edit dialog (updates local state only)
  const { uploadFile: uploadVariantImage, isUploading: isVariantImageUploading } = useUpload({
    onSuccess: (res) => setEditImageUrl(`/api/storage${res.objectPath}`),
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  // Quick-upload: clicks directly on the row image cell → applies to all variants of this colour
  const { uploadFile: quickUploadImage, isUploading: isQuickUploading } = useUpload({
    onSuccess: (res) => {
      const url = `/api/storage${res.objectPath}`;
      setEditImageUrl(url);
      onColourImageUpload(variant.colour ?? null, url);
    },
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/products/${productId}/variants/${variant.id}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
    onSuccess: () => { onRefresh(); setEditOpen(false); toast({ title: "Variant updated" }); },
    onError: () => toast({ title: "Error updating variant", variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/variants/${variant.id}`, { method: "DELETE" }),
    onSuccess: () => { onRefresh(); toast({ title: "Variant removed" }); },
  });

  const handleStockBlur = () => {
    const num = parseInt(stock, 10);
    if (isNaN(num) || num < 0) { setStock(String(variant.stockQuantity)); return; }
    if (num !== variant.stockQuantity) {
      updateMut.mutate({ stockQuantity: num });
    }
  };

  const handleSaveEdit = () => {
    updateMut.mutate({
      stockQuantity: parseInt(editStock, 10) || 0,
      imageUrl: editImageUrl || null,
      primarySupplierId: primaryId !== "none" ? Number(primaryId) : null,
      supplierCode: variantSupplierCode || null,
      supplierPrice: variantSupplierPrice !== "" ? parseFloat(variantSupplierPrice) : null,
      secondarySupplierId: secondaryId !== "none" ? Number(secondaryId) : null,
      secondarySupplierCode: secondarySupplierCode || null,
      secondarySupplierPrice: secondarySupplierPrice !== "" ? parseFloat(secondarySupplierPrice) : null,
    });
  };

  const openEdit = () => {
    setEditStock(String(variant.stockQuantity));
    setEditImageUrl(variant.imageUrl || "");
    setPrimaryId(variant.primarySupplierId ? String(variant.primarySupplierId) : "none");
    setVariantSupplierCode(variant.supplierCode || "");
    setVariantSupplierPrice(variant.supplierPrice != null ? String(variant.supplierPrice) : "");
    setSecondaryId(variant.secondarySupplierId ? String(variant.secondarySupplierId) : "none");
    setSecondarySupplierCode(variant.secondarySupplierCode || "");
    setSecondarySupplierPrice(variant.secondarySupplierPrice != null ? String(variant.secondarySupplierPrice) : "");
    setEditOpen(true);
  };

  const primarySupplier = suppliers.find(s => s.id === (variant.primarySupplierId ?? productSupplierId));
  const secondarySupplier = suppliers.find(s => s.id === (variant.secondarySupplierId ?? productSecondaryId));
  const primaryIsInherited = !variant.primarySupplierId && !!productSupplierId;
  const secondaryIsInherited = !variant.secondarySupplierId && !!productSecondaryId;
  const isLowStock = variant.stockQuantity <= 5;

  return (
    <>
      <TableRow className="group hover:bg-muted/20">
        {/* Hidden file input for quick image upload */}
        <input ref={quickImageRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) quickUploadImage(f); e.target.value = ""; }}
        />
        <TableCell>
          <div className="flex items-center gap-2">
            {/* Image cell — click to upload */}
            <button
              type="button"
              title={variant.imageUrl ? "Click to replace image" : "Click to upload image"}
              onClick={() => quickImageRef.current?.click()}
              className="relative w-8 h-8 rounded overflow-hidden flex-shrink-0 group/img border border-border/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              {isQuickUploading ? (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                </div>
              ) : (variant.imageUrl || editImageUrl) ? (
                <>
                  <UploadedImage src={variant.imageUrl || editImageUrl} alt={variant.colour ?? ""} className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-muted flex items-center justify-center"><Package className="w-3 h-3 text-muted-foreground/40" /></div>} />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-3 h-3 text-white" />
                  </div>
                </>
              ) : (
                <div className="w-full h-full bg-pink-100 border-pink-200 flex items-center justify-center">
                  <div className="absolute inset-0 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center bg-pink-200/60">
                    <Camera className="w-3 h-3 text-pink-700" />
                  </div>
                </div>
              )}
            </button>
            {variant.colour
              ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-800 border border-pink-200">{variant.colour}</span>
              : <span className="text-muted-foreground text-sm italic">Any</span>}
          </div>
        </TableCell>
        <TableCell>
          {variant.sleeve
            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">{variant.sleeve}</span>
            : <span className="text-muted-foreground text-sm italic">—</span>}
        </TableCell>
        <TableCell>
          {variant.size
            ? <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">{variant.size}</span>
            : <span className="text-muted-foreground text-sm italic">Any</span>}
        </TableCell>
        <TableCell className="font-mono text-xs text-muted-foreground">
          {variant.sku ?? <span className="italic">—</span>}
        </TableCell>
        <TableCell>
          <Input
            type="number"
            min={0}
            value={stock}
            onChange={e => setStock(e.target.value)}
            onBlur={handleStockBlur}
            className={`w-20 h-7 text-sm text-center ${isLowStock ? "border-amber-400 text-amber-700 font-bold" : ""}`}
          />
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {primarySupplier
            ? <span className={primaryIsInherited ? "text-muted-foreground italic" : "font-medium text-foreground"}>{primarySupplier.name}</span>
            : <span className="italic">—</span>}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {secondarySupplier
            ? <span className={secondaryIsInherited ? "italic" : ""}>{secondarySupplier.name}</span>
            : <span className="italic">—</span>}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-7 w-7 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={openEdit}>
              <Edit2 className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => {
              if (confirm("Remove this variant?")) deleteMut.mutate();
            }}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Variant</DialogTitle>
          </DialogHeader>
          <div className="flex flex-wrap gap-2 mb-4">
            {variant.colour && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-pink-100 text-pink-800 border border-pink-200">{variant.colour}</span>}
            {variant.sleeve && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">{variant.sleeve}</span>}
            {variant.size && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 border border-blue-200">{variant.size}</span>}
          </div>
          <div className="grid gap-4">
            {/* Variation image upload */}
            <div className="grid gap-2">
              <Label>Variation Image</Label>
              {editImageUrl ? (
                <div className="flex items-start gap-3">
                  <UploadedImage src={editImageUrl} alt="Variant" className="w-16 h-16 object-cover rounded-lg border border-border/50 flex-shrink-0" fallback={<div className="w-16 h-16 rounded-lg border border-border/50 bg-muted flex items-center justify-center flex-shrink-0"><Package className="w-5 h-5 text-muted-foreground/40" /></div>} />
                  <div className="flex flex-col gap-2 mt-1">
                    <button type="button" onClick={() => variantImageRef.current?.click()} disabled={isVariantImageUploading} className="text-xs text-primary hover:underline disabled:opacity-50">
                      {isVariantImageUploading ? "Uploading…" : "Replace image"}
                    </button>
                    <button type="button" onClick={() => setEditImageUrl("")} className="text-xs text-destructive hover:underline">Remove</button>
                  </div>
                </div>
              ) : (
                <button type="button" onClick={() => variantImageRef.current?.click()} disabled={isVariantImageUploading}
                  className="flex items-center justify-center gap-2 h-16 rounded-lg border-2 border-dashed border-border/60 hover:border-primary/40 hover:bg-muted/30 transition-colors disabled:opacity-50"
                >
                  {isVariantImageUploading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Upload className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-xs text-muted-foreground">{isVariantImageUploading ? "Uploading…" : "Upload variation image"}</span>
                </button>
              )}
              <input ref={variantImageRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadVariantImage(f); e.target.value = ""; }}
              />
            </div>
            <div className="grid gap-2">
              <Label>Stock Quantity</Label>
              <Input type="number" min={0} value={editStock} onChange={e => setEditStock(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Preferred Supplier</Label>
              <SupplierSelect value={primaryId} onChange={setPrimaryId} suppliers={suppliers} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label>Supplier Code</Label>
                <Input value={variantSupplierCode} onChange={e => setVariantSupplierCode(e.target.value)} placeholder="Override code" />
              </div>
              <div className="grid gap-2">
                {(() => {
                  const sup = suppliers.find((s: any) => String(s.id) === primaryId);
                  const sym = (sup as any)?.currency === "USD" ? "$" : (sup as any)?.currency === "EUR" ? "€" : "£";
                  return <Label>Supplier Price ({sym})</Label>;
                })()}
                <Input type="number" min="0" step="0.01" value={variantSupplierPrice} onChange={e => setVariantSupplierPrice(e.target.value)} placeholder="Override price" />
              </div>
            </div>

            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
              onClick={() => setShowVariantSecondary(v => !v)}
            >
              <span className={`transition-transform duration-150 ${showVariantSecondary ? "rotate-90" : ""}`}>▶</span>
              {showVariantSecondary ? "Hide" : "Show"} backup supplier
            </button>

            {showVariantSecondary && (
              <div className="pl-4 border-l-2 border-border/40 space-y-3">
                <div className="grid gap-2">
                  <Label>Backup Supplier</Label>
                  <SupplierSelect value={secondaryId} onChange={setSecondaryId} suppliers={suppliers} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label>Backup Code</Label>
                    <Input value={secondarySupplierCode} onChange={e => setSecondarySupplierCode(e.target.value)} placeholder="Backup code" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Backup Price (£)</Label>
                    <Input type="number" min="0" step="0.01" value={secondarySupplierPrice} onChange={e => setSecondarySupplierPrice(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={updateMut.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Add Variant Dialog ────────────────────────────────────────────────────
function AddVariantDialog({ open, onClose, productId, attributes, suppliers, defaultPrimaryId, defaultSecondaryId, onRefresh }: {
  open: boolean; onClose: () => void; productId: number;
  attributes: any[]; suppliers: any[];
  defaultPrimaryId: string; defaultSecondaryId: string;
  onRefresh: () => void;
}) {
  const { toast } = useToast();
  const colours = attributes.filter(a => a.type === "colour").map(a => a.value);
  const sizes = attributes.filter(a => a.type === "size").map(a => a.value);
  const sleevesAttr = attributes.filter(a => a.type === "sleeve").map(a => a.value);

  const [colour, setColour] = useState("none");
  const [customColour, setCustomColour] = useState("");
  const [size, setSize] = useState("none");
  const [customSize, setCustomSize] = useState("");
  const [sleeve, setSleeve] = useState("none");
  const [customSleeve, setCustomSleeve] = useState("");
  const [stock, setStock] = useState("0");
  const [primaryId, setPrimaryId] = useState(defaultPrimaryId);
  const [secondaryId, setSecondaryId] = useState(defaultSecondaryId);

  useEffect(() => {
    if (open) {
      setColour("none"); setCustomColour("");
      setSize("none"); setCustomSize("");
      setSleeve("none"); setCustomSleeve("");
      setStock("0");
      setPrimaryId(defaultPrimaryId);
      setSecondaryId(defaultSecondaryId);
    }
  }, [open, defaultPrimaryId, defaultSecondaryId]);

  const createMut = useMutation({
    mutationFn: (data: any) => apiFetch(`/products/${productId}/variants`, { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { onRefresh(); onClose(); toast({ title: "Variant added" }); },
    onError: () => toast({ title: "Error adding variant", variant: "destructive" }),
  });

  const handleSave = () => {
    const finalColour = colour === "custom" ? customColour.trim() : colour === "none" ? null : colour;
    const finalSize = size === "custom" ? customSize.trim() : size === "none" ? null : size;
    const finalSleeve = sleeve === "custom" ? customSleeve.trim() : sleeve === "none" ? null : sleeve;
    createMut.mutate({
      colour: finalColour,
      size: finalSize,
      sleeve: finalSleeve,
      stockQuantity: parseInt(stock, 10) || 0,
      primarySupplierId: primaryId !== "none" ? Number(primaryId) : null,
      secondarySupplierId: secondaryId !== "none" ? Number(secondaryId) : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Variant Combination</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Colour</Label>
              <Select value={colour} onValueChange={setColour}>
                <SelectTrigger><SelectValue placeholder="Select colour…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No colour —</SelectItem>
                  {colours.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {colour === "custom" && (
                <Input placeholder="Enter colour" value={customColour} onChange={e => setCustomColour(e.target.value)} />
              )}
            </div>
            <div className="grid gap-2">
              <Label>Size</Label>
              <Select value={size} onValueChange={setSize}>
                <SelectTrigger><SelectValue placeholder="Select size…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No size —</SelectItem>
                  {sizes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              {size === "custom" && (
                <Input placeholder="Enter size" value={customSize} onChange={e => setCustomSize(e.target.value)} />
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Fit / Length <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Select value={sleeve} onValueChange={setSleeve}>
              <SelectTrigger><SelectValue placeholder="Select fit / length…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— No sleeve —</SelectItem>
                {sleevesAttr.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
            {sleeve === "custom" && (
              <Input placeholder="e.g. Long Sleeve" value={customSleeve} onChange={e => setCustomSleeve(e.target.value)} />
            )}
          </div>
          <div className="grid gap-2">
            <Label>Stock Quantity</Label>
            <Input type="number" min={0} value={stock} onChange={e => setStock(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Primary Supplier</Label>
            <SupplierSelect value={primaryId} onChange={setPrimaryId} suppliers={suppliers} />
          </div>
          <div className="grid gap-2">
            <Label>Secondary Supplier <span className="text-muted-foreground font-normal">(out-of-stock fallback)</span></Label>
            <SupplierSelect value={secondaryId} onChange={setSecondaryId} suppliers={suppliers} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={createMut.isPending}>Add Variant</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const productId = Number(id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const sizeOrder = useSizeOrder();

  const { data: product, isLoading } = useGetProduct(productId);
  const { data: suppliers = [] } = useListSuppliers({});
  const updateMutation = useUpdateProduct();

  const productImageRef = useRef<HTMLInputElement>(null);
  const { uploadFile: uploadProductImage, isUploading: isProductImageUploading } = useUpload({
    onSuccess: async (res) => {
      const newUrl = `/api/storage${res.objectPath}`;
      await updateMutation.mutateAsync({ id: productId, data: { imageUrl: newUrl } as any });
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      toast({ title: "Product image updated" });
    },
    onError: () => toast({ title: "Image upload failed", variant: "destructive" }),
  });

  const { data: attributes = [], refetch: refetchAttrs } = useQuery({
    queryKey: ["product", productId, "attributes"],
    queryFn: () => apiFetch(`/products/${productId}/attributes`),
    enabled: !!productId,
  });

  const { data: variants = [], refetch: refetchVariants } = useQuery({
    queryKey: ["product", productId, "variants"],
    queryFn: () => apiFetch(`/products/${productId}/variants`),
    enabled: !!productId,
  });

  // Upload one image and apply it to every variant that shares the same colour
  async function handleColourImageUpload(colour: string | null, imageUrl: string) {
    const siblings = (variants as any[]).filter((v) =>
      colour == null ? v.colour == null : v.colour === colour
    );
    await Promise.all(
      siblings.map((v) =>
        apiFetch(`/products/${productId}/variants/${v.id}`, {
          method: "PATCH",
          body: JSON.stringify({ imageUrl }),
        })
      )
    );
    refetchVariants();
  }

  const { data: categoryNames = [] } = useQuery<string[]>({
    queryKey: ["products-category-names"],
    queryFn: () => apiFetch("/products/category-names"),
  });

  const [details, setDetails] = useState<{
    name: string; sku: string; description: string; category: string;
    unitPrice: number; supplierId: string; secondarySupplierId: string;
    supplierCode: string; supplierPrice: string;
    secondarySupplierCode: string; secondarySupplierPrice: string;
    supplierCurrency: string;
    minOrderQty: string;
    vatRate: string;
    priceBreaks: { qty: number; price: number }[];
  } | null>(null);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const [isService, setIsService] = useState(false);
  const [showSecondarySupplier, setShowSecondarySupplier] = useState(false);
  const [addVariantOpen, setAddVariantOpen] = useState(false);
  const [generateMatrixOpen, setGenerateMatrixOpen] = useState(false);
  const [filterColour, setFilterColour] = useState<string>("all");
  const [filterSize, setFilterSize] = useState<string>("all");
  const [filterSleeve, setFilterSleeve] = useState<string>("all");
  const [bulkPrimaryId, setBulkPrimaryId] = useState<string>("none");
  const [bulkPrice, setBulkPrice] = useState<string>("");
  const [bulkCode, setBulkCode] = useState<string>("");

  useEffect(() => {
    if (product) {
      setIsService(!!(product as any).isService);
    }
    if (product && !details) {
      setDetails({
        name: product.name,
        sku: product.sku || "",
        description: product.description || "",
        category: (product as any).category || "",
        unitPrice: product.unitPrice,
        supplierId: product.supplierId ? String(product.supplierId) : "none",
        secondarySupplierId: product.secondarySupplierId ? String(product.secondarySupplierId) : "none",
        supplierCode: product.supplierCode || "",
        supplierPrice: product.supplierPrice != null ? String(product.supplierPrice) : "",
        secondarySupplierCode: product.secondarySupplierCode || "",
        secondarySupplierPrice: product.secondarySupplierPrice != null ? String(product.secondarySupplierPrice) : "",
        supplierCurrency: (product as any).supplierCurrency ?? "GBP",
        minOrderQty: (product as any).minOrderQty != null ? String((product as any).minOrderQty) : "",
        vatRate: (product as any).vatRate != null ? String(parseFloat(String((product as any).vatRate))) : "0.2",
        priceBreaks: Array.isArray((product as any).priceBreaks) ? (product as any).priceBreaks : [],
      });
    }
  }, [product, details]);

  const handleDetailChange = (field: string, value: any) => {
    setDetails(prev => prev ? { ...prev, [field]: value } : prev);
    setDetailsDirty(true);
  };

  // When supplier changes: auto-set currency from supplier record and apply default price breaks if none set
  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find((s: any) => String(s.id) === supplierId);
    setDetails(prev => {
      if (!prev) return prev;
      const currency = (supplier as any)?.currency ?? "GBP";
      const hasBreaks = prev.priceBreaks.length > 0;
      const supplierBreaks: { qty: number; price: number }[] = (supplier as any)?.defaultPriceBreaks ?? [];
      return {
        ...prev,
        supplierId,
        supplierCurrency: currency,
        priceBreaks: !hasBreaks && supplierBreaks.length > 0 ? supplierBreaks : prev.priceBreaks,
      };
    });
    setDetailsDirty(true);
  };

  const saveDetails = () => {
    if (!details?.name) { toast({ title: "Product name is required", variant: "destructive" }); return; }
    updateMutation.mutate(
      {
        id: productId,
        data: {
          name: details.name,
          sku: details.sku || null,
          description: details.description || null,
          category: details.category.trim() || null,
          unitPrice: Number(details.unitPrice),
          supplierId: details.supplierId !== "none" ? Number(details.supplierId) : null,
          secondarySupplierId: details.secondarySupplierId !== "none" ? Number(details.secondarySupplierId) : null,
          supplierCode: details.supplierCode || null,
          supplierPrice: details.supplierPrice !== "" ? parseFloat(details.supplierPrice) : null,
          secondarySupplierCode: details.secondarySupplierCode || null,
          secondarySupplierPrice: details.secondarySupplierPrice !== "" ? parseFloat(details.secondarySupplierPrice) : null,
          supplierCurrency: details.supplierCurrency,
          minOrderQty: details.minOrderQty !== "" ? parseInt(details.minOrderQty, 10) || null : null,
          vatRate: parseFloat(details.vatRate) || 0,
          priceBreaks: details.priceBreaks.length > 0
            ? [...details.priceBreaks].sort((a, b) => a.qty - b.qty)
            : null,
        } as any,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
          qc.invalidateQueries({ queryKey: ["product", productId, "attributes"] });
          qc.invalidateQueries({ queryKey: ["product", productId, "variants"] });
          qc.invalidateQueries({ queryKey: ["product", productId] });
          toast({ title: "Product saved" });
          setDetailsDirty(false);
        },
        onError: () => toast({ title: "Could not save product", variant: "destructive" }),
      }
    );
  };

  const toggleServiceMut = useMutation({
    mutationFn: (val: boolean) => apiFetch(`/products/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ isService: val }),
    }),
    onSuccess: (_data: any, val: boolean) => {
      setIsService(val);
      qc.invalidateQueries({ queryKey: getListProductsQueryKey() });
      qc.invalidateQueries({ queryKey: ["product", productId] });
      toast({ title: val ? "Marked as service" : "Marked as physical product" });
    },
    onError: () => toast({ title: "Could not update product type", variant: "destructive" }),
  });

  const generateMatrixMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/variants/generate-matrix`, { method: "POST" }),
    onSuccess: (data: any) => {
      refetchVariants();
      setGenerateMatrixOpen(false);
      toast({ title: `Generated ${data.created} variant${data.created !== 1 ? "s" : ""}${data.deleted > 0 ? `, removed ${data.deleted} colour-only row${data.deleted !== 1 ? "s" : ""}` : ""}` });
    },
    onError: (err: any) => toast({ title: err.message || "Failed to generate variants", variant: "destructive" }),
  });

  const bulkUpdateMut = useMutation({
    mutationFn: (ids: number[]) => apiFetch(`/products/${productId}/variants/bulk`, {
      method: "PATCH",
      body: JSON.stringify({
        ids,
        ...(bulkPrimaryId !== "none" ? { primarySupplierId: Number(bulkPrimaryId) } : { primarySupplierId: null }),
        ...(bulkPrice !== "" ? { supplierPrice: parseFloat(bulkPrice) } : {}),
        ...(bulkCode !== "" ? { supplierCode: bulkCode } : {}),
      }),
    }),
    onSuccess: (_data: any, ids: number[]) => {
      refetchVariants();
      toast({ title: `Updated ${ids.length} variant${ids.length !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  if (isLoading || !details) {
    return <Layout><div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></Layout>;
  }
  if (!product) {
    return <Layout><div className="text-center py-20"><p className="text-muted-foreground">Product not found.</p><Button variant="outline" className="mt-4" onClick={() => navigate("/products")}>Back</Button></div></Layout>;
  }

  const totalStock = variants.reduce((sum: number, v: any) => sum + (v.stockQuantity || 0), 0);
  const lowStockCount = variants.filter((v: any) => v.stockQuantity <= 5).length;
  const defaultPrimaryId = details.supplierId !== "none" ? Number(details.supplierId) : null;
  const defaultSecondaryId = details.secondarySupplierId !== "none" ? Number(details.secondarySupplierId) : null;

  // Group variants — colour-first (preserving API order), then size within each group
  const colourOrder = [...new Set((variants as any[]).map((v: any) => v.colour ?? ""))];
  const sortedVariants = [...(variants as any[])].sort((a, b) => {
    const ca = a.colour ?? "", cb = b.colour ?? "";
    const ci = colourOrder.indexOf(ca) - colourOrder.indexOf(cb);
    if (ci !== 0) return ci;
    const sa = a.size ?? "", sb = b.size ?? "";
    const ia = sizeOrder.length ? sizeOrder.findIndex((o: string) => o.toLowerCase() === sa.toLowerCase()) : -1;
    const ib = sizeOrder.length ? sizeOrder.findIndex((o: string) => o.toLowerCase() === sb.toLowerCase()) : -1;
    const ra = ia !== -1 ? ia : 10000 + sizeRank(sa);
    const rb = ib !== -1 ? ib : 10000 + sizeRank(sb);
    return ra - rb || sa.localeCompare(sb);
  });
  const colours = colourOrder.filter(Boolean);
  const sizes = [...new Set(sortedVariants.map((v: any) => v.size).filter(Boolean))];
  const sleeves = [...new Set(sortedVariants.map((v: any) => v.sleeve).filter(Boolean))];

  const filteredVariants = sortedVariants.filter((v: any) => {
    if (filterColour !== "all" && v.colour !== filterColour) return false;
    if (filterSize !== "all" && v.size !== filterSize) return false;
    if (filterSleeve !== "all" && v.sleeve !== filterSleeve) return false;
    return true;
  });

  // Auto-populate the bulk strip with shared current values when the filter changes
  useEffect(() => {
    if (filteredVariants.length === 0) return;
    const allSupplierId = filteredVariants.every((v: any) => v.primarySupplierId === filteredVariants[0].primarySupplierId);
    const allCode = filteredVariants.every((v: any) => (v.supplierCode ?? "") === (filteredVariants[0].supplierCode ?? ""));
    const allPrice = filteredVariants.every((v: any) => (v.supplierPrice ?? "") === (filteredVariants[0].supplierPrice ?? ""));
    setBulkPrimaryId(allSupplierId && filteredVariants[0].primarySupplierId ? String(filteredVariants[0].primarySupplierId) : "none");
    setBulkCode(allCode ? (filteredVariants[0].supplierCode ?? "") : "");
    setBulkPrice(allPrice && filteredVariants[0].supplierPrice != null ? String(filteredVariants[0].supplierPrice) : "");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterColour, filterSize, filterSleeve, variants]);

  // Attributes-based colour+size+sleeve lists (for matrix generation)
  const attrColours = (attributes as any[]).filter(a => a.type === "colour").map(a => a.value as string);
  const attrSizes = (attributes as any[]).filter(a => a.type === "size").map(a => a.value as string);
  const attrSleeves = (attributes as any[]).filter(a => a.type === "sleeve").map(a => a.value as string);
  const canGenerateMatrix = attrColours.length > 0 && attrSizes.length > 0;

  return (
    <TooltipProvider>
      <Layout>
        <div className="flex flex-col space-y-6">
          {/* ── Header ── */}
          <div className="flex items-start gap-4">
            <Button variant="ghost" size="icon" className="mt-1 shrink-0" onClick={() => navigate("/products")}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <button
              type="button"
              title="Click to upload product image"
              onClick={() => productImageRef.current?.click()}
              disabled={isProductImageUploading}
              className="group relative w-16 h-16 rounded-lg border border-border/50 overflow-hidden flex-shrink-0 hover:border-primary/50 transition-colors disabled:opacity-60"
            >
              {(product as any).imageUrl ? (
                <UploadedImage src={(product as any).imageUrl} alt={product.name} className="w-full h-full object-cover" fallback={<div className="w-full h-full bg-muted flex items-center justify-center"><Package className="w-7 h-7 text-muted-foreground/40" /></div>} />
              ) : (
                <div className="w-full h-full bg-muted flex items-center justify-center">
                  <Package className="w-7 h-7 text-muted-foreground/40" />
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {isProductImageUploading ? <Loader2 className="w-4 h-4 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
              </div>
            </button>
            <input ref={productImageRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProductImage(f); e.target.value = ""; }}
            />
            <div className="flex-1 min-w-0 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">{product.name}</h1>
                  {product.sku && <span className="font-mono text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded">{product.sku}</span>}
                  {isService && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                      <Wrench className="w-3 h-3" /> Service
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-1 mt-2 text-sm text-muted-foreground">
                  <span className="font-semibold text-foreground text-base">{formatCurrency(product.unitPrice)}</span>
                  {variants.length > 0 && (
                    <>
                      <span>{totalStock} units in stock</span>
                      {lowStockCount > 0 && (
                        <span className="text-amber-600 font-medium flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5" /> {lowStockCount} variant{lowStockCount > 1 ? "s" : ""} low stock
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              {/* Internal GP% badge — only shown when supplier cost is known */}
              {product.supplierPrice != null && product.supplierPrice > 0 && product.unitPrice > 0 && (() => {
                const gp = ((product.unitPrice - product.supplierPrice) / product.unitPrice) * 100;
                const color = gp >= 70 ? "bg-green-50 text-green-700 border-green-200"
                            : gp >= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-red-50 text-red-700 border-red-200";
                return (
                  <div className={`flex-shrink-0 flex flex-col items-center rounded-lg border px-4 py-2 ${color}`}>
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">GP</span>
                    <span className="text-2xl font-bold leading-none">{gp.toFixed(1)}%</span>
                    <span className="text-xs mt-0.5 opacity-60">
                      cost {formatCurrency(product.supplierPrice)}
                    </span>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── Tabs ── */}
          <Tabs defaultValue="details">
            <TabsList className="w-full justify-start bg-muted/50 p-1">
              <TabsTrigger value="details" className="flex items-center gap-1.5"><Package className="w-3.5 h-3.5" /> Details</TabsTrigger>
              {!isService && (
                <TabsTrigger value="variants" className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5" /> Variants
                  {variants.length > 0 && (
                    <span className="ml-1 bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5 rounded-full">{variants.length}</span>
                  )}
                </TabsTrigger>
              )}
            </TabsList>

            {/* ── Details ── */}
            <TabsContent value="details">
              <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                <div className="grid gap-5 max-w-2xl">
                  <div className="grid gap-2">
                    <Label>Product Name *</Label>
                    <Input value={details.name} onChange={e => handleDetailChange("name", e.target.value)} />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="grid gap-2">
                      <Label>SKU</Label>
                      <Input value={details.sku} onChange={e => handleDetailChange("sku", e.target.value)} placeholder="e.g. POLO-001" />
                    </div>
                    <div className="grid gap-2">
                      <Label>Unit Price (£) *</Label>
                      <Input type="number" min="0" step="0.01" value={details.unitPrice} onChange={e => handleDetailChange("unitPrice", parseFloat(e.target.value) || 0)} />
                    </div>
                    <div className="grid gap-2">
                      <Label>VAT Rate</Label>
                      <Select value={details.vatRate} onValueChange={v => handleDetailChange("vatRate", v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.2">Standard (20%)</SelectItem>
                          <SelectItem value="0.05">Reduced (5%)</SelectItem>
                          <SelectItem value="0">Zero-rated (0%)</SelectItem>
                        </SelectContent>
                      </Select>
                      {parseFloat(details.vatRate) === 0 && (
                        <p className="text-xs text-green-600">Zero-rated — e.g. children's clothing</p>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Textarea rows={3} value={details.description} onChange={e => handleDetailChange("description", e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>Category</Label>
                    <input
                      list="product-category-list"
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      placeholder="e.g. Bespoke Ties"
                      value={details.category}
                      onChange={e => handleDetailChange("category", e.target.value)}
                    />
                    <datalist id="product-category-list">
                      {categoryNames.map(name => <option key={name} value={name} />)}
                    </datalist>
                    {details.category === "Bespoke Ties" && (
                      <p className="text-xs text-blue-600">On save, standard variants will be auto-created: <strong>Full Length Tie</strong> ({details.sku ? `${details.sku}-FLT` : "SKU-FLT"}), <strong>Clip-On Tie</strong> ({details.sku ? `${details.sku}-COT` : "SKU-COT"}), <strong>Clip-on Cravat</strong> ({details.sku ? `${details.sku}-COC` : "SKU-COC"}).</p>
                    )}
                  </div>

                  {/* ── Service toggle ── */}
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5 text-amber-500" /> Service product
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">No stock, no variants, no purchasing. E.g. logo digitising, setup charges.</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isService}
                        onClick={() => toggleServiceMut.mutate(!isService)}
                        disabled={toggleServiceMut.isPending}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isService ? "bg-amber-500" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${isService ? "translate-x-4" : "translate-x-0"}`} />
                      </button>
                    </div>
                  </div>

                  {!isService && (
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Preferred Supplier</h4>
                    <div className="grid gap-2 mb-4">
                      <Label>Supplier</Label>
                      <SupplierSelect value={details.supplierId} onChange={handleSupplierChange} suppliers={suppliers} />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="grid gap-2">
                        <Label>Supplier Code</Label>
                        <Input value={details.supplierCode} onChange={e => handleDetailChange("supplierCode", e.target.value)} placeholder="e.g. FCC2105" />
                      </div>
                      <div className="grid gap-2">
                        <Label>Supplier Cost</Label>
                        <div className="flex gap-1.5 items-center">
                          <span className="h-9 flex items-center px-2.5 rounded-md border border-input bg-muted/50 text-sm font-medium text-muted-foreground shrink-0 select-none">
                            {details.supplierCurrency === "USD" ? "$" : details.supplierCurrency === "EUR" ? "€" : "£"}
                          </span>
                          <Input type="number" min="0" step="0.01" value={details.supplierPrice} onChange={e => handleDetailChange("supplierPrice", e.target.value)} placeholder="0.00" />
                        </div>
                        {details.supplierCurrency !== "GBP" && (
                          <p className="text-[11px] text-amber-600">Purchased in {details.supplierCurrency} — convert to £ for reporting</p>
                        )}
                      </div>
                      <div className="grid gap-2">
                        <Label>Min. Order Qty</Label>
                        <Input type="number" min="1" step="1" value={details.minOrderQty} onChange={e => handleDetailChange("minOrderQty", e.target.value)} placeholder="e.g. 25" />
                      </div>
                    </div>

                    {/* Secondary supplier — collapsed by default */}
                    <button
                      type="button"
                      className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors select-none"
                      onClick={() => setShowSecondarySupplier(v => !v)}
                    >
                      <span className={`transition-transform duration-150 ${showSecondarySupplier ? "rotate-90" : ""}`}>▶</span>
                      {showSecondarySupplier ? "Hide" : "Show"} backup supplier
                    </button>

                    {showSecondarySupplier && (
                      <div className="mt-3 pl-4 border-l-2 border-border/40 space-y-4">
                        <div className="grid gap-2">
                          <Label>Backup Supplier</Label>
                          <SupplierSelect value={details.secondarySupplierId} onChange={v => handleDetailChange("secondarySupplierId", v)} suppliers={suppliers} />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="grid gap-2">
                            <Label>Backup Supplier Code</Label>
                            <Input value={details.secondarySupplierCode} onChange={e => handleDetailChange("secondarySupplierCode", e.target.value)} placeholder="e.g. RL204" />
                          </div>
                          <div className="grid gap-2">
                            <Label>Backup Price (£)</Label>
                            <Input type="number" min="0" step="0.01" value={details.secondarySupplierPrice} onChange={e => handleDetailChange("secondarySupplierPrice", e.target.value)} placeholder="0.00" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* ── Price Breaks ── */}
                  <div className="border-t border-border/40 pt-5 mt-1">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quantity Price Breaks</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">Unit selling price (£) based on total order quantity</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDetailChange("priceBreaks", [...details.priceBreaks, { qty: 0, price: 0 }])}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" /> Add Tier
                      </Button>
                    </div>

                    {details.priceBreaks.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">No price breaks set — a fixed unit price applies.</p>
                    ) : (
                      <div className="rounded-md border border-border/50 overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Min. Qty</th>
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Unit Price (£)</th>
                              <th className="w-10 px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...details.priceBreaks]
                              .sort((a, b) => a.qty - b.qty)
                              .map((pb, idx) => (
                                <tr key={idx} className="border-t border-border/30 hover:bg-muted/20">
                                  <td className="px-3 py-1.5">
                                    <Input
                                      type="number"
                                      min="1"
                                      step="1"
                                      className="h-7 w-24 text-sm"
                                      value={pb.qty || ""}
                                      onChange={e => {
                                        const updated = [...details.priceBreaks];
                                        updated[idx] = { ...pb, qty: parseInt(e.target.value, 10) || 0 };
                                        handleDetailChange("priceBreaks", updated);
                                      }}
                                    />
                                  </td>
                                  <td className="px-3 py-1.5">
                                    <div className="flex items-center gap-1">
                                      <span className="text-muted-foreground">£</span>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        className="h-7 w-24 text-sm"
                                        value={pb.price || ""}
                                        onChange={e => {
                                          const updated = [...details.priceBreaks];
                                          updated[idx] = { ...pb, price: parseFloat(e.target.value) || 0 };
                                          handleDetailChange("priceBreaks", updated);
                                        }}
                                      />
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <button
                                      type="button"
                                      className="text-muted-foreground hover:text-destructive transition-colors"
                                      onClick={() => {
                                        const updated = details.priceBreaks.filter((_, i) => i !== idx);
                                        handleDetailChange("priceBreaks", updated);
                                      }}
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={saveDetails} disabled={updateMutation.isPending || !detailsDirty}>
                      <Save className="w-4 h-4 mr-2" />
                      {updateMutation.isPending ? "Saving…" : "Save Changes"}
                    </Button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* ── Variants ── */}
            <TabsContent value="variants">
              <div className="mt-4 space-y-4">
                {/* Colour + Size + Sleeve palette editors */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Palette className="w-4 h-4 text-pink-500" />
                      <h3 className="font-semibold text-foreground">Available Colours</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Define the colour palette for this product. Use when adding variants.</p>
                    <TagInput type="colour" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Ruler className="w-4 h-4 text-blue-500" />
                      <h3 className="font-semibold text-foreground">Available Sizes</h3>
                      {product?.category === "Bespoke Ties" && (
                        <span className="ml-auto text-[11px] font-medium bg-indigo-100 text-indigo-700 border border-indigo-200 rounded px-2 py-0.5">
                          Standard sizes auto-assigned
                        </span>
                      )}
                    </div>
                    {product?.category === "Bespoke Ties" && (
                      <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded p-2 mb-3">
                        Bespoke Ties automatically include: <strong>Full Length Tie</strong>, <strong>Clip-On Tie</strong>, and <strong>Clip-on Cravat</strong>.
                      </p>
                    )}
                    {product?.category !== "Bespoke Ties" && (
                      <p className="text-xs text-muted-foreground mb-3">Define the size range for this product. Use when adding variants.</p>
                    )}
                    <TagInput type="size" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                  <div className="bg-card border border-border/50 rounded-lg p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <Layers className="w-4 h-4 text-amber-500" />
                      <h3 className="font-semibold text-foreground">Fit / Length</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">Optional third dimension — e.g. <strong>Short / Regular / Long</strong> for body length, or <strong>Long Sleeve / Short Sleeve</strong> for sleeve type.</p>
                    <TagInput type="sleeve" productId={productId} attributes={attributes} onRefresh={refetchAttrs} />
                  </div>
                </div>

                {/* Variant table */}
                <div className="bg-card border border-border/50 rounded-lg shadow-sm">
                  <div className="flex items-center justify-between p-4 border-b border-border/40">
                    <div>
                      <h3 className="font-semibold text-foreground">Variant Combinations</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">Each row is a specific colour / sleeve / size combo with its own stock level and suppliers.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {colours.length > 1 && (
                        <Select value={filterColour} onValueChange={setFilterColour}>
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="All colours" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All colours</SelectItem>
                            {colours.map((c: string) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {sizes.length > 1 && (
                        <Select value={filterSize} onValueChange={setFilterSize}>
                          <SelectTrigger className="h-8 w-[130px] text-xs">
                            <SelectValue placeholder="All sizes" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All sizes</SelectItem>
                            {sizes.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {sleeves.length > 1 && (
                        <Select value={filterSleeve} onValueChange={setFilterSleeve}>
                          <SelectTrigger className="h-8 w-[140px] text-xs">
                            <SelectValue placeholder="All fits" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All fits</SelectItem>
                            {sleeves.map((s: string) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      )}
                      {canGenerateMatrix && (
                        <Button size="sm" variant="outline" onClick={() => setGenerateMatrixOpen(true)}>
                          <Layers className="w-4 h-4 mr-1.5" /> Generate size variants
                        </Button>
                      )}
                      <Button size="sm" onClick={() => setAddVariantOpen(true)}>
                        <Plus className="w-4 h-4 mr-1.5" /> Add Variant
                      </Button>
                    </div>
                  </div>

                  {/* Bulk supplier price strip — visible when there are variants */}
                  {variants.length > 0 && (() => {
                    const targetIds = filteredVariants.map((v: any) => v.id);
                    const isFiltered = filterColour !== "all" || filterSize !== "all" || filterSleeve !== "all";
                    const canApply = targetIds.length > 0 && (bulkPrimaryId !== "none" || bulkPrice !== "" || bulkCode !== "");
                    const bulkSup = suppliers.find((s: any) => String(s.id) === bulkPrimaryId);
                    const currSym = (bulkSup as any)?.currency === "USD" ? "$" : (bulkSup as any)?.currency === "EUR" ? "€" : "£";
                    return (
                      <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 bg-muted/40 border-b border-border/40 text-sm">
                        <span className="text-muted-foreground font-medium shrink-0">
                          {(bulkPrimaryId !== "none" || bulkCode !== "" || bulkPrice !== "") ? "Edit" : "Set"} supplier{" "}
                          <span className="font-normal">({isFiltered ? `${targetIds.length} filtered` : `all ${targetIds.length}`}):</span>
                        </span>
                        <SupplierSelect value={bulkPrimaryId} onChange={setBulkPrimaryId} suppliers={suppliers} className="h-7 text-xs w-[160px]" />
                        <Input
                          value={bulkCode}
                          onChange={e => setBulkCode(e.target.value)}
                          placeholder="Supplier code"
                          className="h-7 text-xs w-[120px]"
                        />
                        <div className="relative flex items-center">
                          <span className="absolute left-2.5 text-muted-foreground text-xs pointer-events-none">{currSym}</span>
                          <Input
                            type="number" min="0" step="0.01"
                            value={bulkPrice}
                            onChange={e => setBulkPrice(e.target.value)}
                            placeholder="0.00"
                            className="h-7 text-xs w-24 pl-5"
                          />
                        </div>
                        <Button
                          size="sm"
                          className="h-7 text-xs"
                          disabled={!canApply || bulkUpdateMut.isPending}
                          onClick={() => bulkUpdateMut.mutate(targetIds)}
                        >
                          {bulkUpdateMut.isPending ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Save className="w-3 h-3 mr-1" />}
                          Apply
                        </Button>
                        {(bulkPrimaryId !== "none" || bulkPrice !== "" || bulkCode !== "") && (
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground underline"
                            onClick={() => { setBulkPrimaryId("none"); setBulkPrice(""); setBulkCode(""); }}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    );
                  })()}

                  {variants.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground">
                      <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium text-foreground">No variants yet</p>
                      <p className="text-sm mt-1">Add a variant to track stock per colour and size.</p>
                      <Button variant="outline" size="sm" className="mt-4" onClick={() => setAddVariantOpen(true)}>Add First Variant</Button>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="w-[180px]">Colour</TableHead>
                            <TableHead className="w-[130px]">Fit / Length</TableHead>
                            <TableHead className="w-[110px]">Size</TableHead>
                            <TableHead className="w-[130px]">SKU</TableHead>
                            <TableHead className="w-[90px]">Stock</TableHead>
                            <TableHead>Primary Supplier</TableHead>
                            <TableHead>Secondary Supplier</TableHead>
                            <TableHead className="w-[80px] text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredVariants.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                                No variants match the selected filters.{" "}
                                <button className="underline" onClick={() => { setFilterColour("all"); setFilterSize("all"); setFilterSleeve("all"); }}>Clear filters</button>
                              </TableCell>
                            </TableRow>
                          ) : filteredVariants.map((v: any) => (
                            <VariantRow
                              key={v.id}
                              variant={v}
                              suppliers={suppliers}
                              productId={productId}
                              onRefresh={refetchVariants}
                              onColourImageUpload={handleColourImageUpload}
                              productSupplierId={defaultPrimaryId}
                              productSecondaryId={defaultSecondaryId}
                            />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>

                {/* Summary badges */}
                {variants.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                    <span>{variants.length} variant{variants.length !== 1 ? "s" : ""}</span>
                    <span>·</span>
                    <span>{totalStock} total units</span>
                    {colours.length > 0 && <><span>·</span><span>{colours.length} colour{colours.length !== 1 ? "s" : ""}</span></>}
                    {sleeves.length > 0 && <><span>·</span><span>{sleeves.length} fit{sleeves.length !== 1 ? "s" : ""}</span></>}
                    {sizes.length > 0 && <><span>·</span><span>{sizes.length} size{sizes.length !== 1 ? "s" : ""}</span></>}
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <AddVariantDialog
          open={addVariantOpen}
          onClose={() => setAddVariantOpen(false)}
          productId={productId}
          attributes={attributes}
          suppliers={suppliers}
          defaultPrimaryId={defaultPrimaryId}
          defaultSecondaryId={defaultSecondaryId}
          onRefresh={refetchVariants}
        />

        {/* Generate colour × size matrix dialog */}
        <Dialog open={generateMatrixOpen} onOpenChange={v => { if (!v) setGenerateMatrixOpen(false); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Generate size variants</DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-3 text-sm text-muted-foreground">
              <p>
                This will create{" "}
                <strong className="text-foreground">
                  {attrColours.length} colour{attrColours.length !== 1 ? "s" : ""}
                  {" × "}
                  {attrSizes.length} size{attrSizes.length !== 1 ? "s" : ""}
                  {attrSleeves.length > 0 && <> × {attrSleeves.length} fit{attrSleeves.length !== 1 ? "s" : ""}</>}
                  {" = up to "}
                  {attrColours.length * attrSizes.length * (attrSleeves.length || 1)} variants
                </strong>{" "}for this product.
              </p>
              <p>
                Existing variants without a fit/sleeve value that have zero stock will be removed once the new combinations are created.
              </p>
              <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs space-y-1">
                <p className="font-medium text-foreground">Colours: {attrColours.join(", ")}</p>
                <p className="font-medium text-foreground">Sizes: {attrSizes.join(", ")}</p>
                {attrSleeves.length > 0 && <p className="font-medium text-foreground">Fits: {attrSleeves.join(", ")}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setGenerateMatrixOpen(false)}>Cancel</Button>
              <Button onClick={() => generateMatrixMut.mutate()} disabled={generateMatrixMut.isPending}>
                {generateMatrixMut.isPending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Generating…</> : "Generate variants"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Layout>
    </TooltipProvider>
  );
}
