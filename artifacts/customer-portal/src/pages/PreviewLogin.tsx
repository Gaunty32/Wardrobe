import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";

export default function PreviewLogin() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Use window.location.search directly — reliable across all proxy/iframe setups
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) {
      setLocation("/login");
      return;
    }
    localStorage.setItem("portal_token", token);
    localStorage.setItem("portal_role", "manager");
    // Full page navigation to orders — ensures auth context re-initialises cleanly
    const base = (import.meta.env.BASE_URL as string) || "/customer-portal/";
    window.location.href = base.replace(/\/$/, "") + "/orders";
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}
