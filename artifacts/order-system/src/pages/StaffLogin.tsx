import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye, EyeOff, ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setStaffToken, isStaffAuthenticated } from "@/lib/staff-auth";

const API_BASE = "/api";

type Mode = "loading" | "setup" | "login";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const [mode, setMode]             = useState<Mode>("loading");
  const [password, setPassword]     = useState("");
  const [confirm, setConfirm]       = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);

  useEffect(() => {
    if (isStaffAuthenticated()) { setLocation("/dashboard"); return; }
    fetch(`${API_BASE}/auth/staff/status`)
      .then(r => r.json())
      .then(data => setMode(data.passwordConfigured ? "login" : "setup"))
      .catch(() => setMode("login")); // fall back to login form on error
  }, []);

  async function handleLogin(e: React.FormEvent) {
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
      if (!res.ok) { setError(data.error ?? "Login failed"); return; }
      setStaffToken(data.token);
      setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/staff/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Setup failed"); return; }
      setStaffToken(data.token);
      setLocation("/dashboard");
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "loading") {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
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
              {mode === "setup"
                ? <KeyRound className="w-7 h-7 text-indigo-400" />
                : <ShieldCheck className="w-7 h-7 text-indigo-400" />}
            </div>
            <h1 className="text-white text-2xl font-bold">
              {mode === "setup" ? "Create your password" : "Staff Login"}
            </h1>
            <p className="text-slate-400 text-sm">
              {mode === "setup"
                ? "Set a password to protect the order system."
                : "Select Branding Solutions — Order System"}
            </p>
          </div>

          {mode === "setup" ? (
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3">
                <p className="text-indigo-300 text-xs leading-relaxed">
                  This is the first time the order system has been opened. Choose a password — all SBS staff will use this to log in.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300">New password</Label>
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoFocus
                    className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-slate-300">Confirm password</Label>
                <Input
                  type="password"
                  placeholder="Repeat your password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 focus:border-indigo-500"
                />
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
              )}

              <Button type="submit" disabled={loading || !password || !confirm}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Setting up…</> : "Create password & sign in"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-slate-300">Password</Label>
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    placeholder="Enter staff password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoFocus
                    className="bg-white/5 border-white/15 text-white placeholder:text-slate-500 pr-10 focus:border-indigo-500"
                  />
                  <button type="button" onClick={() => setShowPass(v => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-sm text-red-400 bg-red-900/20 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>
              )}

              <Button type="submit" disabled={loading || !password}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin mr-2" />Signing in…</> : "Sign in"}
              </Button>
            </form>
          )}

          <p className="text-center text-slate-600 text-xs">
            {mode === "setup"
              ? "Make sure to share this password with all SBS staff who need access."
              : "Contact your SBS administrator if you've forgotten the password."}
          </p>

        </div>
      </div>
    </div>
  );
}
