import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag, Package, AlertTriangle, CheckCircle, Mail, ChevronDown, ChevronRight,
  RefreshCw, Plus, FileText, Truck, Clock, TriangleAlert, Trash2, ArrowRight,
  CalendarDays, PackageCheck, Send, Loader2, ChevronUp, TrendingUp, ClipboardList,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { formatDate } from "@/lib/utils";

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
  createdAt: string; updatedAt: string; items: POItem[];
}

function currencySymbol(currency?: string | null): string {
  if (currency === "USD") return "$";
  if (currency === "EUR") return "€";
  return "£";
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
    g.qty.get(c)!.set(s, item.quantityOrdered);
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
    setTimeout(() => window.open(mailto, "_self"), 300);
    onClose();
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

function MatrixTable({ items }: { items: PurchaseRequirement[] }) {
  const productKeys = [...new Map(items.map((i) => [productDisplayName(i), i])).values()];
  const sizeKeys = [...new Set(items.map((i) => [i.colour, i.size].filter(Boolean).join(" / ") || "N/A"))];
  if (productKeys.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[200px]">Product</TableHead>
            {sizeKeys.map((s) => <TableHead key={s} className="text-center font-semibold min-w-[80px]">{s}</TableHead>)}
            <TableHead className="text-center font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {productKeys.map((rep) => {
            const pName = productDisplayName(rep);
            const productItems = items.filter((i) => productDisplayName(i) === pName);
            const totalQty = productItems.reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
            return (
              <TableRow key={pName}>
                <TableCell>
                  <div className="font-medium text-sm">{pName}</div>
                  {(rep.supplierCode || rep.productSku) && (
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">
                      {rep.supplierCode && <span className="mr-2">Supplier Code: {rep.supplierCode}</span>}
                      {rep.productSku && <span>SKU: {rep.productSku}</span>}
                    </div>
                  )}
                </TableCell>
                {sizeKeys.map((sizeKey) => {
                  const qty = productItems.filter((i) => ([i.colour, i.size].filter(Boolean).join(" / ") || "N/A") === sizeKey).reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
                  return <TableCell key={sizeKey} className="text-center">{qty > 0 ? <span className="font-semibold text-primary">{qty}</span> : <span className="text-muted-foreground">—</span>}</TableCell>;
                })}
                <TableCell className="text-center font-bold">{totalQty}</TableCell>
              </TableRow>
            );
          })}
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
          {po.items.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No lines on this PO yet.</div>
          ) : (
            <>
              <POMatrixView items={po.items} currency={po.supplierCurrency} />

              {/* Individual lines with delete buttons — only for draft and ordered POs */}
              {po.status !== "delivered" && (
                <div className="space-y-1 pt-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Individual Lines</p>
                  {po.items.map((line) => (
                    <div key={line.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/10 px-3 py-2 text-sm">
                      <div className="flex items-baseline gap-2 flex-wrap min-w-0">
                        {line.supplierCode && <span className="font-mono font-bold text-primary text-xs">{line.supplierCode}</span>}
                        <span className="font-medium truncate">{line.productName}</span>
                        {(line.colour || line.size) && (
                          <span className="text-xs text-muted-foreground">{[line.colour, line.size].filter(Boolean).join(" / ")}</span>
                        )}
                        <span className="text-xs font-semibold text-foreground">× {line.quantityOrdered}</span>
                        {line.quantityDelivered > 0 && (
                          <span className="text-xs text-green-600">{line.quantityDelivered} received</span>
                        )}
                      </div>
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
                    </div>
                  ))}
                </div>
              )}

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
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [emailGroup, setEmailGroup] = useState<SupplierGroup | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [createPoGroup, setCreatePoGroup] = useState<SupplierGroup | null>(null);
  const [createPoNotes, setCreatePoNotes] = useState("");

  const { data: groups = [], isLoading: reqLoading, refetch: refetchReqs } = useQuery<SupplierGroup[]>({
    queryKey: ["purchasing-requirements"],
    queryFn: () => apiFetch("/purchasing/requirements"),
    refetchInterval: 30000,
  });

  const { data: purchaseOrders = [], isLoading: posLoading, refetch: refetchPos } = useQuery<PurchaseOrder[]>({
    queryKey: ["purchase-orders"],
    queryFn: () => apiFetch("/purchasing/purchase-orders"),
    refetchInterval: 30000,
  });

  const fulfillMutation = useMutation({
    mutationFn: (itemIds: number[]) => apiFetch("/purchasing/mark-fulfilled", { method: "POST", body: JSON.stringify({ itemIds }) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] }); setSelectedItems({}); toast({ title: "Marked as fulfilled" }); },
    onError: () => toast({ title: "Error", variant: "destructive" }),
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
      toast({ title: "Draft PO created", description: "Switch to Purchase Orders tab to manage it." });
    },
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
    onSuccess: () => { invalidateAll(); toast({ title: "Status updated" }); },
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
  const toggleItem = (id: number) => setSelectedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  const toggleGroupItems = (group: SupplierGroup) => {
    const allSel = group.items.every((i) => selectedItems[i.itemId]);
    const upd = { ...selectedItems };
    group.items.forEach((i) => { upd[i.itemId] = !allSel; });
    setSelectedItems(upd);
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;
  const selectedIds = Object.entries(selectedItems).filter(([, v]) => v).map(([k]) => parseInt(k));
  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const { data: backorders = [] } = useQuery<BackorderLine[]>({
    queryKey: ["purchasing-backorders"],
    queryFn: () => apiFetch("/purchasing/backorders"),
    refetchInterval: 30000,
  });

  const filteredPos = purchaseOrders.filter((po) => statusFilter === "all" || po.status === statusFilter);
  const draftCount = purchaseOrders.filter((p) => p.status === "draft").length;
  const orderedCount = purchaseOrders.filter((p) => p.status === "ordered").length;

  const getDraftPoForSupplier = (supplierId: number | null, supplierName: string) =>
    purchaseOrders.find((po) => po.status === "draft" && (supplierId ? po.supplierId === supplierId : po.supplierName === supplierName));

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ShoppingBag className="w-7 h-7 text-primary" /> Purchasing
            </h1>
            <p className="text-muted-foreground mt-1">Manage purchase requirements and supplier orders.</p>
          </div>
        </div>

        <Tabs defaultValue="requirements">
          <TabsList className="mb-4">
            <TabsTrigger value="requirements" className="gap-2">
              <AlertTriangle className="w-4 h-4" /> Requirements
              {totalItems > 0 && <Badge variant="secondary" className="ml-1 text-xs">{totalItems}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-2">
              <FileText className="w-4 h-4" /> Purchase Orders
              {(draftCount + orderedCount) > 0 && <Badge variant="secondary" className="ml-1 text-xs">{draftCount + orderedCount}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="backorders" className="gap-2">
              <ClipboardList className="w-4 h-4" /> Backorders
              {backorders.length > 0 && <Badge className="ml-1 text-xs bg-amber-500 text-white">{backorders.length}</Badge>}
            </TabsTrigger>
          </TabsList>

          {/* ── Requirements Tab ── */}
          <TabsContent value="requirements">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {selectedCount > 0 && (
                    <Button variant="outline" onClick={() => fulfillMutation.mutate(selectedIds)} disabled={fulfillMutation.isPending} className="gap-2 border-green-500 text-green-700 hover:bg-green-50">
                      <CheckCircle className="w-4 h-4" /> Mark {selectedCount} Fulfilled
                    </Button>
                  )}
                </div>
              </div>

              {reqLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : groups.length === 0 ? (
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
                    const allGroupSelected = group.items.every((i) => selectedItems[i.itemId]);
                    const someGroupSelected = group.items.some((i) => selectedItems[i.itemId]);
                    const totalQty = group.items.reduce((s, i) => s + (i.purchaseQuantity ?? 0), 0);
                    const existingDraft = getDraftPoForSupplier(group.supplierId, group.supplierName);

                    return (
                      <div key={group.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => toggleGroup(group.supplierName)}>
                          <div className="flex items-center gap-3 flex-wrap">
                            <div onClick={(e) => { e.stopPropagation(); toggleGroupItems(group); }}>
                              <Checkbox checked={allGroupSelected} className={someGroupSelected && !allGroupSelected ? "data-[state=unchecked]:bg-primary/20" : ""} />
                            </div>
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
                          <div className="border-t border-border px-5 py-4 space-y-5">
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Purchase Matrix</h4>
                              <MatrixTable items={group.items} />
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Line Details</h4>
                              <div className="space-y-2">
                                {(() => {
                                  // Consolidate items with same product + colour + size
                                  const consolidated = new Map<string, { items: PurchaseRequirement[]; totalQty: number }>();
                                  for (const item of group.items) {
                                    const key = `${productDisplayName(item)}||${item.colour ?? ""}||${item.size ?? ""}`;
                                    if (!consolidated.has(key)) consolidated.set(key, { items: [], totalQty: 0 });
                                    const entry = consolidated.get(key)!;
                                    entry.items.push(item);
                                    entry.totalQty += item.purchaseQuantity ?? 0;
                                  }
                                  return [...consolidated.values()].map(({ items: grpItems, totalQty }) => {
                                    const rep = grpItems[0];
                                    const allSelected = grpItems.every((i) => selectedItems[i.itemId]);
                                    const someSelected = grpItems.some((i) => selectedItems[i.itemId]);
                                    const toggleAll = () => {
                                      const upd = { ...selectedItems };
                                      grpItems.forEach((i) => { upd[i.itemId] = !allSelected; });
                                      setSelectedItems(upd);
                                    };
                                    // Deduplicate orders (same order may have multiple items)
                                    const ordersSeen = new Set<number>();
                                    const orders = grpItems.filter((i) => { if (ordersSeen.has(i.orderId)) return false; ordersSeen.add(i.orderId); return true; });
                                    return (
                                      <div key={grpItems.map((i) => i.itemId).join("-")} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                        <Checkbox
                                          checked={allSelected}
                                          className={someSelected && !allSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                                          onCheckedChange={toggleAll}
                                        />
                                        <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="font-medium text-sm">{productDisplayName(rep)}</div>
                                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                            {rep.supplierCode && <span className="text-xs font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0">Supplier Code: {rep.supplierCode}</span>}
                                            {rep.productSku && !rep.supplierCode && <span className="text-xs font-mono text-muted-foreground">SKU: {rep.productSku}</span>}
                                            {rep.colour && <Badge variant="outline" className="text-xs py-0">{rep.colour}</Badge>}
                                            {rep.size && <Badge variant="outline" className="text-xs py-0">{rep.size}</Badge>}
                                            <span className="text-xs text-muted-foreground">
                                              {orders.length === 1
                                                ? <>Order: <a href={`/orders/${orders[0].orderId}`} className="text-primary hover:underline">{orders[0].orderNumber}</a>{orders[0].customerName && ` · ${orders[0].customerName}`}</>
                                                : <>Orders: {orders.map((o, idx) => (<span key={o.orderId}>{idx > 0 && ", "}<a href={`/orders/${o.orderId}`} className="text-primary hover:underline">{o.orderNumber}</a></span>))}{orders[0].customerName && ` · ${orders[0].customerName}`}</>
                                              }
                                            </span>
                                          </div>
                                        </div>
                                        <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm font-semibold">× {totalQty}</Badge>
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </TabsContent>

          {/* ── Purchase Orders Tab ── */}
          <TabsContent value="orders">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="grid grid-cols-3 gap-2">
                    {(["draft", "ordered", "delivered"] as const).map((s) => {
                      const count = purchaseOrders.filter((p) => p.status === s).length;
                      const c = STATUS_CFG[s];
                      const Icon = c.icon;
                      return (
                        <button key={s} onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${statusFilter === s ? `${c.color} shadow-sm` : "border-border text-muted-foreground hover:border-primary/40"}`}>
                          <Icon className="w-3.5 h-3.5" />{c.label} <span className="font-bold">{count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {posLoading ? (
                <div className="flex items-center justify-center py-20 text-muted-foreground"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading...</div>
              ) : filteredPos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  <FileText className="w-12 h-12 text-muted-foreground/30" />
                  <p className="text-lg font-medium">{statusFilter === "all" ? "No purchase orders yet" : `No ${STATUS_CFG[statusFilter as keyof typeof STATUS_CFG]?.label} orders`}</p>
                  <p className="text-sm">Create a draft PO from the Requirements tab.</p>
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
        </Tabs>

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
