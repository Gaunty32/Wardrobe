import { useState, useMemo, useEffect } from "react";
import Layout from "@/components/Layout";
import { Link, useLocation } from "wouter";
import {
  useListOrders,
  useCreateOrder,
  useListCustomers,
  getListOrdersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate, toTitleCase } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Plus, ShoppingCart, Loader2, ArrowRight, ChevronsUpDown, Check, Globe, CheckCircle2, XCircle, Search, AlertTriangle, FileText, Pencil, Paperclip, StickyNote, GitMerge, ChevronUp, ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

import { cn } from "@/lib/utils";
const API_BASE = "/api";
async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers: { "Content-Type": "application/json", ...opts?.headers } });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null;
  return res.json();
}

function DueDateCell({ requiredDate }: { requiredDate: string | null | undefined }) {
  if (!requiredDate) return <span className="text-muted-foreground text-xs">—</span>;
  const date = new Date(requiredDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(date); due.setHours(0, 0, 0, 0);
  const overdue = due < today;
  const dueToday = due.getTime() === today.getTime();
  const formatted = date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  if (overdue) return (
    <span className="flex items-center gap-1 text-red-600 font-semibold text-sm">
      <AlertTriangle className="w-3.5 h-3.5" />{formatted}
    </span>
  );
  if (dueToday) return (
    <span className="flex items-center gap-1 text-amber-600 font-semibold text-sm">
      <AlertTriangle className="w-3.5 h-3.5" />{formatted}
    </span>
  );
  return <span className="text-sm font-medium">{formatted}</span>;
}

function QuoteHoldingPanel() {
  const [, setLocation] = useLocation();

  const { data: quotes = [], isLoading } = useQuery<any[]>({
    queryKey: ["quote-orders"],
    queryFn: () => apiFetch("/orders?status=quote"),
    refetchInterval: 15_000,
  });

  if (isLoading || !quotes.length) return null;

  return (
    <Card className="border-violet-200 bg-violet-50/50 shadow-sm">
      <CardHeader className="py-3 px-5 border-b border-violet-200/60 flex flex-row items-center gap-2">
        <FileText className="w-4 h-4 text-violet-600" />
        <span className="font-semibold text-violet-800 text-sm">Quotes &amp; Awaiting Payment</span>
        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-violet-600 text-white text-xs font-bold">{quotes.length}</span>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Order #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotes.map((o: any) => (
              <TableRow key={o.id} className="hover:bg-violet-50/80 cursor-pointer" onClick={() => setLocation(`/orders/${o.id}`)}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-violet-700">{o.orderNumber}</span>
                    {o.notes && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <StickyNote className="w-3 h-3 text-amber-400 shrink-0 cursor-default" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs whitespace-pre-wrap text-xs">
                            {o.notes}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {o.attachments?.length > 0 && <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" title="Has attachments" />}
                  </div>
                </TableCell>
                <TableCell className="font-medium">{toTitleCase(o.customerName ?? "")}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{o.requiredDate ? formatDate(o.requiredDate) : <span className="italic text-muted-foreground/50">—</span>}</TableCell>
                <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(o.totalAmount ?? "0"))}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-violet-700 hover:bg-violet-100" onClick={e => { e.stopPropagation(); setLocation(`/orders/${o.id}`); }}>
                    View <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PoPendingInline({ orderId, current, onSaved }: { orderId: number; current: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? "");
  const { toast } = useToast();

  useEffect(() => { setValue(current ?? ""); }, [current]);

  const save = async () => {
    setEditing(false);
    if (value === (current ?? "")) return;
    try {
      await apiFetch(`/orders/${orderId}`, { method: "PATCH", body: JSON.stringify({ poNumber: value || null }) });
      onSaved();
    } catch {
      toast({ title: "Could not save PO number", variant: "destructive" });
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="text-xs border rounded px-1.5 py-0.5 font-mono w-32 outline-none focus:ring-1 focus:ring-primary/40"
        placeholder="e.g. PO-2026-001"
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  return (
    <button
      className="flex items-center gap-1 group"
      onClick={e => { e.stopPropagation(); setEditing(true); }}
      title="Click to edit PO number"
    >
      {current
        ? <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">{current}</span>
        : <span className="text-xs text-muted-foreground/40 group-hover:text-muted-foreground transition-colors italic">Add PO#</span>
      }
      <Pencil className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0" />
    </button>
  );
}

function PortalPendingOrders() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: pending = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-pending-orders"],
    queryFn: () => apiFetch("/portal/admin/pending-orders"),
    refetchInterval: 15_000,
  });

  const [confirmingAll, setConfirmingAll] = useState(false);
  const [mergingIds, setMergingIds] = useState<Set<string>>(new Set());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["portal-pending-orders"] });
    qc.invalidateQueries({ queryKey: getListOrdersQueryKey() });
  };

  const confirm = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/admin/orders/${id}/confirm`, { method: "POST" }),
    onSuccess: () => { invalidate(); toast({ title: "Order confirmed", description: "Moved to draft orders." }); },
  });

  const reject = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/admin/orders/${id}/reject`, { method: "POST", body: JSON.stringify({ reason: "" }) }),
    onSuccess: () => { invalidate(); toast({ title: "Order rejected", description: "The portal order has been declined." }); },
  });

  async function confirmAll() {
    setConfirmingAll(true);
    try {
      await Promise.all(pending.map((o: any) => apiFetch(`/portal/admin/orders/${o.id}/confirm`, { method: "POST" })));
      invalidate();
      toast({ title: `${pending.length} orders confirmed`, description: "All portal orders moved to draft." });
    } catch {
      toast({ title: "Error", description: "Some orders could not be confirmed.", variant: "destructive" });
    } finally {
      setConfirmingAll(false);
    }
  }

  async function mergeGroup(orderIds: number[], groupKey: string) {
    setMergingIds(s => new Set([...s, groupKey]));
    try {
      const result: any = await apiFetch("/portal/admin/orders/merge", { method: "POST", body: JSON.stringify({ orderIds }) });
      invalidate();
      toast({ title: "Orders merged", description: `${orderIds.length} orders combined into one.` });
      if (result?.primary?.id) setLocation(`/orders/${result.primary.id}`);
    } catch (e: any) {
      toast({ title: "Could not merge", description: e.message, variant: "destructive" });
    } finally {
      setMergingIds(s => { const n = new Set(s); n.delete(groupKey); return n; });
    }
  }

  // Group orders: those with a PO# shared by multiple orders are grouped, rest are ungrouped
  const { groups, ungrouped } = useMemo(() => {
    const poMap = new Map<string, any[]>();
    for (const o of pending) {
      if (o.po_number) {
        const key = `${o.customer_id}::${o.po_number}`;
        if (!poMap.has(key)) poMap.set(key, []);
        poMap.get(key)!.push(o);
      }
    }
    const groups: Array<{ key: string; po: string; customer: string; orders: any[] }> = [];
    for (const [key, orders] of poMap.entries()) {
      if (orders.length > 1) {
        groups.push({ key, po: orders[0].po_number, customer: orders[0].customer_name, orders });
      }
    }
    const groupedIds = new Set(groups.flatMap(g => g.orders.map((o: any) => o.id)));
    const ungrouped = pending.filter((o: any) => !groupedIds.has(o.id));
    return { groups, ungrouped };
  }, [pending]);

  if (isLoading || !pending.length) return null;

  const renderRow = (o: any, inGroup = false) => (
    <TableRow
      key={o.id}
      className={cn("cursor-pointer", inGroup ? "hover:bg-blue-50/60" : "hover:bg-amber-50/80")}
      onClick={() => setLocation(`/orders/${o.id}`)}
    >
      <TableCell>
        <span className={cn("font-semibold", inGroup ? "text-blue-700" : "text-amber-700")}>{o.order_number}</span>
      </TableCell>
      <TableCell className="font-medium">{toTitleCase(o.customer_name)}</TableCell>
      <TableCell className="text-muted-foreground text-sm">{formatDate(o.order_date)}</TableCell>
      <TableCell onClick={e => e.stopPropagation()}>
        <PoPendingInline
          orderId={o.id}
          current={o.po_number ?? null}
          onSaved={() => qc.invalidateQueries({ queryKey: ["portal-pending-orders"] })}
        />
      </TableCell>
      <TableCell className="text-right text-sm">{o.item_count}</TableCell>
      <TableCell className="text-right font-semibold">{formatCurrency(parseFloat(o.total_amount ?? "0"))}</TableCell>
      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600 border-red-200 hover:bg-red-50" disabled={reject.isPending} onClick={() => reject.mutate(o.id)}>
            <XCircle className="w-3.5 h-3.5" />Reject
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1 bg-green-600 hover:bg-green-700 text-white" disabled={confirm.isPending} onClick={() => confirm.mutate(o.id)}>
            <CheckCircle2 className="w-3.5 h-3.5" />Confirm
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <Card className="border-amber-200 bg-amber-50/50 shadow-sm">
      <CardHeader className="py-3 px-5 border-b border-amber-200/60 flex flex-row items-center gap-2">
        <Globe className="w-4 h-4 text-amber-600" />
        <span className="font-semibold text-amber-800 text-sm">Portal Orders Awaiting Review</span>
        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-amber-600 text-white text-xs font-bold">{pending.length}</span>
        <div className="ml-auto">
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700 text-white"
            disabled={confirmingAll || confirm.isPending}
            onClick={confirmAll}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {confirmingAll ? "Confirming…" : `Confirm All (${pending.length})`}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-border">

        {/* Grouped orders sharing the same PO# */}
        {groups.map(g => {
          const isMerging = mergingIds.has(g.key);
          const totalItems = g.orders.reduce((s: number, o: any) => s + Number(o.item_count ?? 0), 0);
          const totalValue = g.orders.reduce((s: number, o: any) => s + parseFloat(o.total_amount ?? "0"), 0);
          return (
            <div key={g.key} className="bg-blue-50/40 border-l-4 border-blue-400">
              {/* Group header bar */}
              <div className="flex items-center gap-3 px-4 py-2 bg-blue-100/60 border-b border-blue-200/60">
                <GitMerge className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="text-xs font-semibold text-blue-800">
                  {g.orders.length} orders share PO# <span className="font-mono">{g.po}</span> — {totalItems} items, {formatCurrency(totalValue)} total
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-6 text-xs gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 bg-white"
                  disabled={isMerging}
                  onClick={() => mergeGroup(g.orders.map((o: any) => o.id), g.key)}
                >
                  {isMerging ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
                  {isMerging ? "Merging…" : "Merge into one order"}
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Order #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>PO #</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.orders.map((o: any) => renderRow(o, true))}
                </TableBody>
              </Table>
            </div>
          );
        })}

        {/* Ungrouped orders (no shared PO#) */}
        {ungrouped.length > 0 && (
          <Table>
            {groups.length === 0 && (
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>PO #</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
            )}
            <TableBody>
              {ungrouped.map((o: any) => renderRow(o, false))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConfirmedMergeableBanner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mergingIds, setMergingIds] = useState<Set<string>>(new Set());
  const [, setLocation] = useLocation();

  const { data: confirmedOrders = [] } = useListOrders({ status: "confirmed" }, { query: { refetchInterval: 15_000 } });

  const groups = useMemo(() => {
    const poMap = new Map<string, any[]>();
    for (const o of confirmedOrders) {
      const po = (o as any).poNumber;
      const cid = (o as any).customerId;
      if (po && cid) {
        const key = `${cid}::${po}`;
        if (!poMap.has(key)) poMap.set(key, []);
        poMap.get(key)!.push(o);
      }
    }
    const result: Array<{ key: string; po: string; customer: string; orders: any[] }> = [];
    for (const [key, orders] of poMap.entries()) {
      if (orders.length > 1) {
        result.push({ key, po: orders[0].poNumber, customer: orders[0].customerName, orders });
      }
    }
    return result;
  }, [confirmedOrders]);

  if (groups.length === 0) return null;

  async function mergeGroup(orderIds: number[], groupKey: string) {
    setMergingIds(s => new Set([...s, groupKey]));
    try {
      const result: any = await apiFetch("/portal/admin/orders/merge", { method: "POST", body: JSON.stringify({ orderIds }) });
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      toast({ title: "Orders merged", description: `${orderIds.length} confirmed orders combined into one.` });
      if (result?.primary?.id) setLocation(`/orders/${result.primary.id}`);
    } catch (e: any) {
      toast({ title: "Could not merge", description: e.message, variant: "destructive" });
    } finally {
      setMergingIds(s => { const n = new Set(s); n.delete(groupKey); return n; });
    }
  }

  return (
    <Card className="border-blue-200 bg-blue-50/40 shadow-sm">
      <CardHeader className="py-3 px-5 border-b border-blue-200/60 flex flex-row items-center gap-2">
        <GitMerge className="w-4 h-4 text-blue-600" />
        <span className="font-semibold text-blue-800 text-sm">Confirmed Orders — Mergeable by PO Number</span>
        <span className="ml-1 inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-blue-600 text-white text-xs font-bold">
          {groups.length}
        </span>
      </CardHeader>
      <CardContent className="p-0 divide-y divide-blue-100">
        {groups.map(g => {
          const isMerging = mergingIds.has(g.key);
          const totalValue = g.orders.reduce((s: number, o: any) => s + (o.totalAmount ?? 0), 0);
          return (
            <div key={g.key} className="px-5 py-3 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <GitMerge className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span className="text-sm font-medium text-blue-900">
                  {toTitleCase(g.customer)}
                </span>
                <span className="text-xs text-blue-600 font-mono bg-blue-100 px-1.5 py-0.5 rounded">
                  PO# {g.po}
                </span>
                <span className="text-xs text-blue-700">
                  {g.orders.length} orders · {formatCurrency(totalValue)}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                <div className="flex gap-1.5 flex-wrap">
                  {g.orders.map((o: any) => (
                    <button
                      key={o.id}
                      className="text-xs font-mono text-blue-700 hover:text-blue-900 hover:underline"
                      onClick={() => setLocation(`/orders/${o.id}`)}
                    >
                      {o.orderNumber}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100 bg-white shrink-0"
                  disabled={isMerging}
                  onClick={() => mergeGroup(g.orders.map((o: any) => o.id), g.key)}
                >
                  {isMerging ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitMerge className="w-3 h-3" />}
                  {isMerging ? "Merging…" : "Merge into one order"}
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default function Orders() {
  const [, setLocation] = useLocation();
  type SortKey = "orderNumber" | "requiredDate" | "orderDate" | "customerName" | "poNumber" | "status" | "totalAmount";
  type SortDir = "asc" | "desc";

  function SortableHead({ label, sortKey: key, current, dir, onSort, className }: {
    label: string; sortKey: SortKey; current: SortKey; dir: SortDir;
    onSort: (k: SortKey) => void; className?: string;
  }) {
    const active = current === key;
    return (
      <TableHead
        className={cn("cursor-pointer select-none whitespace-nowrap group", className)}
        onClick={() => onSort(key)}
      >
        <span className="inline-flex items-center gap-1">
          {label}
          <span className={cn("transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-40")}>
            {active && dir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </span>
      </TableHead>
    );
  }

  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("orderDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customerComboOpen, setCustomerComboOpen] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: allOrders = [], isLoading } = useListOrders(
    { status: statusFilter === "all" ? undefined : statusFilter },
    { query: { refetchInterval: 15_000 } },
  );
  const { data: customers = [] } = useListCustomers();
  const createMutation = useCreateOrder();

  const selectedCustomer = customers.find(c => c.id.toString() === selectedCustomerId);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir(key === "orderNumber" ? "desc" : "asc"); }
  };

  const orders = useMemo(() => {
    const filtered = (() => {
      if (!customerSearch.trim()) return allOrders;
      const q = customerSearch.toLowerCase();
      return allOrders.filter(o =>
        (o.customerName ?? "").toLowerCase().includes(q) ||
        o.orderNumber.toLowerCase().includes(q)
      );
    })();

    const toMs = (v: unknown) => v ? new Date(v as string).getTime() : null;

    return [...filtered].sort((a, b) => {
      // For date columns, keep nulls at the bottom regardless of sort direction
      const dateSort = (av: unknown, bv: unknown) => {
        const at = toMs(av), bt = toMs(bv);
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return sortDir === "asc" ? at - bt : bt - at;
      };

      switch (sortKey) {
        case "orderNumber": {
          const n = (o: typeof a) => parseInt((o.orderNumber ?? "").replace(/[^0-9]/g, "") || "0", 10);
          return sortDir === "asc" ? n(a) - n(b) : n(b) - n(a);
        }
        case "requiredDate":
          return dateSort((a as any).requiredDate, (b as any).requiredDate);
        case "orderDate":
          return dateSort(a.orderDate, b.orderDate);
        case "customerName": {
          const cmp = (a.customerName ?? "").localeCompare(b.customerName ?? "");
          return sortDir === "asc" ? cmp : -cmp;
        }
        case "poNumber": {
          const cmp = ((a as any).poNumber ?? "").localeCompare((b as any).poNumber ?? "");
          return sortDir === "asc" ? cmp : -cmp;
        }
        case "status": {
          const cmp = (a.status ?? "").localeCompare(b.status ?? "");
          return sortDir === "asc" ? cmp : -cmp;
        }
        case "totalAmount":
          return sortDir === "asc" ? (a.totalAmount ?? 0) - (b.totalAmount ?? 0) : (b.totalAmount ?? 0) - (a.totalAmount ?? 0);
        default:
          return 0;
      }
    });
  }, [allOrders, customerSearch, sortKey, sortDir]);

  const totalValue = useMemo(() => orders.reduce((s, o) => s + (o.totalAmount ?? 0), 0), [orders]);

  const handleCreateOrder = () => {
    if (!selectedCustomerId) {
      toast({ title: "Please select a customer", variant: "destructive" });
      return;
    }
    createMutation.mutate(
      { data: { customerId: parseInt(selectedCustomerId, 10), orderDate: new Date().toISOString() } },
      {
        onSuccess: (newOrder) => {
          queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
          toast({ title: "Order created", description: `Taking you to ${newOrder.orderNumber}…` });
          setLocation(`/orders/${newOrder.id}`);
        },
        onError: (err: any) => {
          toast({ title: "Failed to create order", description: err?.message ?? "Unknown error", variant: "destructive" });
        }
      }
    );
  };

  const openCreate = () => {
    setSelectedCustomerId("");
    setCustomerComboOpen(false);
    setIsCreateOpen(true);
  };

  return (
    <Layout>
      <div className="flex flex-col space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Sales Orders</h1>
            <p className="text-muted-foreground mt-1">Manage and track customer orders.</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-muted-foreground/70">GP%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-green-50 text-green-700 font-medium">&#9679; &gt;65%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">&#9679; &gt;50%</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-50 text-red-600 font-medium">&#9679; &lt;50%</span>
            </div>
            <Button onClick={openCreate} className="shadow-lg shadow-primary/20 transition-all hover:shadow-primary/30">
              <Plus className="w-4 h-4 mr-2" /> New Order
            </Button>
          </div>
        </div>

        <QuoteHoldingPanel />
        <PortalPendingOrders />
        <ConfirmedMergeableBanner />

        <Card className="shadow-sm border-border/50">
          <CardHeader className="py-3 border-b border-border/40 bg-muted/10 flex flex-row items-center gap-3 flex-wrap">
            <div className="w-full max-w-[180px]">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Filter by status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active orders</SelectItem>
                  <SelectItem value="all">All (inc. completed)</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="quote">Quote</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="shipped">Shipped</SelectItem>
                  <SelectItem value="delivered">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search customer or order…"
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                className="pl-8 bg-background h-9"
              />
            </div>
            {customerSearch && (
              <span className="text-xs text-muted-foreground">{orders.length} result{orders.length !== 1 ? "s" : ""}</span>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
            ) : orders.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <SortableHead label="Order #"    sortKey="orderNumber"  current={sortKey} dir={sortDir} onSort={handleSort} className="w-[90px]" />
                        <SortableHead label="Due Date"   sortKey="requiredDate" current={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Order Date" sortKey="orderDate"    current={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Customer"   sortKey="customerName" current={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="PO Number"  sortKey="poNumber"     current={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Status"     sortKey="status"       current={sortKey} dir={sortDir} onSort={handleSort} />
                        <SortableHead label="Total"      sortKey="totalAmount"  current={sortKey} dir={sortDir} onSort={handleSort} className="text-right" />
                        <TableHead className="w-[80px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => {
                        const isPortalPending = order.status === "portal_pending";
                        return (
                        <TableRow
                          key={order.id}
                          className={cn(
                            "group cursor-pointer",
                            isPortalPending
                              ? "bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400"
                              : "hover:bg-muted/30"
                          )}
                          onClick={() => setLocation(`/orders/${order.id}`)}
                        >
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {isPortalPending && <Globe className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                              <span className={cn("font-bold text-base tracking-wide", isPortalPending ? "text-amber-700" : "text-primary")}>{order.orderNumber}</span>
                              {(order as any).notes && (
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <StickyNote className="w-3 h-3 text-amber-400 shrink-0 cursor-default" />
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-xs whitespace-pre-wrap text-xs">
                                      {(order as any).notes}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {(order as any).attachments?.length > 0 && (
                                <Paperclip className="w-3 h-3 text-muted-foreground shrink-0" title="Has attachments" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <DueDateCell requiredDate={(order as any).requiredDate} />
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">{formatDate(order.orderDate)}</TableCell>
                          <TableCell className="font-medium text-foreground">{toTitleCase(order.customerName) || 'Unknown'}</TableCell>
                          <TableCell className="text-sm font-mono text-muted-foreground">{(order as any).poNumber ?? <span className="italic text-muted-foreground/50">—</span>}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <span className="font-semibold text-foreground">{formatCurrency(order.totalAmount)}</span>
                              {(order as any).gpMargin != null && (
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                                  (order as any).gpMargin > 65 ? "bg-green-50 text-green-700" :
                                  (order as any).gpMargin > 50 ? "bg-amber-50 text-amber-700" :
                                  "bg-red-50 text-red-600"
                                }`}>
                                  {((order as any).gpMargin as number).toFixed(0)}%
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell onClick={e => e.stopPropagation()}>
                            <Link href={`/orders/${order.id}`}>
                              <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                                View <ArrowRight className="w-4 h-4 ml-1" />
                              </Button>
                            </Link>
                          </TableCell>
                        </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Total row */}
                <div className="flex items-center justify-between px-4 py-3 border-t border-border/60 bg-muted/20">
                  <span className="text-sm text-muted-foreground">
                    {orders.length} order{orders.length !== 1 ? "s" : ""}
                    {customerSearch ? " (filtered)" : ""}
                  </span>
                  <span className="font-bold text-foreground text-base">
                    {formatCurrency(totalValue)}
                  </span>
                </div>
              </>
            ) : (
              <div className="py-16 text-center text-muted-foreground">
                <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground/40" />
                <h3 className="text-lg font-medium text-foreground">No orders found</h3>
                <p className="mt-1">
                  {customerSearch ? `No orders matching "${customerSearch}".` : "There are no orders matching your criteria."}
                </p>
                {!customerSearch && <Button onClick={openCreate} variant="outline" className="mt-6">Create First Order</Button>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Create Order Dialog ── */}
        <Dialog open={isCreateOpen} onOpenChange={v => { if (!v) setIsCreateOpen(false); }}>
          <DialogContent className="sm:max-w-[440px]">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">New Sales Order</DialogTitle>
              <DialogDescription>
                Select a customer to start a draft order. You'll add products on the next screen.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <Label>Customer</Label>
              <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={customerComboOpen}
                    className="w-full justify-between font-normal h-10"
                  >
                    {selectedCustomer ? toTitleCase(selectedCustomer.name) : "Search customers…"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Type to search…" />
                    <CommandList>
                      <CommandEmpty>No customers found.</CommandEmpty>
                      <CommandGroup>
                        {customers.map(c => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => {
                              setSelectedCustomerId(c.id.toString());
                              setCustomerComboOpen(false);
                            }}
                          >
                            <Check className={cn("mr-2 h-4 w-4", selectedCustomerId === c.id.toString() ? "opacity-100" : "opacity-0")} />
                            <div>
                              <p className="font-medium">{toTitleCase(c.name)}</p>
                              {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
              <Button onClick={handleCreateOrder} disabled={createMutation.isPending || !selectedCustomerId}>
                {createMutation.isPending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating…</>
                  : "Create & Continue"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Layout>
  );
}
