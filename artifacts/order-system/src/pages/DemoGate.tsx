import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getDemoToken, setDemoSession } from "@/lib/demo";

const API_BASE = "/api";

export default function DemoGate() {
  const [, setLocation] = useLocation();
  const [firstName, setFirstName] = useState("");
  const [lastName,  setLastName]  = useState("");
  const [email,     setEmail]     = useState("");
  const [company,   setCompany]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  // If already has a valid demo token, jump straight in
  useEffect(() => {
    if (getDemoToken()) setLocation("/demo/dashboard");
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/demo/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, email, company }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      setDemoSession(data.token, { firstName: data.firstName, company: data.company });
      setLocation("/demo/dashboard");
    } catch (err: any) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col items-center justify-center px-4">

      {/* Logo / brand */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
            <Eye className="w-5 h-5 text-blue-400" />
          </div>
          <span className="text-2xl font-bold text-white tracking-tight">Select Branding Solutions</span>
        </div>
        <p className="text-slate-400 text-sm">Effortless uniform management, from order to delivery</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-slate-900 px-8 py-6">
          <h1 className="text-xl font-bold text-white mb-1">Interactive system demo</h1>
          <p className="text-slate-400 text-sm">Enter your details to get 48‑hour access to the live system with sample data.</p>
        </div>

        <form onSubmit={handleSubmit} className="px-8 py-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                placeholder="Jane"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
                placeholder="Smith"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="jane@yourcompany.com"
              required
              disabled={loading}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="company">Company name</Label>
            <Input
              id="company"
              value={company}
              onChange={e => setCompany(e.target.value)}
              placeholder="Acme Ltd"
              required
              disabled={loading}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <Button type="submit" className="w-full h-11 text-base" disabled={loading}>
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Setting up your demo…</>
              : "Explore the system →"
            }
          </Button>

          <p className="text-xs text-center text-muted-foreground pt-1">
            By continuing you agree to receive a follow-up email from our team. No spam, ever.
          </p>
        </form>
      </div>

      <p className="mt-8 text-slate-500 text-xs text-center max-w-sm">
        Customer data shown in the demo is anonymised. Financial figures are illustrative only.
      </p>
    </div>
  );
}
