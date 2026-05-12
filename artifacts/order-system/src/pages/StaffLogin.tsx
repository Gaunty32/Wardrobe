import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStaffToken, isStaffAuthenticated } from "@/lib/staff-auth";

const API_BASE = "/api";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const [password, setPassword]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [warnDefault, setWarnDefault] = useState(false);

  useEffect(() => {
    if (isStaffAuthenticated()) setLocation("/dashboard");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      setStaffToken(data.token);
      if (data.usingDefault) setWarnDefault(true);
      else setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (warnDefault) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm rounded-2xl border border-amber-500/30 bg-amber-500/10 p-7 text-center space-y-4">
          <p className="text-amber-300 text-sm font-semibold uppercase tracking-widest">Default password in use</p>
          <p className="text-white text-base leading-relaxed">
            You signed in with the default password. Please set a custom password in{" "}
            <strong>Settings → Security</strong> before sharing this system.
          </p>
          <Button
            onClick={() => setLocation("/dashboard")}
            className="w-full bg-amber-500 hover:bg-amber-400 text-black font-semibold"
          >
            Continue to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      <header className="flex items-center gap-3 px-6 py-5 border-b border-white/10">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-slate-400 hover:text-white text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-500/20 mb-2">
              <img
                src="/sbs-logo.png"
                alt="SBS"
                className="h-8 w-auto"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <h1 className="text-white text-2xl font-bold">Staff Login</h1>
            <p className="text-slate-400 text-sm">Select Branding Solutions — Order System</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-slate-300">Password</Label>
              <div className="relative">
                <Input
                  type={showPass ? "text" : "password"}
                  placeholder="Enter staff password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading || !password}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold"
            >
              {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in…</> : "Sign in"}
            </Button>
          </form>

          <p className="text-center text-slate-600 text-xs">
            Contact your SBS administrator if you've forgotten the password.
          </p>
        </div>
      </div>
    </div>
  );
}
