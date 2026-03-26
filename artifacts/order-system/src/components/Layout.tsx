import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { LayoutDashboard, ShoppingCart, Users, Package, Truck, LogOut, Boxes } from "lucide-react";
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
    { name: "Process Stock", href: "/process-stock", icon: Boxes },
    { name: "Suppliers", href: "/suppliers", icon: Truck },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row">
      {/* Sidebar Desktop */}
      <aside className="hidden md:flex w-64 flex-col bg-card border-r border-border/60 shadow-sm fixed inset-y-0 z-10">
        <div className="h-16 flex items-center px-6 border-b border-border/40">
          <img 
            src={`${import.meta.env.BASE_URL}images/logo.png`} 
            alt="Nexus Logo" 
            className="w-8 h-8 mr-3 object-contain"
          />
          <h1 className="font-display font-bold text-xl tracking-tight bg-gradient-to-br from-primary to-primary/70 bg-clip-text text-transparent">Nexus</h1>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link 
                key={item.name} 
                href={item.href}
                className={cn(
                  "flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group",
                  isActive 
                    ? "bg-primary/10 text-primary shadow-sm shadow-primary/5" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={cn(
                  "w-5 h-5 mr-3 transition-colors", 
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                )} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border/40">
          <button className="flex items-center w-full px-3 py-2.5 rounded-xl text-sm font-medium text-muted-foreground hover:bg-red-50 hover:text-red-600 transition-colors group">
            <LogOut className="w-5 h-5 mr-3 text-muted-foreground group-hover:text-red-500 transition-colors" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 relative min-w-0">
        {/* Mobile Header */}
        <header className="md:hidden h-16 flex items-center px-4 border-b border-border/60 bg-card sticky top-0 z-20">
          <img 
            src={`${import.meta.env.BASE_URL}images/logo.png`} 
            alt="Nexus Logo" 
            className="w-8 h-8 mr-3 object-contain"
          />
          <h1 className="font-display font-bold text-xl tracking-tight text-primary">Nexus</h1>
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
