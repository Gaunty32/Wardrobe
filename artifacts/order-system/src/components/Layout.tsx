import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, Truck, LogOut, Boxes, ShoppingBag, ClipboardList, Settings2, Send, CheckSquare, FileText, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [location] = useLocation();

  const navItems = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Orders", href: "/orders", icon: ShoppingCart },
    { name: "Customers", href: "/customers", icon: Users },
    { name: "Products", href: "/products", icon: Package },
    { name: "Stock", href: "/stock", icon: Warehouse },
    { name: "Process Stock", href: "/process-stock", icon: Boxes },
    { name: "Production", href: "/production", icon: ClipboardList },
    { name: "Purchasing", href: "/purchasing", icon: ShoppingBag },
    { name: "Dispatch", href: "/dispatch", icon: Send },
    { name: "Invoicing", href: "/invoices", icon: FileText },
    { name: "Suppliers", href: "/suppliers", icon: Truck },
    { name: "Tasks", href: "/tasks", icon: CheckSquare },
  ];

  const bottomNavItems = [
    { name: "Settings", href: "/settings", icon: Settings2 },
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

        <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
        </nav>

        <div className="p-4 border-t border-white/10 space-y-1">
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
          <button className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:bg-red-500/20 hover:text-red-300 transition-colors group">
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

      {/* Mobile Navigation Bottom Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-card border-t border-border/60 flex items-center justify-around px-2 z-20 pb-safe">
        {navItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
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
