import { useEffect, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;

interface PlanTaskGroup {
  finishName: string;
  totalQty: number;
  orderCount: number;
  overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
  earliestRequired: string | null;
  tasks: unknown[];
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

function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateLong(d: Date): string {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

interface PillProps {
  group: PlanTaskGroup;
  variant: "overdue" | "today" | "soon";
}

function Pill({ group, variant }: PillProps) {
  const styles = {
    overdue: "bg-red-900/70 border border-red-600 text-red-100",
    today:   "bg-orange-900/70 border border-orange-600 text-orange-100",
    soon:    "bg-amber-900/70 border border-amber-600 text-amber-100",
  };
  const countStyles = {
    overdue: "bg-red-500/40 text-red-200",
    today:   "bg-orange-500/40 text-orange-200",
    soon:    "bg-amber-500/40 text-amber-200",
  };
  return (
    <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium leading-none ${styles[variant]}`}>
      <span className="max-w-[18ch] truncate">{group.finishName}</span>
      <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${countStyles[variant]}`}>
        {group.totalQty}
      </span>
    </div>
  );
}

interface SectionProps {
  heading: string;
  groups: PlanTaskGroup[];
  variant: "overdue" | "today" | "soon";
  dotColor: string;
  headingColor: string;
}

function Section({ heading, groups, variant, dotColor, headingColor }: SectionProps) {
  if (groups.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-widest ${headingColor}`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        {heading}
        <span className="font-normal opacity-60 normal-case tracking-normal text-xs ml-1">
          — {groups.length} batch{groups.length !== 1 ? "es" : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => (
          <Pill key={g.finishName} group={g} variant={variant} />
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
      if (res.status === 401 || res.status === 403) {
        setError("Invalid or missing token.");
        return;
      }
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
        <div className={`flex items-center gap-6 px-8 py-2 border-b border-white/10 flex-shrink-0 flex-wrap
          ${urgentTotal > 0 ? "bg-red-950/30" : "bg-green-950/20"}`}>
          <span className={`text-sm font-bold ${urgentTotal > 0 ? "text-red-400" : "text-green-400"}`}>
            {urgentTotal > 0
              ? `${urgentTotal} batch${urgentTotal !== 1 ? "es" : ""} need attention`
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
      <div className="flex-1 px-8 py-6 space-y-7 overflow-y-auto">
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
                {plan.summary.thisWeek + plan.summary.upcoming} further batch{(plan.summary.thisWeek + plan.summary.upcoming) !== 1 ? "es" : ""} later this week or upcoming
              </div>
            )}
          </div>
        )}

        {plan && urgentTotal > 0 && (
          <div className="space-y-7 max-w-6xl">
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
