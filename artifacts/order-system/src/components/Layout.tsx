import { ReactNode, useEffect, useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, Truck, LogOut, Boxes, ShoppingBag, ClipboardList, Settings2, Send, CheckSquare, FileText, Warehouse, BarChart2, MonitorPlay, Bell, MessageSquare, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { isStaffAuthenticated, clearStaffToken } from "@/lib/staff-auth";
import { useQuery } from "@tanstack/react-query";

const API_BASE = "/api";

function getStoredActor(): string {
  return localStorage.getItem("sbs_actor_name") || "";
}

async function apiFetch<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

interface InboxMessage {
  id: number;
  order_id: number;
  order_number: string;
  author_name: string;
  body: string;
  created_at: string;
  customer_name: string | null;
  is_read: boolean;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

let desktopNotifPermission: NotificationPermission = "default";
let notifiedIds = new Set<number>();

function requestDesktopNotifPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().then(p => { desktopNotifPermission = p; });
  } else if ("Notification" in window) {
    desktopNotifPermission = Notification.permission;
  }
}

function fireDesktopNotif(msg: InboxMessage) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (notifiedIds.has(msg.id)) return;
  notifiedIds.add(msg.id);
  new Notification(`New message on ${msg.order_number}`, {
    body: `${msg.author_name}: ${msg.body.slice(0, 120)}`,
    icon: "/images/sbs-logo.png",
    tag: `order-msg-${msg.id}`,
  });
}

function MessagesBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const actor = getStoredActor();

  const { data } = useQuery<{ messages: InboxMessage[]; unreadCount: number }>({
    queryKey: ["messages-inbox", actor],
    queryFn: () => apiFetch(`/messages/inbox?reader=${encodeURIComponent(actor)}`),
    enabled: isStaffAuthenticated(),
    refetchInterval: 20_000,
    staleTime: 10_000,
  });

  const messages = data?.messages ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  // Fire desktop notifications for new unread messages
  useEffect(() => {
    requestDesktopNotifPermission();
  }, []);

  useEffect(() => {
    if (actor && messages.length > 0) {
      messages.filter(m => !m.is_read && m.author_name !== actor).forEach(fireDesktopNotif);
    }
  }, [messages, actor]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const handleClick = (msg: InboxMessage) => {
    setOpen(false);
    navigate(`/orders/${msg.order_id}`);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative p-2 rounded-xl text-white/60 hover:bg-white/10 hover:text-white transition-colors"
        title="Internal messages"
      >
        <MessageSquare className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-semibold text-sm flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              Job Messages
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">{unreadCount} unread</span>
              )}
            </span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-border">
            {messages.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                No messages yet
              </div>
            ) : (
              messages.map(msg => (
                <button
                  key={msg.id}
                  onClick={() => handleClick(msg)}
                  className={cn(
                    "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                    !msg.is_read && msg.author_name !== actor && "bg-primary/5"
                  )}
                >
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {msg.author_name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-1 justify-between">
                      <span className={cn("text-xs font-semibold truncate", !msg.is_read && msg.author_name !== actor && "text-primary")}>
                        {msg.order_number}
                        {msg.customer_name && <span className="text-muted-foreground font-normal ml-1">· {msg.customer_name}</span>}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 ml-1">{formatTime(msg.created_at)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      <span className="font-medium text-foreground">{msg.author_name}:</span>{" "}
                      <span className="line-clamp-2">{msg.body}</span>
                    </p>
                  </div>
                  {!msg.is_read && msg.author_name !== actor && (
                    <span className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                  )}
                </button>
              ))
            )}
          </div>
          {messages.length > 0 && (
            <div className="px-4 py-2 border-t border-border text-center">
              <span className="text-xs text-muted-foreground">Click any message to open the order</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface LayoutProps {
  children: ReactNode;
}

type NavItem = { name: string; href: string; icon: React.ElementType };
type NavSection = { label: string; items: NavItem[] };

export default function Layout({ children }: LayoutProps) {
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isStaffAuthenticated()) {
      setLocation("/login");
    }
  }, [location]);

  if (!isStaffAuthenticated()) return null;

  function handleSignOut() {
    clearStaffToken();
    setLocation("/");
  }

  const navSections: NavSection[] = [
    {
      label: "",
      items: [
        { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
        { name: "Orders", href: "/orders", icon: ShoppingCart },
        { name: "Customers", href: "/customers", icon: Users },
        { name: "Products", href: "/products", icon: Package },
      ],
    },
    {
      label: "Operations",
      items: [
        { name: "Stock", href: "/stock", icon: Warehouse },
        { name: "Process Stock", href: "/process-stock", icon: Boxes },
        { name: "Production", href: "/production", icon: ClipboardList },
        { name: "Purchasing", href: "/purchasing", icon: ShoppingBag },
        { name: "Dispatch", href: "/dispatch", icon: Send },
        { name: "Invoicing", href: "/invoices", icon: FileText },
        { name: "Suppliers", href: "/suppliers", icon: Truck },
        { name: "Tasks", href: "/tasks", icon: CheckSquare },
      ],
    },
    {
      label: "Reports",
      items: [
        { name: "Portal Orders", href: "/reports", icon: BarChart2 },
      ],
    },
  ];

  const allNavItems = navSections.flatMap(s => s.items);

  const bottomNavItems = [
    { name: "Settings", href: "/settings", icon: Settings2 },
    { name: "Demo", href: "/demo", icon: MonitorPlay },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 flex-col fixed inset-y-0 z-10" style={{ backgroundColor: "hsl(var(--sidebar))" }}>
        {/* Logo */}
        <div className="flex items-center justify-center px-4 py-5 border-b border-white/10">
          <img
            src={`${import.meta.env.BASE_URL}images/sbs-logo.png`}
            alt="Select Branding Solutions"
            className="w-full h-auto object-contain"
          />
        </div>

        <nav className="flex-1 px-4 py-5 overflow-y-auto space-y-4">
          {navSections.map((section) => (
            <div key={section.label || "__top__"}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/30 select-none">
                  {section.label}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      className={cn(
                        "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                        isActive
                          ? "bg-white/15 text-white shadow-sm"
                          : "text-white/60 hover:bg-white/10 hover:text-white"
                      )}
                    >
                      <item.icon className={cn(
                        "w-5 h-5 mr-3 transition-colors shrink-0",
                        isActive ? "text-primary" : "text-white/50 group-hover:text-white/80"
                      )} />
                      {item.name}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-4 border-t border-white/10 space-y-1">
          <div className="flex items-center px-1 pb-1">
            <MessagesBell />
          </div>
          {bottomNavItems.map((item) => {
            const isActive = location === item.href || location.startsWith(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                )}
              >
                <item.icon className={cn(
                  "w-5 h-5 mr-3 transition-colors",
                  isActive ? "text-primary" : "text-white/50 group-hover:text-white/80"
                )} />
                {item.name}
              </Link>
            );
          })}
          <button
            onClick={handleSignOut}
            className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:bg-red-500/20 hover:text-red-300 transition-colors group"
          >
            <LogOut className="w-5 h-5 mr-3 transition-colors" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 relative min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden h-16 flex items-center px-4 border-b border-border/60 sticky top-0 z-20" style={{ backgroundColor: "hsl(var(--sidebar))" }}>
          <img
            src={`${import.meta.env.BASE_URL}images/sbs-logo.png`}
            alt="Select Branding Solutions"
            className="h-9 w-auto object-contain"
          />
        </header>

        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </main>

      {/* Mobile Navigation Bottom Bar — shows first 5 items only */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border/60 flex items-center justify-around px-2 z-20 pb-safe">
        {allNavItems.slice(0, 5).map((item) => {
          const isActive = location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center w-full h-full",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5 mb-1" />
              <span className="text-[10px] font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
