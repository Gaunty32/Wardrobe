import { useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Loader2 } from "lucide-react";

export default function PreviewLogin() {
  const [, setLocation] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const params = new URLSearchParams(search);
    const token = params.get("token");
    if (!token) {
      setLocation("/login");
      return;
    }
    localStorage.setItem("portal_token", token);
    localStorage.setItem("portal_role", "manager");
    setLocation("/orders");
    window.location.reload();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}
