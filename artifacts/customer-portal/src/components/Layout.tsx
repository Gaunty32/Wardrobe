import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ShoppingBag, LogOut, LayoutDashboard, Menu, X, Eye, Shirt, Package, Users } from "lucide-react";
import logo from "@/assets/logo.png";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isPreview, isManager } = useAuth();
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const nav = [
    { label: "My Orders", icon: LayoutDashboard, href: "/orders" },
    { label: "New Order", icon: ShoppingBag, href: "/orders/new" },
    { label: "Wardrobe", icon: Shirt, href: "/wardrobe" },
    { label: "Products", icon: Package, href: "/products" },
    ...(isManager ? [{ label: "Team", icon: Users, href: "/team" }] : []),
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Staff preview banner */}
      {isPreview && (
        <div className="bg-amber-400 text-amber-950 text-xs font-semibold flex items-center justify-center gap-2 px-4 py-1.5 sticky top-0 z-50">
          <Eye className="w-3.5 h-3.5 shrink-0" />
          Staff preview — you are viewing the portal as this customer. Orders placed here will be real.
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

      <footer className="border-t py-6 flex flex-col items-center gap-2">
        <span className="text-xs text-muted-foreground/60 uppercase tracking-widest font-medium">Powered by</span>
        <img src={logo} alt="Select Branding Solutions" className="h-10 w-auto opacity-70" />
      </footer>
    </div>
  );
}
