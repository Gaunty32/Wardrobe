import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ClipboardList, CheckCircle2, Clock, Printer, ArrowRight,
  RefreshCw, Plus, Trash2, ChevronDown, ChevronRight, Sparkles, User, Archive, Ruler, Palette
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";
import { formatDate } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  if (res.status === 204) return null as T;
  return res.json();
}

interface ProcessStep {
  id: number;
  name: string;
  type: string | null;
  placement: string | null;
  price: number | null;
  notes: string | null;
}

interface WorksheetItem {
  id: number;
  worksheetId: number;
  orderItemId: number | null;
  productName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientType: string;
  recipientName: string | null;
  finishId: number | null;
  finishName: string | null;
  processes: ProcessStep[];
  notes: string | null;
}

interface Worksheet {
  id: number;
  worksheetNumber: string;
  status: "pre_wip" | "wip" | "complete";
  orderId: number | null;
  orderNumber: string | null;
  customerId: number | null;
  customerName: string | null;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: WorksheetItem[];
}

const STATUS_CONFIG = {
  pre_wip: { label: "Pre-WIP", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Clock },
  wip: { label: "Work in Progress", color: "bg-amber-100 text-amber-800 border-amber-200", icon: ClipboardList },
  complete: { label: "Complete", color: "bg-green-100 text-green-800 border-green-200", icon: CheckCircle2 },
};

function PrintWorksheet({ ws }: { ws: Worksheet }) {
  const allProcesses = ws.items.flatMap((item) => item.processes);
  const uniqueProcesses = Array.from(
    new Map(allProcesses.map((p) => [p.id, p])).values()
  );

  return (
    <div className="print-only bg-white text-black font-sans text-sm" style={{ width: "210mm", minHeight: "297mm", padding: "12mm 15mm", boxSizing: "border-box" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6mm", borderBottom: "2px solid #1e3a5f", paddingBottom: "4mm" }}>
        <div>
          <div style={{ fontSize: "20px", fontWeight: "bold", color: "#1e3a5f" }}>PRODUCTION WORKSHEET</div>
          <div style={{ fontSize: "24px", fontWeight: "900", letterSpacing: "2px", color: "#1e3a5f", marginTop: "2px" }}>{ws.worksheetNumber}</div>
        </div>
        <div style={{ textAlign: "right", fontSize: "11px", color: "#555" }}>
          <div style={{ fontWeight: "bold", fontSize: "14px" }}>Select Branding Solutions</div>
          <div>Date: {formatDate(ws.createdAt)}</div>
          <div>Order: <strong>{ws.orderNumber ?? "—"}</strong></div>
          <div>Customer: <strong>{ws.customerName ?? "—"}</strong></div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6mm", fontSize: "11px" }}>
        <thead>
          <tr style={{ backgroundColor: "#1e3a5f", color: "white" }}>
            <th style={{ padding: "3mm 2mm", textAlign: "left" }}>Product</th>
            <th style={{ padding: "3mm 2mm", textAlign: "left" }}>Colour</th>
            <th style={{ padding: "3mm 2mm", textAlign: "left" }}>Size</th>
            <th style={{ padding: "3mm 2mm", textAlign: "center" }}>Qty</th>
            <th style={{ padding: "3mm 2mm", textAlign: "left" }}>For / Recipient</th>
            <th style={{ padding: "3mm 2mm", textAlign: "left" }}>Finish</th>
          </tr>
        </thead>
        <tbody>
          {ws.items.map((item, idx) => (
            <tr key={item.id} style={{ backgroundColor: idx % 2 === 0 ? "#f8f9fb" : "white", borderBottom: "1px solid #ddd" }}>
              <td style={{ padding: "2.5mm 2mm", fontWeight: "600" }}>{item.productName}</td>
              <td style={{ padding: "2.5mm 2mm" }}>{item.colour ?? "—"}</td>
              <td style={{ padding: "2.5mm 2mm" }}>{item.size ?? "—"}</td>
              <td style={{ padding: "2.5mm 2mm", textAlign: "center", fontWeight: "bold" }}>{item.quantity}</td>
              <td style={{ padding: "2.5mm 2mm" }}>
                {item.recipientType === "person" && item.recipientName ? item.recipientName : "Stock"}
              </td>
              <td style={{ padding: "2.5mm 2mm" }}>{item.finishName ?? "Plain"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {uniqueProcesses.length > 0 && (
        <>
          <div style={{ fontWeight: "bold", fontSize: "13px", color: "#1e3a5f", marginBottom: "2mm", borderBottom: "1px solid #ccc", paddingBottom: "1mm" }}>
            PROCESSES &amp; FINISHES
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "6mm", fontSize: "11px" }}>
            <thead>
              <tr style={{ backgroundColor: "#4a7bb5", color: "white" }}>
                <th style={{ padding: "2.5mm 2mm", textAlign: "left" }}>Process</th>
                <th style={{ padding: "2.5mm 2mm", textAlign: "left" }}>Type</th>
                <th style={{ padding: "2.5mm 2mm", textAlign: "left" }}>Placement</th>
                <th style={{ padding: "2.5mm 2mm", textAlign: "left" }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {uniqueProcesses.map((p, idx) => (
                <tr key={p.id} style={{ backgroundColor: idx % 2 === 0 ? "#f0f4fa" : "white", borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "2.5mm 2mm", fontWeight: "600" }}>{p.name}</td>
                  <td style={{ padding: "2.5mm 2mm" }}>{p.type ?? "—"}</td>
                  <td style={{ padding: "2.5mm 2mm" }}>{p.placement ?? "—"}</td>
                  <td style={{ padding: "2.5mm 2mm" }}>{p.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {ws.notes && (
        <div style={{ marginBottom: "6mm", padding: "3mm", backgroundColor: "#fffbe6", border: "1px solid #f0c040", borderRadius: "3px" }}>
          <strong>Notes:</strong> {ws.notes}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "5mm", marginTop: "auto", paddingTop: "8mm" }}>
        {["Checked by", "Started", "Completed"].map((label) => (
          <div key={label} style={{ border: "1px solid #aaa", borderRadius: "3px", padding: "3mm" }}>
            <div style={{ fontSize: "9px", color: "#888", marginBottom: "8mm" }}>{label}</div>
            <div style={{ borderTop: "1px solid #aaa", paddingTop: "1mm", fontSize: "9px", color: "#888" }}>Signature / Date</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorksheetCard({
  ws,
  onStatusChange,
  onDelete,
}: {
  ws: Worksheet;
  onStatusChange: (id: number, status: "pre_wip" | "wip" | "complete") => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[ws.status];
  const StatusIcon = cfg.icon;

  const handlePrint = () => {
    const win = window.open("", "_blank", "width=900,height=1200");
    if (!win) return;
    const html = document.getElementById(`ws-print-${ws.id}`)?.outerHTML ?? "";
    win.document.write(`
      <!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>${ws.worksheetNumber}</title>
      <style>
        @page { size: A4; margin: 0; }
        body { margin: 0; font-family: Arial, sans-serif; }
        table { page-break-inside: avoid; }
      </style>
      </head><body>${html}</body></html>
    `);
    win.document.close();
    win.focus();
    win.print();
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-base">{ws.worksheetNumber}</span>
              <Badge className={`text-xs ${cfg.color} gap-1`}>
                <StatusIcon className="w-3 h-3" />
                {cfg.label}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground mt-0.5">
              {ws.orderNumber && <span>Order {ws.orderNumber} · </span>}
              {ws.customerName && <span>{ws.customerName} · </span>}
              <span>{ws.items.length} item{ws.items.length !== 1 ? "s" : ""}</span>
              <span className="ml-2 text-xs">{formatDate(ws.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {ws.status === "pre_wip" && (
            <Button size="sm" className="gap-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white" onClick={() => onStatusChange(ws.id, "wip")}>
              <ArrowRight className="w-3.5 h-3.5" /> Move to WIP
            </Button>
          )}
          {ws.status === "wip" && (
            <>
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
                <Printer className="w-3.5 h-3.5" /> Print
              </Button>
              <Button size="sm" className="gap-1.5 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={() => onStatusChange(ws.id, "complete")}>
                <CheckCircle2 className="w-3.5 h-3.5" /> Mark Complete
              </Button>
            </>
          )}
          {ws.status === "complete" && (
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-8 w-8 text-red-500 hover:bg-red-50" onClick={() => onDelete(ws.id)}>
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-3">
          {ws.items.map((item) => (
            <div key={item.id} className="rounded-lg bg-muted/30 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold">{item.productName}</div>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  {item.colour && <Badge variant="outline" className="text-xs gap-1"><Palette className="w-3 h-3" />{item.colour}</Badge>}
                  {item.size && <Badge variant="outline" className="text-xs gap-1"><Ruler className="w-3 h-3" />{item.size}</Badge>}
                  <Badge variant="secondary" className="text-xs font-semibold">× {item.quantity}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {item.recipientType === "person" ? <><User className="w-3 h-3" />{item.recipientName}</> : <><Archive className="w-3 h-3" />Stock</>}
                </span>
                {item.finishName && (
                  <span className="flex items-center gap-1"><Sparkles className="w-3 h-3 text-amber-500" />{item.finishName}</span>
                )}
              </div>
              {item.processes.length > 0 && (
                <div className="space-y-1">
                  {item.processes.map((p) => (
                    <div key={p.id} className="text-xs text-muted-foreground flex gap-2 pl-2 border-l-2 border-amber-300">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {p.type && <span>· {p.type}</span>}
                      {p.placement && <span>· {p.placement}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {ws.notes && (
            <div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">{ws.notes}</div>
          )}
        </div>
      )}

      <div id={`ws-print-${ws.id}`} style={{ display: "none" }}>
        <PrintWorksheet ws={ws} />
      </div>
    </div>
  );
}

export default function Production() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pre_wip");

  const { data: allWorksheets = [], isLoading } = useQuery<Worksheet[]>({
    queryKey: ["worksheets"],
    queryFn: () => apiFetch("/worksheets"),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/worksheets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      toast({ title: "Status updated" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/worksheets/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["worksheets"] });
      toast({ title: "Worksheet deleted" });
    },
    onError: () => toast({ title: "Error", variant: "destructive" }),
  });

  const handleDelete = (id: number) => {
    if (!confirm("Delete this worksheet?")) return;
    deleteMutation.mutate(id);
  };

  const preWip = allWorksheets.filter((w) => w.status === "pre_wip");
  const wip = allWorksheets.filter((w) => w.status === "wip");
  const complete = allWorksheets.filter((w) => w.status === "complete");

  const TAB_COUNTS = [
    { key: "pre_wip", label: "Pre-WIP", count: preWip.length, icon: Clock, color: "text-blue-600" },
    { key: "wip", label: "Work in Progress", count: wip.length, icon: ClipboardList, color: "text-amber-600" },
    { key: "complete", label: "Complete", count: complete.length, icon: CheckCircle2, color: "text-green-600" },
  ];

  const worksheetsForTab = { pre_wip: preWip, wip, complete };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <ClipboardList className="w-7 h-7 text-primary" />
              Production
            </h1>
            <p className="text-muted-foreground mt-1">Manage worksheets and track work in progress.</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => queryClient.invalidateQueries({ queryKey: ["worksheets"] })}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {TAB_COUNTS.map((t) => {
            const Icon = t.icon;
            return (
              <div
                key={t.key}
                className={`rounded-xl border bg-card p-4 cursor-pointer transition-all ${activeTab === t.key ? "border-primary shadow-md" : "border-border hover:border-primary/40"}`}
                onClick={() => setActiveTab(t.key)}
              >
                <div className="flex items-center gap-2">
                  <Icon className={`w-5 h-5 ${t.color}`} />
                  <span className="font-medium text-sm">{t.label}</span>
                </div>
                <div className={`text-3xl font-bold mt-1 ${t.color}`}>{t.count}</div>
              </div>
            );
          })}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            {TAB_COUNTS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-2">
                {t.label}
                {t.count > 0 && <Badge variant="secondary" className="ml-1 text-xs">{t.count}</Badge>}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.entries(worksheetsForTab).map(([status, items]) => (
            <TabsContent key={status} value={status}>
              {isLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
                  {status === "pre_wip" ? <Clock className="w-12 h-12 text-blue-300" /> :
                    status === "wip" ? <ClipboardList className="w-12 h-12 text-amber-300" /> :
                      <CheckCircle2 className="w-12 h-12 text-green-300" />}
                  <p className="text-lg font-medium">
                    {status === "pre_wip" ? "Nothing in pre-production" :
                      status === "wip" ? "No active worksheets" :
                        "No completed worksheets yet"}
                  </p>
                  <p className="text-sm text-center max-w-xs">
                    {status === "pre_wip"
                      ? "Use 'Send to Production' on order line items to create worksheets here."
                      : status === "wip"
                        ? "Move pre-WIP items here when goods arrive and decoration begins."
                        : "Completed worksheets will appear here."}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((ws) => (
                    <WorksheetCard
                      key={ws.id}
                      ws={ws}
                      onStatusChange={(id, s) => statusMutation.mutate({ id, status: s })}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </Layout>
  );
}
