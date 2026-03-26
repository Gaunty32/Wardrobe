import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-200/60 shadow-sm",
    confirmed: "bg-blue-50 text-blue-700 border-blue-200/60 shadow-sm shadow-blue-500/10",
    shipped: "bg-amber-50 text-amber-700 border-amber-200/60 shadow-sm shadow-amber-500/10",
    delivered: "bg-emerald-50 text-emerald-700 border-emerald-200/60 shadow-sm shadow-emerald-500/10",
    cancelled: "bg-red-50 text-red-700 border-red-200/60 shadow-sm shadow-red-500/10"
  };

  const currentStyle = styles[status.toLowerCase()] || styles.draft;

  return (
    <span 
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border uppercase tracking-wider transition-colors",
        currentStyle,
        className
      )}
    >
      {status}
    </span>
  );
}
