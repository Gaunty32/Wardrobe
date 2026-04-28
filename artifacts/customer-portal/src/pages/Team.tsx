import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Plus, Loader2, Users, UserCheck, UserX, UserMinus, Mail, Pencil, RotateCcw, ShieldCheck, MapPin, Ruler, Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Redirect } from "wouter";

const ROLE_LABELS: Record<string, string> = {
  manager: "Admin",
  dept_manager: "Manager",
  member: "User",
  invited: "Invited",
  inactive: "Inactive",
};

const ROLE_DESCRIPTIONS: Record<string, string> = {
  manager: "Full access — add team members, make amendments, place and approve orders",
  dept_manager: "Place orders for their team — orders are held for Admin approval",
  member: "Place orders for themselves only — orders are held for Admin approval",
};

function RoleBadge({ role }: { role: string }) {
  const colours: Record<string, string> = {
    manager: "bg-purple-100 text-purple-700 border-purple-200",
    dept_manager: "bg-blue-100 text-blue-700 border-blue-200",
    member: "bg-slate-100 text-slate-600 border-slate-200",
    invited: "bg-amber-100 text-amber-700 border-amber-200",
    inactive: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${colours[role] ?? colours.member}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ─── Employee section ─────────────────────────────────────────────────────────

function EmployeeForm({ initial, initialSizes, addresses, onSave, onCancel, saving }: {
  initial?: any;
  initialSizes?: Array<{ label: string; size: string }>;
  addresses: any[];
  onSave: (data: any, sizes: Array<{ label: string; size: string }>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    firstName: initial?.first_name ?? "",
    lastName: initial?.last_name ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    jobTitle: initial?.job_title ?? "",
    department: initial?.department ?? "",
    deliveryAddressId: initial?.delivery_address_id ? String(initial.delivery_address_id) : "none",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const [sizes, setSizes] = useState<Array<{ label: string; size: string }>>(initialSizes ?? []);
  const addSize = () => setSizes(s => [...s, { label: "", size: "" }]);
  const removeSize = (i: number) => setSizes(s => s.filter((_, idx) => idx !== i));
  const updateSize = (i: number, field: "label" | "size", val: string) =>
    setSizes(s => s.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  const validSizes = sizes.filter(s => s.label.trim() && s.size.trim());

  return (
    <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>First name *</Label>
          <Input value={form.firstName} onChange={e => set("firstName", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Last name *</Label>
          <Input value={form.lastName} onChange={e => set("lastName", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Email</Label>
        <Input type="email" value={form.email} onChange={e => set("email", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Phone</Label>
          <Input value={form.phone} onChange={e => set("phone", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Job title</Label>
          <Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} />
        </div>
      </div>
      <div className="space-y-1">
        <Label>Department</Label>
        <Input value={form.department} onChange={e => set("department", e.target.value)} />
      </div>
      {addresses.length > 0 && (
        <div className="space-y-1">
          <Label className="flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
            Delivery address
          </Label>
          <Select value={form.deliveryAddressId} onValueChange={v => set("deliveryAddressId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Account address (default)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Account address (default)</SelectItem>
              {addresses.map((a: any) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.label} — {a.line1}{a.city ? `, ${a.city}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            If not set, orders default to the account address.
          </p>
        </div>
      )}

      {/* Clothing sizes section */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <Label className="flex items-center gap-1.5">
            <Ruler className="w-3.5 h-3.5 text-muted-foreground" />
            Clothing sizes
            <span className="font-normal text-muted-foreground ml-1">(used as suggestions when ordering)</span>
          </Label>
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addSize}>
            <Plus className="w-3 h-3" /> Add size
          </Button>
        </div>
        {sizes.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No sizes saved — add entries like "Polo Shirt: L" or "Jacket: XL".
          </p>
        ) : (
          <div className="space-y-1.5">
            {sizes.map((row, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input
                  className="h-8 text-sm"
                  placeholder="Item (e.g. Polo Shirt)"
                  value={row.label}
                  onChange={e => updateSize(i, "label", e.target.value)}
                />
                <Input
                  className="h-8 text-sm w-24 shrink-0"
                  placeholder="Size"
                  value={row.size}
                  onChange={e => updateSize(i, "size", e.target.value)}
                />
                <button
                  type="button"
                  className="text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeSize(i)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <DialogFooter className="pt-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
          onClick={() => onSave(
            {
              ...form,
              deliveryAddressId: form.deliveryAddressId === "none" ? null : parseInt(form.deliveryAddressId, 10),
            },
            validSizes
          )}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
          {initial ? "Save changes" : "Add employee"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function EmployeesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showInactive, setShowInactive] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const { data: employees = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-team-employees", showInactive],
    queryFn: () => apiFetch(`/portal/team/employees?showInactive=${showInactive}`),
  });

  const { data: addresses = [] } = useQuery<any[]>({
    queryKey: ["portal-addresses"],
    queryFn: () => apiFetch("/portal/addresses"),
  });

  // Load existing sizes when editing an employee
  const { data: editSizes = [] } = useQuery<Array<{ id: number; label: string; size: string }>>({
    queryKey: ["portal-employee-sizes", editTarget?.id],
    queryFn: () => apiFetch(`/portal/team/employees/${editTarget!.id}/sizes`),
    enabled: !!editTarget?.id,
  });

  const saveSizes = async (empId: number, sizes: Array<{ label: string; size: string }>) => {
    if (sizes.length > 0) {
      await apiFetch(`/portal/team/employees/${empId}/sizes`, {
        method: "PUT",
        body: JSON.stringify(sizes),
      });
    }
  };

  const addMutation = useMutation({
    mutationFn: async ({ data, sizes }: { data: any; sizes: Array<{ label: string; size: string }> }) => {
      const emp = await apiFetch("/portal/team/employees", { method: "POST", body: JSON.stringify(data) });
      if (sizes.length > 0) await saveSizes(emp.id, sizes);
      return emp;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-employees"] });
      setAddOpen(false);
      toast({ title: "Employee added" });
    },
    onError: () => toast({ title: "Failed to add employee", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data, sizes }: { id: number; data: any; sizes: Array<{ label: string; size: string }> }) => {
      await apiFetch(`/portal/team/employees/${id}`, { method: "PATCH", body: JSON.stringify(data) });
      await saveSizes(id, sizes);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-employees"] });
      qc.invalidateQueries({ queryKey: ["portal-employee-sizes"] });
      setEditTarget(null);
      toast({ title: "Employee updated" });
    },
    onError: () => toast({ title: "Failed to update employee", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/portal/team/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-employees"] });
      toast({ title: "Employee updated" });
    },
    onError: () => toast({ title: "Failed to update employee", variant: "destructive" }),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            id="show-inactive-emp"
            checked={showInactive}
            onCheckedChange={setShowInactive}
          />
          <Label htmlFor="show-inactive-emp" className="cursor-pointer">Show inactive</Label>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> Add employee
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : employees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {showInactive ? "No employees found" : "No active employees"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {employees.map((emp: any) => (
            <div
              key={emp.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card transition-opacity ${emp.is_active ? "" : "opacity-60"}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${emp.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {emp.first_name?.[0]}{emp.last_name?.[0]}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">
                  {emp.first_name} {emp.last_name}
                  {!emp.is_active && (
                    <span className="ml-2 text-xs text-muted-foreground font-normal">(inactive)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {[emp.job_title, emp.department, emp.email].filter(Boolean).join(" · ")}
                </p>
                {emp.delivery_address_label && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3 h-3 shrink-0" />
                    {emp.delivery_address_label}
                    {emp.delivery_address_line1 && ` — ${emp.delivery_address_line1}`}
                    {emp.delivery_address_city && `, ${emp.delivery_address_city}`}
                  </p>
                )}
                {emp.sizes && emp.sizes.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-1">
                    {emp.sizes.map((s: any, i: number) => (
                      <span key={i} className="inline-flex items-center gap-0.5 rounded border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <Ruler className="w-2.5 h-2.5 shrink-0" />{s.label}: <strong>{s.size}</strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {emp.role_name && (
                <Badge variant="outline" className="text-xs shrink-0">{emp.role_name}</Badge>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setEditTarget(emp)}
                  title="Edit"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${emp.is_active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
                  onClick={() => statusMutation.mutate({ id: emp.id, isActive: !emp.is_active })}
                  title={emp.is_active ? "Deactivate" : "Reactivate"}
                >
                  {emp.is_active ? <UserMinus className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add employee</DialogTitle></DialogHeader>
          <EmployeeForm
            addresses={addresses}
            onSave={(data, sizes) => addMutation.mutate({ data, sizes })}
            onCancel={() => setAddOpen(false)}
            saving={addMutation.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit employee</DialogTitle></DialogHeader>
          {editTarget && (
            <EmployeeForm
              initial={editTarget}
              initialSizes={editSizes}
              addresses={addresses}
              onSave={(data, sizes) => editMutation.mutate({ id: editTarget.id, data, sizes })}
              onCancel={() => setEditTarget(null)}
              saving={editMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Portal users section ─────────────────────────────────────────────────────

function UsersTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-team-users"],
    queryFn: () => apiFetch("/portal/team/users"),
  });

  const inviteMutation = useMutation({
    mutationFn: (data: any) =>
      apiFetch("/portal/team/users/invite", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      const base = window.location.origin;
      setInviteLink(`${base}${import.meta.env.BASE_URL.replace(/\/$/, "")}${res.inviteUrl}`);
      setInviteEmail("");
      toast({ title: "Invite created" });
    },
    onError: () => toast({ title: "Failed to send invite", variant: "destructive" }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      apiFetch(`/portal/team/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      toast({ title: "Role updated" });
    },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/portal/team/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      toast({ title: "Access updated" });
    },
    onError: () => toast({ title: "Failed to update access", variant: "destructive" }),
  });

  const formatLastLogin = (ts: string | null) => {
    if (!ts) return "Never logged in";
    return `Last login ${new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" className="gap-1.5" onClick={() => { setInviteLink(null); setInviteOpen(true); }}>
          <Mail className="w-4 h-4" /> Invite user
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No portal users yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {users.map((u: any) => (
            <div
              key={u.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card ${u.status === "inactive" ? "opacity-60" : ""}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${u.status === "active" ? "bg-primary/10" : "bg-muted"}`}>
                <ShieldCheck className={`w-4 h-4 ${u.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">{formatLastLogin(u.last_login_at)}</p>
              </div>

              <Select
                value={u.portal_role}
                onValueChange={(v) => roleMutation.mutate({ id: u.id, role: v })}
                disabled={u.status === "inactive"}
              >
                <SelectTrigger className="h-7 text-xs w-28 shrink-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">User</SelectItem>
                  <SelectItem value="dept_manager">Manager</SelectItem>
                  <SelectItem value="manager">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant={u.status === "active" || u.status === "invited" ? "outline" : "secondary"}
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => statusMutation.mutate({ id: u.id, status: u.status === "inactive" ? "active" : "inactive" })}
              >
                {u.status === "inactive" ? (
                  <><RotateCcw className="w-3 h-3 mr-1" /> Reactivate</>
                ) : (
                  <><UserX className="w-3 h-3 mr-1" /> Deactivate</>
                )}
              </Button>

              <RoleBadge role={u.status === "invited" ? "invited" : u.status === "inactive" ? "inactive" : u.portal_role} />
            </div>
          ))}
        </div>
      )}

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) { setInviteOpen(false); setInviteLink(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite a portal user</DialogTitle></DialogHeader>
          {inviteLink ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Share this invite link with the new user:</p>
              <div className="rounded-md border bg-muted p-3 text-xs font-mono break-all select-all">
                {inviteLink}
              </div>
              <p className="text-xs text-muted-foreground">The link expires in 7 days.</p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => { navigator.clipboard.writeText(inviteLink); toast({ title: "Copied to clipboard" }); }}
                >
                  Copy link
                </Button>
                <Button onClick={() => { setInviteOpen(false); setInviteLink(null); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Email address *</Label>
                <Input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="colleague@company.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Portal role</Label>
                {(["manager", "dept_manager", "member"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setInviteRole(r)}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                      inviteRole === r
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/30"
                    }`}
                  >
                    <p className={`font-semibold text-sm ${inviteRole === r ? "text-primary" : ""}`}>
                      {ROLE_LABELS[r]}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[r]}</p>
                  </button>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button
                  disabled={inviteMutation.isPending || !inviteEmail.trim()}
                  onClick={() => inviteMutation.mutate({ email: inviteEmail.trim(), portalRole: inviteRole })}
                >
                  {inviteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  Create invite
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type TeamTab = "employees" | "users";

export default function Team() {
  const { isManager } = useAuth();
  const [tab, setTab] = useState<TeamTab>("employees");

  if (!isManager) return <Redirect to="/orders" />;

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Manage your employees and control who has access to the portal.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit mb-6">
        {(["employees", "users"] as TeamTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "employees" ? "Employees" : "Portal Users"}
          </button>
        ))}
      </div>

      {tab === "employees" ? <EmployeesTab /> : <UsersTab />}
    </PortalLayout>
  );
}
