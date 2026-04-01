import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, RefreshCw, CheckCircle, AlertTriangle, Play, Clock,
  Eye, EyeOff, Loader2, Wifi, WifiOff, ShoppingCart
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
    refetchInterval: 10000,
  });

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string | null>) => apiFetch("/settings", { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings-raw"] });
      toast({ title: "Settings saved", description: "WooCommerce sync will use the new credentials." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: () => apiFetch("/woo-sync/run", { method: "POST" }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({
        title: "Sync complete",
        description: `${result.created} created, ${result.updated} updated${result.errors?.length ? `, ${result.errors.length} errors` : ""}`,
      });
    },
    onError: (e: Error) => {
      queryClient.invalidateQueries({ queryKey: ["sync-logs"] });
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
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

              {/* Save + Sync Now */}
              <div className="flex items-center gap-3">
                <Button onClick={handleSave} disabled={saveMutation.isPending} className="gap-2">
                  {saveMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Saving...</> : <><CheckCircle className="w-4 h-4" />Save Settings</>}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending || !isConnected}
                  className="gap-2"
                >
                  {syncMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Syncing...</> : <><Play className="w-4 h-4" />Sync Now</>}
                </Button>
              </div>

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
        </Tabs>
      </div>
    </Layout>
  );
}
