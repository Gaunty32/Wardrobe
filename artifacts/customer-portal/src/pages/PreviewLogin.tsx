import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

// Extract & store token synchronously at module evaluation time —
// this runs before any React effects so AuthProvider always finds the token.
const _params = new URLSearchParams(window.location.search);
const _previewToken = _params.get("token");
if (_previewToken) {
  localStorage.setItem("portal_token", _previewToken);
  localStorage.setItem("portal_role", "manager");
}

export default function PreviewLogin() {
  const [, setLocation] = useLocation();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!_previewToken) {
      setLocation("/login");
      return;
    }
    // Wait for AuthProvider to finish its auth check, then navigate
    if (!loading) {
      setLocation(user ? "/orders" : "/login");
    }
  }, [loading, user]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}
