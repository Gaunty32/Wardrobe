import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useVersionCheck } from "@/hooks/use-version-check";
import { RefreshCw } from "lucide-react";

import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import ProcessStock from "@/pages/ProcessStock";
import Stock from "@/pages/Stock";
import Purchasing from "@/pages/Purchasing";
import Production from "@/pages/Production";
import Suppliers from "@/pages/Suppliers";
import Dispatch from "@/pages/Dispatch";
import Settings from "@/pages/Settings";
import Tasks from "@/pages/Tasks";
import Invoices from "@/pages/Invoices";
import Reports from "@/pages/Reports";
import NotFound from "@/pages/not-found";
import DemoGate from "@/pages/DemoGate";
import DemoDashboard from "@/pages/DemoDashboard";
import DemoOrders from "@/pages/DemoOrders";
import DemoOrderDetail from "@/pages/DemoOrderDetail";
import DemoProducts from "@/pages/DemoProducts";
import DemoCustomers from "@/pages/DemoCustomers";
import DemoPortal from "@/pages/DemoPortal";
import DemoSection from "@/pages/DemoSection";
import PortalGuide from "@/pages/PortalGuide";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
    }
  }
});

function UpdateBanner() {
  const updateAvailable = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground shadow-md">
      <p className="text-sm font-medium">A new version of the app is available.</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30 transition-colors shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh now
      </button>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes — no auth required */}
      <Route path="/portal-guide" component={PortalGuide} />

      {/* Demo routes — no auth required, must come first */}
      <Route path="/demo" component={DemoGate} />
      <Route path="/demo/dashboard" component={DemoDashboard} />
      <Route path="/demo/orders" component={DemoOrders} />
      <Route path="/demo/orders/:id" component={DemoOrderDetail} />
      <Route path="/demo/products" component={DemoProducts} />
      <Route path="/demo/customers" component={DemoCustomers} />
      <Route path="/demo/portal" component={DemoPortal} />
      <Route path="/demo/stock" component={() => <DemoSection section="stock" />} />
      <Route path="/demo/process-stock" component={() => <DemoSection section="process-stock" />} />
      <Route path="/demo/production" component={() => <DemoSection section="production" />} />
      <Route path="/demo/purchasing" component={() => <DemoSection section="purchasing" />} />
      <Route path="/demo/dispatch" component={() => <DemoSection section="dispatch" />} />
      <Route path="/demo/invoicing" component={() => <DemoSection section="invoicing" />} />
      <Route path="/demo/suppliers" component={() => <DemoSection section="suppliers" />} />
      <Route path="/demo/tasks" component={() => <DemoSection section="tasks" />} />

      <Route path="/" component={Dashboard} />
      <Route path="/orders" component={Orders} />
      <Route path="/orders/:id" component={OrderDetail} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/products" component={Products} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/stock" component={Stock} />
      <Route path="/process-stock" component={ProcessStock} />
      <Route path="/purchasing" component={Purchasing} />
      <Route path="/production" component={Production} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/dispatch" component={Dispatch} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/settings" component={Settings} />
      <Route path="/reports" component={Reports} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <UpdateBanner />
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
