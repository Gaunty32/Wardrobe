import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, CheckCircle2, ShoppingCart, PackageX, Mail, Check,
  Copy, ChevronRight, Package, AlertTriangle, Truck, CreditCard, XCircle,
} from "lucide-react";

const SHIPPING_OPTIONS = [
  { value: "free_local", label: "Free Local Delivery" },
  { value: "local_delivery", label: "Local Delivery" },
  { value: "office_collection", label: "Office Collection" },
  { value: "warehouse_collection", label: "Warehouse Collection" },
  { value: "courier", label: "Courier" },
] as const;

function defaultRequiredDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

interface ShortfallItem {
  id: number;
  productName: string;
  colour: string | null;
  size: string | null;
  purchaseQuantity: number;
  supplierId: number | null;
  supplierName: string | null;
  supplierEmail: string | null;
}

interface ShortfallGroup {
  supplierId: number | null;
  supplierName: string;
  supplierEmail: string | null;
  itemIds: number[];
  items: ShortfallItem[];
  existingDraftPos: Array<{ id: number; poNumber: string }>;
}

interface ProcessShortfallGroup {
  supplierName: string;
  supplierId: number | null;
  items: Array<{ name: string; sku: string | null; shortfall: number }>;
}

interface AllocationResult {
  allocation: { allocated: number; purchaseRequired: number };
  shortfallGroups: ShortfallGroup[];
  processShortfallGroups: ProcessShortfallGroup[];
  unlinkedItems: number;
  emailConfigured: boolean;
  stripeCharge?: { success: boolean; paymentIntentId?: string; cardLast4?: string; error?: string } | null;
}

type Step = "review" | "confirming" | "purchase_orders" | "creating_pos" | "email" | "sending_email" | "done";
type PoAction = "new" | `existing:${number}`;

interface ConfirmOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: number;
    orderNumber: string;
    customerName: string | null;
    status: string;
    totalAmount?: number | null;
    requiredDate?: string | null;
    shippingMethod?: string | null;
    items?: Array<{ id: number; productName: string; quantity: number; purchaseRequired?: boolean }>;
  };
  onConfirmed: () => void;
}

export function ConfirmOrderDialog({ open, onOpenChange, order, onConfirmed }: ConfirmOrderDialogProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("review");
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [poActions, setPoActions] = useState<Record<string, PoAction>>({});
  const [poResults, setPoResults] = useState<string[]>([]);
  const [emailTo, setEmailTo] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [emailText, setEmailText] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [copied, setCopied] = useState(false);
  const [requiredDate, setRequiredDate] = useState(defaultRequiredDate);
  const [shippingMethod, setShippingMethod] = useState<string>("");
  const [carriageAmount, setCarriageAmount] = useState<string>("");
  const [paymentLinkUrl, setPaymentLinkUrl] = useState<string | null>(null);
  const [paymentLinkLoading, setPaymentLinkLoading] = useState(false);
  const [paymentLinkError, setPaymentLinkError] = useState<string | null>(null);
  const [paymentLinkCopied, setPaymentLinkCopied] = useState(false);

  const initialRequiredDate = () =>
    order.requiredDate ? new Date(order.requiredDate).toISOString().slice(0, 10) : defaultRequiredDate();
  const initialShippingMethod = () => order.shippingMethod ?? "";

  const reset = () => {
    setStep("review");
    setResult(null);
    setPoActions({});
    setPoResults([]);
    setEmailTo("");
    setEmailSent(false);
    setEmailText("");
    setCopied(false);
    setRequiredDate(initialRequiredDate());
    setShippingMethod(initialShippingMethod());
    setCarriageAmount(order.shippingMethod === "courier" ? "8.50" : "");
    setPaymentLinkUrl(null);
    setPaymentLinkLoading(false);
    setPaymentLinkError(null);
    setPaymentLinkCopied(false);
  };

  useEffect(() => {
    if (open) {
      setRequiredDate(initialRequiredDate());
      setShippingMethod(initialShippingMethod());
      setCarriageAmount(order.shippingMethod === "courier" ? "8.50" : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (shippingMethod === "courier") {
      setCarriageAmount(prev => prev === "" ? "8.50" : prev);
    }
  }, [shippingMethod]);

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  // ─── Generate Stripe Payment Link ────────────────────────────────────────
  const generatePaymentLink = async () => {
    if (paymentLinkLoading) return;
    setPaymentLinkLoading(true);
    setPaymentLinkError(null);
    try {
      const data = await apiFetch<{ url: string; existing?: boolean }>(
        `/stripe/orders/${order.id}/payment-link`,
        { method: "POST" }
      );
      setPaymentLinkUrl(data.url);
    } catch (err: any) {
      setPaymentLinkError(err.message);
    } finally {
      setPaymentLinkLoading(false);
    }
  };

  useEffect(() => {
    if (step === "email" && open && !paymentLinkUrl && !paymentLinkLoading) {
      generatePaymentLink();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);

  // ─── Step 1: Confirm ──────────────────────────────────────────────────────
  const handleConfirm = async () => {
    setStep("confirming");
    try {
      const data = await apiFetch<AllocationResult & { id: number }>(`/orders/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "confirmed",
          requiredDate: requiredDate || null,
          shippingMethod: shippingMethod || null,
          carriageAmount: carriageAmount !== "" ? parseFloat(carriageAmount) : 0,
        }),
      });
      setResult(data);
      // Initialise PO action for each supplier group
      const initial: Record<string, PoAction> = {};
      for (const g of data.shortfallGroups ?? []) {
        initial[g.supplierName] = g.existingDraftPos.length > 0
          ? `existing:${g.existingDraftPos[0].id}`
          : "new";
      }
      setPoActions(initial);
      if ((data.shortfallGroups ?? []).length > 0) {
        setStep("purchase_orders");
      } else {
        setStep("email");
      }
      onConfirmed();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setStep("review");
    }
  };

  // ─── Step 2: Create Purchase Orders ──────────────────────────────────────
  const handleCreatePos = async () => {
    if (!result) return;
    setStep("creating_pos");
    const created: string[] = [];
    try {
      for (const group of result.shortfallGroups) {
        const action = poActions[group.supplierName] ?? "new";
        if (action === "new") {
          const po = await apiFetch<{ poNumber: string }>("/purchasing/purchase-orders", {
            method: "POST",
            body: JSON.stringify({
              supplierId: group.supplierId ?? null,
              supplierName: group.supplierName,
              supplierEmail: group.supplierEmail ?? null,
              itemIds: group.itemIds,
            }),
          });
          created.push(`Created ${po.poNumber} for ${group.supplierName}`);
        } else {
          const poId = parseInt(action.replace("existing:", ""), 10);
          const existingLabel = group.existingDraftPos.find(p => p.id === poId)?.poNumber ?? `PO #${poId}`;
          await apiFetch(`/purchasing/purchase-orders/${poId}/items`, {
            method: "POST",
            body: JSON.stringify({ itemIds: group.itemIds }),
          });
          created.push(`Added to ${existingLabel} for ${group.supplierName}`);
        }
      }
      setPoResults(created);
      setStep("email");
    } catch (err: any) {
      toast({ title: "PO Error", description: err.message, variant: "destructive" });
      setStep("purchase_orders");
    }
  };

  // ─── Step 3: Send Email ───────────────────────────────────────────────────
  const handleSendEmail = async () => {
    setStep("sending_email");
    try {
      const data = await apiFetch<{ sent: boolean; text: string; subject: string; error?: string; to: string }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify(emailTo ? { toEmail: emailTo } : {}) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      if (data.sent) {
        setEmailSent(true);
        setEmailTo(data.to);
        toast({ title: "Email Sent", description: `Acknowledgement sent to ${data.to}` });
      } else {
        toast({ title: "Email not sent", description: data.error ?? "SMTP not configured — use copy instead.", variant: "destructive" });
      }
      setStep("email");
    } catch (err: any) {
      if (err.message.includes("No customer email")) {
        toast({ title: "No email address", description: "Enter the customer's email address below.", variant: "destructive" });
      } else {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
      setStep("email");
    }
  };

  const handlePreviewEmail = async () => {
    try {
      const data = await apiFetch<{ text: string; subject: string; html: string; to: string }>(
        `/orders/${order.id}/send-acknowledgement`,
        { method: "POST", body: JSON.stringify({ toEmail: emailTo || "preview@example.com", previewOnly: true }) }
      );
      setEmailText(data.text);
      setEmailSubject(data.subject);
      setEmailTo(prev => prev || data.to);
    } catch {}
  };

  const handleCopyEmail = async () => {
    if (!emailText) await handlePreviewEmail();
    const textToCopy = emailText || "Loading...";
    await navigator.clipboard.writeText(textToCopy).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const itemCount = order.items?.length ?? 0;
  const isConfirming = step === "confirming";
  const isCreatingPos = step === "creating_pos";
  const isSendingEmail = step === "sending_email";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">

        {/* ── STEP: REVIEW ── */}
        {step === "review" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-primary" />
                Confirm Order {order.orderNumber}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer</span>
                  <span className="font-medium">{order.customerName ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium">{itemCount} line{itemCount !== 1 ? "s" : ""}</span>
                </div>
                {order.totalAmount != null && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Order Total</span>
                    <span className="font-semibold">£{Number(order.totalAmount).toFixed(2)}</span>
                  </div>
                )}
              </div>

              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="required-date">Required Date</Label>
                  <Input
                    id="required-date"
                    type="date"
                    value={requiredDate}
                    onChange={e => setRequiredDate(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="shipping-method" className="flex items-center gap-1.5">
                    <Truck className="w-4 h-4" />
                    Shipping Method <span className="text-destructive">*</span>
                  </Label>
                  <Select value={shippingMethod} onValueChange={setShippingMethod}>
                    <SelectTrigger id="shipping-method" className={!shippingMethod ? "border-destructive/50 ring-destructive/20" : ""}>
                      <SelectValue placeholder="Select shipping method…" />
                    </SelectTrigger>
                    <SelectContent>
                      {SHIPPING_OPTIONS.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!shippingMethod && (
                    <p className="text-[11px] text-destructive">A shipping method is required to confirm</p>
                  )}
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="carriage-amount">Shipping Charge</Label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-muted-foreground text-sm pointer-events-none">£</span>
                    <Input
                      id="carriage-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={carriageAmount}
                      onChange={e => setCarriageAmount(e.target.value)}
                      placeholder="0.00"
                      className="pl-7"
                    />
                  </div>
                  {shippingMethod === "courier" && (
                    <p className="text-[11px] text-muted-foreground">Default £8.50 DPD charge — override if needed</p>
                  )}
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Confirming will allocate available stock to this order and flag any shortfalls for purchasing. A production worksheet can then be created once stock is picked.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
              <Button onClick={handleConfirm} disabled={!requiredDate || !shippingMethod}>
                <Check className="w-4 h-4 mr-1.5" /> Confirm Order
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP: CONFIRMING ── */}
        {step === "confirming" && (
          <div className="flex flex-col items-center gap-4 py-10">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Confirming order and allocating stock…</p>
          </div>
        )}

        {/* ── STEP: PURCHASE ORDERS ── */}
        {(step === "purchase_orders" || step === "creating_pos") && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PackageX className="w-5 h-5 text-amber-600" />
                Create Purchase Orders
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Allocation summary */}
              <div className="flex gap-3">
                {result.allocation.allocated > 0 && (
                  <div className="flex items-center gap-1.5 rounded-md bg-green-50 border border-green-200 px-3 py-1.5 text-sm text-green-700">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{result.allocation.allocated} line{result.allocation.allocated !== 1 ? "s" : ""} allocated from stock</span>
                  </div>
                )}
                {result.allocation.purchaseRequired > 0 && (
                  <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-1.5 text-sm text-amber-700">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{result.allocation.purchaseRequired} line{result.allocation.purchaseRequired !== 1 ? "s" : ""} need ordering</span>
                  </div>
                )}
              </div>

              {/* Unlinked items warning */}
              {result.unlinkedItems > 0 && (
                <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-300 px-3 py-2.5 text-sm text-orange-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <strong>{result.unlinkedItems} line{result.unlinkedItems !== 1 ? "s" : ""}</strong> {result.unlinkedItems !== 1 ? "are" : "is"} not linked to a catalogue product — stock cannot be checked and no purchase order will be raised automatically. Check these lines manually in the Purchasing page.
                  </span>
                </div>
              )}

              {/* Garment supplier groups */}
              <div className="space-y-3">
                {result.shortfallGroups.map((group) => (
                  <div key={group.supplierName} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{group.supplierName}</span>
                      <Badge variant="outline" className="text-xs">
                        {group.items.length} line{group.items.length !== 1 ? "s" : ""}
                      </Badge>
                    </div>
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-1">
                      {group.items.map((item) => (
                        <li key={item.id} className="flex gap-1">
                          <span className="font-medium text-foreground">{item.productName}</span>
                          {(item.colour || item.size) && (
                            <span>· {[item.colour, item.size].filter(Boolean).join(" / ")}</span>
                          )}
                          <span className="ml-auto">×{item.purchaseQuantity}</span>
                        </li>
                      ))}
                    </ul>
                    {/* PO action selector */}
                    <div className="pt-1">
                      <div className="flex gap-2 flex-wrap text-sm">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name={`po-${group.supplierName}`}
                            value="new"
                            checked={poActions[group.supplierName] === "new"}
                            onChange={() => setPoActions(a => ({ ...a, [group.supplierName]: "new" }))}
                            className="accent-primary"
                          />
                          <span>Create new PO</span>
                        </label>
                        {group.existingDraftPos.map((po) => (
                          <label key={po.id} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name={`po-${group.supplierName}`}
                              value={`existing:${po.id}`}
                              checked={poActions[group.supplierName] === `existing:${po.id}`}
                              onChange={() => setPoActions(a => ({ ...a, [group.supplierName]: `existing:${po.id}` }))}
                              className="accent-primary"
                            />
                            <span>Add to <span className="font-medium">{po.poNumber}</span></span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Process stock shortfalls */}
              {(result.processShortfallGroups ?? []).length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-blue-700">
                    <Package className="w-4 h-4" />
                    Process materials to order
                  </div>
                  {result.processShortfallGroups.map((group) => (
                    <div key={group.supplierName} className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm">{group.supplierName}</span>
                        <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">
                          {group.items.length} material{group.items.length !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                      <ul className="text-xs text-muted-foreground space-y-0.5 pl-1">
                        {group.items.map((item) => (
                          <li key={item.name} className="flex gap-1">
                            <span className="font-medium text-foreground">{item.name}</span>
                            {item.sku && <span className="text-muted-foreground font-mono">({item.sku})</span>}
                            <span className="ml-auto text-blue-700 font-semibold">×{item.shortfall}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-blue-600/80 pt-0.5">Order these separately via Purchasing → Process Stock.</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("email")} disabled={isCreatingPos}>
                Skip
              </Button>
              <Button onClick={handleCreatePos} disabled={isCreatingPos} className="gap-1.5">
                {isCreatingPos ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : <><Package className="w-4 h-4" /> Create Purchase Orders</>}
              </Button>
            </DialogFooter>
          </>
        )}

        {/* ── STEP: EMAIL ── */}
        {(step === "email" || step === "sending_email") && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-blue-600" />
                Order Acknowledgement
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Unlinked items warning (shown when jumped straight to email with no shortfall groups) */}
              {result && result.unlinkedItems > 0 && result.shortfallGroups.length === 0 && (
                <div className="flex items-start gap-2 rounded-md bg-orange-50 border border-orange-300 px-3 py-2.5 text-sm text-orange-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <strong>{result.unlinkedItems} line{result.unlinkedItems !== 1 ? "s" : ""}</strong> {result.unlinkedItems !== 1 ? "are" : "is"} not linked to a catalogue product — no stock check was performed. Check the Purchasing page to raise any required orders manually.
                  </span>
                </div>
              )}

              {/* PO results summary */}
              {poResults.length > 0 && (
                <div className="rounded-md bg-green-50 border border-green-200 p-3 space-y-1 text-sm text-green-700">
                  {poResults.map((r, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      {r}
                    </div>
                  ))}
                </div>
              )}

              {/* Stripe Payment Link */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <CreditCard className="w-4 h-4 text-blue-600" />
                    Stripe Payment Link
                  </div>
                  {!paymentLinkUrl && (
                    <button
                      onClick={generatePaymentLink}
                      disabled={paymentLinkLoading}
                      className="text-xs text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                    >
                      {paymentLinkLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</> : "Regenerate"}
                    </button>
                  )}
                  {paymentLinkUrl && (
                    <button
                      onClick={generatePaymentLink}
                      disabled={paymentLinkLoading}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 flex items-center gap-1"
                      title="Generate a new payment link"
                    >
                      {paymentLinkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Regenerate"}
                    </button>
                  )}
                </div>
                {paymentLinkError && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> {paymentLinkError}
                  </p>
                )}
                {paymentLinkLoading && !paymentLinkUrl && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" /> Creating payment link…
                  </div>
                )}
                {paymentLinkUrl ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={paymentLinkUrl}
                        className="text-xs flex-1 rounded border bg-background px-2 py-1 font-mono outline-none select-all min-w-0"
                      />
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(paymentLinkUrl).catch(() => {});
                          setPaymentLinkCopied(true);
                          setTimeout(() => setPaymentLinkCopied(false), 2000);
                        }}
                        className="shrink-0 flex items-center gap-1 text-xs border rounded px-2 py-1 hover:bg-muted transition-colors"
                      >
                        {paymentLinkCopied ? <><Check className="w-3 h-3 text-green-600" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Total inc. 20% VAT — included automatically in the acknowledgement email.</p>
                  </div>
                ) : (!paymentLinkLoading && (
                  <p className="text-xs text-muted-foreground">
                    {paymentLinkError ? "Could not generate link — the email will use a generic payment link." : "Generating a payment link for this order…"}
                  </p>
                ))}
              </div>

              {emailSent ? (
                <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                  <CheckCircle2 className="w-4 h-4" />
                  Acknowledgement sent to <span className="font-medium ml-1">{emailTo}</span>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Send an order acknowledgement email to the customer.
                    {!result?.emailConfigured && " SMTP is not yet configured — you can copy the email text to send manually."}
                  </p>
                  <div className="grid gap-1.5">
                    <Label htmlFor="email-to">Customer Email</Label>
                    <Input
                      id="email-to"
                      placeholder="customer@example.com"
                      value={emailTo}
                      onChange={e => setEmailTo(e.target.value)}
                    />
                  </div>
                  {emailSubject && (
                    <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground mb-1">{emailSubject}</p>
                      <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed max-h-32 overflow-y-auto">{emailText}</pre>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter className="flex-wrap gap-2">
              <Button variant="outline" onClick={() => setStep("done")}>
                {emailSent ? "Continue" : "Skip"}
              </Button>
              {!emailSent && (
                <>
                  <Button variant="outline" onClick={handleCopyEmail} className="gap-1.5">
                    {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Email</>}
                  </Button>
                  {result?.emailConfigured && (
                    <Button onClick={handleSendEmail} disabled={isSendingEmail} className="gap-1.5">
                      {isSendingEmail ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : <><Mail className="w-4 h-4" /> Send Email</>}
                    </Button>
                  )}
                </>
              )}
              {emailSent && (
                <Button onClick={() => setStep("done")} className="gap-1.5">
                  <ChevronRight className="w-4 h-4" /> Done
                </Button>
              )}
            </DialogFooter>
          </>
        )}

        {/* ── STEP: DONE ── */}
        {step === "done" && result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-green-700">
                <CheckCircle2 className="w-5 h-5" />
                Order Confirmed
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                {order.orderNumber} has been confirmed. Here's a summary of what was done:
              </p>
              <ul className="space-y-2 text-sm">
                {result.allocation.allocated > 0 && (
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <span>{result.allocation.allocated} line{result.allocation.allocated !== 1 ? "s" : ""} allocated from stock — ready to pick and send to production</span>
                  </li>
                )}
                {poResults.map((r, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Package className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <span>{r}</span>
                  </li>
                ))}
                {result.allocation.purchaseRequired > 0 && poResults.length === 0 && (
                  <li className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <span>{result.allocation.purchaseRequired} line{result.allocation.purchaseRequired !== 1 ? "s" : ""} need purchasing — go to the Purchasing page to create POs</span>
                  </li>
                )}
                {emailSent && (
                  <li className="flex items-start gap-2">
                    <Mail className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <span>Acknowledgement email sent to {emailTo}</span>
                  </li>
                )}
                {result.stripeCharge?.success && (
                  <li className="flex items-start gap-2">
                    <CreditCard className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                    <span>
                      Payment taken from card ending <strong>{result.stripeCharge.cardLast4}</strong>
                    </span>
                  </li>
                )}
                {result.stripeCharge && !result.stripeCharge.success && (
                  <li className="flex items-start gap-2">
                    <XCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
                    <span className="text-destructive">
                      Payment failed — {result.stripeCharge.error}. Charge the card manually or contact the customer.
                    </span>
                  </li>
                )}
              </ul>
              {result.allocation.allocated > 0 && (
                <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-sm text-blue-700">
                  <strong>Next step:</strong> Once the stock is picked, click <em>Send to Production</em> on the order to create a production worksheet.
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => handleClose(false)}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
