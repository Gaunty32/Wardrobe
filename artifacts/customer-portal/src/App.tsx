import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { useVersionCheck } from "@/hooks/use-version-check";
import { Loader2, RefreshCw } from "lucide-react";

import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import PreviewLogin from "@/pages/PreviewLogin";
import Dashboard from "@/pages/Dashboard";
import OrderDetailPage from "@/pages/OrderDetail";
import NewOrder from "@/pages/NewOrder";
import Wardrobe from "@/pages/Wardrobe";
import Products from "@/pages/Products";
import Team from "@/pages/Team";
import Invoices from "@/pages/Invoices";
import PaymentMethods from "@/pages/PaymentMethods";
import Stock from "@/pages/Stock";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function UpdateBanner() {
  const updateAvailable = useVersionCheck();
  if (!updateAvailable) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 bg-primary px-4 py-2.5 text-primary-foreground shadow-md">
      <p className="text-sm font-medium">A new version of the portal is available.</p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 text-sm font-semibold hover:bg-white/30 transition-colors shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" /> Refresh
      </button>
    </div>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/preview-login" component={PreviewLogin} />
      <Route path="/orders/new" component={() => <ProtectedRoute component={NewOrder} />} />
      <Route path="/orders/:id" component={() => <ProtectedRoute component={OrderDetailPage} />} />
      <Route path="/orders" component={() => <ProtectedRoute component={Dashboard} />} />
      <Route path="/invoices" component={() => <ProtectedRoute component={Invoices} />} />
      <Route path="/wardrobe" component={() => <ProtectedRoute component={Wardrobe} />} />
      <Route path="/products" component={() => <ProtectedRoute component={Products} />} />
      <Route path="/team" component={() => <ProtectedRoute component={Team} />} />
      <Route path="/payment-methods" component={() => <ProtectedRoute component={PaymentMethods} />} />
      <Route path="/stores" component={() => <ProtectedRoute component={Stock} />} />
      <Route path="/">
        {() => {
          const token = localStorage.getItem("portal_token");
          return token ? <Redirect to="/orders" /> : <Redirect to="/login" />;
        }}
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <UpdateBanner />
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
