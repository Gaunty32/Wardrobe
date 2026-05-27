import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import {
  FileText, Plus, Search, Loader2, Trash2, Eye, ChevronRight,
  Clock, Send, CheckCircle2, ShoppingCart, X,
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

interface Quote {
  id: number;
  quoteNumber: string;
  customerId: number | null;
  customerName: string;
  status: "draft" | "sent" | "viewed" | "ordered" | "expired";
  notes: string | null;
  expiresAt: string | null;
  token: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  totalExVat: string;
}

interface Customer {
  id: number;
  name: string;
}

const STATUS_CONFIG: Record<Quote["status"], { label: string; color: string; icon: React.ElementType }> = {
  draft:   { label: "Draft",   color: "bg-slate-100 text-slate-700 border-slate-300",   icon: Clock },
  sent:    { label: "Sent",    color: "bg-blue-100 text-blue-700 border-blue-300",      icon: Send },
  viewed:  { label: "Viewed",  color: "bg-amber-100 text-amber-700 border-amber-300",   icon: Eye },
  ordered: { label: "Ordered", color: "bg-green-100 text-green-700 border-green-300",   icon: CheckCircle2 },
  expired: { label: "Expired", color: "bg-red-100 text-red-700 border-red-300",         icon: X },
};

function StatusBadge({ status }: { status: Quote["status"] }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;
  const Icon = cfg.icon;
  return (
    <Badge className={`${cfg.color} gap-1 text-xs font-medium`}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </Badge>
  );
}

export default function Quotes() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerId, setNewCustomerId] = useState<number | null>(null);
  const [newNotes, setNewNotes] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  const { data: quotes = [], isLoading } = useQuery<Quote[]>({
    queryKey: ["quotes"],
    queryFn: () => apiFetch("/quotes"),
    refetchInterval: 30_000,
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["customers-list"],
    queryFn: () => apiFetch("/customers"),
    staleTime: 60_000,
  });

  const createQuote = useMutation({
    mutationFn: () => apiFetch<{ id: number }>("/quotes", {
      method: "POST",
      body: JSON.stringify({ customerName: newCustomerName, customerId: newCustomerId, notes: newNotes || null }),
    }),
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      setNewOpen(false);
      setNewCustomerName("");
      setNewCustomerId(null);
      setNewNotes("");
      setLocation(`/quotes/${q.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteQuote = useMutation({
    mutationFn: (id: number) => apiFetch(`/quotes/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["quotes"] }); toast({ title: "Quote deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = quotes.filter((q) => {
    const s = search.toLowerCase();
    return !s || q.quoteNumber.toLowerCase().includes(s) || q.customerName.toLowerCase().includes(s);
  });

  const filteredCustomers = customers.filter((c) =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const statusCounts = quotes.reduce((acc, q) => {
    acc[q.status] = (acc[q.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FileText className="w-7 h-7 text-primary" /> Quotes
            </h1>
            <p className="text-muted-foreground mt-1">Build and send quotes that customers can review and order directly.</p>
          </div>
          <Button onClick={() => setNewOpen(true)} className="gap-2">
            <Plus className="w-4 h-4" /> New Quote
          </Button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {(["draft", "sent", "viewed", "ordered"] as const).map((s) => {
            const cfg = STATUS_CONFIG[s];
            const Icon = cfg.icon;
            return (
              <div key={s} className={`rounded-xl border p-4 flex items-center gap-3 ${cfg.color}`}>
                <Icon className="w-5 h-5 opacity-70" />
                <div>
                  <div className="text-2xl font-bold">{statusCounts[s] ?? 0}</div>
                  <div className="text-xs font-medium">{cfg.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quote number or customer…"
            className="pl-9 h-9 text-sm"
          />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{search ? "No quotes matched your search" : "No quotes yet"}</p>
            {!search && <p className="text-sm mt-1">Click <strong>New Quote</strong> to get started.</p>}
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Quote #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Total ex VAT</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((q) => (
                  <TableRow
                    key={q.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setLocation(`/quotes/${q.id}`)}
                  >
                    <TableCell className="font-mono font-semibold text-primary">{q.quoteNumber}</TableCell>
                    <TableCell className="font-medium">{q.customerName}</TableCell>
                    <TableCell><StatusBadge status={q.status} /></TableCell>
                    <TableCell className="text-right text-muted-foreground">{q.itemCount}</TableCell>
                    <TableCell className="text-right font-medium">
                      £{parseFloat(q.totalExVat).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(q.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => setLocation(`/quotes/${q.id}`)}
                        >
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost" size="sm"
                          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => { if (confirm(`Delete ${q.quoteNumber}?`)) deleteQuote.mutate(q.id); }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Quote</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Customer</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={customerSearch}
                  onChange={(e) => {
                    setCustomerSearch(e.target.value);
                    setNewCustomerName(e.target.value);
                    setNewCustomerId(null);
                  }}
                  placeholder="Search existing customers…"
                  className="pl-9"
                />
              </div>
              {customerSearch && filteredCustomers.length > 0 && !newCustomerId && (
                <div className="border rounded-lg overflow-hidden max-h-40 overflow-y-auto shadow-sm">
                  {filteredCustomers.slice(0, 8).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors border-b last:border-b-0"
                      onClick={() => {
                        setNewCustomerId(c.id);
                        setNewCustomerName(c.name);
                        setCustomerSearch(c.name);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              {newCustomerId && (
                <p className="text-xs text-green-600 font-medium">✓ Linked to existing customer</p>
              )}
              {!newCustomerId && customerSearch && (
                <p className="text-xs text-muted-foreground">No match — will be saved as a new customer name</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="e.g. 15 polo shirts + 10 hoodies for new starters…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createQuote.mutate()}
              disabled={!newCustomerName.trim() || createQuote.isPending}
            >
              {createQuote.isPending ? <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Creating…</> : "Create Quote"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
