import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, AlertCircle, Lightbulb, Clock, CheckCircle2, Loader2, User, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

async function apiFetch<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const actor = localStorage.getItem("sbs_actor_name") || "";
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(actor ? { "x-actor": actor } : {}), ...opts?.headers },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface FeedbackItem {
  id: number;
  type: "critical" | "minor" | "feature";
  title: string;
  description: string;
  submitted_by: string;
  source: "staff" | "portal";
  status: "open" | "in_progress" | "resolved";
  created_at: string;
}

const TYPE_CONFIG = {
  critical: { label: "Critical Issue", icon: AlertTriangle, color: "text-red-600", bg: "bg-red-50 border-red-200", badge: "bg-red-100 text-red-700" },
  minor: { label: "Minor Issue", icon: AlertCircle, color: "text-amber-600", bg: "bg-amber-50 border-amber-200", badge: "bg-amber-100 text-amber-700" },
  feature: { label: "Feature Request", icon: Lightbulb, color: "text-blue-600", bg: "bg-blue-50 border-blue-200", badge: "bg-blue-100 text-blue-700" },
};

const STATUS_CONFIG = {
  open: { label: "Open", icon: Clock, color: "text-slate-600", badge: "bg-slate-100 text-slate-700" },
  in_progress: { label: "In Progress", icon: Loader2, color: "text-purple-600", badge: "bg-purple-100 text-purple-700" },
  resolved: { label: "Resolved", icon: CheckCircle2, color: "text-green-600", badge: "bg-green-100 text-green-700" },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Feedback() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("open");

  const { data: items = [], isLoading } = useQuery<FeedbackItem[]>({
    queryKey: ["feedback"],
    queryFn: () => apiFetch("/feedback"),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["feedback"] }),
  });

  const filtered = items.filter(item => {
    if (typeFilter !== "all" && item.type !== typeFilter) return false;
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    return true;
  });

  const counts = {
    critical: items.filter(i => i.type === "critical" && i.status !== "resolved").length,
    minor: items.filter(i => i.type === "minor" && i.status !== "resolved").length,
    feature: items.filter(i => i.type === "feature" && i.status !== "resolved").length,
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Feedback & Issues</h1>
          <p className="text-sm text-muted-foreground mt-1">Issues and feature requests submitted by staff and portal customers.</p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-4">
          {(["critical", "minor", "feature"] as const).map(type => {
            const cfg = TYPE_CONFIG[type];
            const Icon = cfg.icon;
            return (
              <button
                key={type}
                onClick={() => { setTypeFilter(type); setStatusFilter("all"); }}
                className={cn(
                  "p-4 rounded-xl border text-left transition-all hover:shadow-sm",
                  cfg.bg,
                  typeFilter === type ? "ring-2 ring-offset-1 ring-current" : ""
                )}
              >
                <div className={cn("flex items-center gap-2 mb-1", cfg.color)}>
                  <Icon className="w-4 h-4" />
                  <span className="text-xs font-semibold uppercase tracking-wide">{cfg.label}</span>
                </div>
                <p className={cn("text-2xl font-bold", cfg.color)}>{counts[type]}</p>
                <p className="text-xs text-muted-foreground">open</p>
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="critical">Critical Issues</SelectItem>
              <SelectItem value="minor">Minor Issues</SelectItem>
              <SelectItem value="feature">Feature Requests</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{filtered.length} item{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        {/* Items list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
            <p className="font-medium">Nothing here</p>
            <p className="text-sm">No items match the current filters.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(item => {
              const typeCfg = TYPE_CONFIG[item.type];
              const statusCfg = STATUS_CONFIG[item.status];
              const TypeIcon = typeCfg.icon;
              return (
                <div key={item.id} className={cn("rounded-xl border p-4 bg-card transition-all", item.status === "resolved" && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <div className={cn("mt-0.5 shrink-0", typeCfg.color)}>
                      <TypeIcon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", typeCfg.badge)}>
                          {typeCfg.label}
                        </span>
                        <span className={cn("text-xs font-semibold px-2 py-0.5 rounded-full", statusCfg.badge)}>
                          {statusCfg.label}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          {item.source === "portal" ? <Monitor className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          {item.source === "portal" ? "Customer Portal" : "Staff"}
                        </span>
                      </div>
                      <p className="font-semibold text-foreground leading-tight">{item.title}</p>
                      {item.description && (
                        <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{item.description}</p>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {item.submitted_by && <span>By {item.submitted_by}</span>}
                        <span>{fmtDate(item.created_at)}</span>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <Select
                        value={item.status}
                        onValueChange={status => updateStatus.mutate({ id: item.id, status })}
                      >
                        <SelectTrigger className="w-36 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="resolved">Resolved</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
