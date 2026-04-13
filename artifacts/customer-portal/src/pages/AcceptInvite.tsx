import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export default function AcceptInvite() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const token = params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/portal/auth/accept-invite", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      localStorage.setItem("portal_token", data.token);
      localStorage.setItem("portal_customer_id", String(data.customerId));
      setSuccess(true);
      setTimeout(() => setLocation("/orders"), 1800);
    } catch {
      setError("This invite link is invalid or has expired. Please contact your account manager.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-sm w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-10 h-10 text-destructive mx-auto mb-3" />
            <p className="font-medium">Missing invite token.</p>
            <p className="text-sm text-muted-foreground mt-1">Use the link from your invite email.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <img src="/customer-portal/images/logo.png" alt="Select Branding Solutions" className="h-16 w-auto" />
          <p className="text-sm text-muted-foreground text-center leading-snug max-w-[220px]">
            Effortless uniform management from order to delivery.
          </p>
        </div>

        <Card className="shadow-lg">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">Set your password</CardTitle>
            <CardDescription>Create a password to activate your portal account</CardDescription>
          </CardHeader>
          <CardContent>
            {success ? (
              <div className="text-center py-4">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="font-semibold">Account activated!</p>
                <p className="text-sm text-muted-foreground mt-1">Redirecting you to your orders…</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input
                    id="confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="Repeat password"
                    required
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Activate account
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
