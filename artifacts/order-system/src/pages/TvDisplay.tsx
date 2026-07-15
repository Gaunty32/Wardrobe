import { useEffect, useState, useCallback, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;

// ── Config (override via URL params) ─────────────────────────────────────────
function getParam(key: string, fallback: number) {
  const v = new URLSearchParams(window.location.search).get(key);
  const n = v ? parseInt(v, 10) : NaN;
  return isNaN(n) ? fallback : n;
}

const CARDS_PER_PAGE  = getParam("perPage",  9);   // cards per slide
const SLIDE_SECS      = getParam("secs",     12);  // seconds per slide

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlanFinish {
  finishName: string;
  qty: number;
  worksheetNumber: string | null;
  type: string;
}

interface PlanTaskGroup {
  finishName: string;
  customerName: string;
  finishes: PlanFinish[];
  totalQty: number;
  orderCount: number;
  overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
  earliestRequired: string | null;
}

interface DailyPlan {
  generatedAt: string;
  taskGroups: PlanTaskGroup[];
  summary: {
    overdue: number;
    today: number;
    soon: number;
    thisWeek: number;
    upcoming: number;
    urgentCount: number;
    urgentItems: number;
    totalItems: number;
  };
}

// ── Styles ────────────────────────────────────────────────────────────────────
const STYLES = {
  overdue: {
    card:   "border-red-700/80 bg-red-950/50",
    header: "border-b border-red-700/50 bg-red-900/30",
    dot:    "bg-red-500",
    text:   "text-red-400",
    badge:  "bg-red-900/80 text-red-200 border border-red-600",
    pill:   "bg-red-900/60 border border-red-700/60 text-red-100",
    count:  "text-red-300 font-black",
    tag:    "text-red-500",
  },
  today: {
    card:   "border-orange-700/80 bg-orange-950/50",
    header: "border-b border-orange-700/50 bg-orange-900/30",
    dot:    "bg-orange-500",
    text:   "text-orange-400",
    badge:  "bg-orange-900/80 text-orange-200 border border-orange-600",
    pill:   "bg-orange-900/60 border border-orange-700/60 text-orange-100",
    count:  "text-orange-300 font-black",
    tag:    "text-orange-500",
  },
  soon: {
    card:   "border-amber-700/70 bg-amber-950/40",
    header: "border-b border-amber-700/50 bg-amber-900/20",
    dot:    "bg-amber-400",
    text:   "text-amber-400",
    badge:  "bg-amber-900/80 text-amber-200 border border-amber-600",
    pill:   "bg-amber-900/60 border border-amber-700/60 text-amber-100",
    count:  "text-amber-300 font-black",
    tag:    "text-amber-500",
  },
} as const;

type Variant = keyof typeof STYLES;

function urgencyVariant(u: string): Variant {
  if (u === "overdue") return "overdue";
  if (u === "today")   return "today";
  return "soon";
}

function daysLabel(days: number | null): string {
  if (days === null) return "No due date";
  if (days < 0)  return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Card ──────────────────────────────────────────────────────────────────────
function OrderCard({ group }: { group: PlanTaskGroup }) {
  const v = urgencyVariant(group.urgency);
  const s = STYLES[v];
  const urgencyText =
    group.urgency === "overdue" ? "⚠ OVERDUE" :
    group.urgency === "today"   ? "DUE TODAY" :
                                  "TOMORROW";
  return (
    <div className={`rounded-2xl border-2 ${s.card} overflow-hidden flex flex-col h-full`}>
      <div className={`flex items-center justify-between px-5 py-3 ${s.header} gap-3`}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${s.dot}`} />
          <span className="font-black text-white leading-tight truncate" style={{ fontSize: "clamp(1rem, 1.6vw, 2rem)" }}>
            {group.customerName}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className={`font-black uppercase tracking-wider ${s.tag}`} style={{ fontSize: "clamp(0.65rem, 0.9vw, 1rem)" }}>
            {urgencyText}
          </span>
          <span className={`font-black tabular-nums ${s.text}`} style={{ fontSize: "clamp(1.4rem, 2.5vw, 3rem)" }}>
            {group.totalQty}
          </span>
        </div>
      </div>
      <div className="px-5 py-3 flex flex-wrap gap-2 flex-1 content-start">
        {(group.finishes ?? []).map((f, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${s.pill}`}
            style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}
          >
            <span className="truncate" style={{ maxWidth: "18ch" }}>{f.finishName}</span>
            <span className={`tabular-nums font-black ${s.count}`}>{f.qty}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ durationMs, running }: { durationMs: number; running: boolean }) {
  const [pct, setPct] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    setPct(0);
    startRef.current = Date.now();
    if (!running) return;
    const raf = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      setPct(Math.min(100, (elapsed / durationMs) * 100));
    }, 100);
    return () => clearInterval(raf);
  }, [running, durationMs]);

  return (
    <div className="w-full h-1 bg-white/10 flex-shrink-0">
      <div
        className="h-full bg-blue-500/60 transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TvDisplay() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [plan, setPlan]               = useState<DailyPlan | null>(null);
  const [error, setError]             = useState<string | null>(null);
  const [pageIndex, setPageIndex]     = useState(0);
  const [now, setNow]                 = useState(new Date());
  const [progressKey, setProgressKey] = useState(0);

  // ── Fetch plan ──────────────────────────────────────────────────────────────
  const fetchPlan = useCallback(async () => {
    if (!token) { setError("No token in URL."); return; }
    try {
      const res = await fetch(`${API_BASE}/tv/daily-plan?token=${encodeURIComponent(token)}`);
      if (res.status === 401 || res.status === 403) { setError("Invalid or missing token."); return; }
      if (!res.ok) { setError("Failed to load plan."); return; }
      const data: DailyPlan = await res.json();
      setPlan(data);
      setError(null);
    } catch {
      setError("Network error — retrying.");
    }
  }, [token]);

  useEffect(() => {
    fetchPlan();
    const dataTimer  = setInterval(fetchPlan, 30_000);
    const clockTimer = setInterval(() => setNow(new Date()), 60_000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, [fetchPlan]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const urgentGroups = [
    ...(plan?.taskGroups.filter((g) => g.urgency === "overdue") ?? []),
    ...(plan?.taskGroups.filter((g) => g.urgency === "today")   ?? []),
    ...(plan?.taskGroups.filter((g) => g.urgency === "soon")    ?? []),
  ];
  const pages      = urgentGroups.length > 0 ? chunk(urgentGroups, CARDS_PER_PAGE) : [];
  const totalPages = pages.length;

  // Auto-advance slides
  useEffect(() => {
    if (totalPages <= 1) return;
    const t = setInterval(() => {
      setPageIndex((i) => (i + 1) % totalPages);
      setProgressKey((k) => k + 1);
    }, SLIDE_SECS * 1000);
    return () => clearInterval(t);
  }, [totalPages]);

  // Reset to page 0 when plan refreshes
  useEffect(() => {
    setPageIndex(0);
    setProgressKey((k) => k + 1);
  }, [plan]);

  const currentPage   = pages[pageIndex] ?? [];
  const urgentTotal   = urgentGroups.length;
  const summary       = plan?.summary;

  return (
    <div
      className="h-screen w-screen flex flex-col text-white select-none overflow-hidden"
      style={{ background: "#0a0f1e", fontFamily: "'Segoe UI', Arial, sans-serif" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between border-b border-white/10 flex-shrink-0"
        style={{ padding: "clamp(0.5rem, 1vw, 1.2rem) clamp(1.5rem, 3vw, 4rem)" }}
      >
        <div className="flex items-center gap-4">
          <span className="font-black text-white" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
            ⚡ Production Plan
          </span>
          <span className="text-slate-500" style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.3rem)" }}>
            {formatDateLong(now)}
          </span>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-slate-400 font-medium" style={{ fontSize: "clamp(0.7rem, 1.1vw, 1.3rem)" }}>
              {pageIndex + 1} / {totalPages}
            </span>
            <div className="flex gap-1.5">
              {pages.map((_, i) => (
                <span
                  key={i}
                  className={`rounded-full transition-colors ${i === pageIndex ? "bg-blue-400" : "bg-white/20"}`}
                  style={{ width: "clamp(6px, 0.6vw, 10px)", height: "clamp(6px, 0.6vw, 10px)" }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {plan && (
        <div
          className={`flex items-center flex-wrap gap-x-6 border-b border-white/10 flex-shrink-0 ${
            urgentTotal > 0 ? "bg-red-950/30" : "bg-green-950/20"
          }`}
          style={{ padding: "clamp(0.4rem, 0.8vw, 1rem) clamp(1.5rem, 3vw, 4rem)" }}
        >
          <span
            className={`font-black ${urgentTotal > 0 ? "text-red-400" : "text-green-400"}`}
            style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.7rem)" }}
          >
            {urgentTotal > 0
              ? `${urgentTotal} order${urgentTotal !== 1 ? "s" : ""} need attention`
              : "✓ All urgent work under control"}
          </span>
          <div className="flex items-center gap-6 ml-auto flex-wrap">
            {(summary?.overdue  ?? 0) > 0 && <span className="text-red-400    font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.overdue} overdue</span>}
            {(summary?.today    ?? 0) > 0 && <span className="text-orange-400 font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.today} today</span>}
            {(summary?.soon     ?? 0) > 0 && <span className="text-amber-400  font-bold" style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.soon} tomorrow</span>}
            {(summary?.thisWeek ?? 0) > 0 && <span className="text-blue-400"             style={{ fontSize: "clamp(0.8rem, 1.1vw, 1.3rem)" }}>● {summary!.thisWeek} this week</span>}
          </div>
        </div>
      )}

      {/* ── Cards grid ─────────────────────────────────────────────────────── */}
      <div
        className="flex-1 overflow-hidden"
        style={{ padding: "clamp(0.75rem, 1.5vw, 2rem) clamp(1.5rem, 3vw, 4rem)" }}
      >
        {error && (
          <div
            className="flex items-center justify-center h-full rounded-2xl bg-red-950/60 border-2 border-red-700 text-red-300 font-bold"
            style={{ fontSize: "clamp(1rem, 1.8vw, 2rem)" }}
          >
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="flex items-center justify-center h-full text-slate-500" style={{ fontSize: "clamp(1rem, 2vw, 2.5rem)" }}>
            Loading…
          </div>
        )}

        {plan && urgentTotal === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-6">
            <div style={{ fontSize: "clamp(4rem, 10vw, 12rem)" }}>✅</div>
            <div className="font-black text-green-400" style={{ fontSize: "clamp(1.5rem, 3vw, 4rem)" }}>
              All urgent work is complete
            </div>
            {((summary?.thisWeek ?? 0) + (summary?.upcoming ?? 0)) > 0 && (
              <div className="text-slate-400" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
                {(summary!.thisWeek + summary!.upcoming)} further order{(summary!.thisWeek + summary!.upcoming) !== 1 ? "s" : ""} later this week
              </div>
            )}
          </div>
        )}

        {plan && currentPage.length > 0 && (
          <div
            className="h-full"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gridAutoRows: "1fr",
              gap: "clamp(0.5rem, 1vw, 1.5rem)",
            }}
          >
            {currentPage.map((g) => (
              <OrderCard key={g.customerName + g.daysUntilDue + g.urgency} group={g} />
            ))}
          </div>
        )}
      </div>

      {/* ── Progress bar (advances when multiple pages) ─────────────────────── */}
      <ProgressBar
        key={progressKey}
        durationMs={SLIDE_SECS * 1000}
        running={totalPages > 1}
      />
    </div>
  );
}
