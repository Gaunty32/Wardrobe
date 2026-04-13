import { useState, useEffect, createContext, useContext } from "react";
import { apiFetch } from "@/lib/api";
import { useLocation } from "wouter";

type AuthUser = {
  user: { email: string; status: string; last_login_at: string | null };
  customer: { id: number; name: string };
};

type AuthContextType = {
  user: AuthUser | null;
  loading: boolean;
  logout: () => void;
  refetchUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setLocation] = useLocation();

  const fetchUser = async () => {
    try {
      const token = localStorage.getItem("portal_token");
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const data = await apiFetch("/portal/auth/me");
      setUser(data);
    } catch (err) {
      setUser(null);
      localStorage.removeItem("portal_token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const logout = () => {
    localStorage.removeItem("portal_token");
    localStorage.removeItem("portal_customer_id");
    localStorage.removeItem("portal_customer_name");
    localStorage.removeItem("portal_email");
    setUser(null);
    setLocation("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout, refetchUser: fetchUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
