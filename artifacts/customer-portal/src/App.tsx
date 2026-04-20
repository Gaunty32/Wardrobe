import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";

import Login from "@/pages/Login";
import AcceptInvite from "@/pages/AcceptInvite";
import PreviewLogin from "@/pages/PreviewLogin";
import Dashboard from "@/pages/Dashboard";
import OrderDetailPage from "@/pages/OrderDetail";
import NewOrder from "@/pages/NewOrder";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

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
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
