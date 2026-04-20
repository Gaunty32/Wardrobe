import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  FileText, Mail, BookOpen, Loader2, ExternalLink, CheckCircle2,
  Truck, Clock, ArrowRight, AlertTriangle, Package,
} from "lucide-react";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface InvoiceOrder {
  id: number;
  orderNumber: string;
  customerName: string | null;
  customerId: number | null;
  totalAmount: string;
  status: string;
  dispatchedAt: string | null;
  trackingNumber: string | null;
  invoiceEmailSentAt: string | null;
  invoiceEmailSentTo: string | null;
  xeroInvoiceId: string | null;
  xeroInvoiceStatus: string | null;
}

interface InvoicesData {
  toSend: InvoiceOrder[];
  toPost: InvoiceOrder[];
  done: InvoiceOrder[];
}

interface EmailStatus {
  configured: boolean;
  host: string | null;
  fromEmail: string | null;
}

function parseApiError(e: Error): string {
  try {
    const obj = JSON.parse(e.message);
    return obj.error ?? e.message;
  } catch {
    return e.message;
  }
}

function DPDLink({ tracking }: { tracking: string }) {
  return (
    <a
      href={`https://track.dpd.co.uk/parcels/${tracking}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs font-mono"
    >
      {tracking} <ExternalLink className="w-3 h-3" />
    </a>
  );
}

function TrackingCell({ order, onSaved }: { order: InvoiceOrder; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.trackingNumber ?? "");
  const { toast } = useToast();
  const qc = useQueryClient();

  const save = useMutation({
    mutationFn: (tn: string | null) =>
      apiFetch(`/invoices/${order.id}/tracking`, { method: "PATCH", body: JSON.stringify({ trackingNumber: tn || null }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setEditing(false);
      onSaved();
    },
    onError: (e: Error) => toast({ title: "Error", description: parseApiError(e), variant: "destructive" }),
  });

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 15006678987456"
          className="h-7 text-xs w-40 font-mono"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save.mutate(value);
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <Button size="sm" className="h-7 px-2 text-xs" onClick={() => save.mutate(value)} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    );
  }

  return order.trackingNumber ? (
    <div className="flex items-center gap-2">
      <DPDLink tracking={order.trackingNumber} />
      <button onClick={() => { setValue(order.trackingNumber ?? ""); setEditing(true); }} className="text-muted-foreground hover:text-foreground text-xs underline">edit</button>
    </div>
  ) : (
    <button onClick={() => setEditing(true)} className="text-xs text-muted-foreground hover:text-foreground underline flex items-center gap-1">
      <Truck className="w-3 h-3" /> Add tracking
    </button>
  );
}

function OrderRow({
  order,
  showSendEmail,
  showPostXero,
}: {
  order: InvoiceOrder;
  showSendEmail?: boolean;
  showPostXero?: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sendEmail = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; sentTo: string; xeroInvoiceId?: string }>(`/invoices/${order.id}/send-email`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setConfirmOpen(false);
      const xeroMsg = res.xeroInvoiceId ? " Also posted to Xero." : "";
      toast({ title: "Invoice sent", description: `Emailed to ${res.sentTo}.${xeroMsg}` });
    },
    onError: (e: Error) => toast({ title: "Failed to send", description: parseApiError(e), variant: "destructive" }),
  });

  const postXero = useMutation({
    mutationFn: () => apiFetch(`/invoices/${order.id}/post-xero`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast({ title: "Posted to Xero", description: `Invoice for ${order.orderNumber} posted.` });
    },
    onError: (e: Error) => toast({ title: "Xero error", description: parseApiError(e), variant: "destructive" }),
  });

  const subtotal = parseFloat(order.totalAmount);
  const total = subtotal * 1.2;

  return (
    <>
      <TableRow>
        <TableCell>
          <Link href={`/orders/${order.id}`} className="font-medium text-primary hover:underline">
            {order.orderNumber}
          </Link>
        </TableCell>
        <TableCell className="text-sm">{order.customerName ?? "—"}</TableCell>
        <TableCell className="text-sm text-right font-medium">
          <div>{formatCurrency(total)}</div>
          <div className="text-xs text-muted-foreground">ex VAT {formatCurrency(subtotal)}</div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {order.dispatchedAt ? formatDate(order.dispatchedAt) : "—"}
        </TableCell>
        <TableCell>
          <TrackingCell order={order} onSaved={() => {}} />
        </TableCell>
        <TableCell>
          {order.invoiceEmailSentAt ? (
            <div className="text-xs">
              <div className="flex items-center gap-1 text-green-700 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" /> Sent
              </div>
              <div className="text-muted-foreground">{order.invoiceEmailSentTo}</div>
              <div className="text-muted-foreground">{formatDate(order.invoiceEmailSentAt)}</div>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" /> Not sent
            </span>
          )}
        </TableCell>
        <TableCell>
          {order.xeroInvoiceId ? (
            <Badge className="bg-indigo-100 text-indigo-800 border-indigo-300 text-xs gap-1">
              <BookOpen className="w-3 h-3" /> {order.xeroInvoiceStatus ?? "DRAFT"}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-2">
            {showSendEmail && (
              <Button
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setConfirmOpen(true)}
                disabled={sendEmail.isPending}
              >
                {sendEmail.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                Send Invoice
              </Button>
            )}
            {showPostXero && !order.xeroInvoiceId && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1 text-xs border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                onClick={() => postXero.mutate()}
                disabled={postXero.isPending}
              >
                {postXero.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                Post to Xero
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Confirm send dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Send Invoice — {order.orderNumber}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>This will email the invoice PDF to the customer and automatically post it to Xero as a draft invoice.</p>
            <div className="rounded-lg bg-muted/50 border border-border p-3 space-y-1.5">
              <div><span className="text-muted-foreground">Customer:</span> <strong>{order.customerName}</strong></div>
              <div><span className="text-muted-foreground">Amount:</span> <strong>{formatCurrency(total)} inc. VAT</strong></div>
              {order.trackingNumber && (
                <div><span className="text-muted-foreground">DPD tracking:</span> <strong className="font-mono">{order.trackingNumber}</strong></div>
              )}
              {!order.trackingNumber && (
                <div className="flex items-center gap-1.5 text-amber-700 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  No tracking number — add one for better customer experience
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button onClick={() => sendEmail.mutate()} disabled={sendEmail.isPending} className="gap-2">
              {sendEmail.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</> : <><Mail className="w-4 h-4" />Send Invoice</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const COLS = (
  <TableRow className="bg-muted/40">
    <TableHead className="text-xs">Order</TableHead>
    <TableHead className="text-xs">Customer</TableHead>
    <TableHead className="text-xs text-right">Amount</TableHead>
    <TableHead className="text-xs">Dispatched</TableHead>
    <TableHead className="text-xs">DPD Tracking</TableHead>
    <TableHead className="text-xs">Email</TableHead>
    <TableHead className="text-xs">Xero</TableHead>
    <TableHead className="text-xs">Actions</TableHead>
  </TableRow>
);

export default function Invoices() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<InvoicesData>({
    queryKey: ["invoices"],
    queryFn: () => apiFetch("/invoices"),
    refetchInterval: 30_000,
  });

  const { data: emailStatus } = useQuery<EmailStatus>({
    queryKey: ["email-status"],
    queryFn: () => apiFetch("/settings/email/status"),
    staleTime: 60_000,
  });

  const toSend = data?.toSend ?? [];
  const toPost = data?.toPost ?? [];
  const done = data?.done ?? [];

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-7 h-7 text-primary" /> Invoicing
            </h1>
            <p className="text-muted-foreground mt-1">
              Send invoices to customers and post them to Xero.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {emailStatus && (
              <Badge className={emailStatus.configured
                ? "bg-green-100 text-green-800 border-green-300 gap-1.5"
                : "bg-amber-100 text-amber-800 border-amber-300 gap-1.5"
              }>
                <Mail className="w-3 h-3" />
                {emailStatus.configured ? `Email: ${emailStatus.fromEmail}` : "Email not configured"}
              </Badge>
            )}
            <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs">
              <a href="/settings">Configure email →</a>
            </Button>
          </div>
        </div>

        {/* SMTP warning */}
        {emailStatus && !emailStatus.configured && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <strong>Email not configured.</strong> Go to{" "}
              <a href="/settings" className="underline font-medium">Settings → Email</a>{" "}
              to set up your Microsoft 365 SMTP credentials before sending invoices.
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "To Send", count: toSend.length, color: "bg-blue-50 border-blue-200 text-blue-800", icon: <Mail className="w-5 h-5 text-blue-500" /> },
            { label: "To Post to Xero", count: toPost.length, color: "bg-indigo-50 border-indigo-200 text-indigo-800", icon: <BookOpen className="w-5 h-5 text-indigo-500" /> },
            { label: "Complete", count: done.length, color: "bg-green-50 border-green-200 text-green-800", icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl border p-4 flex items-center gap-3 ${s.color}`}>
              {s.icon}
              <div>
                <div className="text-2xl font-bold">{s.count}</div>
                <div className="text-xs font-medium">{s.label}</div>
              </div>
            </div>
          ))}
        </div>

        <Tabs defaultValue="to-send">
          <TabsList>
            <TabsTrigger value="to-send" className="gap-2">
              <Mail className="w-4 h-4" /> To Send
              {toSend.length > 0 && (
                <Badge className="ml-1 bg-blue-500 text-white text-xs px-1.5 py-0 h-5">{toSend.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="to-post" className="gap-2">
              <BookOpen className="w-4 h-4" /> To Post to Xero
              {toPost.length > 0 && (
                <Badge className="ml-1 bg-indigo-500 text-white text-xs px-1.5 py-0 h-5">{toPost.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="done" className="gap-2">
              <CheckCircle2 className="w-4 h-4" /> Complete
            </TabsTrigger>
          </TabsList>

          {/* To Send */}
          <TabsContent value="to-send" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : toSend.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">All invoices have been sent</p>
                <p className="text-sm mt-1">Dispatched orders will appear here waiting to be invoiced.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{COLS}</TableHeader>
                  <TableBody>
                    {toSend.map((order) => (
                      <OrderRow key={order.id} order={order} showSendEmail />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* To Post */}
          <TabsContent value="to-post" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : toPost.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Nothing waiting for Xero</p>
                <p className="text-sm mt-1">Invoices emailed but not yet posted to Xero will appear here.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{COLS}</TableHeader>
                  <TableBody>
                    {toPost.map((order) => (
                      <OrderRow key={order.id} order={order} showPostXero />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* Done */}
          <TabsContent value="done" className="mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </div>
            ) : done.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No completed invoices yet</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>{COLS}</TableHeader>
                  <TableBody>
                    {done.map((order) => (
                      <OrderRow key={order.id} order={order} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
