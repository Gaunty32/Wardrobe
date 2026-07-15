import { useEffect, useState, useCallback } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_BASE = `${BASE}/api`;

interface PlanTaskItem {
  productName: string;
  colour: string | null;
  size: string | null;
  qty: number;
  recipient: string | null;
}

interface PlanTask {
  type: "picking" | "pre_wip" | "wip";
  worksheetId: number | null;
  worksheetNumber: string | null;
  orderId: number | null;
  orderNumber: string | null;
  customerName: string | null;
  requiredDate: string | null;
  qty: number;
  items: PlanTaskItem[];
}

interface PlanTaskGroup {
  finishName: string;
  totalQty: number;
  orderCount: number;
  overallStatus: "in_progress" | "ready" | "pick_first" | "mixed";
  urgency: "overdue" | "today" | "soon" | "this_week" | "upcoming";
  daysUntilDue: number | null;
  earliestRequired: string | null;
  tasks: PlanTask[];
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

const URGENCY = {
  overdue:   { label: "Overdue — Act Now",  border: "border-l-red-500",    badge: "bg-red-900/60 text-red-300 border border-red-700",   dot: "bg-red-400",    text: "text-red-400",    cardBg: "bg-red-950/40 border-red-800/60" },
  today:     { label: "Due Today",          border: "border-l-orange-500", badge: "bg-orange-900/60 text-orange-300 border border-orange-700", dot: "bg-orange-400", text: "text-orange-400", cardBg: "bg-orange-950/40 border-orange-800/60" },
  soon:      { label: "Due in 1–2 Days",    border: "border-l-amber-400",  badge: "bg-amber-900/60 text-amber-300 border border-amber-700",  dot: "bg-amber-400",  text: "text-amber-400",  cardBg: "bg-amber-950/40 border-amber-800/60" },
  this_week: { label: "Due This Week",      border: "border-l-blue-500",   badge: "bg-blue-900/60 text-blue-300 border border-blue-700",    dot: "bg-blue-400",   text: "text-blue-400",   cardBg: "bg-blue-950/40 border-blue-800/60" },
  upcoming:  { label: "Upcoming",           border: "border-l-slate-500",  badge: "bg-slate-800 text-slate-400 border border-slate-700",     dot: "bg-slate-500",  text: "text-slate-400",  cardBg: "bg-slate-800/40 border-slate-700/60" },
};

const STATUS = {
  in_progress: { label: "In Progress",    color: "text-amber-400" },
  ready:       { label: "Ready to Start", color: "text-green-400" },
  pick_first:  { label: "Needs Picking",  color: "text-purple-400" },
  mixed:       { label: "Mixed Stages",   color: "text-slate-400" },
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

function TaskGroupCard({ group }: { group: PlanTaskGroup }) {
  const urg = URGENCY[group.urgency] ?? URGENCY.upcoming;
  const stat = STATUS[group.overallStatus] ?? STATUS.mixed;

  return (
    <div className={`rounded-xl border border-l-4 ${urg.border} ${urg.cardBg} overflow-hidden`}>
      <div className="flex items-center gap-4 px-5 py-4">
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${urg.dot}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-white font-bold text-lg leading-tight">{group.finishName}</span>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${urg.badge}`}>{urg.label}</span>
            <span className={`text-sm font-medium ${stat.color}`}>{stat.label}</span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-400 flex-wrap">
            <span className={`font-medium ${urg.text}`}>{daysLabel(group.daysUntilDue)}</span>
            <span>{group.totalQty} item{group.totalQty !== 1 ? "s" : ""} · {group.orderCount} order{group.orderCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
        <div className={`text-3xl font-black tabular-nums ${urg.text} flex-shrink-0`}>
          {group.totalQty}
        </div>
      </div>

      {group.tasks.length > 0 && (
        <div className="border-t border-white/10 divide-y divide-white/5">
          {group.tasks.map((task, i) => (
            <div key={i} className="px-5 py-2.5 flex items-center gap-3 text-sm">
              <div className="w-3 flex-shrink-0" />
              <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
                {task.worksheetNumber && (
                  <span className="font-mono font-bold text-white">{task.worksheetNumber}</span>
                )}
                {task.orderNumber && (
                  <span className={`font-mono ${task.worksheetNumber ? "text-slate-400" : "font-bold text-white"}`}>
                    {task.orderNumber}
                  </span>
                )}
                {task.customerName && (
                  <span className="text-slate-400 truncate">— {task.customerName}</span>
                )}
              </div>
              <span className="text-white font-semibold flex-shrink-0">{task.qty} item{task.qty !== 1 ? "s" : ""}</span>
            </div>
          ))}
        </div>
      )}
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
    if (!token) { setError("No token provided in URL."); return; }
    try {
      const res = await fetch(`${API_BASE}/tv/daily-plan?token=${encodeURIComponent(token)}`);
      if (res.status === 401 || res.status === 403) {
        setError("Invalid or missing token. This URL may have expired or been changed.");
        return;
      }
      if (!res.ok) { setError("Failed to load production plan."); return; }
      const data: DailyPlan = await res.json();
      setPlan(data);
      setLastRefreshed(new Date());
      setError(null);
    } catch {
      setError("Network error — retrying shortly.");
    }
  }, [token]);

  useEffect(() => {
    fetchPlan();
    const dataTimer = setInterval(fetchPlan, 30_000);
    const clockTimer = setInterval(() => setNow(new Date()), 1_000);
    return () => { clearInterval(dataTimer); clearInterval(clockTimer); };
  }, [fetchPlan]);

  const urgentGroups  = plan?.taskGroups.filter((g) => g.urgency === "overdue") ?? [];
  const todayGroups   = plan?.taskGroups.filter((g) => g.urgency === "today") ?? [];
  const soonGroups    = plan?.taskGroups.filter((g) => g.urgency === "soon") ?? [];
  const visibleGroups = [...urgentGroups, ...todayGroups, ...soonGroups];

  const needsAction = (plan?.summary.overdue ?? 0) + (plan?.summary.today ?? 0) + (plan?.summary.soon ?? 0);

  return (
    <div
      className="min-h-screen text-white flex flex-col"
      style={{ background: "#0f172a", fontFamily: "'Segoe UI', Arial, sans-serif" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-white/10">
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs font-bold tracking-widest uppercase text-slate-500 mb-0.5">Select Branding Solutions</div>
            <div className="text-2xl font-black tracking-tight text-white flex items-center gap-2">
              <span className="text-primary">⚡</span> Production — Today's Plan
            </div>
          </div>
        </div>

        <div className="text-right">
          <div className="text-4xl font-black tabular-nums tracking-tight text-white">{formatTime(now)}</div>
          <div className="text-sm text-slate-400 mt-0.5">{formatDateLong(now)}</div>
        </div>
      </div>

      {/* ── Summary bar ───────────────────────────────────────────────── */}
      {plan && (
        <div className={`flex items-center gap-6 px-8 py-3 border-b border-white/10 flex-wrap ${needsAction > 0 ? "bg-red-950/30" : "bg-green-950/30"}`}>
          <span className={`font-bold text-base ${needsAction > 0 ? "text-red-400" : "text-green-400"}`}>
            {needsAction > 0
              ? `${needsAction} batch${needsAction !== 1 ? "es" : ""} need attention now`
              : "✓ All urgent work is under control"}
          </span>
          <div className="flex items-center gap-5 ml-auto text-sm flex-wrap">
            {plan.summary.overdue > 0   && <span className="flex items-center gap-1.5 text-red-400 font-semibold"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />{plan.summary.overdue} overdue</span>}
            {plan.summary.today > 0     && <span className="flex items-center gap-1.5 text-orange-400 font-semibold"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />{plan.summary.today} due today</span>}
            {plan.summary.soon > 0      && <span className="flex items-center gap-1.5 text-amber-400 font-semibold"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{plan.summary.soon} due soon</span>}
            {plan.summary.thisWeek > 0  && <span className="flex items-center gap-1.5 text-blue-400"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />{plan.summary.thisWeek} this week</span>}
            {plan.summary.upcoming > 0  && <span className="flex items-center gap-1.5 text-slate-500"><span className="w-2 h-2 rounded-full bg-slate-500 inline-block" />{plan.summary.upcoming} upcoming</span>}
          </div>
          {lastRefreshed && (
            <span className="text-xs text-slate-600 ml-2">Updated {formatTime(lastRefreshed)}</span>
          )}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {error && (
          <div className="rounded-xl bg-red-950/60 border border-red-700 text-red-300 px-6 py-5 text-center text-lg font-medium">
            {error}
          </div>
        )}

        {!plan && !error && (
          <div className="flex items-center justify-center h-64 text-slate-500 text-xl">
            Loading…
          </div>
        )}

        {plan && visibleGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <div className="text-6xl">✅</div>
            <div className="text-2xl font-bold text-green-400">All urgent work is complete</div>
            <div className="text-slate-400">
              {plan.summary.thisWeek + plan.summary.upcoming > 0
                ? `${plan.summary.thisWeek + plan.summary.upcoming} further batch${plan.summary.thisWeek + plan.summary.upcoming !== 1 ? "es" : ""} later this week or upcoming`
                : "No production batches in the queue"}
            </div>
          </div>
        )}

        {visibleGroups.length > 0 && (
          <div className="space-y-3 max-w-5xl mx-auto">
            {urgentGroups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-red-400 font-bold text-sm uppercase tracking-wider mb-3">
                  <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
                  Overdue — Complete Immediately
                </div>
                {urgentGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} />)}
              </div>
            )}
            {todayGroups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-orange-400 font-bold text-sm uppercase tracking-wider mb-3 mt-4">
                  <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
                  Due Today — Start First
                </div>
                {todayGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} />)}
              </div>
            )}
            {soonGroups.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-bold text-sm uppercase tracking-wider mb-3 mt-4">
                  <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                  Due in Next 2 Working Days — Plan Today
                </div>
                {soonGroups.map((g) => <TaskGroupCard key={g.finishName} group={g} />)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
