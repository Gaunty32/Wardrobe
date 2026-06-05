import { useState, useEffect, useRef, useMemo } from "react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Package, Loader2, X, Plus, Save, Trash2, Edit2, AlertCircle,
  Layers, Palette, Ruler, Upload, Camera, Wrench, Check, ChevronsUpDown, Cloud, Star, BookOpen, User, Sparkles
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
  const [open, setOpen] = useState(false);
  const selected = suppliers.find((s) => String(s.id) === value);
  const triggerClass = className ?? "h-8 text-sm";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`${triggerClass} justify-between font-normal gap-1 px-3`}
        >
          <span className="truncate">{selected ? selected.name : "— None —"}</span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search supplier…" className="h-8 text-sm" />
          <CommandList className="max-h-56">
            <CommandEmpty>No supplier found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="none" onSelect={() => { onChange("none"); setOpen(false); }}>
                <Check className={`mr-2 w-3.5 h-3.5 ${value === "none" ? "opacity-100" : "opacity-0"}`} />
                — None —
              </CommandItem>
              {suppliers.map((s) => (
                <CommandItem key={s.id} value={s.name} onSelect={() => { onChange(String(s.id)); setOpen(false); }}>
                  <Check className={`mr-2 w-3.5 h-3.5 ${String(s.id) === value ? "opacity-100" : "opacity-0"}`} />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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

  const availabilityMut = useMutation({
    mutationFn: (available: boolean) => apiFetch(`/products/${productId}/variants/${variant.id}`, {
      method: "PATCH", body: JSON.stringify({ isAvailable: available }),
    }),
    onSuccess: () => onRefresh(),
    onError: () => toast({ title: "Error updating availability", variant: "destructive" }),
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
        <TableCell>
          <button
            type="button"
            disabled={availabilityMut.isPending}
            onClick={() => availabilityMut.mutate(variant.isAvailable === false ? true : false)}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border transition-colors disabled:opacity-50 ${
              variant.isAvailable === false
                ? "bg-slate-100 text-slate-500 border-slate-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-slate-100 hover:text-slate-500 hover:border-slate-200"
            }`}
          >
            {availabilityMut.isPending && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {variant.isAvailable === false ? "Unavailable" : "Available"}
          </button>
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

  const { data: variantsData, refetch: refetchVariants } = useQuery({
    queryKey: ["product", productId, "variants"],
    queryFn: () => apiFetch(`/products/${productId}/variants`),
    enabled: !!productId,
  });
  // Stable reference: avoids creating a new [] on every render while loading
  const variants = useMemo(() => (variantsData as any[]) ?? [], [variantsData]);

  const rewriteMut = useMutation({
    mutationFn: ({ draft, staffName }: { draft: string; staffName: string }) =>
      apiFetch("/staff/rewrite-quote", {
        method: "POST",
        body: JSON.stringify({ draft, staffName, productName: (product as any)?.name ?? "" }),
      }),
    onSuccess: (data: any) => {
      setQuoteRewritten(data.rewritten);
      setQuoteUseRewritten(true);
    },
    onError: () => toast({ title: "AI rewrite failed", variant: "destructive" }),
  });

  const addStaffMut = useMutation({
    mutationFn: (body: { name: string; role: string | null; profileImageUrl: string | null }) =>
      apiFetch("/staff", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => { refetchStaff(); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); setEditingStaffId(null); },
    onError: () => toast({ title: "Could not save staff member", variant: "destructive" }),
  });

  const updateStaffMut = useMutation({
    mutationFn: ({ id, body }: { id: number; body: { name: string; role: string | null; profileImageUrl: string | null } }) =>
      apiFetch(`/staff/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { refetchStaff(); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); setEditingStaffId(null); },
    onError: () => toast({ title: "Could not update staff member", variant: "destructive" }),
  });

  const deleteStaffMut = useMutation({
    mutationFn: (id: number) => apiFetch(`/staff/${id}`, { method: "DELETE" }),
    onSuccess: () => refetchStaff(),
    onError: () => toast({ title: "Could not delete staff member", variant: "destructive" }),
  });

  const { uploadFile: uploadStaffPhoto, isUploading: uploadingStaffPhoto } = useUpload({});

  const pushWooMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/push-woo-availability`, { method: "POST" }),
    onSuccess: (data: any) => {
      toast({ title: `Pushed ${data.pushed} of ${data.total} variation${data.total !== 1 ? "s" : ""} to WooCommerce` });
      if (data.errors?.length > 0) {
        toast({ title: "Some variations failed", description: data.errors.slice(0, 3).join("; "), variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "WooCommerce push failed", description: e?.message, variant: "destructive" }),
  });

  const pushWooGuidanceMut = useMutation({
    mutationFn: () => apiFetch(`/products/${productId}/push-woo-guidance`, { method: "POST" }),
    onSuccess: () => toast({ title: "Guidance pushed to WooCommerce" }),
    onError: (e: any) => toast({ title: "WooCommerce push failed", description: e?.message, variant: "destructive" }),
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

  const { data: staffList = [], refetch: refetchStaff } = useQuery<any[]>({
    queryKey: ["staff-members"],
    queryFn: () => apiFetch("/staff"),
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
  const [guidance, setGuidance] = useState<{
    bestFor: string;
    notIdealFor: string;
    staffQuotes: { id: string; staffId: number; staffName: string; staffRole: string | null; staffImageUrl: string | null; draft: string; rewritten: string | null; }[];
    badges: string[];
    valueRating: number | null;
    durabilityRating: number | null;
    smartRating: number | null;
    tags: string[];
  } | null>(null);
  const [guidanceDirty, setGuidanceDirty] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [quoteDraft, setQuoteDraft] = useState("");
  const [quoteStaffId, setQuoteStaffId] = useState<number | null>(null);
  const [quoteRewritten, setQuoteRewritten] = useState<string | null>(null);
  const [quoteUseRewritten, setQuoteUseRewritten] = useState(false);
  const [manageStaffOpen, setManageStaffOpen] = useState(false);
  const [staffFormName, setStaffFormName] = useState("");
  const [staffFormRole, setStaffFormRole] = useState("");
  const [staffFormImageUrl, setStaffFormImageUrl] = useState("");
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
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
    if (product && !guidance) {
      const p = product as any;
      setGuidance({
        bestFor: p.guidanceBestFor || "",
        notIdealFor: p.guidanceNotIdealFor || "",
        staffQuotes: Array.isArray(p.guidanceStaffQuotes) ? p.guidanceStaffQuotes : [],
        badges: Array.isArray(p.guidanceBadges) ? p.guidanceBadges : (p.guidanceBadge ? [p.guidanceBadge] : []),
        valueRating: p.guidanceValueRating ?? null,
        durabilityRating: p.guidanceDurabilityRating ?? null,
        smartRating: p.guidanceSmartRating ?? null,
        tags: Array.isArray(p.guidanceTags) ? p.guidanceTags : [],
      });
    }
  }, [product, details, guidance]);

  const handleDetailChange = (field: string, value: any) => {
    setDetails(prev => prev ? { ...prev, [field]: value } : prev);
    setDetailsDirty(true);
  };

  const handleGuidanceChange = (field: string, value: any) => {
    setGuidance(prev => prev ? { ...prev, [field]: value } : prev);
    setGuidanceDirty(true);
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

  const saveGuidance = (staffQuotesOverride?: typeof guidance extends null ? never : typeof guidance.staffQuotes) => {
    if (!guidance) return;
    const quotes = staffQuotesOverride ?? guidance.staffQuotes;
    updateMutation.mutate(
      {
        id: productId,
        data: {
          guidanceBestFor: guidance.bestFor || null,
          guidanceNotIdealFor: guidance.notIdealFor || null,
          guidanceStaffQuotes: quotes.length > 0 ? quotes : null,
          guidanceBadges: guidance.badges.length > 0 ? guidance.badges : null,
          guidanceValueRating: guidance.valueRating,
          guidanceDurabilityRating: guidance.durabilityRating,
          guidanceSmartRating: guidance.smartRating,
          guidanceTags: guidance.tags.length > 0 ? guidance.tags : null,
        } as any,
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["product", productId] });
          toast({ title: "Guidance saved" });
          setGuidanceDirty(false);
        },
        onError: () => toast({ title: "Could not save guidance", variant: "destructive" }),
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
    mutationFn: ({ ids, supplierId, code, price }: { ids: number[]; supplierId: string; code: string; price: string }) =>
      apiFetch(`/products/${productId}/variants/bulk`, {
        method: "PATCH",
        body: JSON.stringify({
          ids,
          ...(supplierId !== "none" ? { primarySupplierId: Number(supplierId) } : { primarySupplierId: null }),
          ...(price !== "" ? { supplierPrice: parseFloat(price) } : {}),
          ...(code !== "" ? { supplierCode: code } : {}),
        }),
      }),
    onSuccess: (_data: any, { ids }) => {
      refetchVariants();
      toast({ title: `Updated ${ids.length} variant${ids.length !== 1 ? "s" : ""}` });
    },
    onError: () => toast({ title: "Bulk update failed", variant: "destructive" }),
  });

  // ── Must be computed before any early returns (React Rules of Hooks) ──────
  // Group variants — colour-first (preserving API order), then size within each group.
  // Wrapped in useMemo so the array reference is stable, preventing useEffect dep loops.
  const sortedVariants = useMemo(() => {
    const colourOrder = [...new Set(variants.map((v: any) => v.colour ?? ""))];
    return [...variants].sort((a: any, b: any) => {
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
  }, [variants, sizeOrder]);
  const colours = [...new Set(variants.map((v: any) => v.colour ?? ""))].filter(Boolean);
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

  // ── Combination pricing (colour + sleeve groups) ──────────────────────────
  type ComboDraft = { supplierId: string; code: string; price: string };

  const comboPricingGroups = useMemo(() => {
    if (sortedVariants.length === 0) return [];
    const seen = new Set<string>();
    const groups: {
      key: string; colour: string | null; sleeve: string | null;
      variantIds: number[]; sharedSupplierId: string; sharedCode: string; sharedPrice: string;
    }[] = [];
    for (const v of sortedVariants) {
      const colour = v.colour ?? "";
      const sleeve = v.sleeve ?? "";
      const key = `${colour}||${sleeve}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const members = sortedVariants.filter((v2: any) => (v2.colour ?? "") === colour && (v2.sleeve ?? "") === sleeve);
      const suppIds = [...new Set(members.map((v2: any) => v2.primarySupplierId ? String(v2.primarySupplierId) : "none"))];
      const codes = [...new Set(members.map((v2: any) => v2.supplierCode ?? ""))];
      const rawPrices = members.map((v2: any) => v2.supplierPrice != null ? String(parseFloat(String(v2.supplierPrice))) : "");
      const prices = [...new Set(rawPrices)];
      groups.push({
        key, colour: v.colour, sleeve: v.sleeve,
        variantIds: members.map((v2: any) => v2.id),
        sharedSupplierId: suppIds.length === 1 ? suppIds[0] : "none",
        sharedCode: codes.length === 1 ? codes[0] : "",
        sharedPrice: prices.length === 1 ? prices[0] : "",
      });
    }
    return groups;
  }, [sortedVariants]);

  const [comboDrafts, setComboDrafts] = useState<Record<string, ComboDraft>>({});

  useEffect(() => {
    setComboDrafts(() => {
      const next: Record<string, ComboDraft> = {};
      for (const g of comboPricingGroups) {
        next[g.key] = { supplierId: g.sharedSupplierId, code: g.sharedCode, price: g.sharedPrice };
      }
      return next;
    });
  }, [comboPricingGroups]);

  if (isLoading || !details || !guidance) {
    return <Layout><div className="flex justify-center items-center h-64"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div></Layout>;
  }
  if (!product) {
    return <Layout><div className="text-center py-20"><p className="text-muted-foreground">Product not found.</p><Button variant="outline" className="mt-4" onClick={() => navigate("/products")}>Back</Button></div></Layout>;
  }

  const totalStock = variants.reduce((sum: number, v: any) => sum + (v.stockQuantity || 0), 0);
  const lowStockCount = variants.filter((v: any) => v.stockQuantity <= 5).length;
  const defaultPrimaryId = details.supplierId !== "none" ? Number(details.supplierId) : null;
  const defaultSecondaryId = details.secondarySupplierId !== "none" ? Number(details.secondarySupplierId) : null;

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
              {product.unitPrice > 0 && (() => {
                // Collect all supplier prices: per-variant if set, else product-level fallback
                const variantPrices: number[] = variants
                  .map((v: any) => v.supplierPrice != null ? parseFloat(v.supplierPrice) : null)
                  .filter((p): p is number => p != null && p > 0);
                const productFallback = product.supplierPrice != null && parseFloat(String(product.supplierPrice)) > 0
                  ? parseFloat(String(product.supplierPrice))
                  : null;
                const costs = variantPrices.length > 0 ? variantPrices : (productFallback ? [productFallback] : []);
                if (costs.length === 0) return null;
                const unitPrice = product.unitPrice;
                const gps = costs.map(c => ((unitPrice - c) / unitPrice) * 100);
                const minGp = Math.min(...gps);
                const maxGp = Math.max(...gps);
                const isRange = Math.abs(maxGp - minGp) > 0.05;
                const displayGp = isRange ? maxGp : minGp; // use max for colouring when range
                const color = displayGp >= 70 ? "bg-green-50 text-green-700 border-green-200"
                            : displayGp >= 30 ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-red-50 text-red-700 border-red-200";
                return (
                  <div className={`flex-shrink-0 flex flex-col items-center rounded-lg border px-4 py-2 ${color}`}>
                    <span className="text-xs font-medium uppercase tracking-wide opacity-70">GP</span>
                    {isRange ? (
                      <span className="text-xl font-bold leading-none whitespace-nowrap">
                        {minGp.toFixed(0)}%–{maxGp.toFixed(0)}%
                      </span>
                    ) : (
                      <span className="text-2xl font-bold leading-none">{minGp.toFixed(0)}%</span>
                    )}
                    <span className="text-xs mt-0.5 opacity-60">
                      {isRange ? `${costs.length} variant costs` : `cost ${formatCurrency(costs[0])}`}
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
              <TabsTrigger value="guidance" className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" /> Guidance
              </TabsTrigger>
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
                        <p className="text-xs text-muted-foreground mt-0.5">Discount off unit price (£) based on total order quantity</p>
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
                              <th className="text-left px-3 py-2 font-medium text-muted-foreground text-nowrap">Discount (£)</th>
                              <th className="w-10 px-2 py-2" />
                            </tr>
                          </thead>
                          <tbody>
                            {[...details.priceBreaks]
                              .sort((a, b) => a.qty - b.qty)
                              .map((pb, idx) => {
                                const discount = parseFloat((details.unitPrice - pb.price).toFixed(2));
                                return (
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
                                        <span className="text-muted-foreground text-sm">£</span>
                                        <Input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          className="h-7 w-24 text-sm"
                                          value={discount > 0 ? discount : ""}
                                          placeholder="0.00"
                                          onFocus={e => e.target.select()}
                                          onChange={e => {
                                            const disc = parseFloat(e.target.value) || 0;
                                            const updated = [...details.priceBreaks];
                                            updated[idx] = { ...pb, price: parseFloat((details.unitPrice - disc).toFixed(2)) };
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
                                );
                              })}
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

                {/* ── Supplier by Combination ── */}
                {comboPricingGroups.length > 1 && (
                  <div className="bg-card border border-border/50 rounded-lg shadow-sm">
                    <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
                      <Layers className="w-4 h-4 text-primary" />
                      <div>
                        <h3 className="font-semibold text-foreground text-sm">Supplier by Combination</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Set a different supplier, code, and cost for each {colours.length > 0 ? "colour" : ""}{colours.length > 0 && sleeves.length > 0 ? " + " : ""}{sleeves.length > 0 ? "fit" : ""} combination — applies to all sizes in that group.
                        </p>
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent text-xs">
                            {colours.length > 0 && <TableHead>Colour</TableHead>}
                            {sleeves.length > 0 && <TableHead>Fit / Length</TableHead>}
                            <TableHead>Supplier</TableHead>
                            <TableHead>Code</TableHead>
                            <TableHead>Cost</TableHead>
                            <TableHead className="text-right w-24" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {comboPricingGroups.map(g => {
                            const draft: ComboDraft = comboDrafts[g.key] ?? { supplierId: g.sharedSupplierId, code: g.sharedCode, price: g.sharedPrice };
                            const isDirty = draft.supplierId !== g.sharedSupplierId || draft.code !== g.sharedCode || draft.price !== g.sharedPrice;
                            const bulkSup = (suppliers as any[]).find((s: any) => String(s.id) === draft.supplierId);
                            const currSym = bulkSup?.currency === "USD" ? "$" : bulkSup?.currency === "EUR" ? "€" : "£";
                            const setDraft = (field: keyof ComboDraft, val: string) =>
                              setComboDrafts(prev => ({ ...prev, [g.key]: { ...draft, [field]: val } }));
                            const canApply = draft.supplierId !== "none" || draft.code !== "" || draft.price !== "";
                            return (
                              <TableRow key={g.key} className={isDirty ? "bg-primary/5" : ""}>
                                {colours.length > 0 && (
                                  <TableCell>
                                    {g.colour
                                      ? <span className="font-medium text-sm">{g.colour}</span>
                                      : <span className="text-muted-foreground text-sm">—</span>}
                                  </TableCell>
                                )}
                                {sleeves.length > 0 && (
                                  <TableCell>
                                    {g.sleeve
                                      ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200">{g.sleeve}</span>
                                      : <span className="text-muted-foreground text-sm">—</span>}
                                  </TableCell>
                                )}
                                <TableCell>
                                  <SupplierSelect
                                    value={draft.supplierId}
                                    onChange={v => setDraft("supplierId", v)}
                                    suppliers={suppliers}
                                    className="h-7 text-xs w-[150px]"
                                  />
                                </TableCell>
                                <TableCell>
                                  <Input
                                    value={draft.code}
                                    onChange={e => setDraft("code", e.target.value)}
                                    placeholder={g.sharedCode || "e.g. FCC1001"}
                                    className="h-7 text-xs w-[110px]"
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="relative flex items-center">
                                    <span className="absolute left-2 text-muted-foreground text-xs pointer-events-none">{currSym}</span>
                                    <Input
                                      type="number" min="0" step="0.01"
                                      value={draft.price}
                                      onChange={e => setDraft("price", e.target.value)}
                                      placeholder="0.00"
                                      className="h-7 text-xs w-24 pl-4"
                                    />
                                  </div>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    size="sm"
                                    variant={isDirty ? "default" : "outline"}
                                    className="h-7 text-xs gap-1"
                                    disabled={!canApply || bulkUpdateMut.isPending}
                                    onClick={() => bulkUpdateMut.mutate({
                                      ids: g.variantIds,
                                      supplierId: draft.supplierId,
                                      code: draft.code,
                                      price: draft.price,
                                    })}
                                  >
                                    {bulkUpdateMut.isPending
                                      ? <Loader2 className="w-3 h-3 animate-spin" />
                                      : <Save className="w-3 h-3" />}
                                    Apply
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

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
                      {!!(product as any).wooCommerceId && variants.length > 0 && (variants as any[]).some((v: any) => v.wooVariationId) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pushWooMut.mutate()}
                          disabled={pushWooMut.isPending}
                          className="gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50"
                        >
                          {pushWooMut.isPending
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Cloud className="w-3.5 h-3.5" />}
                          Push to WooCommerce
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
                          onClick={() => bulkUpdateMut.mutate({ ids: targetIds, supplierId: bulkPrimaryId, code: bulkCode, price: bulkPrice })}
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
                            <TableHead className="w-[110px]">Status</TableHead>
                            <TableHead className="w-[80px] text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredVariants.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
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

            {/* ── Guidance ── */}
            <TabsContent value="guidance">
              <div className="mt-4 bg-card border border-border/50 rounded-lg p-6 shadow-sm">
                <div className="grid gap-6 max-w-2xl">

                  {/* Ratings */}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">Ratings (click to set, click again to clear)</p>
                    <div className="grid grid-cols-3 gap-6">
                      {([
                        { label: "Value for Money", field: "valueRating", value: guidance.valueRating },
                        { label: "Durability",       field: "durabilityRating", value: guidance.durabilityRating },
                        { label: "Technical Features", field: "smartRating", value: guidance.smartRating },
                      ] as { label: string; field: string; value: number | null }[]).map(({ label, field, value }) => (
                        <div key={field} className="grid gap-2">
                          <Label>{label}</Label>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map((n) => (
                              <button
                                key={n}
                                type="button"
                                onClick={() => handleGuidanceChange(field, value === n ? null : n)}
                                className="p-0.5 hover:scale-110 transition-transform"
                              >
                                <Star className={`w-6 h-6 ${n <= (value ?? 0) ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`} />
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Badges */}
                  <div className="grid gap-2">
                    <Label>Badges <span className="text-muted-foreground font-normal">(select any that apply)</span></Label>
                    <div className="flex flex-wrap gap-2">
                      {(["Most Popular", "Best Value", "Premium Choice", "Staff Pick", "Bulk Buy Discount"] as string[]).map((b) => {
                        const active = guidance.badges.includes(b);
                        return (
                          <button
                            key={b}
                            type="button"
                            onClick={() => {
                              const next = active
                                ? guidance.badges.filter((x) => x !== b)
                                : [...guidance.badges, b];
                              handleGuidanceChange("badges", next);
                            }}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors flex items-center gap-1 ${
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background text-muted-foreground border-border hover:border-primary/50"
                            }`}
                          >
                            {active && <Check className="w-3 h-3" />}
                            {b}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="grid gap-2">
                    <Label>Guidance Tags</Label>
                    <div className="flex flex-wrap gap-2">
                      {(["Everyday Workwear", "Smart Uniform", "Heavy Duty", "Budget Friendly", "Premium"] as string[]).map((tag) => {
                        const active = guidance.tags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const next = active
                                ? guidance.tags.filter((t) => t !== tag)
                                : [...guidance.tags, tag];
                              handleGuidanceChange("tags", next);
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1 ${
                              active
                                ? "bg-primary/10 text-primary border-primary/40"
                                : "bg-background text-muted-foreground border-border hover:border-primary/30"
                            }`}
                          >
                            {active && <Check className="w-3 h-3" />}
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Text fields */}
                  <div className="grid gap-2">
                    <Label>Best For</Label>
                    <Textarea
                      value={guidance.bestFor}
                      onChange={(e) => handleGuidanceChange("bestFor", e.target.value)}
                      placeholder="e.g. Outdoor teams, frequent washers, budget-conscious buyers…"
                      rows={3}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Not Ideal For</Label>
                    <Textarea
                      value={guidance.notIdealFor}
                      onChange={(e) => handleGuidanceChange("notIdealFor", e.target.value)}
                      placeholder="e.g. Office environments, formal wear…"
                      rows={3}
                    />
                  </div>
                  {/* Staff Quotes */}
                  <div className="grid gap-3">
                    <div className="flex items-center justify-between">
                      <Label>Staff Quotes</Label>
                      <button
                        type="button"
                        onClick={() => setManageStaffOpen(true)}
                        className="text-xs text-muted-foreground hover:text-primary transition-colors"
                      >
                        Manage Staff
                      </button>
                    </div>

                    {guidance.staffQuotes.length === 0 ? (
                      <div className="border border-dashed border-border rounded-lg p-4 text-center text-sm text-muted-foreground">
                        No quotes yet — add your first staff recommendation below.
                      </div>
                    ) : (
                      <div className="grid gap-3">
                        {guidance.staffQuotes.map((q) => (
                          <div key={q.id} className="flex gap-3 border border-border rounded-lg p-3 bg-muted/20">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex-shrink-0 overflow-hidden flex items-center justify-center text-sm font-bold text-primary">
                              {q.staffImageUrl
                                ? <img src={q.staffImageUrl} alt={q.staffName} className="w-full h-full object-cover" />
                                : q.staffName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-sm font-semibold">{q.staffName}</span>
                                {q.staffRole && <span className="text-xs text-muted-foreground">{q.staffRole}</span>}
                                {q.rewritten && <span className="text-xs text-primary/70 flex items-center gap-0.5"><Sparkles className="w-3 h-3" /> AI-polished</span>}
                              </div>
                              <p className="text-sm text-muted-foreground italic">"{q.rewritten || q.draft}"</p>
                            </div>
                            <div className="flex gap-1 flex-shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingQuoteId(q.id);
                                  setQuoteDraft(q.draft);
                                  setQuoteStaffId(q.staffId);
                                  setQuoteRewritten(q.rewritten);
                                  setQuoteUseRewritten(!!q.rewritten);
                                  setQuoteDialogOpen(true);
                                }}
                                className="p-1 text-muted-foreground hover:text-primary transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleGuidanceChange("staffQuotes", guidance.staffQuotes.filter((x) => x.id !== q.id))}
                                className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingQuoteId(null);
                        setQuoteDraft("");
                        setQuoteStaffId(null);
                        setQuoteRewritten(null);
                        setQuoteUseRewritten(false);
                        setQuoteDialogOpen(true);
                      }}
                      className="w-fit"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> Add Quote
                    </Button>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    {!!(product as any).wooCommerceId && (
                      <Button
                        variant="outline"
                        onClick={() => pushWooGuidanceMut.mutate()}
                        disabled={pushWooGuidanceMut.isPending || guidanceDirty}
                        title={guidanceDirty ? "Save guidance first before pushing" : "Push guidance to WooCommerce"}
                      >
                        {pushWooGuidanceMut.isPending
                          ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          : <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>}
                        Push to WooCommerce
                      </Button>
                    )}
                    <Button onClick={saveGuidance} disabled={!guidanceDirty || updateMutation.isPending}>
                      {updateMutation.isPending
                        ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        : <Save className="w-4 h-4 mr-2" />}
                      Save Guidance
                    </Button>
                  </div>
                </div>
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

        {/* ── Add / Edit Quote dialog ── */}
        <Dialog open={quoteDialogOpen} onOpenChange={(v) => { if (!v) setQuoteDialogOpen(false); }}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingQuoteId ? "Edit Quote" : "Add Staff Quote"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-2">
                <Label>Staff Member</Label>
                {staffList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No staff members yet —{" "}
                    <button type="button" className="underline text-primary" onClick={() => { setQuoteDialogOpen(false); setManageStaffOpen(true); }}>
                      add one first
                    </button>
                  </p>
                ) : (
                  <Select
                    value={quoteStaffId ? String(quoteStaffId) : ""}
                    onValueChange={(v) => {
                      const id = Number(v);
                      setQuoteStaffId(id);
                      const sm = staffList.find((s: any) => s.id === id);
                      if (sm) setQuoteRewritten(null);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a staff member…" />
                    </SelectTrigger>
                    <SelectContent>
                      {staffList.map((s: any) => (
                        <SelectItem key={s.id} value={String(s.id)}>
                          <span className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-primary/10 inline-flex items-center justify-center text-xs font-bold text-primary overflow-hidden flex-shrink-0">
                              {s.profileImageUrl
                                ? <img src={s.profileImageUrl} alt={s.name} className="w-full h-full object-cover object-center" />
                                : s.name.charAt(0).toUpperCase()}
                            </span>
                            {s.name}{s.role ? ` — ${s.role}` : ""}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              <div className="grid gap-2">
                <Label>Draft Recommendation</Label>
                <Textarea
                  value={quoteDraft}
                  onChange={(e) => { setQuoteDraft(e.target.value); setQuoteRewritten(null); setQuoteUseRewritten(false); }}
                  placeholder="Type the basic recommendation — AI will polish it…"
                  rows={3}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  disabled={!quoteDraft.trim() || !quoteStaffId || rewriteMut.isPending}
                  onClick={() => {
                    const sm = staffList.find((s: any) => s.id === quoteStaffId);
                    rewriteMut.mutate({ draft: quoteDraft, staffName: sm?.name ?? "Staff" });
                  }}
                >
                  {rewriteMut.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Rewriting…</>
                    : <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> AI Rewrite</>}
                </Button>
              </div>

              {quoteRewritten && (
                <div className="grid gap-2">
                  <Label>AI-Polished Version</Label>
                  <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm italic text-foreground">
                    "{quoteRewritten}"
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="use-rewritten"
                      checked={quoteUseRewritten}
                      onChange={(e) => setQuoteUseRewritten(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="use-rewritten" className="text-sm cursor-pointer">Use AI version on the product page</label>
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQuoteDialogOpen(false)}>Cancel</Button>
              <Button
                disabled={!quoteStaffId || !quoteDraft.trim()}
                onClick={() => {
                  const sm = staffList.find((s: any) => s.id === quoteStaffId);
                  const newQuote = {
                    id: editingQuoteId ?? Math.random().toString(36).slice(2),
                    staffId: quoteStaffId!,
                    staffName: sm?.name ?? "",
                    staffRole: sm?.role ?? null,
                    staffImageUrl: sm?.profileImageUrl ?? null,
                    draft: quoteDraft,
                    rewritten: quoteUseRewritten ? quoteRewritten : null,
                  };
                  const updated = editingQuoteId
                    ? guidance!.staffQuotes.map((q) => q.id === editingQuoteId ? newQuote : q)
                    : [...guidance!.staffQuotes, newQuote];
                  handleGuidanceChange("staffQuotes", updated);
                  setQuoteDialogOpen(false);
                  saveGuidance(updated);
                }}
              >
                {editingQuoteId ? "Save Changes" : "Add Quote"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Manage Staff dialog ── */}
        <Dialog open={manageStaffOpen} onOpenChange={(v) => { if (!v) { setManageStaffOpen(false); setEditingStaffId(null); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); } }}>
          <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col">
            <DialogHeader className="flex-shrink-0">
              <DialogTitle>Manage Staff</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-2 overflow-y-auto flex-1 min-h-0">
              {/* Add / Edit form */}
              <div className="border border-border rounded-lg p-4 grid gap-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{editingStaffId ? "Edit Staff Member" : "Add Staff Member"}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Name *</Label>
                    <Input value={staffFormName} onChange={(e) => setStaffFormName(e.target.value)} placeholder="e.g. Chris" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">Role</Label>
                    <Input value={staffFormRole} onChange={(e) => setStaffFormRole(e.target.value)} placeholder="e.g. Sales Manager" />
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Profile Photo</Label>
                  <div className="flex items-center gap-2">
                    {staffFormImageUrl && (
                      <img src={staffFormImageUrl} alt="preview" className="w-8 h-8 rounded-full object-cover object-center border border-border" />
                    )}
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingStaffPhoto}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const res = await uploadStaffPhoto(file);
                          if (res) setStaffFormImageUrl(`/api/storage${res.objectPath}`);
                        }}
                      />
                      <span className="inline-flex items-center gap-1.5 text-xs border border-border rounded px-2 py-1.5 hover:bg-muted transition-colors">
                        {uploadingStaffPhoto ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                        {uploadingStaffPhoto ? "Uploading…" : "Upload photo"}
                      </span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!staffFormName.trim() || addStaffMut.isPending || updateStaffMut.isPending}
                    onClick={() => {
                      const body = { name: staffFormName.trim(), role: staffFormRole.trim() || null, profileImageUrl: staffFormImageUrl || null };
                      if (editingStaffId) {
                        updateStaffMut.mutate({ id: editingStaffId, body });
                      } else {
                        addStaffMut.mutate(body);
                      }
                    }}
                  >
                    {(addStaffMut.isPending || updateStaffMut.isPending) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (editingStaffId ? "Save" : "Add")}
                  </Button>
                  {editingStaffId && (
                    <Button size="sm" variant="outline" onClick={() => { setEditingStaffId(null); setStaffFormName(""); setStaffFormRole(""); setStaffFormImageUrl(""); }}>
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              {/* Staff list */}
              {staffList.length > 0 && (
                <div className="grid gap-2">
                  {staffList.map((s: any) => (
                    <div key={s.id} className="flex items-center gap-3 py-1.5 border-b border-border/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex-shrink-0 overflow-hidden flex items-center justify-center text-xs font-bold text-primary">
                        {s.profileImageUrl
                          ? <img src={s.profileImageUrl} alt={s.name} className="w-full h-full object-cover object-center" />
                          : s.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{s.name}</p>
                        {s.role && <p className="text-xs text-muted-foreground">{s.role}</p>}
                      </div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="p-1 text-muted-foreground hover:text-primary"
                          onClick={() => { setEditingStaffId(s.id); setStaffFormName(s.name); setStaffFormRole(s.role ?? ""); setStaffFormImageUrl(s.profileImageUrl ?? ""); }}
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="p-1 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteStaffMut.mutate(s.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>

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
