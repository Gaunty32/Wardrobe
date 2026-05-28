import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListProducts } from "@workspace/api-client-react";
import { Link, useParams, useLocation } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Loader2, Trash2, Plus, Copy, Check, Send, Clock,
  Eye, CheckCircle2, ShoppingCart, X, Link as LinkIcon, FileText,
  ChevronDown, Save, Upload, ImageOff,
} from "lucide-react";
import { UploadedImage } from "@/components/UploadedImage";
import { useUpload } from "@workspace/object-storage-web";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface QuoteItem {
  id: number;
  quoteId: number;
  productId: number | null;
  productName: string;
  productUrl: string | null;
  colour: string | null;
  size: string | null;
  finishName: string | null;
  quantity: number;
  unitPrice: string;
  vatRate: string;
  notes: string | null;
  sortOrder: number;
}

interface Quote {
  id: number;
  quoteNumber: string;
  customerId: number | null;
  customerName: string;
  status: "draft" | "sent" | "viewed" | "ordered" | "expired";
  notes: string | null;
  coverText: string | null;
  expiresAt: string | null;
  customerLogoUrl: string | null;
  token: string;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
}

type QuoteStatus = Quote["status"];

const STATUS_STEPS: { key: QuoteStatus; label: string; icon: React.ElementType }[] = [
  { key: "draft",   label: "Draft",   icon: Clock },
  { key: "sent",    label: "Sent",    icon: Send },
  { key: "viewed",  label: "Viewed",  icon: Eye },
  { key: "ordered", label: "Ordered", icon: ShoppingCart },
];

const STATUS_COLOR: Record<QuoteStatus, string> = {
  draft:   "bg-slate-100 text-slate-700 border-slate-300",
  sent:    "bg-blue-100 text-blue-700 border-blue-300",
  viewed:  "bg-amber-100 text-amber-700 border-amber-300",
  ordered: "bg-green-100 text-green-700 border-green-300",
  expired: "bg-red-100 text-red-700 border-red-300",
};

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} className="gap-1.5 text-xs shrink-0">
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

const EMPTY_ITEM = { productName: "", productUrl: "", colour: "", size: "", finishName: "", quantity: 1, unitPrice: 0 };
const EMPTY_FINISH = { finishName: "", unitPrice: 0 };

export default function QuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const quoteId = parseInt(id ?? "0");

  const { data: quote, isLoading } = useQuery<Quote>({
    queryKey: ["quote", quoteId],
    queryFn: () => apiFetch(`/quotes/${quoteId}`),
    enabled: !!quoteId,
  });

  const [customerName, setCustomerName] = useState("");
  const [status, setStatus] = useState<QuoteStatus>("draft");
  const [notes, setNotes] = useState("");
  const [coverText, setCoverText] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [customerLogoUrl, setCustomerLogoUrl] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const { uploadFile, isUploading: isUploadingLogo } = useUpload({
    onSuccess: (res) => {
      const url = `/api/storage/objects${res.objectPath.replace(/^\/objects/, "")}`;
      setCustomerLogoUrl(url);
      setDirty(true);
    },
  });

  // Product autocomplete — debounced server-side search (same as Products page)
  const [newItem, setNewItem] = useState({ ...EMPTY_ITEM });
  const [addFinishLine, setAddFinishLine] = useState(false);
  const [finishLine, setFinishLine] = useState({ ...EMPTY_FINISH });
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const productDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setProductSearchTerm(newItem.productName.trim()), 300);
    return () => clearTimeout(t);
  }, [newItem.productName]);

  const { data: productResults = [] } = useListProducts(
    { search: productSearchTerm },
    { query: { enabled: productSearchTerm.length >= 2 } },
  );
  const productSuggestions = productResults.slice(0, 8);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setShowProductDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    if (!quote) return;
    setCustomerName(quote.customerName);
    setStatus(quote.status);
    setNotes(quote.notes ?? "");
    setCoverText(quote.coverText ?? "");
    setCustomerLogoUrl(quote.customerLogoUrl ?? null);
    if (quote.expiresAt) {
      setExpiresAt(new Date(quote.expiresAt).toISOString().slice(0, 10));
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      setExpiresAt(d.toISOString().slice(0, 10));
    }
    setDirty(false);
  }, [quote]);

  const saveQuote = useMutation({
    mutationFn: () => apiFetch(`/quotes/${quoteId}`, {
      method: "PATCH",
      body: JSON.stringify({
        customerName,
        status,
        notes: notes || null,
        coverText: coverText || null,
        expiresAt: expiresAt || null,
        customerLogoUrl: customerLogoUrl ?? null,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setDirty(false);
      toast({ title: "Quote saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteQuote = useMutation({
    mutationFn: () => apiFetch(`/quotes/${quoteId}`, { method: "DELETE" }),
    onSuccess: () => { setLocation("/quotes"); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addItem = useMutation({
    mutationFn: async () => {
      await apiFetch(`/quotes/${quoteId}/items`, {
        method: "POST",
        body: JSON.stringify({
          productName: newItem.productName,
          productUrl: newItem.productUrl || null,
          colour: newItem.colour || null,
          size: newItem.size || null,
          finishName: newItem.finishName || null,
          quantity: newItem.quantity,
          unitPrice: newItem.unitPrice,
        }),
      });
      if (addFinishLine && finishLine.finishName.trim()) {
        await apiFetch(`/quotes/${quoteId}/items`, {
          method: "POST",
          body: JSON.stringify({
            productName: finishLine.finishName.trim(),
            quantity: newItem.quantity,
            unitPrice: finishLine.unitPrice,
          }),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setNewItem({ ...EMPTY_ITEM });
      setFinishLine({ ...EMPTY_FINISH });
      setAddFinishLine(false);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteItem = useMutation({
    mutationFn: (itemId: number) => apiFetch(`/quotes/${quoteId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quote", quoteId] });
      qc.invalidateQueries({ queryKey: ["quotes"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: Partial<typeof EMPTY_ITEM> }) =>
      apiFetch(`/quotes/${quoteId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quote", quoteId] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markSent = () => {
    setStatus("sent");
    apiFetch(`/quotes/${quoteId}`, { method: "PATCH", body: JSON.stringify({ status: "sent" }) })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["quote", quoteId] });
        qc.invalidateQueries({ queryKey: ["quotes"] });
        toast({ title: "Quote marked as sent" });
        setDirty(false);
      })
      .catch((e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }));
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading quote…
        </div>
      </Layout>
    );
  }

  if (!quote) {
    return (
      <Layout>
        <div className="py-24 text-center text-muted-foreground">
          <p>Quote not found.</p>
          <Button variant="link" onClick={() => setLocation("/quotes")}>← Back to Quotes</Button>
        </div>
      </Layout>
    );
  }

  const items = quote.items ?? [];
  const hasColour = items.some((i) => i.colour);
  const hasSize = items.some((i) => i.size);
  const colSpan = 5 + (hasColour ? 1 : 0) + (hasSize ? 1 : 0) + 1;
  const subtotal = items.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity, 0);
  const vat = items.reduce((s, i) => s + parseFloat(i.unitPrice) * i.quantity * parseFloat(i.vatRate), 0);
  const total = subtotal + vat;

  const portalLink = `${window.location.origin}/customer-portal/orders/new?quote=${quote.token}`;
  const fullMessage = `${coverText}\n\nClick the link below to view your quote and place your order:\n${portalLink}`;

  const stepIndex = STATUS_STEPS.findIndex((s) => s.key === quote.status);

  return (
    <Layout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/quotes">
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground -ml-2">
                <ArrowLeft className="w-4 h-4" /> Quotes
              </Button>
            </Link>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono font-bold text-primary text-lg">{quote.quoteNumber}</span>
            <Badge className={`${STATUS_COLOR[quote.status]} text-xs`}>{quote.status}</Badge>
          </div>
          <div className="flex items-center gap-2">
            {dirty && (
              <Button onClick={() => saveQuote.mutate()} disabled={saveQuote.isPending} size="sm" className="gap-1.5">
                {saveQuote.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Save changes
              </Button>
            )}
            <Button
              variant="outline" size="sm"
              className="gap-1.5 text-destructive hover:text-destructive"
              onClick={() => { if (confirm(`Delete ${quote.quoteNumber}?`)) deleteQuote.mutate(); }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </div>
        </div>

        {/* Status progress */}
        <div className="flex items-center gap-0 rounded-xl border bg-muted/30 px-6 py-4">
          {STATUS_STEPS.map((step, i) => {
            const isActive = i === stepIndex;
            const isDone = i < stepIndex;
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center flex-1">
                <div className={`flex items-center gap-2 ${isActive ? "text-primary font-semibold" : isDone ? "text-primary/60" : "text-muted-foreground/50"}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isActive ? "bg-primary text-white" : isDone ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <span className="text-sm hidden sm:block">{step.label}</span>
                </div>
                {i < STATUS_STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${i < stepIndex ? "bg-primary/40" : "bg-border"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Quote details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4 rounded-xl border bg-card p-5">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Quote Details</h3>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Customer Logo</Label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => logoFileInputRef.current?.click()}
                    className="w-20 h-14 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/40 transition-colors flex items-center justify-center bg-muted/20 overflow-hidden shrink-0"
                    title="Click to upload logo"
                  >
                    {customerLogoUrl ? (
                      <UploadedImage src={customerLogoUrl} alt="Logo" className="w-full h-full object-contain p-1" fallback={<ImageOff className="w-4 h-4 text-muted-foreground" />} />
                    ) : (
                      <Upload className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                  <div className="flex-1 space-y-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full text-xs gap-1.5"
                      onClick={() => logoFileInputRef.current?.click()}
                      disabled={isUploadingLogo}
                    >
                      {isUploadingLogo ? <><Loader2 className="w-3 h-3 animate-spin" />Uploading…</> : <><Upload className="w-3 h-3" />{customerLogoUrl ? "Replace Logo" : "Upload Logo"}</>}
                    </Button>
                    {customerLogoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground gap-1.5"
                        onClick={() => { setCustomerLogoUrl(null); setDirty(true); }}
                      >
                        <X className="w-3 h-3" /> Remove logo
                      </Button>
                    )}
                  </div>
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Customer Name</Label>
                <Input
                  value={customerName}
                  onChange={(e) => { setCustomerName(e.target.value); setDirty(true); }}
                  placeholder="Customer name"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => { setStatus(v as QuoteStatus); setDirty(true); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["draft","sent","viewed","ordered","expired"] as QuoteStatus[]).map((s) => (
                      <SelectItem key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Expiry Date <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => { setExpiresAt(e.target.value); setDirty(true); }}
                />
              </div>
            </div>
          </div>
          <div className="space-y-4 rounded-xl border bg-card p-5">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Internal Notes</h3>
            <Textarea
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
              placeholder="Notes about this enquiry — products discussed, sizes, budget, etc."
              rows={5}
              className="resize-none"
            />
          </div>
        </div>

        {/* Items */}
        <div className="rounded-xl border overflow-hidden">
            <div className="px-5 py-3 bg-muted/40 border-b">
              <h3 className="font-semibold text-sm">Quoted Items</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  {hasColour && <TableHead className="w-28">Colour</TableHead>}
                  {hasSize && <TableHead className="w-24">Size</TableHead>}
                  <TableHead className="w-36">Finish / Decoration</TableHead>
                  <TableHead className="w-20 text-right">Qty</TableHead>
                  <TableHead className="w-28 text-right">Unit Price</TableHead>
                  <TableHead className="w-28 text-right">Line Total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    showColour={hasColour}
                    showSize={hasSize}
                    onDelete={() => deleteItem.mutate(item.id)}
                    onSave={(data) => updateItem.mutate({ itemId: item.id, data })}
                  />
                ))}
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colSpan} className="text-center text-muted-foreground py-6 text-sm">
                      No items yet — add your first item below.
                    </TableCell>
                  </TableRow>
                )}
                {/* Add row */}
                <TableRow className="bg-muted/20">
                  <TableCell>
                    <div className="relative" ref={productDropdownRef}>
                      <Input
                        value={newItem.productName}
                        onChange={(e) => { setNewItem((p) => ({ ...p, productName: e.target.value, productUrl: "" })); setShowProductDropdown(true); }}
                        onFocus={() => setShowProductDropdown(true)}
                        placeholder="Product name *"
                        className="h-8 text-sm"
                        autoComplete="off"
                      />
                      {showProductDropdown && productSuggestions.length > 0 && (
                        <div className="absolute z-50 left-0 top-full mt-1 w-80 bg-background border rounded-lg shadow-lg overflow-hidden">
                          {productSuggestions.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                setNewItem((prev) => ({
                                  ...prev,
                                  productName: p.name,
                                  productUrl: (p as any).permalink ?? "",
                                  unitPrice: p.unitPrice != null ? Number(p.unitPrice) : prev.unitPrice,
                                }));
                                setShowProductDropdown(false);
                              }}
                            >
                              <div className="font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">{p.sku}{p.unitPrice != null ? ` · £${Number(p.unitPrice).toFixed(2)}` : ""}</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {hasColour && (
                    <TableCell>
                      <Input
                        value={newItem.colour}
                        onChange={(e) => setNewItem((p) => ({ ...p, colour: e.target.value }))}
                        placeholder="Colour"
                        className="h-8 text-sm"
                      />
                    </TableCell>
                  )}
                  {hasSize && (
                    <TableCell>
                      <Input
                        value={newItem.size}
                        onChange={(e) => setNewItem((p) => ({ ...p, size: e.target.value }))}
                        placeholder="Size"
                        className="h-8 text-sm"
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Input
                      value={newItem.finishName}
                      onChange={(e) => setNewItem((p) => ({ ...p, finishName: e.target.value }))}
                      placeholder="e.g. Logo Embroidery"
                      className="h-8 text-sm"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      value={newItem.quantity}
                      onChange={(e) => setNewItem((p) => ({ ...p, quantity: parseInt(e.target.value) || 1 }))}
                      className="h-8 text-sm text-right"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={newItem.unitPrice}
                      onChange={(e) => setNewItem((p) => ({ ...p, unitPrice: parseFloat(e.target.value) || 0 }))}
                      className="h-8 text-sm text-right"
                    />
                  </TableCell>
                  <TableCell className="text-right text-sm text-muted-foreground">
                    £{(newItem.quantity * newItem.unitPrice).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => addItem.mutate()}
                      disabled={!newItem.productName.trim() || addItem.isPending}
                      title="Add item"
                    >
                      {addItem.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    </Button>
                  </TableCell>
                </TableRow>
                {/* Finish line row */}
                {addFinishLine && (
                  <TableRow className="bg-amber-50/40 dark:bg-amber-950/10">
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground pl-1 whitespace-nowrap">↳ Finish:</span>
                        <Input
                          value={finishLine.finishName}
                          onChange={(e) => setFinishLine((p) => ({ ...p, finishName: e.target.value }))}
                          placeholder="e.g. Logo Embroidery"
                          className="h-8 text-sm"
                          autoFocus
                        />
                      </div>
                    </TableCell>
                    {hasColour && <TableCell />}
                    {hasSize && <TableCell />}
                    <TableCell />
                    <TableCell>
                      <span className="text-xs text-muted-foreground text-right block">{newItem.quantity}×</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={finishLine.unitPrice}
                        onChange={(e) => setFinishLine((p) => ({ ...p, unitPrice: parseFloat(e.target.value) || 0 }))}
                        className="h-8 text-sm text-right"
                        placeholder="0.00"
                      />
                    </TableCell>
                    <TableCell className="text-right text-sm text-muted-foreground">
                      £{(newItem.quantity * finishLine.unitPrice).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => { setAddFinishLine(false); setFinishLine({ ...EMPTY_FINISH }); }}
                        title="Remove finish line"
                      >
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {/* Add finish line toggle */}
            {!addFinishLine && (
              <div className="px-4 py-2 border-t bg-muted/10">
                <button
                  type="button"
                  onClick={() => setAddFinishLine(true)}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add finish / decoration line
                </button>
              </div>
            )}

          {/* Totals */}
          {items.length > 0 && (
            <div className="border-t bg-muted/20 px-5 py-4 space-y-1.5">
              <div className="flex justify-end gap-8 text-sm">
                <span className="text-muted-foreground">Subtotal (ex VAT)</span>
                <span className="font-medium w-24 text-right">£{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-end gap-8 text-sm">
                <span className="text-muted-foreground">VAT</span>
                <span className="font-medium w-24 text-right">£{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-end gap-8 text-sm font-semibold">
                <span>Total (inc VAT)</span>
                <span className="w-24 text-right text-primary">£{total.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Share section */}
        <div className="rounded-xl border overflow-hidden">
          <div className="px-5 py-3 bg-muted/40 border-b flex items-center gap-2">
            <LinkIcon className="w-4 h-4 text-primary" />
            <h3 className="font-semibold text-sm">Share with Customer</h3>
          </div>
          <div className="p-5 space-y-5">
            {/* Portal link */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Portal Link</Label>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs font-mono text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap border">
                  {portalLink}
                </div>
                <CopyButton text={portalLink} label="Copy Link" />
              </div>
              <p className="text-xs text-muted-foreground">
                Send this link to the customer. When they open it (while logged in to their portal), their order form will be pre-filled with the items above.
              </p>
            </div>

            {/* Mark as sent */}
            {quote.status === "draft" && (
              <Button onClick={markSent} variant="outline" size="sm" className="gap-2 text-blue-700 border-blue-300 hover:bg-blue-50">
                <Send className="w-3.5 h-3.5" /> Mark as Sent
              </Button>
            )}

            {/* Cover text */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Email Cover Text</Label>
                <div className="flex gap-2">
                  <CopyButton text={coverText} label="Copy Text Only" />
                  <CopyButton text={fullMessage} label="Copy Full Message" />
                </div>
              </div>
              <Textarea
                value={coverText}
                onChange={(e) => { setCoverText(e.target.value); setDirty(true); }}
                rows={12}
                className="font-mono text-xs resize-none"
              />
              <p className="text-xs text-muted-foreground">
                Use <strong>Copy Full Message</strong> to get the cover text with the portal link automatically appended at the bottom.
              </p>
            </div>

            {dirty && (
              <Button onClick={() => saveQuote.mutate()} disabled={saveQuote.isPending} className="gap-1.5">
                {saveQuote.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Save changes
              </Button>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function ItemRow({
  item,
  showColour,
  showSize,
  onDelete,
  onSave,
}: {
  item: QuoteItem;
  showColour: boolean;
  showSize: boolean;
  onDelete: () => void;
  onSave: (data: { productName?: string; colour?: string; size?: string; finishName?: string; quantity?: number; unitPrice?: number }) => void;
}) {
  const [productName, setProductName] = useState(item.productName);
  const [colour, setColour] = useState(item.colour ?? "");
  const [size, setSize] = useState(item.size ?? "");
  const [finishName, setFinishName] = useState(item.finishName ?? "");
  const [quantity, setQuantity] = useState(item.quantity);
  const [unitPrice, setUnitPrice] = useState(parseFloat(item.unitPrice));

  const save = () => {
    onSave({ productName, colour: colour || null, size: size || null, finishName: finishName || null, quantity, unitPrice });
  };

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Input
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
            onBlur={save}
            className="h-8 text-sm border-transparent hover:border-input focus:border-input"
          />
          {item.productUrl && (
            <a
              href={item.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
              title="View on website"
            >
              <LinkIcon className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </TableCell>
      {showColour && (
        <TableCell>
          <Input
            value={colour}
            onChange={(e) => setColour(e.target.value)}
            onBlur={save}
            placeholder="—"
            className="h-8 text-sm border-transparent hover:border-input focus:border-input"
          />
        </TableCell>
      )}
      {showSize && (
        <TableCell>
          <Input
            value={size}
            onChange={(e) => setSize(e.target.value)}
            onBlur={save}
            placeholder="—"
            className="h-8 text-sm border-transparent hover:border-input focus:border-input"
          />
        </TableCell>
      )}
      <TableCell>
        <Input
          value={finishName}
          onChange={(e) => setFinishName(e.target.value)}
          onBlur={save}
          placeholder="—"
          className="h-8 text-sm border-transparent hover:border-input focus:border-input"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
          onBlur={save}
          className="h-8 text-sm text-right border-transparent hover:border-input focus:border-input"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          step={0.01}
          value={unitPrice}
          onChange={(e) => setUnitPrice(parseFloat(e.target.value) || 0)}
          onBlur={save}
          className="h-8 text-sm text-right border-transparent hover:border-input focus:border-input"
        />
      </TableCell>
      <TableCell className="text-right text-sm font-medium">
        £{(quantity * unitPrice).toFixed(2)}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost" size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
