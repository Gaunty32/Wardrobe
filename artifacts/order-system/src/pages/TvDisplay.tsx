import { useEffect, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;

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

const STYLES = {
  overdue: {
    card:    "border-red-700/80 bg-red-950/50",
    header:  "border-b border-red-700/50 bg-red-900/30",
    dot:     "bg-red-500",
    text:    "text-red-400",
    badge:   "bg-red-900/80 text-red-200 border border-red-600",
    pill:    "bg-red-900/60 border border-red-700/60 text-red-100",
    count:   "text-red-300 font-black",
    label:   "text-red-500",
  },
  today: {
    card:    "border-orange-700/80 bg-orange-950/50",
    header:  "border-b border-orange-700/50 bg-orange-900/30",
    dot:     "bg-orange-500",
    text:    "text-orange-400",
    badge:   "bg-orange-900/80 text-orange-200 border border-orange-600",
    pill:    "bg-orange-900/60 border border-orange-700/60 text-orange-100",
    count:   "text-orange-300 font-black",
    label:   "text-orange-500",
  },
  soon: {
    card:    "border-amber-700/70 bg-amber-950/40",
    header:  "border-b border-amber-700/50 bg-amber-900/20",
    dot:     "bg-amber-400",
    text:    "text-amber-400",
    badge:   "bg-amber-900/80 text-amber-200 border border-amber-600",
    pill:    "bg-amber-900/60 border border-amber-700/60 text-amber-100",
    count:   "text-amber-300 font-black",
    label:   "text-amber-500",
  },
} as const;

function daysLabel(days: number | null): string {
  if (days === null) return "No due date";
  if (days < 0)  return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Tomorrow";
  return `${days} days`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function OrderCard({ group, variant }: { group: PlanTaskGroup; variant: keyof typeof STYLES }) {
  const s = STYLES[variant];
  return (
    <div className={`rounded-2xl border-2 ${s.card} overflow-hidden flex flex-col`}>
      {/* Customer name header */}
      <div className={`flex items-center justify-between px-5 py-4 ${s.header} gap-3`}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${s.dot}`} />
          <span className="font-black text-white leading-tight truncate" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
            {group.customerName}
          </span>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className={`px-3 py-1 rounded-full font-bold whitespace-nowrap ${s.badge}`} style={{ fontSize: "clamp(0.75rem, 1.1vw, 1.3rem)" }}>
            {daysLabel(group.daysUntilDue)}
          </span>
          <span className={`font-black tabular-nums ${s.text}`} style={{ fontSize: "clamp(1.5rem, 3vw, 3.5rem)" }}>
            {group.totalQty}
          </span>
        </div>
      </div>
      {/* Finish pills */}
      <div className="px-5 py-4 flex flex-wrap gap-2 flex-1 content-start">
        {(group.finishes ?? []).map((f, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 ${s.pill}`}
            style={{ fontSize: "clamp(0.8rem, 1.3vw, 1.5rem)" }}
          >
            <span className="truncate" style={{ maxWidth: "20ch" }}>{f.finishName}</span>
            <span className={`tabular-nums font-black ${s.count}`}>{f.qty}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Section({ heading, groups, variant, dotColor, headingColor }: {
  heading: string;
  groups: PlanTaskGroup[];
  variant: keyof typeof STYLES;
  dotColor: string;
  headingColor: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-4">
      <div className={`flex items-center gap-3 font-black uppercase tracking-widest ${headingColor}`} style={{ fontSize: "clamp(0.9rem, 1.4vw, 1.7rem)" }}>
        <span className={`w-3 h-3 rounded-full flex-shrink-0 ${dotColor}`} />
        {heading}
        <span className="font-normal opacity-50 normal-case tracking-normal">
          — {groups.length} order{groups.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 30vw), 1fr))" }}>
        {groups.map((g) => (
          <OrderCard key={g.customerName + g.daysUntilDue} group={g} variant={variant} />
        ))}
      </div>
    </div>
  );
}

export default function TvDisplay() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  const fetchPlan = useCallback(async () => {
    if (!token) { setError("No token in URL."); return; }
    try {
      const res = await fetch(`${API_BASE}/tv/daily-plan?token=${encodeURIComponent(token)}`);
      if (res.status === 401 || res.status === 403) { setError("Invalid or missing token."); return; }
      if (!res.ok) { setError("Failed to load plan."); return; }
      const data: DailyPlan = await res.json();
      setPlan(data);
      setLastRefreshed(new Date());
      setError(null);
    } catch {
      setError("Network error — retrying.");
    }
  }, [token]);

  useEffect(() => {
    fetchPlan();
    const dataTimer  = setInterval(fetchPlan, 30_000);
    const clockTimer = setInterval(() => setNow(new Date()), 1_000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, [fetchPlan]);

  const overdue = plan?.taskGroups.filter((g) => g.urgency === "overdue") ?? [];
  const today   = plan?.taskGroups.filter((g) => g.urgency === "today")   ?? [];
  const soon    = plan?.taskGroups.filter((g) => g.urgency === "soon")    ?? [];
  const urgentTotal = overdue.length + today.length + soon.length;

  return (
    <div
      className="min-h-screen flex flex-col text-white select-none overflow-hidden"
      style={{ background: "#0a0f1e", fontFamily: "'Segoe UI', Arial, sans-serif" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-white/10 flex-shrink-0"
           style={{ padding: "clamp(0.75rem, 1.5vw, 2rem) clamp(1.5rem, 3vw, 4rem)" }}>
        <div>
          <div className="font-bold tracking-[0.25em] uppercase text-slate-500"
               style={{ fontSize: "clamp(0.6rem, 0.9vw, 1rem)" }}>
            Select Branding Solutions
          </div>
          <div className="font-black tracking-tight text-white"
               style={{ fontSize: "clamp(1.2rem, 2.5vw, 3rem)" }}>
            ⚡ Production — Today's Plan
          </div>
        </div>
        <div className="text-right">
          <div className="font-black tabular-nums tracking-tight"
               style={{ fontSize: "clamp(2rem, 7vw, 8rem)", lineHeight: 1 }}>
            {formatTime(now)}
          </div>
          <div className="text-slate-400"
               style={{ fontSize: "clamp(0.75rem, 1.4vw, 1.6rem)" }}>
            {formatDateLong(now)}
          </div>
        </div>
      </div>

      {/* ── Summary strip ──────────────────────────────────────────────────── */}
      {plan && (
        <div className={`flex items-center flex-wrap gap-x-6 gap-y-1 border-b border-white/10 flex-shrink-0
          ${urgentTotal > 0 ? "bg-red-950/30" : "bg-green-950/20"}`}
             style={{ padding: "clamp(0.5rem, 1vw, 1.2rem) clamp(1.5rem, 3vw, 4rem)" }}>
          <span className={`font-black ${urgentTotal > 0 ? "text-red-400" : "text-green-400"}`}
                style={{ fontSize: "clamp(0.9rem, 1.5vw, 1.8rem)" }}>
            {urgentTotal > 0
              ? `${urgentTotal} order${urgentTotal !== 1 ? "s" : ""} need attention`
              : "✓ All urgent work under control"}
          </span>
          <div className="flex items-center gap-6 ml-auto flex-wrap">
            {plan.summary.overdue  > 0 && <span className="text-red-400 font-bold" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}>● {plan.summary.overdue} overdue</span>}
            {plan.summary.today    > 0 && <span className="text-orange-400 font-bold" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}>● {plan.summary.today} today</span>}
            {plan.summary.soon     > 0 && <span className="text-amber-400 font-bold" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}>● {plan.summary.soon} tomorrow</span>}
            {plan.summary.thisWeek > 0 && <span className="text-blue-400" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}>● {plan.summary.thisWeek} this week</span>}
            {plan.summary.upcoming > 0 && <span className="text-slate-500" style={{ fontSize: "clamp(0.8rem, 1.2vw, 1.4rem)" }}>● {plan.summary.upcoming} upcoming</span>}
          </div>
          {lastRefreshed && (
            <span className="text-slate-600" style={{ fontSize: "clamp(0.6rem, 0.85vw, 1rem)" }}>
              Updated {formatTime(lastRefreshed)}
            </span>
          )}
        </div>
      )}

      {/* ── Main content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto space-y-8"
           style={{ padding: "clamp(1rem, 2vw, 3rem) clamp(1.5rem, 3vw, 4rem)" }}>

        {error && (
          <div className="rounded-2xl bg-red-950/60 border-2 border-red-700 text-red-300 font-bold text-center"
               style={{ padding: "clamp(1rem, 2vw, 2.5rem)", fontSize: "clamp(1rem, 1.8vw, 2rem)" }}>
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="flex items-center justify-center" style={{ height: "30vh", fontSize: "clamp(1.2rem, 2vw, 2.5rem)", color: "#475569" }}>
            Loading…
          </div>
        )}

        {plan && urgentTotal === 0 && (
          <div className="flex flex-col items-center justify-center gap-6" style={{ height: "50vh" }}>
            <div style={{ fontSize: "clamp(4rem, 10vw, 12rem)" }}>✅</div>
            <div className="font-black text-green-400" style={{ fontSize: "clamp(1.5rem, 3vw, 4rem)" }}>
              All urgent work is complete
            </div>
            {(plan.summary.thisWeek + plan.summary.upcoming) > 0 && (
              <div className="text-slate-400" style={{ fontSize: "clamp(1rem, 1.8vw, 2.2rem)" }}>
                {plan.summary.thisWeek + plan.summary.upcoming} further order{(plan.summary.thisWeek + plan.summary.upcoming) !== 1 ? "s" : ""} later this week
              </div>
            )}
          </div>
        )}

        {plan && urgentTotal > 0 && (
          <div className="space-y-10">
            <Section
              heading="Overdue — Complete Immediately"
              groups={overdue}
              variant="overdue"
              dotColor="bg-red-500"
              headingColor="text-red-400"
            />
            <Section
              heading="Due Today — Start First"
              groups={today}
              variant="today"
              dotColor="bg-orange-500"
              headingColor="text-orange-400"
            />
            <Section
              heading="Tomorrow — Plan Today"
              groups={soon}
              variant="soon"
              dotColor="bg-amber-400"
              headingColor="text-amber-400"
            />
          </div>
        )}
      </div>
    </div>
  );
}
