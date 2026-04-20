import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import Dashboard from "@/pages/Dashboard";
import Orders from "@/pages/Orders";
import OrderDetail from "@/pages/OrderDetail";
import Customers from "@/pages/Customers";
import CustomerDetail from "@/pages/CustomerDetail";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import ProcessStock from "@/pages/ProcessStock";
import Purchasing from "@/pages/Purchasing";
import Production from "@/pages/Production";
import Suppliers from "@/pages/Suppliers";
import Dispatch from "@/pages/Dispatch";
import Settings from "@/pages/Settings";
import Tasks from "@/pages/Tasks";
import Invoices from "@/pages/Invoices";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/orders" component={Orders} />
      <Route path="/orders/:id" component={OrderDetail} />
      <Route path="/customers" component={Customers} />
      <Route path="/customers/:id" component={CustomerDetail} />
      <Route path="/products" component={Products} />
      <Route path="/products/:id" component={ProductDetail} />
      <Route path="/process-stock" component={ProcessStock} />
      <Route path="/purchasing" component={Purchasing} />
      <Route path="/production" component={Production} />
      <Route path="/suppliers" component={Suppliers} />
      <Route path="/dispatch" component={Dispatch} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/invoices" component={Invoices} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
