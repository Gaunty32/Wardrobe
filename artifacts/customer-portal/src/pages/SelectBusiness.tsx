import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { apiFetch } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, Building2, ChevronRight } from "lucide-react";
import logo from "@/assets/logo.png";

interface Business {
  portalUserId: number;
  customerId: number;
  customerName: string;
  logoUrl: string | null;
  portalRole: string;
}

export default function SelectBusiness() {
  const [, setLocation] = useLocation();
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [selectionToken, setSelectionToken] = useState("");
  const [email, setEmail] = useState("");
  const [selecting, setSelecting] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = sessionStorage.getItem("portal_selection_token");
    const storedEmail = sessionStorage.getItem("portal_selection_email");
    const raw = sessionStorage.getItem("portal_selection_businesses");
    if (!token || !raw) {
      setLocation("/login");
      return;
    }
    try {
      setSelectionToken(token);
      setEmail(storedEmail ?? "");
      setBusinesses(JSON.parse(raw));
    } catch {
      setLocation("/login");
    }
  }, []);

  const select = async (b: Business) => {
    setSelecting(b.portalUserId);
    setError("");
    try {
      const data = await apiFetch("/portal/auth/select-business", {
        method: "POST",
        body: JSON.stringify({ selectionToken, portalUserId: b.portalUserId }),
      });
      sessionStorage.removeItem("portal_selection_token");
      sessionStorage.removeItem("portal_selection_email");
      sessionStorage.removeItem("portal_selection_businesses");
      localStorage.setItem("portal_token", data.token);
      localStorage.setItem("portal_customer_id", String(data.customerId));
      localStorage.setItem("portal_customer_name", data.customerName ?? "");
      localStorage.setItem("portal_email", data.email ?? "");
      localStorage.setItem("portal_role", data.portalRole ?? "member");
      // Preserve the full business list so the user can switch later
      if (businesses.length > 1) {
        localStorage.setItem("portal_businesses", JSON.stringify(businesses));
      }
      setLocation("/orders");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please sign in again.");
      setSelecting(null);
    }
  };

  if (businesses.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src={logo} alt="Select Branding Solutions" className="h-16 w-auto" />
          <div className="text-center">
            <h1 className="text-xl font-semibold text-foreground">Choose your account</h1>
            {email && (
              <p className="text-sm text-muted-foreground mt-1">
                Signed in as <span className="font-medium">{email}</span>
              </p>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 mb-4 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-3">
          {businesses.map((b) => {
            const isLoading = selecting === b.portalUserId;
            const roleLabel = b.portalRole === "manager" ? "Manager" : b.portalRole === "dept_manager" ? "Dept. Manager" : "Member";
            return (
              <button
                key={b.portalUserId}
                onClick={() => select(b)}
                disabled={selecting !== null}
                className="w-full group"
              >
                <Card className="shadow-sm hover:shadow-md transition-shadow cursor-pointer border-2 border-transparent group-hover:border-primary/30 disabled:opacity-60">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="w-14 h-14 rounded-lg bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      {b.logoUrl ? (
                        <img src={b.logoUrl} alt={b.customerName} className="w-full h-full object-contain p-1" />
                      ) : (
                        <Building2 className="w-7 h-7 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="font-semibold text-foreground truncate">{b.customerName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{roleLabel}</p>
                    </div>
                    {isLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin text-primary shrink-0" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    )}
                  </CardContent>
                </Card>
              </button>
            );
          })}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Not you?{" "}
          <button
            className="text-primary hover:underline"
            onClick={() => {
              sessionStorage.removeItem("portal_selection_token");
              sessionStorage.removeItem("portal_selection_email");
              sessionStorage.removeItem("portal_selection_businesses");
              setLocation("/login");
            }}
          >
            Sign in with a different email
          </button>
        </p>
      </div>
    </div>
  );
}
