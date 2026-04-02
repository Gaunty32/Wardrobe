import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, RefreshCw, CheckCircle, AlertTriangle, Play,
  Eye, EyeOff, Loader2, Wifi, WifiOff, ShoppingCart,
  Link2, Unlink2, Users, ExternalLink, BookOpen
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
  tenantId: string | null;
  tenantName: string | null;
  expiresAt: string | null;
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

  const saveXeroCredsMutation = useMutation({
    mutationFn: (data: { clientId: string; clientSecret: string }) =>
      apiFetch("/xero/credentials", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => {
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

              {/* Last sync summary */}
              {lastLog && (
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
              <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${xeroStatus?.connected ? "bg-green-50 border-green-200 text-green-800" : "bg-muted/50 border-border text-muted-foreground"}`}>
                {xeroStatus?.connected
                  ? <><Wifi className="w-4 h-4 flex-shrink-0" /> Connected to Xero{xeroStatus.tenantName ? ` — ${xeroStatus.tenantName}` : ""}</>
                  : <><WifiOff className="w-4 h-4 flex-shrink-0" /> Not connected — save your credentials below and click Connect</>}
              </div>

              {/* Credentials */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">App Credentials</h2>
                <p className="text-sm text-muted-foreground">
                  Create a free <strong>Web App</strong> at{" "}
                  <a href="https://developer.xero.com/app/manage" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    developer.xero.com <ExternalLink className="w-3 h-3" />
                  </a>{" "}
                  and copy the Client ID and Secret below. Add{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{window.location.origin}/api/xero/callback</code>{" "}
                  as a redirect URI in the Xero app settings.
                </p>
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
                  onClick={() => saveXeroCredsMutation.mutate({ clientId: xeroClientId, clientSecret: xeroClientSecret })}
                  disabled={saveXeroCredsMutation.isPending || !xeroClientId || !xeroClientSecret}
                  className="gap-2"
                >
                  {saveXeroCredsMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Credentials</>}
                </Button>
              </div>

              {/* Connect / Disconnect */}
              <div className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h2 className="font-semibold text-base">Authorisation</h2>
                {xeroStatus?.connected ? (
                  <div className="flex items-center gap-3">
                    <Badge className="bg-green-100 text-green-800 border-green-300 gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> Connected</Badge>
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
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">
                      After saving your credentials, click below to authorise this app to access your Xero organisation.
                    </p>
                    <Button asChild className="gap-2">
                      <a href="/api/xero/connect">
                        <Link2 className="w-4 h-4" /> Connect to Xero
                      </a>
                    </Button>
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
                      ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing contacts...</>
                      : <><Users className="w-4 h-4" />Sync Contacts</>}
                  </Button>
                </div>
              )}

            </div>
          </TabsContent>

        </Tabs>
      </div>
    </Layout>
  );
}
