import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ShoppingBag, LogOut, LayoutDashboard, Menu, X, Eye, Shirt, Package, Users, Receipt, CreditCard, Bell, CheckCheck, Truck, ThumbsUp, AlertCircle, Info } from "lucide-react";
import logo from "@/assets/logo.png";
import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

interface PortalNotification {
  id: number;
  title: string;
  body: string | null;
  link: string | null;
  type: string;
  is_read: boolean;
  created_at: string;
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  const { data: notifications = [] } = useQuery<PortalNotification[]>({
    queryKey: ["portal-notifications"],
    queryFn: () => apiFetch("/portal/notifications"),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const unread = notifications.filter(n => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/notifications/${id}/read`, { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: () => apiFetch("/portal/notifications/read-all", { method: "PATCH" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-notifications"] }),
  });

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const typeIcon = (type: string) => {
    if (type === "needs_approval") return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
    if (type === "approved") return <ThumbsUp className="w-4 h-4 text-green-500 shrink-0" />;
    if (type === "dispatched") return <Truck className="w-4 h-4 text-blue-500 shrink-0" />;
    return <Info className="w-4 h-4 text-muted-foreground shrink-0" />;
  };

  const handleClick = (n: PortalNotification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) setLocation(n.link);
    setOpen(false);
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-full hover:bg-muted/60 transition-colors"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
      >
        <Bell className="w-5 h-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm">Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Mark all read
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto divide-y divide-border">
            {notifications.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No notifications yet
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                    !n.is_read && "bg-primary/5"
                  )}
                >
                  {typeIcon(n.type)}
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm leading-tight truncate", !n.is_read && "font-semibold")}>{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">{fmt(n.created_at)}</p>
                  </div>
                  {!n.is_read && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1.5" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isPreview, isManager, isDeptManager, previewEmployeeName } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = [
    { label: "My Orders", icon: LayoutDashboard, href: "/orders" },
    { label: "New Order", icon: ShoppingBag, href: "/orders/new" },
    { label: "Wardrobe", icon: Shirt, href: "/wardrobe" },
    { label: "Products", icon: Package, href: "/products" },
    { label: "Invoices", icon: Receipt, href: "/invoices" },
    { label: "Payment", icon: CreditCard, href: "/payment-methods" },
    ...(isManager ? [{ label: "Team", icon: Users, href: "/team" }] : isDeptManager ? [{ label: "My Team", icon: Users, href: "/team" }] : []),
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Staff preview banner */}
      {isPreview && (
        <div className="bg-amber-400 text-amber-950 text-xs font-semibold flex items-center justify-center gap-2 px-4 py-1.5 sticky top-0 z-50">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          Staff preview{previewEmployeeName ? <> — viewing as <strong>{previewEmployeeName}</strong></> : " — no specific employee selected"}. Orders placed here will be real.
          <button
            onClick={logout}
            className="ml-3 underline underline-offset-2 hover:no-underline font-medium"
          >
            Exit preview
          </button>
        </div>
      )}
      {/* Top nav */}
      <header className="h-28 border-b bg-card shadow-sm sticky top-0 z-40 flex items-center px-6 gap-4">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {user?.customer?.logo_url ? (
            <img
              src={user.customer.logo_url}
              alt={user.customer.name}
              className="h-24 w-auto max-w-[400px] object-contain shrink-0"
            />
          ) : (
            <img src={logo} alt="Select Branding Solutions" className="h-20 w-auto shrink-0" />
          )}
          {user?.customer?.name && (
            <span className="text-base font-medium text-muted-foreground truncate hidden sm:block">
              {user.customer.name}
            </span>
          )}
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
          {nav.map(({ label, icon: Icon, href }) => (
            <button
              key={href}
              onClick={() => setLocation(href)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                location === href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>

        <div className="hidden sm:flex items-center gap-2">
          {!isPreview && <NotificationBell />}
          {user && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">{user.user?.email}</span>
          )}
          <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-muted-foreground">
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>

        {/* Mobile menu button */}
        <div className="sm:hidden flex items-center gap-2">
          {!isPreview && <NotificationBell />}
          <button className="p-1.5 rounded-md" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Mobile nav */}
      {mobileOpen && (
        <div className="sm:hidden border-b bg-card px-4 py-3 flex flex-col gap-1">
          {nav.map(({ label, icon: Icon, href }) => (
            <button
              key={href}
              onClick={() => { setLocation(href); setMobileOpen(false); }}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors text-left",
                location === href
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
          <div className="border-t mt-2 pt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{user?.user?.email}</span>
            <Button variant="ghost" size="sm" onClick={logout}>Sign out</Button>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 container max-w-5xl mx-auto px-4 py-6">{children}</main>

      <footer className="border-t py-6 flex flex-col items-center gap-2">
        <span className="text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">Powered by</span>
        <img src={logo} alt="Select Branding Solutions" className="h-10 w-auto opacity-70" />
      </footer>
    </div>
  );
}
