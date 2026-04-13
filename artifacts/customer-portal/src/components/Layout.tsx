import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ShoppingBag, LogOut, Package, LayoutDashboard, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = [
    { label: "My Orders", icon: LayoutDashboard, href: "/orders" },
    { label: "New Order", icon: ShoppingBag, href: "/orders/new" },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top nav */}
      <header className="h-14 border-b bg-card shadow-sm sticky top-0 z-40 flex items-center px-4 gap-4">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Package className="w-5 h-5 text-primary shrink-0" />
          <span className="font-semibold text-foreground truncate">
            {user?.customer?.name ?? "Customer Portal"}
          </span>
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
          {user && (
            <span className="text-xs text-muted-foreground truncate max-w-[160px]">{user.user?.email}</span>
          )}
          <Button variant="ghost" size="sm" onClick={logout} className="gap-1.5 text-muted-foreground">
            <LogOut className="w-4 h-4" /> Sign out
          </Button>
        </div>

        {/* Mobile menu button */}
        <button className="sm:hidden p-1.5 rounded-md" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
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

      <footer className="border-t py-3 text-center text-xs text-muted-foreground">
        &copy; Select Branding Solutions &mdash; Customer Portal
      </footer>
    </div>
  );
}
