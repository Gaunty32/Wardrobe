import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

// Extract token synchronously — before AuthProvider's fetchUser() can fire
// and potentially redirect to /login using a stale/expired session token.
const _params = new URLSearchParams(window.location.search);
const _previewToken = _params.get("token");
if (_previewToken) {
  localStorage.setItem("portal_token", _previewToken);
  localStorage.setItem("portal_role", "manager");
}

export default function PreviewLogin() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!_previewToken) {
      setLocation("/login");
      return;
    }
    const base = (import.meta.env.BASE_URL as string) || "/customer-portal/";
    window.location.href = base.replace(/\/$/, "") + "/orders";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}
