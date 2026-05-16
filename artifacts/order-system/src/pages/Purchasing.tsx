import { useState, useRef, useCallback } from "react";
import { ProcessStockTab } from "@/pages/ProcessStock";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Package, AlertTriangle, CheckCircle, Mail, ChevronDown, ChevronRight,
  RefreshCw, Plus, FileText, Truck, Clock, TriangleAlert, Trash2, ArrowRight,
  CalendarDays, PackageCheck, Send, Loader2, ChevronUp, TrendingUp, ClipboardList, Layers, Boxes, Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate, cn } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface PurchaseRequirement {
  itemId: number; orderId: number; orderNumber: string | null; customerName: string | null;
  productId: number | null; productName: string; colour: string | null; size: string | null;
  purchaseQuantity: number | null; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  supplierCode: string | null; productSku: string | null; canonicalProductName: string | null;
}
interface SupplierGroup {
  supplierId: number | null; supplierName: string; supplierEmail: string | null; supplierCurrency: string; items: PurchaseRequirement[];
}

interface POItem {
  id: number; poId: number; orderItemId: number | null; orderId: number | null; orderNumber: string | null;
  productName: string; colour: string | null; size: string | null;
  supplierCode: string | null; supplierPrice: number | null;
  productSku: string | null; canonicalProductName: string | null;
  quantityOrdered: number; quantityDelivered: number; estimatedDueDate: string | null; notes: string | null;
}

interface PurchaseOrder {
  id: number; poNumber: string; supplierId: number | null; supplierName: string; supplierEmail: string | null;
  supplierCurrency: string;
  status: "draft" | "ordered" | "delivered"; notes: string | null; sentAt: string | null;
  estimatedDeliveryDate: string | null;
  attachments: Array<{ name: string; objectPath: string }> | null;
  createdAt: string; updatedAt: string; items: POItem[];
}

function currencySymbol(currency?: string | null): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "£";
}

interface ProcessStockRequirement {
  processStockId: number;
  name: string;
  sku: string | null;
  stockQuantity: number;
  supplierId: number | null;
  supplierName: string | null;
  fileUrl: string | null;
  totalNeeded: number;
  shortfall: number;
  orders: Array<{ orderId: number; orderNumber: string; customerName: string | null; requiredDate: string | null; qty: number }>;
}

interface BackorderLine {
  id: number;
  poId: number;
  poNumber: string;
  supplierName: string;
  productName: string;
  colour: string | null;
  size: string | null;
  supplierCode: string | null;
  quantityOrdered: number;
  quantityDelivered: number;
  remaining: number;
  estimatedDueDate: string | null;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
}

const STATUS_CFG = {
  draft: { label: "Draft", color: "bg-slate-100 text-slate-700 border-slate-300", icon: FileText },
  ordered: { label: "Ordered", color: "bg-blue-100 text-blue-800 border-blue-300", icon: Send },
  delivered: { label: "Delivered", color: "bg-green-100 text-green-800 border-green-300", icon: PackageCheck },
};

function buildPOMatrix(items: POItem[]) {
  const groupKeys: string[] = [];
  const groups = new Map<string, { code: string | null; productName: string; price: number | null; colours: string[]; sizes: string[]; qty: Map<string, Map<string, number>> }>();
  for (const item of items) {
    const gk = item.supplierCode ?? item.productName;
    if (!groups.has(gk)) { groupKeys.push(gk); groups.set(gk, { code: item.supplierCode, productName: item.productName, price: item.supplierPrice, colours: [], sizes: [], qty: new Map() }); }
    const g = groups.get(gk)!;
    const c = item.colour ?? "—"; const s = item.size ?? "—";
    if (!g.colours.includes(c)) g.colours.push(c);
    if (!g.sizes.includes(s)) g.sizes.push(s);
    if (!g.qty.has(c)) g.qty.set(c, new Map());
    g.qty.get(c)!.set(s, (g.qty.get(c)!.get(s) ?? 0) + item.quantityOrdered);
    if (item.supplierPrice != null && g.price == null) g.price = item.supplierPrice;
  }
  const allSizes: string[] = [];
  for (const gk of groupKeys) for (const s of groups.get(gk)!.sizes) if (!allSizes.includes(s)) allSizes.push(s);
  return { groupKeys, groups, allSizes };
}

function POMatrixView({ items, currency }: { items: POItem[]; currency?: string }) {
  const { groupKeys, groups, allSizes } = buildPOMatrix(items);

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-800 text-white">
            <TableHead className="font-semibold text-white">Code</TableHead>
            <TableHead className="font-semibold text-white">Colour</TableHead>
            {allSizes.map((s) => <TableHead key={s} className="text-center font-semibold text-white">{s}</TableHead>)}
            <TableHead className="text-center font-semibold text-white">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupKeys.map((gk) => {
            const g = groups.get(gk)!;
            const groupTotal = g.colours.reduce((sum, c) => sum + allSizes.reduce((s2, sz) => s2 + (g.qty.get(c)?.get(sz) ?? 0), 0), 0);
            return (
              <>
                {g.colours.map((colour, ci) => {
                  const rowTotal = allSizes.reduce((s, sz) => s + (g.qty.get(colour)?.get(sz) ?? 0), 0);
                  return (
                    <TableRow key={`${gk}-${colour}`} className={ci % 2 === 0 ? "bg-white" : "bg-muted/30"}>
                      {ci === 0 ? (
                        <TableCell className="font-mono font-bold text-sm text-indigo-700 align-top pt-3">
                          <div>{g.code ?? "—"}</div>
                          <div className="text-xs font-normal text-muted-foreground font-sans truncate max-w-[90px]">{g.productName}</div>
                          {g.price != null && <div className="text-xs text-muted-foreground">{currencySymbol(currency)}{g.price.toFixed(2)}/u</div>}
                        </TableCell>
                      ) : (
                        <TableCell />
                      )}
                      <TableCell className="font-medium">{colour}</TableCell>
                      {allSizes.map((sz) => {
                        const qty = g.qty.get(colour)?.get(sz) ?? 0;
                        return <TableCell key={sz} className="text-center">{qty > 0 ? <span className="font-semibold text-primary">{qty}</span> : <span className="text-muted-foreground text-xs">—</span>}</TableCell>;
                      })}
                      <TableCell className="text-center font-bold">{rowTotal}</TableCell>
                    </TableRow>
                  );
                })}
                {g.colours.length > 1 && (
                  <TableRow className="bg-slate-100 border-t border-slate-300">
                    <TableCell className="text-xs text-muted-foreground" />
                    <TableCell className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subtotal</TableCell>
                    {allSizes.map((sz) => {
                      const colTotal = g.colours.reduce((sum, c) => sum + (g.qty.get(c)?.get(sz) ?? 0), 0);
                      return <TableCell key={sz} className="text-center font-semibold text-sm">{colTotal > 0 ? colTotal : <span className="text-muted-foreground text-xs">—</span>}</TableCell>;
                    })}
                    <TableCell className="text-center font-bold">{groupTotal}</TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
          {groupKeys.length > 1 && (
            <TableRow className="bg-slate-800">
              <TableCell className="text-white font-bold text-sm" colSpan={2}>TOTAL</TableCell>
              {allSizes.map((sz) => {
                const t = groupKeys.reduce((sum, gk) => { const g = groups.get(gk)!; return sum + g.colours.reduce((s, c) => s + (g.qty.get(c)?.get(sz) ?? 0), 0); }, 0);
                return <TableCell key={sz} className="text-center font-bold text-white">{t > 0 ? t : "—"}</TableCell>;
              })}
              <TableCell className="text-center font-bold text-white">{items.reduce((s, i) => s + i.quantityOrdered, 0)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function buildPOMailtoBody(po: PurchaseOrder, notes: string): string {
  const { groupKeys, groups, allSizes } = buildPOMatrix(po.items);
  const dateStr = new Date(po.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const lines: string[] = [
    `Dear ${po.supplierName},`,
    ``,
    `Please supply the following items for purchase order ${po.poNumber} dated ${dateStr}:`,
    ``,
  ];
  for (const gk of groupKeys) {
    const g = groups.get(gk)!;
    lines.push(`${g.productName}${g.code ? ` [${g.code}]` : ""}:`);
    for (const colour of g.colours) {
      const parts = allSizes
        .map((sz) => { const q = g.qty.get(colour)?.get(sz) ?? 0; return q > 0 ? `${sz}: ${q}` : null; })
        .filter(Boolean);
      lines.push(`  ${colour} — ${parts.join(", ")}`);
    }
    lines.push(``);
  }
  const totalUnits = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  lines.push(`Total units: ${totalUnits}`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``, `Please see the attached PDF for full details.`, ``, `Kind regards,`, `Select Branding Solutions`);
  return lines.join("\n");
}

function POEmailDialog({ po, open, onClose, onSent }: { po: PurchaseOrder; open: boolean; onClose: () => void; onSent: () => void }) {
  const [notes, setNotes] = useState("");
  const [recipientEmail, setRecipientEmail] = useState(po.supplierEmail ?? "");

  const handleOpen = () => {
    const subject = encodeURIComponent(`Purchase Order ${po.poNumber} — Select Branding Solutions`);
    const body = encodeURIComponent(buildPOMailtoBody(po, notes));
    const mailto = `mailto:${recipientEmail}?subject=${subject}&body=${body}`;
    // Download the PDF so they can attach it
    const a = document.createElement("a");
    a.href = `/api/purchasing/purchase-orders/${po.id}/pdf`;
    a.download = `${po.poNumber}.pdf`;
    a.click();
    // Small delay so the download starts before the email client opens
    setTimeout(() => window.open(mailto, "_blank"), 300);
    onClose();
    onSent();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" />Email PO — {po.poNumber}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Recipient email</Label>
            <Input value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} placeholder="supplier@example.com" type="email" />
          </div>
          <div className="space-y-1.5">
            <Label>Additional notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any extra instructions for this supplier..." rows={3} />
          </div>
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
            The PDF will download automatically — attach it to the email that opens in your email client.
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" className="gap-2 sm:mr-auto" onClick={() => window.open(`/api/purchasing/purchase-orders/${po.id}/pdf`, "_blank")}>
            <FileText className="w-4 h-4" /> Preview PDF
          </Button>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleOpen} disabled={!recipientEmail} className="gap-2">
            <Mail className="w-4 h-4" /> Open in Email Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildEmailBody(group: SupplierGroup, notes: string): string {
  const productMap = new Map<string, Map<string, number>>();
  for (const item of group.items) {
    const key = item.productName;
    if (!productMap.has(key)) productMap.set(key, new Map());
    const sizeKey = [item.colour, item.size].filter(Boolean).join(" / ") || "N/A";
    const existing = productMap.get(key)!.get(sizeKey) ?? 0;
    productMap.get(key)!.set(sizeKey, existing + (item.purchaseQuantity ?? 0));
  }
  const lines: string[] = [];
  lines.push(`Dear ${group.supplierName},`, ``, `Please supply the following items:`, ``);
  for (const [product, sizes] of productMap.entries()) {
    lines.push(`${product}:`);
    for (const [size, qty] of sizes.entries()) lines.push(`  ${size}: ${qty}`);
    lines.push(``);
  }
  const orders = [...new Set(group.items.map((i) => i.orderNumber).filter(Boolean))];
  lines.push(`These are required for orders: ${orders.join(", ")}`);
  if (notes.trim()) lines.push(``, `Notes: ${notes.trim()}`);
  lines.push(``, `Kind regards,`, `Select Branding Solutions`);
  return lines.join("\n");
}

function productDisplayName(item: PurchaseRequirement): string {
  return item.canonicalProductName ?? item.productName;
}

function productLabel(item: PurchaseRequirement): string {
  const name = productDisplayName(item);
  const code = item.supplierCode ?? item.productSku;
  return code ? `${code} — ${name}` : name;
}

/** Single editable row in the requirements table */
function RequirementsRow({
  item,
  onQtyChange,
}: {
  item: PurchaseRequirement;
  onQtyChange: (item: PurchaseRequirement, qty: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const baseQty = item.purchaseQuantity ?? 1;

  const commit = (value: number) => {
    if (value >= 1 && value !== baseQty) onQtyChange(item, value);
  };

  const changeBy = (delta: number) => {
    if (!inputRef.current) return;
    const next = Math.max(1, (parseInt(inputRef.current.value) || baseQty) + delta);
    inputRef.current.value = String(next);
    commit(next);
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium text-sm">{item.canonicalProductName ?? item.productName}</div>
        {(item.supplierCode || item.productSku) && (
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            {item.supplierCode && <span className="mr-2">Supplier: {item.supplierCode}</span>}
            {item.productSku && <span>SKU: {item.productSku}</span>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
      </TableCell>
      <TableCell className="text-xs font-mono text-muted-foreground">
        {item.orderNumber ?? "—"}
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-center gap-1">
          <button
            type="button"
            className="w-6 h-6 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-base leading-none"
            onClick={() => changeBy(-1)}
          >−</button>
          <input
            ref={inputRef}
            type="number"
            min={1}
            defaultValue={baseQty}
            key={baseQty}
            className="w-12 text-center text-sm font-semibold border border-transparent hover:border-input focus:border-input rounded px-1 py-0.5 bg-transparent focus:bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            onBlur={(e) => commit(parseInt(e.target.value) || baseQty)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          />
          <button
            type="button"
            className="w-6 h-6 rounded border border-border bg-background hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center text-base leading-none"
            onClick={() => changeBy(1)}
          >+</button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Flat editable table — one row per purchase requirement line */
function RequirementsLineTable({
  items,
  onQtyChange,
}: {
  items: PurchaseRequirement[];
  onQtyChange: (item: PurchaseRequirement, qty: number) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Product</TableHead>
            <TableHead className="font-semibold min-w-[130px]">Colour / Size</TableHead>
            <TableHead className="font-semibold text-xs min-w-[80px]">Order</TableHead>
            <TableHead className="text-center font-semibold min-w-[130px]">Qty to order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <RequirementsRow key={item.itemId} item={item} onQtyChange={onQtyChange} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ProcessMaterialsLineTable({ items }: { items: ProcessStockRequirement[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Material</TableHead>
            <TableHead className="font-semibold min-w-[110px]">SKU</TableHead>
            <TableHead className="font-semibold text-xs min-w-[140px]">Orders</TableHead>
            <TableHead className="text-center font-semibold min-w-[110px]">Qty to order</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((req) => (
            <TableRow key={req.processStockId}>
              <TableCell>
                <div className="font-medium text-sm">{req.name}</div>
                <div className="text-xs text-muted-foreground">In stock: {req.stockQuantity} · Need: {req.totalNeeded}</div>
              </TableCell>
              <TableCell>
                {req.sku
                  ? <span className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0">{req.sku}</span>
                  : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  {req.orders.map((o) => (
                    <span key={o.orderId} className="text-xs">
                      <a href={`/orders/${o.orderId}`} className="text-primary hover:underline font-mono font-semibold">{o.orderNumber}</a>
                      {` ×${o.qty}`}
                    </span>
                  ))}
                </div>
              </TableCell>
              <TableCell className="text-center">
                <span className="font-bold text-sm">{req.shortfall}</span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EmailDialog({ group, open, onClose, onSent }: { group: SupplierGroup; open: boolean; onClose: () => void; onSent: (ids: number[]) => void }) {
  const [notes, setNotes] = useState("");
  const emailBody = buildEmailBody(group, notes);
  const subject = encodeURIComponent(`Purchase Order — Select Branding Solutions`);
  const mailto = `mailto:${group.supplierEmail ?? ""}?subject=${subject}&body=${encodeURIComponent(emailBody)}`;
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="w-5 h-5 text-primary" />Purchase Order — {group.supplierName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1"><Label>Additional Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes for this supplier..." rows={2} /></div>
          <div className="space-y-1"><Label>Email Preview</Label><pre className="text-xs bg-muted/50 border border-border rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">{emailBody}</pre></div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { window.open(mailto, "_blank"); onSent(group.items.map((i) => i.itemId)); }} className="gap-2"><Mail className="w-4 h-4" />Open Email Client</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.split("T")[0];
}

function DeliveryRow({ line, onSave }: {
  line: POItem;
  onSave: (itemId: number, data: { quantityDelivered?: number; estimatedDueDate?: string | null }) => void;
}) {
  const [qtyDel, setQtyDel] = useState(String(line.quantityDelivered));
  const [dueDate, setDueDate] = useState(toDateInputValue(line.estimatedDueDate));
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const qtyRef = useRef(qtyDel);
  const dateRef = useRef(dueDate);
  qtyRef.current = qtyDel;
  dateRef.current = dueDate;

  const triggerSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const parsed = parseInt(qtyRef.current);
      onSave(line.id, {
        quantityDelivered: isNaN(parsed) ? 0 : Math.max(0, parsed),
        estimatedDueDate: dateRef.current || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }, 120);
  }, [line.id, onSave]);

  const qty = parseInt(qtyDel) || 0;
  const fullyDelivered = qty >= line.quantityOrdered;
  const overDelivered = qty > line.quantityOrdered;
  const remaining = line.quantityOrdered - qty;
  const surplus = qty - line.quantityOrdered;

  return (
    <div className={`rounded-lg border px-3 py-2.5 transition-colors ${
      overDelivered ? "border-orange-200 bg-orange-50/40" :
      fullyDelivered ? "border-green-200 bg-green-50/50" :
      "border-border bg-card"
    }`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            {line.supplierCode && (
              <span className="font-bold text-sm font-mono text-primary">{line.supplierCode}</span>
            )}
            {line.productSku && (
              <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{line.productSku}</span>
            )}
            <span className="font-medium text-sm">{line.canonicalProductName ?? line.productName}</span>
          </div>
          {(line.colour || line.size) && (
            <div className="text-muted-foreground text-xs mt-0.5">{[line.colour, line.size].filter(Boolean).join(" / ")}</div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Received qty — no max cap, allows over-delivery */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Rcvd:</span>
            <Input
              type="number" min={0} value={qtyDel}
              onChange={(e) => setQtyDel(e.target.value)}
              onBlur={triggerSave}
              className={`h-7 w-14 text-sm text-center px-1 ${overDelivered ? "border-orange-400 text-orange-700" : ""}`}
            />
            <span className="text-xs text-muted-foreground">/ {line.quantityOrdered}</span>
          </div>
          {/* Backorder due date — always visible so users can set it */}
          <div className="flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <Input
              type="date" value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={triggerSave}
              className="h-7 w-36 text-xs px-1.5"
              title="Backorder expected delivery date"
            />
          </div>
          {/* Status indicator */}
          {overDelivered ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 bg-orange-100 border border-orange-300 rounded px-1.5 py-0.5">
              <TrendingUp className="w-3 h-3" />+{surplus} to stock
            </span>
          ) : saved ? (
            <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          ) : fullyDelivered ? (
            <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />
          ) : remaining > 0 && qty > 0 ? (
            <span className="text-xs text-amber-600 font-medium">{remaining} on backorder</span>
          ) : dueDate ? (
            <span className="text-xs text-blue-600 font-medium">backorder set</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MarkOrderedDialog({ po, open, onClose, onConfirm }: {
  po: PurchaseOrder;
  open: boolean;
  onClose: () => void;
  onConfirm: (estimatedDeliveryDate: string) => void;
}) {
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 3);
  const [deliveryDate, setDeliveryDate] = useState(defaultDate.toISOString().split("T")[0]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" /> Mark as Ordered — {po.poNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Estimated delivery date</Label>
            <Input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">You can update this later if dates change.</p>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-800">
            This will move the PO to <strong>Ordered</strong> status. The supplier should have already received the PO.
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={() => onConfirm(deliveryDate)} disabled={!deliveryDate}>
            <Send className="w-4 h-4" /> Confirm Ordered
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function POCard({
  po, onStatusChange, onDelete, onDeleteLine, onLineUpdate, onRefresh, onReceiveAll,
}: {
  po: PurchaseOrder;
  onStatusChange: (id: number, status: string, extra?: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  onDeleteLine: (poId: number, itemId: number) => void;
  onLineUpdate: (poId: number, itemId: number, data: Record<string, unknown>) => void;
  onRefresh: () => void;
  onReceiveAll: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [markOrderedOpen, setMarkOrderedOpen] = useState(false);
  const cfg = STATUS_CFG[po.status];
  const StatusIcon = cfg.icon;

  const totalOrdered = po.items.reduce((s, i) => s + i.quantityOrdered, 0);
  const totalDelivered = po.items.reduce((s, i) => s + i.quantityDelivered, 0);
  const allDelivered = po.items.length > 0 && po.items.every((i) => i.quantityDelivered >= i.quantityOrdered);
  const someDelivered = po.items.some((i) => i.quantityDelivered > 0);
  const totalValue = po.items.reduce((s, i) => s + (i.supplierPrice != null ? i.supplierPrice * i.quantityOrdered : 0), 0);
  const hasValue = po.items.some((i) => i.supplierPrice != null);

  const deliveryLabel = po.estimatedDeliveryDate
    ? new Date(po.estimatedDeliveryDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : null;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors" onClick={() => setExpanded((e) => !e)}>
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono font-bold">{po.poNumber}</span>
              <Badge className={`text-xs gap-1 ${cfg.color}`}><StatusIcon className="w-3 h-3" />{cfg.label}</Badge>
              {deliveryLabel && po.status === "ordered" && (
                <span className="flex items-center gap-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">
                  <CalendarDays className="w-3 h-3" /> Due {deliveryLabel}
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              <span className="font-medium">{po.supplierName}</span>
              <span className="mx-1">·</span>
              <span>{po.items.length} line{po.items.length !== 1 ? "s" : ""}</span>
              <span className="mx-1">·</span>
              {po.status === "delivered" ? (() => {
                const backorderLines = po.items.filter((i) => i.quantityDelivered < i.quantityOrdered).length;
                return backorderLines > 0
                  ? <span className="text-amber-700 font-medium">{backorderLines} on backorder</span>
                  : <span className="text-green-700">fully received</span>;
              })() : (
                <span>{totalOrdered} unit{totalOrdered !== 1 ? "s" : ""}</span>
              )}
              {hasValue && (
                <>
                  <span className="mx-1">·</span>
                  <span className="font-semibold text-foreground">{currencySymbol(po.supplierCurrency)}{totalValue.toFixed(2)}</span>
                </>
              )}
              <span className="mx-1">·</span>
              <span>{formatDate(po.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {(po.status === "draft" || po.status === "ordered") && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setEmailOpen(true)}>
              <Mail className="w-3.5 h-3.5" /> Email PO
            </Button>
          )}
          {po.status === "draft" && (
            <Button size="sm" className="gap-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setMarkOrderedOpen(true)}>
              <Send className="w-3.5 h-3.5" /> Mark Ordered
            </Button>
          )}
          {po.status === "ordered" && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs border-green-400 text-green-700 hover:bg-green-50"
              onClick={() => { if (confirm("Receive full delivery? All lines will be marked as fully delivered.")) onReceiveAll(po.id); }}>
              <PackageCheck className="w-3.5 h-3.5" /> Receive All
            </Button>
          )}
          {po.status === "ordered" && (allDelivered || someDelivered) && (
            <Button
              size="sm"
              className={`gap-1.5 text-xs text-white ${allDelivered ? "bg-green-600 hover:bg-green-700" : "bg-amber-600 hover:bg-amber-700"}`}
              title={allDelivered
                ? "Close this PO and allocate received stock to orders"
                : "Record this partial delivery — backordered lines will remain tracked until they arrive"}
              onClick={() => onStatusChange(po.id, "delivered")}
            >
              <PackageCheck className="w-3.5 h-3.5" />
              {allDelivered ? "Complete Delivery" : "Book Partial Delivery"}
            </Button>
          )}
          {(po.status === "draft" || po.status === "ordered") && (
            <Button
              size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50"
              title="Delete this purchase order"
              onClick={() => {
                const msg = po.status === "ordered"
                  ? `Delete PO ${po.poNumber}? This PO has already been marked as ordered. All lines will return to the purchasing requirements list.`
                  : `Delete draft PO ${po.poNumber}?`;
                if (confirm(msg)) onDelete(po.id);
              }}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">
          {po.notes && <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{po.notes}</div>}
          {po.attachments && po.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {po.attachments.map((att, i) => (
                <a
                  key={i}
                  href={`${API_BASE}/storage${att.objectPath}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                >
                  <Paperclip className="w-3 h-3 text-muted-foreground" />
                  {att.name}
                </a>
              ))}
            </div>
          )}
          {po.items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No lines on this PO yet.</div>
          ) : (
            <>
              <POMatrixView items={po.items} currency={po.supplierCurrency} />

              {/* Individual lines — quantity editable on draft POs */}
              <div className="space-y-1 pt-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Individual Lines</p>
                {po.items.map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      {line.supplierCode && <span className="font-mono font-bold text-primary text-xs">{line.supplierCode}</span>}
                      <span className="font-medium truncate">{line.productName}</span>
                      {(line.colour || line.size) && (
                        <span className="text-xs text-muted-foreground">{[line.colour, line.size].filter(Boolean).join(" / ")}</span>
                      )}
                      <span className="text-xs text-muted-foreground">×</span>
                      {po.status === "draft" ? (
                        <input
                          type="number"
                          min={1}
                          defaultValue={line.quantityOrdered}
                          key={line.quantityOrdered}
                          className="w-14 text-center text-xs font-semibold border border-border rounded px-1 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                          onBlur={(e) => {
                            const val = parseInt(e.target.value);
                            if (!isNaN(val) && val >= 1 && val !== line.quantityOrdered) {
                              onLineUpdate(po.id, line.id, { quantityOrdered: val });
                            }
                          }}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                        />
                      ) : (
                        <span className="text-xs font-semibold">{line.quantityOrdered}</span>
                      )}
                      {line.quantityDelivered > 0 && (
                        <span className="text-xs text-green-600">{line.quantityDelivered} received</span>
                      )}
                    </div>
                    {po.status !== "delivered" && (
                      <button
                        title="Remove this line"
                        className="flex-shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors"
                        onClick={() => {
                          if (confirm(`Remove ${line.productName}${line.colour ? ` (${line.colour}` : ""}${line.size ? ` / ${line.size}` : ""}${line.colour ? ")" : ""} × ${line.quantityOrdered} from this PO?`)) {
                            onDeleteLine(po.id, line.id);
                          }
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {po.status === "ordered" && (
                <div className="space-y-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <Truck className="w-3.5 h-3.5" /> Book In Delivery
                    </h4>
                    <span className="text-xs text-muted-foreground">{totalDelivered}/{totalOrdered} received</span>
                  </div>
                  <div className="space-y-2">
                    {po.items.map((line) => (
                      <DeliveryRow key={line.id} line={line} onSave={(lineId, data) => onLineUpdate(po.id, lineId, data)} />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">Quantities and dates save automatically when you click away. Use <strong>Receive All</strong> to mark everything delivered at once. When done, click <strong>Complete Delivery</strong> (or <strong>Book Partial Delivery</strong> if some lines are on backorder) to allocate stock to orders.</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {emailOpen && (
        <POEmailDialog po={po} open={emailOpen} onClose={() => setEmailOpen(false)} onSent={onRefresh} />
      )}
      {markOrderedOpen && (
        <MarkOrderedDialog
          po={po}
          open={markOrderedOpen}
          onClose={() => setMarkOrderedOpen(false)}
          onConfirm={(date) => { onStatusChange(po.id, "ordered", { estimatedDeliveryDate: date }); setMarkOrderedOpen(false); }}
        />
      )}
    </div>
  );
}

export default function Purchasing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [emailGroup, setEmailGroup] = useState<SupplierGroup | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createPoGroup, setCreatePoGroup] = useState<SupplierGroup | null>(null);
  const [createPoNotes, setCreatePoNotes] = useState("");
  const [createProcessPoGroup, setCreateProcessPoGroup] = useState<{ supplierId: number | null; supplierName: string; items: ProcessStockRequirement[] } | null>(null);
  const [createProcessPoNotes, setCreateProcessPoNotes] = useState("");

  const { data: groups = [], isFetching: reqFetching, refetch: refetchReqs } = useQuery<SupplierGroup[]>({
    queryKey: ["purchasing-requirements"],
    queryFn: () => apiFetch("/purchasing/requirements"),
    refetchInterval: 30000,
  });

  const { data: purchaseOrders = [], isFetching: posFetching, refetch: refetchPos } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders"],
    queryFn: () => apiFetch("/purchasing/purchase-orders"),
    refetchInterval: 30000,
  });


  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
    queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
  };

  const createPoMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/purchasing/purchase-orders", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      setCreatePoGroup(null); setCreatePoNotes("");
      toast({ title: "Draft PO created", description: "It appears in the Draft tab below the requirements." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createProcessPoMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/purchasing/purchase-orders/for-process-stock", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] });
      setCreateProcessPoGroup(null); setCreateProcessPoNotes(""); setProcessPoQtys({});
      toast({ title: "Draft PO created", description: "Process material PO added to the Draft tab." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addProcessStockToPoMutation = useMutation({
    mutationFn: ({ poId, items }: { poId: number; items: ProcessStockRequirement[] }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/process-stock-items`, {
        method: "POST",
        body: JSON.stringify({
          items: items.map(r => ({
            processStockId: r.processStockId,
            productName: r.name,
            supplierCode: r.sku ?? null,
            quantityOrdered: r.shortfall,
          })),
        }),
      }),
    onSuccess: () => { invalidateAll(); queryClient.invalidateQueries({ queryKey: ["process-stock-requirements"] }); toast({ title: "Added to draft PO" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addToPoMutation = useMutation({
    mutationFn: ({ poId, itemIds }: { poId: number; itemIds: number[] }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items`, { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => { invalidateAll(); toast({ title: "Items added to draft PO" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, extra }: { id: number; status: string; extra?: Record<string, unknown> }) =>
      apiFetch(`/purchasing/purchase-orders/${id}`, { method: "PATCH", body: JSON.stringify({ status, ...extra }) }),
    onSuccess: (_data, vars) => {
      invalidateAll();
      setStatusFilter("all");
      const msgs: Record<string, string> = {
        ordered: "PO marked as Ordered — now showing in the Ordered tab.",
        delivered: "Delivery booked — PO moved to Delivered.",
        draft: "PO moved back to Draft.",
      };
      toast({ title: "Status updated", description: msgs[vars.status] });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const receiveAllMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/purchasing/purchase-orders/${id}/receive-all`, { method: "POST" }),
    onSuccess: () => { invalidateAll(); toast({ title: "Delivery booked in", description: "All lines marked as received." }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/purchasing/purchase-orders/${id}`, { method: "DELETE" }),
    onSuccess: () => { invalidateAll(); toast({ title: "PO deleted" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteLineMutation = useMutation({
    mutationFn: ({ poId, itemId }: { poId: number; itemId: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      toast({ title: "Line removed", description: "Item returned to purchasing requirements." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const lineUpdateMutation = useMutation({
    mutationFn: ({ poId, itemId, data }: { poId: number; itemId: number; data: Record<string, unknown> }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reqQtyMutation = useMutation({
    mutationFn: ({ orderId, itemId, purchaseQuantity }: { orderId: number; itemId: number; purchaseQuantity: number }) =>
      apiFetch(`/orders/${orderId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ purchaseQuantity }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
    },
    onError: (e: Error) => toast({ title: "Error updating quantity", description: e.message, variant: "destructive" }),
  });

  const clearBackorderMutation = useMutation({
    mutationFn: ({ poId, itemId, quantityOrdered }: { poId: number; itemId: number; quantityOrdered: number }) =>
      apiFetch(`/purchasing/purchase-orders/${poId}/items/${itemId}`, { method: "PATCH", body: JSON.stringify({ quantityDelivered: quantityOrdered }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-backorders"] });
      queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
      toast({ title: "Backorder cleared", description: "Line marked as fully received." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleGroup = (name: string) => setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const { data: backorders = [] } = useQuery<BackorderLine[]>({
    queryKey: ["purchasing-backorders"],
    queryFn: () => apiFetch("/purchasing/backorders"),
    refetchInterval: 30000,
  });

  const { data: processStockReqs = [] } = useQuery<ProcessStockRequirement[]>({
    queryKey: ["process-stock-requirements"],
    queryFn: () => apiFetch("/purchasing/process-stock-requirements"),
    refetchInterval: 60000,
  });
  const processShortfallCount = processStockReqs.filter(r => r.shortfall > 0).length;
  const processReqsBySupplier = Object.values(
    processStockReqs
      .filter(r => r.shortfall > 0)
      .reduce((acc, req) => {
        const key = String(req.supplierId ?? req.supplierName ?? "unknown");
        if (!acc[key]) acc[key] = { supplierId: req.supplierId, supplierName: req.supplierName ?? "Unknown Supplier", items: [] };
        acc[key].items.push(req);
        return acc;
      }, {} as Record<string, { supplierId: number | null; supplierName: string; items: ProcessStockRequirement[] }>)
  );

  const draftPos = purchaseOrders.filter((po) => po.status === "draft");
  const filteredPos = purchaseOrders.filter((po) => po.status === "ordered");
  const draftCount = purchaseOrders.filter((p) => p.status === "draft").length;
  const orderedCount = purchaseOrders.filter((p) => p.status === "ordered").length;
  const deliveredCount = purchaseOrders.filter((p) => p.status === "delivered").length;

  const getDraftPoForSupplier = (supplierId: number | null, supplierName: string) =>
    purchaseOrders.find((po) => po.status === "draft" && (supplierId ? po.supplierId === supplierId : po.supplierName === supplierName));

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="w-7 h-7 text-primary" /> Purchasing
            </h1>
            <p className="text-muted-foreground mt-1">Manage purchase requirements and supplier orders.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={() => { refetchReqs(); refetchPos(); }}
            disabled={reqFetching || posFetching}
          >
            <RefreshCw className={`w-4 h-4 ${reqFetching || posFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        <Tabs defaultValue="requirements">
          <TabsList className="mb-4">
            <TabsTrigger value="requirements" className="gap-2">
              <FileText className="w-4 h-4" /> Draft
              {(totalItems + processShortfallCount + draftPos.length) > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">{totalItems + processShortfallCount + draftPos.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <Truck className="w-4 h-4" /> Awaiting Delivery
              {orderedCount > 0 && <Badge variant="secondary" className="ml-1 text-xs">{orderedCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="backorders" className="gap-2">
              <ClipboardList className="w-4 h-4" /> Backorders
              {backorders.length > 0 && <Badge className="ml-1 text-xs bg-amber-500 text-white">{backorders.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="completed" className="gap-2">
              <PackageCheck className="w-4 h-4" /> Completed
              {deliveredCount > 0 && <Badge variant="secondary" className="ml-1 text-xs">{deliveredCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="process_stock" className="gap-2">
              <Boxes className="w-4 h-4" /> Process Stock
            </TabsTrigger>
          </TabsList>

          {/* ── Requirements Tab ── */}
          <TabsContent value="requirements">
            <div className="space-y-4">

              {reqFetching && groups.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : groups.length === 0 && processReqsBySupplier.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <CheckCircle className="w-12 h-12 text-green-400" />
                  <p className="text-lg font-medium">No purchasing required</p>
                  <p className="text-sm">All order items are in stock or fulfilled.</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>{totalItems} item{totalItems !== 1 ? "s" : ""} across {groups.length} supplier{groups.length !== 1 ? "s" : ""} need purchasing</span>
                  </div>

                  {groups.map((group) => {
                    const isExpanded = expandedGroups[group.supplierName] !== false;
                    const totalQty = group.items.reduce((s, i) => s + (i.purchaseQuantity ?? 0), 0);
                    const existingDraft = getDraftPoForSupplier(group.supplierId, group.supplierName);

                    return (
                      <div key={group.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggleGroup(group.supplierName)}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <div className="font-semibold text-base flex items-center gap-2">
                                {group.supplierName}
                                {group.supplierId === null && (
                                  <span className="text-xs font-normal text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                                    Set supplier on the product to assign
                                  </span>
                                )}
                              </div>
                              {group.supplierEmail && <div className="text-xs text-muted-foreground">{group.supplierEmail}</div>}
                            </div>
                            <Badge variant="secondary">{group.items.length} line{group.items.length !== 1 ? "s" : ""}</Badge>
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{totalQty} units needed</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {existingDraft ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                onClick={() => addToPoMutation.mutate({ poId: existingDraft.id, itemIds: group.items.map((i) => i.itemId) })}
                                disabled={addToPoMutation.isPending}>
                                <Plus className="w-3.5 h-3.5" /> Add to Draft PO ({existingDraft.poNumber})
                              </Button>
                            ) : (
                              <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90" onClick={() => setCreatePoGroup(group)}>
                                <FileText className="w-3.5 h-3.5" /> Create Draft PO
                              </Button>
                            )}
                            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setEmailGroup(group)}>
                              <Mail className="w-3.5 h-3.5" /> Email
                            </Button>
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-border px-5 py-4">
                            <RequirementsLineTable
                              items={group.items}
                              onQtyChange={(item, qty) => reqQtyMutation.mutate({ orderId: item.orderId, itemId: item.itemId, purchaseQuantity: qty })}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Process Materials Requirements — merged into Draft tab */}
              {processReqsBySupplier.length > 0 && (
                <>
                  {groups.length > 0 && (
                    <div className="flex items-center gap-2 pt-2 pb-1">
                      <div className="flex-1 border-t border-border" />
                      <span className="text-xs text-muted-foreground uppercase tracking-wide font-semibold px-2">Process Materials</span>
                      <div className="flex-1 border-t border-border" />
                    </div>
                  )}
                  {processReqsBySupplier.map((psGroup) => {
                    const totalPsQty = psGroup.items.reduce((s, r) => s + r.shortfall, 0);
                    const existingDraft = getDraftPoForSupplier(psGroup.supplierId, psGroup.supplierName);
                    const isExpanded = expandedGroups[`ps_${psGroup.supplierName}`] !== false;
                    return (
                      <div key={psGroup.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggleGroup(`ps_${psGroup.supplierName}`)}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <div className="font-semibold text-base">{psGroup.supplierName ?? "Unknown Supplier"}</div>
                            </div>
                            <Badge variant="secondary">{psGroup.items.length} line{psGroup.items.length !== 1 ? "s" : ""}</Badge>
                            <Badge className="bg-amber-100 text-amber-800 border-amber-200">{totalPsQty} units needed</Badge>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                            {existingDraft ? (
                              <Button size="sm" variant="outline" className="gap-1.5 text-xs border-blue-400 text-blue-700 hover:bg-blue-50"
                                onClick={() => addProcessStockToPoMutation.mutate({ poId: existingDraft.id, items: psGroup.items })}
                                disabled={addProcessStockToPoMutation.isPending}>
                                <Plus className="w-3.5 h-3.5" /> Add to Draft PO ({existingDraft.poNumber})
                              </Button>
                            ) : (
                              <Button size="sm" className="gap-1.5 text-xs bg-primary hover:bg-primary/90"
                                onClick={() => { setCreateProcessPoGroup(psGroup); setCreateProcessPoNotes(""); }}>
                                <FileText className="w-3.5 h-3.5" /> Create Draft PO
                              </Button>
                            )}
                            {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                          </div>
                        </div>
                        {isExpanded && (
                          <div className="border-t border-border px-5 py-4">
                            <ProcessMaterialsLineTable items={psGroup.items} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}

              {/* Draft POs — created but not yet sent to supplier */}
              {draftPos.length > 0 && (
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 border-t-2 border-border" />
                    <div className="flex items-center gap-2 shrink-0">
                      <FileText className="w-4 h-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">Draft Purchase Orders</span>
                      <Badge variant="secondary" className="text-xs">{draftPos.length}</Badge>
                    </div>
                    <div className="flex-1 border-t-2 border-border" />
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Review quantities on each PO, then click <strong>Mark Ordered</strong> once sent to the supplier.
                  </p>
                  {draftPos.map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                      onRefresh={() => { refetchPos(); refetchReqs(); }}
                      onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Purchase Orders Tab ── */}
          <TabsContent value="orders">
            <div className="space-y-4">
              {posFetching && purchaseOrders.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : filteredPos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <Truck className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-lg font-medium">No orders awaiting delivery</p>
                  <p className="text-sm">Mark a draft PO as Ordered once you've sent it to the supplier.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredPos.map((po) => (
                    <POCard
                      key={po.id}
                      po={po}
                      onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                      onDelete={(id) => deleteMutation.mutate(id)}
                      onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                      onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                      onRefresh={() => { refetchPos(); refetchReqs(); }}
                      onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          {/* ── Completed Tab ── */}
          <TabsContent value="completed">
            {posFetching && purchaseOrders.length === 0 ? (
              <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
            ) : deliveredCount === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <PackageCheck className="w-12 h-12 text-muted-foreground/30" />
                <p className="text-lg font-medium">No completed deliveries yet</p>
                <p className="text-sm">Deliveries booked in will appear here once marked as delivered.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {purchaseOrders.filter((po) => po.status === "delivered").map((po) => (
                  <POCard
                    key={po.id}
                    po={po}
                    onStatusChange={(id, status, extra) => statusMutation.mutate({ id, status, extra })}
                    onDelete={(id) => deleteMutation.mutate(id)}
                    onDeleteLine={(poId, itemId) => deleteLineMutation.mutate({ poId, itemId })}
                    onLineUpdate={(poId, itemId, data) => lineUpdateMutation.mutate({ poId, itemId, data })}
                    onRefresh={() => { refetchPos(); refetchReqs(); }}
                    onReceiveAll={(id) => receiveAllMutation.mutate(id)}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Backorders Tab ── */}
          <TabsContent value="backorders">
            {backorders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                <CheckCircle className="w-12 h-12 text-green-400" />
                <p className="text-lg font-medium">No backorders</p>
                <p className="text-sm">Lines with a backorder date set will appear here until the stock arrives.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-amber-500" />
                  {backorders.length} line{backorders.length !== 1 ? "s" : ""} on backorder
                </p>
                {backorders.map((b) => (
                  <div key={b.id} className="rounded-xl border border-amber-200 bg-amber-50/40 px-4 py-3 space-y-1.5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="space-y-0.5">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {b.supplierCode && <span className="font-bold text-sm font-mono text-primary">{b.supplierCode}</span>}
                          <span className="font-medium text-sm">{b.productName}</span>
                          {(b.colour || b.size) && (
                            <span className="text-xs text-muted-foreground">{[b.colour, b.size].filter(Boolean).join(" / ")}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                          <span>PO: <span className="font-mono font-medium text-foreground">{b.poNumber}</span></span>
                          <span>{b.supplierName}</span>
                          {b.orderNumber && (
                            <span>Order: <span className="font-mono font-medium text-foreground">{b.orderNumber}</span></span>
                          )}
                          {b.customerName && <span>{b.customerName}</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-right flex-shrink-0">
                        <div className="flex items-center gap-2">
                          <Badge className="bg-amber-100 text-amber-800 border border-amber-300 text-xs font-semibold">
                            {b.remaining} still pending
                          </Badge>
                          <button
                            title="Mark as fully received"
                            className="text-red-400 hover:text-red-600 hover:bg-red-50 rounded p-1 transition-colors"
                            disabled={clearBackorderMutation.isPending}
                            onClick={() => {
                              if (confirm(`Mark ${b.productName}${b.colour ? ` (${b.colour})` : ""} as fully received? This will clear it from the backorders list.`)) {
                                clearBackorderMutation.mutate({ poId: b.poId, itemId: b.id, quantityOrdered: b.quantityOrdered });
                              }
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {b.estimatedDueDate && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <CalendarDays className="w-3 h-3" />
                            Due {new Date(b.estimatedDueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                          </span>
                        )}
                        {b.requiredDate && (
                          <span className="text-xs text-orange-600 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Order req. {new Date(b.requiredDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* ── Process Stock Tab ── */}
          <TabsContent value="process_stock">
            <ProcessStockTab />
          </TabsContent>
        </Tabs>

        {/* ── Create Process Material PO dialog ── */}
        {createProcessPoGroup && (
          <Dialog open={!!createProcessPoGroup} onOpenChange={() => setCreateProcessPoGroup(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Create Draft PO — {createProcessPoGroup.supplierName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-border divide-y text-sm">
                  {createProcessPoGroup.items.map((req) => (
                    <div key={req.processStockId} className="flex justify-between px-3 py-2">
                      <span className="font-medium">{req.name}</span>
                      <span className="text-muted-foreground">
                        {req.sku && <span className="font-mono mr-2 text-xs">{req.sku}</span>}
                        <strong>× {req.shortfall}</strong>
                      </span>
                    </div>
                  ))}
                </div>
                {createProcessPoGroup.items.some((r) => r.fileUrl) && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" />
                    Print file(s) will be attached to this PO automatically.
                  </p>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea placeholder="Any notes for this purchase order..." value={createProcessPoNotes} onChange={(e) => setCreateProcessPoNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateProcessPoGroup(null)}>Cancel</Button>
                <Button
                  onClick={() => createProcessPoMutation.mutate({
                    supplierId: createProcessPoGroup.supplierId,
                    supplierName: createProcessPoGroup.supplierName,
                    notes: createProcessPoNotes || null,
                    items: createProcessPoGroup.items.map((req) => ({
                      processStockId: req.processStockId,
                      productName: req.name,
                      supplierCode: req.sku ?? null,
                      quantityOrdered: req.shortfall,
                    })),
                  })}
                  disabled={createProcessPoMutation.isPending}
                  className="gap-1.5"
                >
                  {createProcessPoMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><FileText className="w-4 h-4" />Create Draft PO</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* ── Create PO dialog ── */}
        {createPoGroup && (
          <Dialog open={!!createPoGroup} onOpenChange={() => setCreatePoGroup(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Create Draft PO — {createPoGroup.supplierName}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-lg border border-border divide-y text-sm">
                  {createPoGroup.items.map((item) => (
                    <div key={item.itemId} className="flex justify-between px-3 py-2">
                      <span className="font-medium">{productDisplayName(item)}</span>
                      <span className="text-muted-foreground">{[item.colour, item.size].filter(Boolean).join(" / ")} <strong>× {item.purchaseQuantity}</strong></span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                  <Textarea placeholder="Any notes for this purchase order..." value={createPoNotes} onChange={(e) => setCreatePoNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreatePoGroup(null)}>Cancel</Button>
                <Button
                  onClick={() => createPoMutation.mutate({
                    supplierId: createPoGroup.supplierId,
                    supplierName: createPoGroup.supplierName,
                    supplierEmail: createPoGroup.supplierEmail,
                    notes: createPoNotes || null,
                    itemIds: createPoGroup.items.map((i) => i.itemId),
                  })}
                  disabled={createPoMutation.isPending}
                  className="gap-1.5"
                >
                  {createPoMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Creating...</> : <><FileText className="w-4 h-4" />Create Draft PO</>}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {emailGroup && (
          <EmailDialog group={emailGroup} open={!!emailGroup} onClose={() => setEmailGroup(null)} onSent={(ids) => { setEmailGroup(null); fulfillMutation.mutate(ids); }} />
        )}
      </div>
    </Layout>
  );
}
