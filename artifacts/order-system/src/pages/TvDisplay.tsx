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

const VARIANT_STYLES = {
  overdue: {
    card:   "border-red-800/70 bg-red-950/40",
    header: "border-b border-red-800/40",
    dot:    "bg-red-500",
    text:   "text-red-400",
    badge:  "bg-red-900/60 text-red-300 border border-red-700",
    pill:   "bg-red-900/50 border border-red-700/60 text-red-100",
    count:  "text-red-300 font-bold",
  },
  today: {
    card:   "border-orange-800/70 bg-orange-950/40",
    header: "border-b border-orange-800/40",
    dot:    "bg-orange-500",
    text:   "text-orange-400",
    badge:  "bg-orange-900/60 text-orange-300 border border-orange-700",
    pill:   "bg-orange-900/50 border border-orange-700/60 text-orange-100",
    count:  "text-orange-300 font-bold",
  },
  soon: {
    card:   "border-amber-700/60 bg-amber-950/30",
    header: "border-b border-amber-700/40",
    dot:    "bg-amber-400",
    text:   "text-amber-400",
    badge:  "bg-amber-900/60 text-amber-300 border border-amber-700",
    pill:   "bg-amber-900/50 border border-amber-700/60 text-amber-100",
    count:  "text-amber-300 font-bold",
  },
};

function daysLabel(days: number | null): string {
  if (days === null) return "No due date";
  if (days < 0)  return `${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""} overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function OrderCard({ group, variant }: { group: PlanTaskGroup; variant: keyof typeof VARIANT_STYLES }) {
  const s = VARIANT_STYLES[variant];
  return (
    <div className={`rounded-xl border ${s.card} overflow-hidden`}>
      {/* Customer name header */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${s.header}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
          <span className={`font-bold text-white text-base truncate`}>{group.customerName}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 ${s.badge}`}>
            {daysLabel(group.daysUntilDue)}
          </span>
        </div>
        <span className={`text-xl font-black tabular-nums ml-3 flex-shrink-0 ${s.text}`}>{group.totalQty}</span>
      </div>
      {/* Finish pills */}
      <div className="px-4 py-2.5 flex flex-wrap gap-1.5">
        {(group.finishes ?? []).map((f, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-sm leading-none ${s.pill}`}
          >
            <span className="truncate max-w-[22ch]">{f.finishName}</span>
            <span className={`text-xs tabular-nums ${s.count}`}>{f.qty}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

interface SectionProps {
  heading: string;
  groups: PlanTaskGroup[];
  variant: keyof typeof VARIANT_STYLES;
  dotColor: string;
  headingColor: string;
}

function Section({ heading, groups, variant, dotColor, headingColor }: SectionProps) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-2">
      <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest mb-3 ${headingColor}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        {heading}
        <span className="font-normal opacity-50 normal-case tracking-normal ml-1">
          — {groups.length} order{groups.length !== 1 ? "s" : ""}
        </span>
      </div>
      {groups.map((g) => (
        <OrderCard key={g.customerName + g.daysUntilDue} group={g} variant={variant} />
      ))}
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
      className="min-h-screen flex flex-col text-white select-none"
      style={{ background: "#0f172a", fontFamily: "'Segoe UI', Arial, sans-serif" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-4 border-b border-white/10 flex-shrink-0">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-slate-500 mb-0.5">
            Select Branding Solutions
          </div>
          <div className="text-xl font-black tracking-tight text-white">
            ⚡ Production — Today's Plan
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-black tabular-nums tracking-tight">{formatTime(now)}</div>
          <div className="text-sm text-slate-400">{formatDateLong(now)}</div>
        </div>
      </div>

      {/* Summary strip */}
      {plan && (
        <div className={`flex items-center gap-5 px-8 py-2 border-b border-white/10 flex-shrink-0 flex-wrap
          ${urgentTotal > 0 ? "bg-red-950/30" : "bg-green-950/20"}`}>
          <span className={`text-sm font-bold ${urgentTotal > 0 ? "text-red-400" : "text-green-400"}`}>
            {urgentTotal > 0
              ? `${urgentTotal} order${urgentTotal !== 1 ? "s" : ""} need attention`
              : "✓ All urgent work under control"}
          </span>
          <div className="flex items-center gap-4 ml-auto text-xs flex-wrap">
            {plan.summary.overdue  > 0 && <span className="text-red-400 font-semibold">● {plan.summary.overdue} overdue</span>}
            {plan.summary.today    > 0 && <span className="text-orange-400 font-semibold">● {plan.summary.today} today</span>}
            {plan.summary.soon     > 0 && <span className="text-amber-400 font-semibold">● {plan.summary.soon} tomorrow</span>}
            {plan.summary.thisWeek > 0 && <span className="text-blue-400">● {plan.summary.thisWeek} this week</span>}
            {plan.summary.upcoming > 0 && <span className="text-slate-500">● {plan.summary.upcoming} upcoming</span>}
          </div>
          {lastRefreshed && (
            <span className="text-[10px] text-slate-600 ml-2">Updated {formatTime(lastRefreshed)}</span>
          )}
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 px-8 py-5 space-y-8 overflow-y-auto">
        {error && (
          <div className="rounded-lg bg-red-950/60 border border-red-700 text-red-300 px-5 py-4 text-sm font-medium text-center">
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="flex items-center justify-center h-40 text-slate-500">Loading…</div>
        )}

        {plan && urgentTotal === 0 && (
          <div className="flex flex-col items-center justify-center h-56 gap-3">
            <div className="text-5xl">✅</div>
            <div className="text-xl font-bold text-green-400">All urgent work is complete</div>
            {(plan.summary.thisWeek + plan.summary.upcoming) > 0 && (
              <div className="text-slate-400 text-sm">
                {plan.summary.thisWeek + plan.summary.upcoming} further order{(plan.summary.thisWeek + plan.summary.upcoming) !== 1 ? "s" : ""} later this week or upcoming
              </div>
            )}
          </div>
        )}

        {plan && urgentTotal > 0 && (
          <div className="space-y-8 max-w-5xl">
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
