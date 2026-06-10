import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, RefreshCw, CheckCircle, AlertTriangle, Play,
  Eye, EyeOff, Loader2, Wifi, WifiOff, ShoppingCart,
  Link2, Unlink2, Users, ExternalLink, BookOpen, Mail, Send, Lock, GripVertical, Ruler,
  UserPlus, Trash2, UserCheck, Zap, Phone, Printer
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";
import { getListProductsQueryKey } from "@workspace/api-client-react";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface SyncLog {
  id: number;
  type: string;
  status: string;
  message: string | null;
  itemsCreated: string | null;
  itemsUpdated: string | null;
  errors: string | null;
  progressPct: number | null;
  startedAt: string;
  completedAt: string | null;
}

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  running: { label: "Running", color: "bg-blue-100 text-blue-800 border-blue-300" },
  completed: { label: "Completed", color: "bg-green-100 text-green-800 border-green-300" },
  completed_with_errors: { label: "Completed w/ Errors", color: "bg-amber-100 text-amber-800 border-amber-300" },
  failed: { label: "Failed", color: "bg-red-100 text-red-800 border-red-300" },
};

const SCHEDULE_OPTIONS = [
  { value: "none", label: "Disabled" },
  { value: "hourly", label: "Every hour" },
  { value: "every6hours", label: "Every 6 hours" },
  { value: "daily", label: "Daily (2am)" },
];

interface XeroStatus {
  connected: boolean;
  hasCredentials: boolean;
  tenantId: string | null;
  tenantName: string | null;
  expiresAt: string | null;
}

const DEFAULT_SIZE_ORDER = [
  "XXXS", "XXS", "XS", "S", "M", "L", "XL",
  "2XL", "3XL", "4XL", "5XL", "6XL", "7XL", "8XL",
  "X-Small", "Small", "Medium", "Large", "X-Large", "XX-Large",
  "One Size",
];

function SizesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: rawSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings"],
    queryFn: () => fetch(`${API_BASE}/settings`).then(r => r.json()),
    staleTime: 1000 * 60 * 10,
  });

  const [order, setOrder] = useState<string[]>(DEFAULT_SIZE_ORDER);
  const [dirty, setDirty] = useState(false);
  const [newSize, setNewSize] = useState("");
  const dragIdx = useRef<number | null>(null);

  useEffect(() => {
    const raw = rawSettings?.["size_order"];
    if (raw) {
      try { setOrder(JSON.parse(raw)); } catch {}
    }
  }, [rawSettings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(`${API_BASE}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ size_order: JSON.stringify(order) }),
      }).then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Size order saved" });
      setDirty(false);
    },
    onError: () => toast({ title: "Error", description: "Could not save size order", variant: "destructive" }),
  });

  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: DragEvent<HTMLDivElement>, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current!, 1);
      next.splice(idx, 0, moved);
      dragIdx.current = idx;
      return next;
    });
    setDirty(true);
  };
  const handleDragEnd = () => { dragIdx.current = null; };

  const addSize = () => {
    const trimmed = newSize.trim();
    if (!trimmed || order.includes(trimmed)) { setNewSize(""); return; }
    setOrder(prev => [...prev, trimmed]);
    setNewSize("");
    setDirty(true);
  };

  const removeSize = (size: string) => {
    setOrder(prev => prev.filter(s => s !== size));
    setDirty(true);
  };

  return (
    <div className="grid gap-6 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold mb-1">Size Display Order</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Drag to reorder, or add/remove sizes. This order is used everywhere sizes appear — wardrobe items, order forms, stock tables, and the customer portal.
        </p>
        <div className="border rounded-lg divide-y overflow-hidden">
          {order.map((size, idx) => (
            <div
              key={size}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-3 px-4 py-2.5 cursor-grab active:cursor-grabbing hover:bg-muted/50 select-none transition-colors group"
            >
              <GripVertical className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
              <span className="text-sm font-medium flex-1">{size}</span>
              <button
                onClick={(e) => { e.stopPropagation(); removeSize(size); }}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-muted-foreground hover:text-red-600 hover:bg-red-50"
                title="Remove size"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <Input
            value={newSize}
            onChange={(e) => setNewSize(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSize(); }}
            placeholder="Add a size (e.g. Extra Small Youth)"
            className="flex-1"
          />
          <Button variant="outline" onClick={addSize} disabled={!newSize.trim()}>Add</Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
          className="gap-2"
        >
          {saveMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
            : <><CheckCircle className="w-4 h-4" />Save Order</>}
        </Button>
        <Button
          variant="outline"
          onClick={() => { setOrder(DEFAULT_SIZE_ORDER); setDirty(true); }}
        >
          Reset to Default
        </Button>
      </div>
    </div>
  );
}

interface StaffAccount { name: string; email: string; }

function StaffAccountsCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newName, setNewName]   = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding]     = useState(false);

  const { data, isLoading } = useQuery<{ accounts: StaffAccount[] }>({
    queryKey: ["staff-accounts"],
    queryFn: () => fetch(`${API_BASE}/auth/staff/accounts`).then(r => r.json()),
  });
  const accounts = data?.accounts ?? [];

  const addMutation = useMutation({
    mutationFn: () =>
      fetch(`${API_BASE}/auth/staff/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, email: newEmail }),
      }).then(async r => { if (!r.ok) throw new Error((await r.json()).error); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      setNewName(""); setNewEmail(""); setAdding(false);
      toast({ title: "Staff account added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: (email: string) =>
      fetch(`${API_BASE}/auth/staff/accounts/${encodeURIComponent(email)}`, { method: "DELETE" })
        .then(r => { if (!r.ok) throw new Error("Failed"); return r.json(); }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      toast({ title: "Account removed" });
    },
    onError: () => toast({ title: "Error", description: "Could not remove account", variant: "destructive" }),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-base flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-muted-foreground" /> Staff Accounts
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Add each staff member's name and email address. They can then sign in using a one-time code sent to their email — no password needed.
        </p>
      </div>

      {/* Accounts list */}
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No staff accounts yet. Add one below.</p>
        </div>
      ) : (
        <div className="border rounded-lg divide-y overflow-hidden">
          {accounts.map(a => (
            <div key={a.email} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.name}</p>
                <p className="text-xs text-muted-foreground truncate">{a.email}</p>
              </div>
              <button
                onClick={() => removeMutation.mutate(a.email)}
                disabled={removeMutation.isPending}
                className="shrink-0 text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                title="Remove"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add form */}
      {adding ? (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input placeholder="James Smith" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label>Email address</Label>
              <Input type="email" placeholder="james@selectbranding.co.uk" value={newEmail} onChange={e => setNewEmail(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !newName || !newEmail} className="gap-1.5">
              {addMutation.isPending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Adding…</> : <><CheckCircle className="w-3.5 h-3.5" />Add account</>}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); setNewEmail(""); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="gap-2">
          <UserPlus className="w-4 h-4" /> Add staff member
        </Button>
      )}
    </div>
  );
}

function InvocoTab({ rawSettings }: { rawSettings: Record<string, string> | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey]     = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl]     = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    if (rawSettings && !loaded) {
      setApiKey(rawSettings["invoco_api_key"] ?? "");
      setUsername(rawSettings["invoco_username"] ?? "");
      setPassword(rawSettings["invoco_password"] ?? "");
      setApiUrl(rawSettings["invoco_api_url"] ?? "");
      setLoaded(true);
    }
  }, [rawSettings, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoco_api_key:  apiKey   || null,
          invoco_username: username || null,
          invoco_password: password || null,
          invoco_api_url:  apiUrl   || null,
        }),
      }).then((r) => { if (!r.ok) throw new Error("Save failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "Invoco settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const isConfigured = !!((apiKey || (username && password)) && apiUrl);

  return (
    <div className="grid gap-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Phone className="w-4 h-4 text-blue-500" />
          <h2 className="font-semibold text-base">Invoco Phonebook Sync</h2>
          {isConfigured && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
              <CheckCircle className="w-3 h-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Whenever a customer is created or updated, their name and phone number are automatically pushed to your Invoco phonebook — so incoming calls display the customer's name on your handsets.
        </p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="invocoApiUrl">API Endpoint URL</Label>
            <Input
              id="invocoApiUrl"
              placeholder="https://api.invoco.net/phonebook/contacts"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              The Invoco API endpoint for adding/updating phonebook contacts.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="invocoApiKey">API Key</Label>
            <div className="relative">
              <Input
                id="invocoApiKey"
                type={showApiKey ? "text" : "password"}
                placeholder="Your Invoco API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Sent as <code className="bg-muted px-1 rounded text-xs">Authorization: Bearer &lt;key&gt;</code>. If set, username/password below are ignored.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Basic Auth (fallback if no API key)</p>
            <div className="space-y-1.5">
              <Label htmlFor="invocoUsername">Username</Label>
              <Input
                id="invocoUsername"
                placeholder="your-invoco-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invocoPassword">Password</Label>
              <div className="relative">
                <Input
                  id="invocoPassword"
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending
            ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</>
            : <><CheckCircle className="w-4 h-4" />Save</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-sm">How it works</h2>
        <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
          <li>Every time you save a customer, their <strong>phone number</strong> and <strong>contact name</strong> are pushed to Invoco in the background.</li>
          <li>Uses your <strong>API key</strong> (Bearer token) if set; falls back to <strong>HTTP Basic Auth</strong> if not.</li>
          <li>If the customer has no phone number, the sync is skipped for that record.</li>
          <li>Errors are logged server-side but won't interrupt saving the customer.</li>
        </ul>
      </div>
    </div>
  );
}

function HighLevelTab({ rawSettings }: { rawSettings: Record<string, string> | undefined }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [webhookUrl, setWebhookUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [locationId, setLocationId] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (rawSettings && !loaded) {
      setWebhookUrl(rawSettings["high_level_webhook_url"] ?? "");
      setApiKey(rawSettings["high_level_api_key"] ?? "");
      setLocationId(rawSettings["high_level_location_id"] ?? "");
      setLoaded(true);
    }
  }, [rawSettings, loaded]);

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          high_level_webhook_url: webhookUrl || null,
          high_level_api_key: apiKey || null,
          high_level_location_id: locationId || null,
        }),
      }).then((r) => { if (!r.ok) throw new Error("Save failed"); return r.json(); }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "High Level settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      fetch("/api/enquiries/sync", { method: "POST" }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ synced: number }>;
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["enquiries"] });
      toast({ title: "Enquiries synced", description: `${data.synced} lead${data.synced !== 1 ? "s" : ""} imported from High Level` });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: e.message, variant: "destructive" }),
  });

  const { data: enquiries = [] } = useQuery<any[]>({
    queryKey: ["enquiries"],
    queryFn: () => fetch("/api/enquiries").then((r) => r.json()),
  });

  return (
    <div className="grid gap-6 max-w-2xl">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-base">Leads Sync (Enquiries)</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Contacts tagged <strong>Telephone Enquiry</strong>, <strong>Website Lead</strong>, or <strong>Showroom Contact</strong> in High Level will appear as selectable Enquiries when creating a new quote.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="hlApiKey">API Key (Private Integration Token)</Label>
            <Input
              id="hlApiKey"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              High Level → Settings → Integrations → Private Integrations → create or copy token.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hlLocationId">Location ID</Label>
            <Input
              id="hlLocationId"
              placeholder="abc123xyz..."
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              High Level → Settings → Business Profile — the Location ID shown at the top.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save</>}
          </Button>
          <Button
            size="sm" variant="outline" className="gap-1.5"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending || !apiKey || !locationId}
          >
            {syncMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing…</> : <><RefreshCw className="w-4 h-4" />Sync Enquiries Now</>}
          </Button>
          {enquiries.length > 0 && (
            <span className="text-xs text-muted-foreground">{enquiries.length} enquiri{enquiries.length !== 1 ? "es" : "y"} cached</span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-amber-500" />
          <h2 className="font-semibold text-base">High Level Webhook</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          When you click <strong>Send via High Level</strong> on a collection order invoice, SBS posts the order data to this URL, triggering your High Level workflow to send the customer their invoice template.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="hlWebhookUrl">Webhook URL</Label>
          <Input
            id="hlWebhookUrl"
            placeholder="https://services.leadconnectorhq.com/hooks/..."
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Find this in High Level → Automations → your workflow → Webhook trigger → copy the URL.
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save Webhook URL</>}
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-sm">Payload sent to High Level</h2>
        <p className="text-xs text-muted-foreground">The following fields are POSTed as JSON to your webhook URL:</p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li><code>contactId</code> — the customer's High Level contact ID (set per-customer)</li>
          <li><code>orderNumber</code> — e.g. SBS-1234</li>
          <li><code>customerName</code></li>
          <li><code>totalAmountExVat</code> — e.g. "250.00"</li>
          <li><code>totalAmountIncVat</code> — e.g. "300.00"</li>
          <li><code>customerEmail</code></li>
          <li><code>shippingMethod</code> — e.g. "office_collection"</li>
        </ul>
      </div>
    </div>
  );
}

function SecurityTab() {
  const [current, setCurrent]     = useState("");
  const [newPass, setNewPass]     = useState("");
  const [confirm, setConfirm]     = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [success, setSuccess]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPass !== confirm) { setError("New passwords don't match"); return; }
    if (newPass.length < 8) { setError("New password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: newPass }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to change password"); return; }
      setSuccess(true);
      setCurrent(""); setNewPass(""); setConfirm("");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-6 max-w-2xl">

      <StaffAccountsCard />

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h2 className="font-semibold text-base">Change Staff Password</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All staff share a single login password for the order system. Update it here when needed.
          </p>
        </div>

        {success && (
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
            <CheckCircle className="w-4 h-4 shrink-0" /> Password changed successfully.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <div className="relative">
              <Input type={showCurrent ? "text" : "password"} value={current}
                onChange={e => setCurrent(e.target.value)} placeholder="Enter current password"
                className="pr-10" />
              <button type="button" onClick={() => setShowCurrent(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <div className="relative">
              <Input type={showNew ? "text" : "password"} value={newPass}
                onChange={e => setNewPass(e.target.value)} placeholder="At least 8 characters"
                className="pr-10" />
              <button type="button" onClick={() => setShowNew(v => !v)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat new password" />
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button type="submit" disabled={loading || !current || !newPass || !confirm} className="gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><Lock className="w-4 h-4" />Update password</>}
          </Button>
        </form>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 space-y-2">
        <h2 className="font-semibold text-base">Forgotten your password?</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          If you're completely locked out, go to the login page and click <strong>"Back"</strong> then use the email code option — or use the recovery key from Replit Secrets{" "}
          (<code className="text-xs bg-muted px-1.5 py-0.5 rounded">STAFF_RECOVERY_KEY</code>) to clear the password and set a new one.
        </p>
      </div>
    </div>
  );
}

const LABEL_PRINTER_KEY = "sbs_label_printer";

function PrintingTab() {
  const [printerName, setPrinterName] = useState(() => {
    try { return localStorage.getItem(LABEL_PRINTER_KEY) || "TSC DA210"; } catch { return "TSC DA210"; }
  });
  const [saved, setSaved] = useState(false);

  function save() {
    try { localStorage.setItem(LABEL_PRINTER_KEY, printerName.trim() || "TSC DA210"); } catch { /* ignore */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="grid gap-6 max-w-2xl">
      <div>
        <h3 className="text-base font-semibold mb-1">Label Printer (QZ Tray)</h3>
        <p className="text-sm text-muted-foreground mb-4">
          When <strong>QZ Tray</strong> is running on this computer, wearer and box labels print
          directly to the named printer below — no dialog required. If QZ Tray isn't running,
          the browser print dialog opens as normal.
        </p>
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="mb-1 block">Printer name</Label>
            <Input
              value={printerName}
              onChange={e => { setPrinterName(e.target.value); setSaved(false); }}
              placeholder="TSC DA210"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must match the printer name exactly as shown in Windows → Printers &amp; scanners.
            </p>
          </div>
          <Button onClick={save} className="gap-2 shrink-0">
            {saved ? <><CheckCircle className="w-4 h-4" /> Saved</> : "Save"}
          </Button>
        </div>
      </div>

      <div className="border rounded-lg p-4 bg-muted/40">
        <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
          <Printer className="w-4 h-4" /> QZ Tray setup (one-time, per computer)
        </h4>
        <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
          <li>Download and install <strong>QZ Tray</strong> from <a href="https://qz.io/download/" target="_blank" rel="noreferrer" className="underline text-foreground">qz.io/download</a></li>
          <li>Launch QZ Tray — it runs in the system tray (bottom-right of taskbar)</li>
          <li>Right-click the QZ Tray icon → <strong>Advanced</strong> → tick <strong>Allow unsigned content</strong></li>
          <li>Set the printer name above to match your label printer exactly, then click Save</li>
          <li>Open any order and print wearer or box labels — they will send automatically</li>
        </ol>
        <p className="text-xs text-muted-foreground mt-3">
          QZ Tray must be running whenever labels need to print silently. If it's not running,
          labels still open and print via the normal browser dialog.
        </p>
      </div>
    </div>
  );
}

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [wooUrl, setWooUrl] = useState("");
  const [wooKey, setWooKey] = useState("");
  const [wooSecret, setWooSecret] = useState("");
  const [syncSchedule, setSyncSchedule] = useState("none");
  const [showKey, setShowKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [formLoaded, setFormLoaded] = useState(false);

  // Xero credential fields
  const [xeroClientId, setXeroClientId] = useState("");
  const [xeroClientSecret, setXeroClientSecret] = useState("");
  const [showXeroSecret, setShowXeroSecret] = useState(false);

  // Xero sync progress bar state — effect is placed after syncXeroContactsMutation declaration below
  const [xeroSyncProgress, setXeroSyncProgress] = useState(0);

  // Email / SMTP fields
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("Select Branding Solutions");
  const [showSmtpPass, setShowSmtpPass] = useState(false);
  const [smtpFormLoaded, setSmtpFormLoaded] = useState(false);
  const [testEmailTo, setTestEmailTo] = useState("");

  // Detect ?xero=connected redirect from OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const xeroParam = params.get("xero");
    const msg = params.get("msg");
    if (xeroParam === "connected") {
      toast({ title: "Xero connected", description: "Your Xero account has been linked successfully." });
      window.history.replaceState({}, "", window.location.pathname);
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
    } else if (xeroParam === "error") {
      toast({ title: "Xero connection failed", description: msg ?? "Unknown error", variant: "destructive" });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const { data: xeroStatus } = useQuery<XeroStatus>({
    queryKey: ["xero-status"],
    queryFn: () => apiFetch("/xero/status"),
    refetchInterval: 60_000,
  });

  const { data: xeroRedirectUriData } = useQuery<{ redirectUri: string; isOverride: boolean }>({
    queryKey: ["xero-redirect-uri"],
    queryFn: () => apiFetch("/xero/redirect-uri"),
    staleTime: Infinity,
  });

  // Editable redirect URI — pre-fill once the auto-detected value arrives
  const [xeroRedirectUri, setXeroRedirectUri] = useState("");
  useEffect(() => {
    if (xeroRedirectUriData?.redirectUri && !xeroRedirectUri) {
      setXeroRedirectUri(xeroRedirectUriData.redirectUri);
    }
  }, [xeroRedirectUriData]);

  const saveXeroCredsMutation = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string; redirectUri: string }) =>
      apiFetch("/xero/credentials", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xero-redirect-uri"] });
      toast({ title: "Xero credentials saved", description: "Click 'Connect to Xero' to authorise." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncXeroContactsMutation = useMutation({
    mutationFn: () => apiFetch("/xero/sync/contacts", { method: "POST" }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
      toast({
        title: "Xero contact sync complete",
        description: `${res.customersImported} customers imported, ${res.suppliersImported} suppliers imported, ${res.pushed} pushed to Xero.`,
      });
    },
    onError: (e: Error) => toast({ title: "Sync failed", description: parseApiError(e), variant: "destructive" }),
  });

  // Progress bar animation — must be after syncXeroContactsMutation is declared
  useEffect(() => {
    if (!syncXeroContactsMutation.isPending) {
      if (xeroSyncProgress > 0) {
        setXeroSyncProgress(100);
        const t = setTimeout(() => setXeroSyncProgress(0), 700);
        return () => clearTimeout(t);
      }
      return;
    }
    setXeroSyncProgress(5);
    const interval = setInterval(() => {
      setXeroSyncProgress((prev) => {
        if (prev >= 88) { clearInterval(interval); return prev; }
        const step = Math.max(0.5, (88 - prev) * 0.04);
        return Math.min(88, prev + step);
      });
    }, 200);
    return () => clearInterval(interval);
  }, [syncXeroContactsMutation.isPending]);

  const disconnectXeroMutation = useMutation({
    mutationFn: () => apiFetch("/xero/disconnect", { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["xero-status"] });
      toast({ title: "Xero disconnected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: rawSettings } = useQuery<Record<string, string | null>>({
    queryKey: ["settings-raw"],
    queryFn: () => apiFetch("/settings/raw"),
  });

  useEffect(() => {
    if (rawSettings && !formLoaded) {
      setWooUrl(rawSettings["woo_url"] ?? "");
      setWooKey(rawSettings["woo_consumer_key"] ?? "");
      setWooSecret(rawSettings["woo_consumer_secret"] ?? "");
      setSyncSchedule(rawSettings["woo_sync_schedule"] ?? "none");
      setFormLoaded(true);
    }
  }, [rawSettings, formLoaded]);

  useEffect(() => {
    if (rawSettings && !smtpFormLoaded) {
      setSmtpHost(rawSettings["smtp_host"] ?? "smtp.office365.com");
      setSmtpPort(rawSettings["smtp_port"] ?? "587");
      setSmtpUser(rawSettings["smtp_user"] ?? "");
      setSmtpFromEmail(rawSettings["smtp_from_email"] ?? "");
      setSmtpFromName(rawSettings["smtp_from_name"] ?? "Select Branding Solutions");
      setSmtpFormLoaded(true);
    }
  }, [rawSettings, smtpFormLoaded]);

  const saveSmtpMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) => apiFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      queryClient.invalidateQueries({ queryKey: ["email-status"] });
      toast({ title: "Email settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testSmtpMutation = useMutation({
    mutationFn: (to: string) => apiFetch<{ ok: boolean; provider?: string; messageId?: string; error?: string }>("/settings/email/test", { method: "POST", body: JSON.stringify({ to }) }),
    onSuccess: (res) => {
      if (res.ok) {
        toast({ title: "Test email sent", description: `Delivered via ${res.provider ?? "unknown"}. Check the inbox (and spam folder) for the test message.` });
      } else {
        toast({ title: "Send failed", description: res.error ?? "Unknown error", variant: "destructive" });
      }
    },
    onError: (e: Error) => toast({ title: "Test failed", description: parseApiError(e), variant: "destructive" }),
  });

  const { data: logs = [], isLoading: logsLoading, refetch: refetchLogs } = useQuery<SyncLog[]>({
    queryKey: ["sync-logs"],
    queryFn: () => apiFetch("/woo-sync/logs"),
    // Poll every 3s while a sync is running, otherwise every 15s
    refetchInterval: (query) => {
      const data = query.state.data as SyncLog[] | undefined;
      return data?.[0]?.status === "running" ? 3000 : 15000;
    },
  });

  const isSyncRunning = logs[0]?.status === "running";

  // When a sync transitions from "running" → completed/failed, invalidate all product data
  const prevSyncStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = logs[0]?.status;
    if (prevSyncStatus.current === "running" && current && current !== "running") {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["product"] });
    }
    prevSyncStatus.current = current;
  }, [logs[0]?.status]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) => apiFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "Settings saved", description: "WooCommerce sync will use the new credentials." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function parseApiError(e: Error): string {
    try {
      const obj = JSON.parse(e.message);
      return obj.error ?? e.message;
    } catch {
      return e.message;
    }
  }

  const syncMutation = useMutation({
    mutationFn: (full = false) => apiFetch(`/woo-sync/run${full ? "?full=true" : ""}`, { method: "POST" }),
    onSuccess: () => {
      // Endpoint now returns 202 immediately — sync runs in the background.
      // Refresh logs straight away so the new "running" row appears.
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({ title: "Sync started", description: "Running in the background — the log below updates automatically." });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({ title: "Sync failed", description: parseApiError(e), variant: "destructive" });
    },
  });

  const lastLog = logs[0];
  const isConnected = !!(rawSettings?.["woo_url"] && rawSettings?.["woo_consumer_key"] && rawSettings?.["woo_consumer_secret"]);

  function handleSave() {
    saveMutation.mutate({
      woo_url: wooUrl || null,
      woo_consumer_key: wooKey || null,
      woo_consumer_secret: wooSecret || null,
      woo_sync_schedule: syncSchedule === "none" ? null : syncSchedule,
    });
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Settings2 className="w-7 h-7 text-primary" /> Settings
          </h1>
          <p className="text-muted-foreground mt-1">Configure integrations and sync preferences.</p>
        </div>

        <Tabs defaultValue="woocommerce">
          <TabsList>
            <TabsTrigger value="woocommerce" className="gap-2">
              <ShoppingCart className="w-4 h-4" /> WooCommerce Sync
            </TabsTrigger>
            <TabsTrigger value="xero" className="gap-2">
              <BookOpen className="w-4 h-4" /> Xero Accounting
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-2">
              <Mail className="w-4 h-4" /> Email
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-2">
              <Lock className="w-4 h-4" /> Security
            </TabsTrigger>
            <TabsTrigger value="highlevel" className="gap-2">
              <Zap className="w-4 h-4" /> High Level
            </TabsTrigger>
            <TabsTrigger value="invoco" className="gap-2">
              <Phone className="w-4 h-4" /> Invoco
            </TabsTrigger>
            <TabsTrigger value="sizes" className="gap-2">
              <Ruler className="w-4 h-4" /> Sizes
            </TabsTrigger>
            <TabsTrigger value="printing" className="gap-2">
              <Printer className="w-4 h-4" /> Printing
            </TabsTrigger>
          </TabsList>

          <TabsContent value="woocommerce" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Connection status banner */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${isConnected ? "bg-green-50 border-green-200 text-green-800" : "bg-muted/50 border-border text-muted-foreground"}`}>
                {isConnected ? <Wifi className="w-4 h-4 flex-shrink-0" /> : <WifiOff className="w-4 h-4 flex-shrink-0" />}
                {isConnected
                  ? `Connected to ${rawSettings?.["woo_url"]}`
                  : "Not connected — enter your WooCommerce credentials below"}
              </div>

              {/* Credentials */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Store Credentials</h2>
                <p className="text-sm text-muted-foreground">
                  Generate API keys in your WooCommerce admin under <strong>Settings → Advanced → REST API</strong>. Set permissions to <strong>Read</strong>.
                </p>

                <div className="space-y-1.5">
                  <Label>Store URL</Label>
                  <Input
                    placeholder="https://yourstore.com"
                    value={wooUrl}
                    onChange={(e) => setWooUrl(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Consumer Key</Label>
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      placeholder="ck_xxxxxxxxxxxx"
                      value={wooKey}
                      onChange={(e) => setWooKey(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label>Consumer Secret</Label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      placeholder="cs_xxxxxxxxxxxx"
                      value={wooSecret}
                      onChange={(e) => setWooSecret(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Schedule */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Sync Schedule</h2>
                <p className="text-sm text-muted-foreground">
                  Products are synced one-way from WooCommerce — your store stays the master catalogue.
                </p>
                <div className="space-y-1.5">
                  <Label>Automatic sync frequency</Label>
                  <Select value={syncSchedule} onValueChange={setSyncSchedule}>
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SCHEDULE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Save + Sync buttons */}
              <div className="flex items-center gap-3 flex-wrap">
                <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Settings</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate(false)}
                  disabled={syncMutation.isPending || isSyncRunning || !isConnected}
                  className="gap-2"
                  title="Only fetches products changed since the last sync"
                >
                  {(syncMutation.isPending || isSyncRunning) ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing...</> : <><Play className="w-4 h-4" />Sync Changes</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate(true)}
                  disabled={syncMutation.isPending || isSyncRunning || !isConnected}
                  className="gap-2 text-muted-foreground"
                  title="Re-fetches all products from WooCommerce regardless of when they were last modified"
                >
                  {(syncMutation.isPending || isSyncRunning) ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing all...</> : <><RefreshCw className="w-4 h-4" />Full Sync</>}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                <strong>Sync Changes</strong> is fast — it only fetches products modified since the last run. Use <strong>Full Sync</strong> when you've made bulk changes in WooCommerce or want to be sure everything is up to date.
              </p>

              {/* Live progress bar — shown while a sync is running */}
              {isSyncRunning && (() => {
                const pct = logs[0]?.progressPct ?? 0;
                const phase = pct === 0 ? "Connecting to WooCommerce…" :
                              pct < 10 ? "Fetching product catalogue…" :
                              pct < 99 ? `Processing products… ${pct}%` :
                              "Finishing up…";
                return (
                  <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-blue-800 font-medium">
                        <Loader2 className="w-4 h-4 animate-spin" />{phase}
                      </span>
                      {pct > 0 && <span className="text-blue-600 font-mono text-xs">{pct}%</span>}
                    </div>
                    <div className="w-full bg-blue-200 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-700 ease-out"
                        style={{ width: pct > 0 ? `${pct}%` : "8%", animation: pct === 0 ? "pulse 1.5s infinite" : undefined }}
                      />
                    </div>
                    <p className="text-xs text-blue-600">Updates every few seconds — you can leave this page and come back.</p>
                  </div>
                );
              })()}

              {/* Last sync summary — shown when idle */}
              {lastLog && !isSyncRunning && (
                <div className={`flex items-start gap-3 px-4 py-3 rounded-lg border text-sm ${
                  lastLog.status === "completed" ? "bg-green-50 border-green-200" :
                  lastLog.status === "failed" ? "bg-red-50 border-red-200" :
                  "bg-amber-50 border-amber-200"
                }`}>
                  {lastLog.status === "completed" ? <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" /> :
                   lastLog.status === "failed" ? <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" /> :
                   <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />}
                  <div>
                    <div className="font-medium">
                      Last sync: {formatDate(lastLog.startedAt)}
                      {lastLog.completedAt && ` → ${formatDate(lastLog.completedAt)}`}
                    </div>
                    {lastLog.message && <div className="text-muted-foreground">{lastLog.message}</div>}
                    {(lastLog.itemsCreated || lastLog.itemsUpdated) && (
                      <div className="text-muted-foreground">
                        {lastLog.itemsCreated} created · {lastLog.itemsUpdated} updated
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Sync history */}
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 border-b border-border">
                  <h2 className="font-semibold text-sm">Sync History</h2>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetchLogs()}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                {logsLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />Loading...
                  </div>
                ) : logs.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">No sync runs yet.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="text-xs">Started</TableHead>
                        <TableHead className="text-xs">Status</TableHead>
                        <TableHead className="text-xs text-center">Created</TableHead>
                        <TableHead className="text-xs text-center">Updated</TableHead>
                        <TableHead className="text-xs">Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {logs.map((log) => {
                        const cfg = STATUS_CFG[log.status] ?? { label: log.status, color: "bg-muted text-muted-foreground" };
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs">{formatDate(log.startedAt)}</TableCell>
                            <TableCell><Badge className={`text-xs ${cfg.color}`}>{cfg.label}</Badge></TableCell>
                            <TableCell className="text-center text-sm font-medium">{log.itemsCreated ?? "—"}</TableCell>
                            <TableCell className="text-center text-sm font-medium">{log.itemsUpdated ?? "—"}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">{log.message ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="xero" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Connection status banner */}
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
                xeroStatus?.connected
                  ? "bg-green-50 border-green-200 text-green-800"
                  : xeroStatus?.hasCredentials
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-muted/50 border-border text-muted-foreground"
              }`}>
                {xeroStatus?.connected
                  ? <><Wifi className="w-4 h-4 flex-shrink-0" /> Connected to Xero{xeroStatus.tenantName ? ` — ${xeroStatus.tenantName}` : ""}</>
                  : xeroStatus?.hasCredentials
                    ? <><Link2 className="w-4 h-4 flex-shrink-0" /> Credentials saved — click <strong className="mx-1">Connect to Xero</strong> below to complete authorisation</>
                    : <><WifiOff className="w-4 h-4 flex-shrink-0" /> Not connected — enter your credentials below and click Connect</>}
              </div>

              {/* Credentials */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-base">App Credentials</h2>
                  {xeroStatus?.hasCredentials && !xeroStatus?.connected && (
                    <Badge className="bg-amber-100 text-amber-800 border-amber-300 gap-1.5 text-xs">
                      <CheckCircle className="w-3 h-3" /> Credentials saved — connect to activate
                    </Badge>
                  )}
                  {xeroStatus?.hasCredentials && xeroStatus?.connected && (
                    <Badge className="bg-green-100 text-green-800 border-green-300 gap-1.5 text-xs">
                      <CheckCircle className="w-3 h-3" /> Connected
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Create a free <strong>Web App</strong> at{" "}
                  <a href="https://developer.xero.com/app/manage" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    developer.xero.com <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and paste the Client ID and Secret below. You <strong>must</strong> also add the redirect URI shown here to your Xero app — copy it exactly.
                </p>

                {/* Redirect URI — editable so it can be corrected if the auto-detected value is wrong */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Step 1 — Redirect URI</p>
                    {xeroRedirectUriData?.isOverride && (
                      <span className="text-xs text-amber-600 italic">Custom value saved</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={xeroRedirectUri}
                      onChange={(e) => setXeroRedirectUri(e.target.value)}
                      className="flex-1 text-xs font-mono bg-white border-amber-200 text-amber-900 h-8"
                      placeholder="Loading…"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-amber-300 text-amber-700 hover:bg-amber-100"
                      onClick={() => {
                        if (xeroRedirectUri) {
                          navigator.clipboard.writeText(xeroRedirectUri);
                          toast({ title: "Copied!", description: "Redirect URI copied to clipboard." });
                        }
                      }}
                      disabled={!xeroRedirectUri}
                    >
                      Copy
                    </Button>
                  </div>
                  <p className="text-xs text-amber-700">
                    Register this URL exactly in your Xero app under <strong>Configuration → Redirect URIs</strong>. Edit it here if your deployed app uses a different domain.
                  </p>
                </div>

                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2 — Enter your credentials</p>
                <div className="space-y-1.5">
                  <Label>Client ID</Label>
                  <Input
                    placeholder="Your Xero Client ID"
                    value={xeroClientId}
                    onChange={(e) => setXeroClientId(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Client Secret</Label>
                  <div className="relative">
                    <Input
                      type={showXeroSecret ? "text" : "password"}
                      placeholder="Your Xero Client Secret"
                      value={xeroClientSecret}
                      onChange={(e) => setXeroClientSecret(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowXeroSecret((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showXeroSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Button
                  onClick={() => saveXeroCredsMutation.mutate({ clientId: xeroClientId, clientSecret: xeroClientSecret, redirectUri: xeroRedirectUri })}
                  disabled={saveXeroCredsMutation.isPending || !xeroClientId || !xeroClientSecret || !xeroRedirectUri}
                  className="gap-2"
                >
                  {saveXeroCredsMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Credentials</>}
                </Button>
              </div>

              {/* Connect / Disconnect */}
              <div className={`rounded-xl border bg-card p-5 space-y-4 ${xeroStatus?.hasCredentials && !xeroStatus?.connected ? "border-amber-300 ring-1 ring-amber-200" : "border-border"}`}>
                <h2 className="font-semibold text-base">Authorisation</h2>
                {xeroStatus?.connected ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <Badge className="bg-green-100 text-green-800 border-green-300 gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Connected</Badge>
                      {xeroStatus.tenantName && <span className="text-sm text-muted-foreground">{xeroStatus.tenantName}</span>}
                    </div>
                    {xeroStatus.expiresAt && (
                      <p className="text-xs text-muted-foreground">
                        Token expires: {new Date(xeroStatus.expiresAt).toLocaleString()}
                      </p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => { if (confirm("Disconnect from Xero? Token and tenant link will be removed.")) disconnectXeroMutation.mutate(); }}
                      disabled={disconnectXeroMutation.isPending}
                    >
                      {disconnectXeroMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink2 className="w-4 h-4" />}
                      Disconnect
                    </Button>
                  </div>
                ) : xeroStatus?.hasCredentials ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>Credentials saved. Click below to authorise access to your Xero organisation — you'll be redirected to Xero and back.</span>
                    </div>
                    <Button asChild size="lg" className="gap-2 w-full sm:w-auto">
                      <a href="/api/xero/connect">
                        <Link2 className="w-4 h-4" /> Connect to Xero
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      Save your credentials above, then click here to authorise this app to access your Xero organisation.
                    </p>
                    <Button asChild className="gap-2" disabled>
                      <span className="opacity-50 cursor-not-allowed">
                        <Link2 className="w-4 h-4" /> Connect to Xero
                      </span>
                    </Button>
                    <p className="text-xs text-muted-foreground">Save your Client ID and Secret first to enable this button.</p>
                  </div>
                )}
              </div>

              {/* Contact sync */}
              {xeroStatus?.connected && (
                <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                  <h2 className="font-semibold text-base">Contact Sync</h2>
                  <p className="text-sm text-muted-foreground">
                    Pulls all Xero contacts into Customers and Suppliers, matches existing records by email or name, and pushes any unmatched local records back to Xero.
                  </p>
                  <Button
                    variant="outline"
                    onClick={() => syncXeroContactsMutation.mutate()}
                    disabled={syncXeroContactsMutation.isPending}
                    className="gap-2"
                  >
                    {syncXeroContactsMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing contacts…</>
                      : <><Users className="w-4 h-4" />Sync Contacts</>}
                  </Button>

                  {/* Progress bar — visible while sync is running (and briefly on completion) */}
                  {xeroSyncProgress > 0 && (
                    <div className="space-y-1.5">
                      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                          style={{ width: `${xeroSyncProgress}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {xeroSyncProgress < 100
                          ? `Syncing… ${Math.round(xeroSyncProgress)}%`
                          : "Sync complete!"}
                      </p>
                    </div>
                  )}
                </div>
              )}

            </div>
          </TabsContent>

          {/* ─── Email Tab ─────────────────────────────────────────── */}
          <TabsContent value="email" className="mt-6">
            <div className="grid gap-6 max-w-2xl">

              {/* Resend active banner */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                  <h2 className="font-semibold text-base text-emerald-900">Email sending active via Resend</h2>
                </div>
                <p className="text-sm text-emerald-800 leading-relaxed">
                  Outgoing emails (invoices, portal sign-in links, order acknowledgements, and purchase orders) are sent through <strong>Resend</strong>. No SMTP configuration is needed.
                </p>
                <div className="flex gap-2 items-center">
                  <Input
                    type="email"
                    placeholder="Send test email to…"
                    value={testEmailTo}
                    onChange={e => setTestEmailTo(e.target.value)}
                    className="h-8 text-sm bg-white border-emerald-300 max-w-xs"
                    onKeyDown={e => { if (e.key === "Enter" && testEmailTo.includes("@")) testSmtpMutation.mutate(testEmailTo); }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testSmtpMutation.mutate(testEmailTo)}
                    disabled={testSmtpMutation.isPending || !testEmailTo.includes("@")}
                    className="gap-2 border-emerald-300 text-emerald-800 hover:bg-emerald-100 shrink-0"
                  >
                    {testSmtpMutation.isPending
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Sending…</>
                      : <><Send className="w-4 h-4" />Send test</>}
                  </Button>
                </div>
                <p className="text-xs text-emerald-700">Enter your email address and click Send test — if you receive it, login codes will work. Check your spam/junk folder too.</p>
              </div>

              {/* SMTP fallback (collapsed / reference only) */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base text-muted-foreground">SMTP (fallback — not currently used)</h2>
                <p className="text-sm text-muted-foreground">
                  These settings are only used if Resend is unavailable. Leave them blank unless you have a specific reason to configure an SMTP fallback.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2 sm:col-span-1">
                    <Label>SMTP Host</Label>
                    <Input placeholder="smtp.office365.com" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Port</Label>
                    <Input placeholder="587" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Username</Label>
                  <Input placeholder="you@yourdomain.com" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Password / App Password</Label>
                  <div className="relative">
                    <Input
                      type={showSmtpPass ? "text" : "password"}
                      placeholder="Enter your email password or app password"
                      value={smtpPass}
                      onChange={(e) => setSmtpPass(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSmtpPass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSmtpPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>From Email Address</Label>
                  <Input placeholder="invoices@yourdomain.com" value={smtpFromEmail} onChange={(e) => setSmtpFromEmail(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>From Name</Label>
                  <Input placeholder="Select Branding Solutions" value={smtpFromName} onChange={(e) => setSmtpFromName(e.target.value)} />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveSmtpMutation.mutate({
                    smtp_host: smtpHost || null,
                    smtp_port: smtpPort || null,
                    smtp_user: smtpUser || null,
                    smtp_pass: smtpPass || null,
                    smtp_from_email: smtpFromEmail || null,
                    smtp_from_name: smtpFromName || null,
                  })}
                  disabled={saveSmtpMutation.isPending}
                  className="gap-2"
                >
                  {saveSmtpMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving…</> : <><CheckCircle className="w-4 h-4" />Save SMTP Settings</>}
                </Button>
              </div>

            </div>
          </TabsContent>

          {/* ─── Security Tab ──────────────────────────────────────── */}
          <TabsContent value="security" className="mt-6">
            <SecurityTab />
          </TabsContent>

          {/* ─── High Level Tab ────────────────────────────────────── */}
          <TabsContent value="highlevel" className="mt-6">
            <HighLevelTab rawSettings={rawSettings} />
          </TabsContent>

          {/* ─── Invoco Tab ────────────────────────────────────────── */}
          <TabsContent value="invoco" className="mt-6">
            <InvocoTab rawSettings={rawSettings} />
          </TabsContent>

          {/* ─── Sizes Tab ─────────────────────────────────────────── */}
          <TabsContent value="sizes" className="mt-6">
            <SizesTab />
          </TabsContent>

          {/* ─── Printing Tab ──────────────────────────────────────── */}
          <TabsContent value="printing" className="mt-6">
            <PrintingTab />
          </TabsContent>

        </Tabs>
      </div>
    </Layout>
  );
}
