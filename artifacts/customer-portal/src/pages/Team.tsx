import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  Plus, Loader2, Users, UserCheck, UserX, UserMinus, Mail, Pencil, RotateCcw,
  ShieldCheck, MapPin, Ruler, Trash2, Link as LinkIcon, Wallet, Search, X,
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

const AVATAR_COLORS = [
  "bg-blue-100 text-blue-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-orange-100 text-orange-700",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
  "bg-cyan-100 text-cyan-700",
  "bg-pink-100 text-pink-700",
];
function getAvatarColor(id: number) {
  return AVATAR_COLORS[Math.abs(id) % AVATAR_COLORS.length];
}

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

// ─── Explosion particles ──────────────────────────────────────────────────────

const CONFETTI_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#a855f7","#ec4899","#14b8a6"];

function Explosion({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  const particles = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => {
      const angle = (i / 28) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist  = 55 + Math.random() * 160;
      return {
        id:       i,
        tx:       Math.cos(angle) * dist,
        ty:       Math.sin(angle) * dist - Math.random() * 30,
        color:    CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size:     5 + Math.random() * 9,
        rot:      Math.random() * 720 - 360,
        dur:      480 + Math.random() * 320,
        round:    i % 3 !== 1,
      };
    }), []);

  useEffect(() => {
    const t = setTimeout(onDone, 950);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 9999 }}>
      {particles.map(p => (
        <div
          key={p.id}
          style={{
            position: "fixed",
            left: x,
            top: y,
            width:  p.size,
            height: p.size,
            backgroundColor: p.color,
            borderRadius: p.round ? "50%" : "2px",
            animation: `particle-fly ${p.dur}ms ease-out forwards`,
            "--tx": `${p.tx}px`,
            "--ty": `${p.ty}px`,
            "--rot": `${p.rot}deg`,
          } as React.CSSProperties}
        />
      ))}
      <div
        style={{
          position: "fixed",
          left: x,
          top: y,
          fontSize: "2.4rem",
          lineHeight: 1,
          animation: "bye-float 0.95s ease-out forwards",
          userSelect: "none",
        } as React.CSSProperties}
      >
        👋
      </div>
    </div>
  );
}

// ─── Bin zone (right-side panel) ──────────────────────────────────────────────

function BinZone({
  dragging,
  hovering,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  dragging: boolean;
  hovering: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop:     (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`sticky top-20 w-28 shrink-0 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 px-3 py-8 text-center select-none transition-all duration-200
        ${dragging
          ? hovering
            ? "border-red-500 bg-red-500 text-white shadow-xl shadow-red-200/60 scale-105"
            : "border-red-300 bg-red-50 text-red-500 border-dashed"
          : "border-dashed border-border/30 bg-muted/10 text-muted-foreground/25"
        }
      `}
      onDragOver={dragging ? onDragOver : undefined}
      onDragLeave={dragging ? onDragLeave : undefined}
      onDrop={dragging ? onDrop : undefined}
    >
      <Trash2
        className={`w-8 h-8 transition-all duration-150 ${hovering ? "scale-125" : dragging ? "scale-110" : "scale-100"}`}
        style={hovering ? { animation: "bin-shake 0.3s ease-in-out infinite" } : undefined}
      />
      <div className="space-y-1">
        <p className="text-xs font-semibold leading-tight">
          {hovering ? "Let go! 😬" : dragging ? "Drop here" : "Leavers"}
        </p>
        <p className={`text-[10px] leading-tight ${dragging ? "opacity-80" : "opacity-50"}`}>
          {hovering ? "They'll go inactive" : dragging ? "to deactivate" : "Drag here to deactivate"}
        </p>
      </div>
    </div>
  );
}

// ─── Employee form ─────────────────────────────────────────────────────────────

function EmployeeForm({ initial, initialSizes, addresses, roles, allEmployees, onSave, onCancel, saving }: {
  initial?: any;
  initialSizes?: Array<{ label: string; size: string }>;
  addresses: any[];
  roles: Array<{ id: number; name: string }>;
  allEmployees: any[];
  onSave: (data: any, sizes: Array<{ label: string; size: string }>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    firstName: initial?.first_name ?? "",
    lastName: initial?.last_name ?? "",
    employeeNumber: initial?.employee_number ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    jobTitle: initial?.job_title ?? "",
    department: initial?.department ?? "",
    deliveryAddressId: initial?.delivery_address_id ? String(initial.delivery_address_id) : "none",
    roleId: initial?.role_id ? String(initial.role_id) : "none",
    managerId: initial?.manager_id ? String(initial.manager_id) : "none",
    allowance: initial?.allowance != null ? String(initial.allowance) : "",
  });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const selectedRoleName = roles.find(r => String(r.id) === form.roleId)?.name ?? "";
  const isOperativeRole = selectedRoleName.toLowerCase().includes("operative");
  const managerOptions = allEmployees.filter((e: any) => {
    if (e.id === initial?.id) return false;
    if (isOperativeRole) return (e.role_name ?? "").toLowerCase().includes("team manager");
    return true;
  });

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
        <Label>Employee Number</Label>
        <Input placeholder="e.g. EMP-001" value={form.employeeNumber} onChange={e => set("employeeNumber", e.target.value)} />
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

      <div className="grid grid-cols-2 gap-3">
        {roles.length > 0 && (
          <div className="space-y-1">
            <Label>Role</Label>
            <Select value={form.roleId} onValueChange={v => set("roleId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="No role" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No role</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {managerOptions.length > 0 && (
          <div className="space-y-1">
            <Label>Team Manager</Label>
            <Select value={form.managerId} onValueChange={v => set("managerId", v)}>
              <SelectTrigger>
                <SelectValue placeholder="No manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager</SelectItem>
                {managerOptions.map((e: any) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {e.first_name} {e.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
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

      <div className="space-y-1 pt-1">
        <Label className="flex items-center gap-1.5">
          <Wallet className="w-3.5 h-3.5 text-muted-foreground" />
          Annual allowance override (£)
          <span className="font-normal text-muted-foreground ml-1">(leave blank to use role default)</span>
        </Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
          <Input
            type="number"
            min="0"
            step="0.01"
            placeholder="e.g. 250.00"
            className="pl-7"
            value={form.allowance}
            onChange={e => set("allowance", e.target.value)}
          />
        </div>
      </div>

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
              roleId: form.roleId === "none" ? null : parseInt(form.roleId, 10),
              managerId: form.managerId === "none" ? null : parseInt(form.managerId, 10),
              allowance: form.allowance.trim() !== "" ? parseFloat(form.allowance) : null,
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

// ─── Employees tab ─────────────────────────────────────────────────────────────

function EmployeesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const searchTrimmed = search.trim().toLowerCase();

  const { data: employees = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-team-employees", true],
    queryFn: () => apiFetch("/portal/team/employees?showInactive=true"),
  });
  const { data: allEmployees = [] } = useQuery<any[]>({
    queryKey: ["portal-team-employees", false],
    queryFn: () => apiFetch("/portal/team/employees?showInactive=false"),
  });
  const activeEmployees = useMemo(
    () => (employees as any[]).filter((e: any) => e.is_active),
    [employees],
  );
  const searchResults = useMemo(() => {
    if (!searchTrimmed) return [];
    return (employees as any[]).filter((e: any) =>
      `${e.first_name ?? ""} ${e.last_name ?? ""} ${e.employee_number ?? ""} ${e.email ?? ""} ${e.department ?? ""} ${e.job_title ?? ""}`
        .toLowerCase()
        .includes(searchTrimmed),
    );
  }, [employees, searchTrimmed]);

  const { data: roles = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["portal-team-roles"],
    queryFn: () => apiFetch("/portal/team/roles"),
  });
  const { data: addresses = [] } = useQuery<any[]>({
    queryKey: ["portal-addresses"],
    queryFn: () => apiFetch("/portal/addresses"),
  });
  const { data: portalUsers = [] } = useQuery<any[]>({
    queryKey: ["portal-team-users"],
    queryFn: () => apiFetch("/portal/team/users"),
  });
  const { data: emailStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["portal-email-status"],
    queryFn: () => apiFetch("/portal/team/email-status"),
  });
  const emailConfigured = emailStatus?.configured ?? false;

  const portalByEmpId = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of portalUsers as any[]) {
      if (u.linked_employee_id) m.set(Number(u.linked_employee_id), u);
    }
    return m;
  }, [portalUsers]);

  const unlinkedPortalUsers = useMemo(
    () => (portalUsers as any[]).filter((u: any) => !u.linked_employee_id),
    [portalUsers],
  );

  const groups = useMemo(() => {
    const m = new Map<number | null, any[]>();
    for (const e of activeEmployees as any[]) {
      const key = e.manager_id != null ? Number(e.manager_id) : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [activeEmployees]);

  const leaderIds = useMemo(() => {
    const s = new Set<number>();
    for (const e of activeEmployees as any[]) {
      if (e.manager_id != null) s.add(Number(e.manager_id));
    }
    return s;
  }, [activeEmployees]);

  const sectionKeys = useMemo(() => {
    const keys = [...groups.keys()].filter((k): k is number => k !== null);
    return keys.sort((a, b) => {
      const la = (activeEmployees as any[]).find((e: any) => e.id === a);
      const lb = (activeEmployees as any[]).find((e: any) => e.id === b);
      return (la?.last_name ?? "").localeCompare(lb?.last_name ?? "");
    });
  }, [groups, activeEmployees]);

  const unassigned = useMemo(
    () => (groups.get(null) ?? []).filter((e: any) => !leaderIds.has(e.id)),
    [groups, leaderIds],
  );

  // ── drag & drop ───────────────────────────────────────────────────────────────
  const [dragEmpId, setDragEmpId] = useState<number | null>(null);
  const [dragOverKey, setDragOverKey] = useState<number | null | undefined>(undefined);
  const [dragOverBin, setDragOverBin] = useState(false);
  const [explosionPos, setExplosionPos] = useState<{ x: number; y: number } | null>(null);

  const reassignMutation = useMutation({
    mutationFn: ({ id, managerId }: { id: number; managerId: number | null }) =>
      apiFetch(`/portal/team/employees/${id}`, { method: "PATCH", body: JSON.stringify({ managerId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-employees"] });
      toast({ title: "Employee reassigned" });
    },
    onError: () => toast({ title: "Failed to reassign", variant: "destructive" }),
  });

  const handleDrop = (newManagerId: number | null) => {
    if (dragEmpId == null || dragEmpId === newManagerId) return;
    reassignMutation.mutate({ id: dragEmpId, managerId: newManagerId });
    setDragEmpId(null);
    setDragOverKey(undefined);
  };

  // ── add / edit ────────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);

  const { data: editSizes = [] } = useQuery<Array<{ id: number; label: string; size: string }>>({
    queryKey: ["portal-employee-sizes", editTarget?.id],
    queryFn: () => apiFetch(`/portal/team/employees/${editTarget!.id}/sizes`),
    enabled: !!editTarget?.id,
  });

  const saveSizes = async (empId: number, sizes: Array<{ label: string; size: string }>) => {
    if (sizes.length > 0)
      await apiFetch(`/portal/team/employees/${empId}/sizes`, { method: "PUT", body: JSON.stringify(sizes) });
  };

  const addMutation = useMutation({
    mutationFn: async ({ data, sizes }: { data: any; sizes: Array<{ label: string; size: string }> }) => {
      const emp = await apiFetch("/portal/team/employees", { method: "POST", body: JSON.stringify(data) });
      if (sizes.length > 0) await saveSizes(emp.id, sizes);
      return emp;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-team-employees"] }); setAddOpen(false); toast({ title: "Employee added" }); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-team-employees"] }); toast({ title: "Employee updated" }); },
    onError: () => toast({ title: "Failed to update employee", variant: "destructive" }),
  });

  const handleBinDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragEmpId == null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width  / 2;
    const y = rect.top  + rect.height / 2;
    const empId = dragEmpId;
    setDragEmpId(null);
    setDragOverKey(undefined);
    setDragOverBin(false);
    setExplosionPos({ x, y });
    statusMutation.mutate({ id: empId, isActive: false });
    toast({ title: "👋 Bye then! Employee moved to inactive." });
  }, [dragEmpId, statusMutation, toast]);

  // ── top-up ────────────────────────────────────────────────────────────────────
  const [topupTarget, setTopupTarget] = useState<any | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const openTopup = (emp: any) => {
    setTopupTarget(emp);
    setTopupAmount(parseFloat(emp.allowance_topup ?? "0") > 0 ? String(parseFloat(emp.allowance_topup)) : "");
  };

  const topupMutation = useMutation({
    mutationFn: ({ id, topup }: { id: number; topup: number }) =>
      apiFetch(`/portal/team/employees/${id}/topup`, { method: "PATCH", body: JSON.stringify({ topup }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-employees"] });
      setTopupTarget(null); setTopupAmount("");
      toast({ title: "Extra credits updated" });
    },
    onError: () => toast({ title: "Failed to update credits", variant: "destructive" }),
  });

  // ── portal management ─────────────────────────────────────────────────────────
  const [portalTarget, setPortalTarget] = useState<{ emp: any; user: any | null } | null>(null);
  const [portalInviteRole, setPortalInviteRole] = useState("member");
  const [portalInviteResult, setPortalInviteResult] = useState<{ emailSent: boolean; inviteUrl: string; email: string } | null>(null);

  const openPortal = (emp: any) => {
    const user = portalByEmpId.get(emp.id) ?? null;
    setPortalTarget({ emp, user });
    setPortalInviteRole("member");
    setPortalInviteResult(null);
  };

  const inviteFromEmpMutation = useMutation({
    mutationFn: (data: { email: string; portalRole: string }) =>
      apiFetch("/portal/team/users/invite", { method: "POST", body: JSON.stringify({ ...data, sendNow: emailConfigured }) }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      setPortalInviteResult({ emailSent: res.emailSent ?? false, inviteUrl: res.inviteUrl, email: res.email });
    },
    onError: () => toast({ title: "Failed to invite", variant: "destructive" }),
  });

  const portalRoleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: string }) =>
      apiFetch(`/portal/team/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["portal-team-users"] }); toast({ title: "Role updated" }); },
    onError: () => toast({ title: "Failed to update role", variant: "destructive" }),
  });

  const portalPricingMutation = useMutation({
    mutationFn: ({ id, showPricing }: { id: number; showPricing: boolean }) =>
      apiFetch(`/portal/team/users/${id}/show-pricing`, { method: "PATCH", body: JSON.stringify({ showPricing }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["portal-team-users"] }),
    onError: () => toast({ title: "Failed to update pricing access", variant: "destructive" }),
  });

  const portalStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiFetch(`/portal/team/users/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      toast({ title: "Access updated" });
      setPortalTarget(null);
    },
    onError: () => toast({ title: "Failed to update access", variant: "destructive" }),
  });

  // ── member chip renderer ──────────────────────────────────────────────────────
  const renderMemberChip = (emp: any) => {
    const isDragging = dragEmpId === emp.id;
    const portalUser = portalByEmpId.get(emp.id);
    return (
      <div
        key={emp.id}
        draggable
        onDragStart={(e) => { setDragEmpId(emp.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragEmpId(null); setDragOverKey(undefined); setDragOverBin(false); }}
        className={`group flex items-center gap-2 rounded-lg border px-2.5 py-2 bg-background select-none transition-all
          ${isDragging ? "opacity-30 border-dashed scale-95" : "hover:border-primary/40 hover:shadow-sm cursor-grab active:cursor-grabbing"}
        `}
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${getAvatarColor(emp.id)}`}>
          {emp.first_name?.[0]}{emp.last_name?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-xs leading-tight truncate">{emp.first_name} {emp.last_name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {[emp.employee_number && `#${emp.employee_number}`, emp.role_name || emp.job_title].filter(Boolean).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          {portalUser ? (
            <button onClick={() => openPortal(emp)} title="Manage portal access">
              <RoleBadge role={portalUser.status === "invited" ? "invited" : portalUser.status === "inactive" ? "inactive" : portalUser.portal_role} />
            </button>
          ) : emp.email ? (
            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-primary" onClick={() => openPortal(emp)} title="Invite to portal">
              <Mail className="w-3 h-3" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditTarget(emp)} title="Edit">
            <Pencil className="w-3 h-3" />
          </Button>
          <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-destructive"
            onClick={() => statusMutation.mutate({ id: emp.id, isActive: false })} title="Deactivate">
            <UserMinus className="w-3 h-3" />
          </Button>
        </div>
      </div>
    );
  };

  // ── JSX ───────────────────────────────────────────────────────────────────────
  const isDropTarget = (key: number | null) => dragEmpId != null && dragOverKey === key;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-5">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, department…"
            className="pl-9 pr-8"
          />
          {search && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> Add employee
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : searchTrimmed ? (
        /* ── Search results flat list ── */
        searchResults.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">No employees match "{search}"</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {searchResults.map((emp: any) => (
              <div
                key={emp.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card ${emp.is_active ? "" : "opacity-60"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${getAvatarColor(emp.id)}`}>
                  {emp.first_name?.[0]}{emp.last_name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">
                    {emp.first_name} {emp.last_name}
                    {!emp.is_active && <span className="ml-2 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-normal">leaver</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[emp.employee_number && `#${emp.employee_number}`, emp.role_name, emp.job_title, emp.department, emp.email].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditTarget(emp)} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {!emp.is_active ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-green-600"
                      onClick={() => statusMutation.mutate({ id: emp.id, isActive: true })} title="Reactivate">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => statusMutation.mutate({ id: emp.id, isActive: false })} title="Deactivate">
                      <UserMinus className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : activeEmployees.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No active employees — add one to get started</p>
          </CardContent>
        </Card>
      ) : (
        /* ── Main tile view ── */
        <div className="flex gap-5 items-start">
          {/* Left: tile grid */}
          <div className="flex-1 min-w-0 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">

              {/* ── Manager tiles ── */}
              {sectionKeys.map((leaderId) => {
                const leader = (activeEmployees as any[]).find((e: any) => e.id === leaderId);
                if (!leader) return null;
                const members = groups.get(leaderId) ?? [];
                const leaderPortalUser = portalByEmpId.get(leaderId);
                const leaderPortalRole = leaderPortalUser
                  ? (leaderPortalUser.status === "invited" ? "invited" : leaderPortalUser.status === "inactive" ? "inactive" : leaderPortalUser.portal_role)
                  : null;
                const effectiveAllowance = leader.effective_allowance != null ? parseFloat(leader.effective_allowance) : null;
                const dropTarget = isDropTarget(leaderId);

                return (
                  <div
                    key={leaderId}
                    className={`flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-150
                      ${dropTarget ? "border-primary ring-2 ring-primary/30 shadow-xl" : "shadow-sm hover:shadow-md"}
                    `}
                    onDragOver={(e) => { if (dragEmpId != null) { e.preventDefault(); setDragOverKey(leaderId); } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
                    onDrop={(e) => { e.preventDefault(); handleDrop(leaderId); }}
                  >
                    {/* Manager header */}
                    <div className="p-5 flex flex-col items-center text-center border-b bg-gradient-to-b from-muted/40 to-transparent">
                      <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-3 ring-4 ring-white shadow-md ${getAvatarColor(leaderId)}`}>
                        {leader.first_name?.[0]}{leader.last_name?.[0]}
                      </div>
                      <p className="font-bold text-sm leading-tight">{leader.first_name} {leader.last_name}</p>
                      {leader.employee_number && (
                        <p className="text-[11px] text-muted-foreground/70 font-mono mt-0.5">#{leader.employee_number}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">{leader.role_name || "Team Manager"}</p>
                      <p className="text-xs font-medium text-muted-foreground mt-1">
                        {members.length} member{members.length !== 1 ? "s" : ""}
                      </p>
                      {leaderPortalRole && (
                        <button onClick={() => openPortal(leader)} className="mt-2" title="Manage portal access">
                          <RoleBadge role={leaderPortalRole} />
                        </button>
                      )}
                      <div className="flex items-center gap-0.5 mt-2.5">
                        {!leaderPortalRole && leader.email && (
                          <Button variant="ghost" size="sm" className="h-6 text-xs px-2 gap-1 text-muted-foreground hover:text-primary" onClick={() => openPortal(leader)}>
                            <Mail className="w-3 h-3" /> Invite
                          </Button>
                        )}
                        {effectiveAllowance != null && (
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-primary" onClick={() => openTopup(leader)} title="Extra credits">
                            <Plus className="w-3 h-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditTarget(leader)} title="Edit">
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => statusMutation.mutate({ id: leader.id, isActive: false })}
                          title="Deactivate">
                          <UserMinus className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>

                    {/* Member chips */}
                    <div className={`flex-1 p-2 space-y-1.5 min-h-[72px] max-h-60 overflow-y-auto transition-colors
                      ${dropTarget ? "bg-primary/5" : ""}
                    `}>
                      {members.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-4 italic select-none">
                          {dragEmpId != null ? "↓ Drop here to assign" : "No members yet"}
                        </p>
                      ) : (
                        members.map((emp: any) => renderMemberChip(emp))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* ── Unassigned tile ── */}
              {unassigned.length > 0 && (
                <div
                  className={`flex flex-col rounded-2xl border bg-card overflow-hidden transition-all duration-150 shadow-sm
                    ${isDropTarget(null) ? "border-primary ring-2 ring-primary/30 shadow-xl" : "border-dashed border-border/60"}
                  `}
                  onDragOver={(e) => { if (dragEmpId != null) { e.preventDefault(); setDragOverKey(null); } }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(null); }}
                >
                  <div className="p-5 flex flex-col items-center text-center border-b bg-muted/20">
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3 ring-4 ring-white shadow-sm">
                      <Users className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-bold text-sm">Unassigned</p>
                    <p className="text-xs text-muted-foreground mt-0.5">No team manager</p>
                    <p className="text-xs font-medium text-muted-foreground mt-1">
                      {unassigned.length} member{unassigned.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className={`flex-1 p-2 space-y-1.5 min-h-[72px] max-h-60 overflow-y-auto
                    ${isDropTarget(null) ? "bg-primary/5" : ""}
                  `}>
                    {unassigned.map((emp: any) => renderMemberChip(emp))}
                  </div>
                </div>
              )}
            </div>

            {/* Portal-only users */}
            {unlinkedPortalUsers.length > 0 && (
              <div className="rounded-xl border bg-card overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b bg-muted/20">
                  <ShieldCheck className="w-3.5 h-3.5" /> Portal access only ({unlinkedPortalUsers.length})
                </div>
                <div className="px-3 py-2 space-y-1.5">
                  {unlinkedPortalUsers.map((u: any) => (
                    <div key={u.id} className="flex items-center gap-2.5 rounded-lg border px-3 py-2.5 bg-card">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{u.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {u.status === "invited" ? "Invite pending" : u.last_login_at
                            ? `Last sign-in ${new Date(u.last_login_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                            : "Never signed in"}
                        </p>
                      </div>
                      <RoleBadge role={u.status === "invited" ? "invited" : u.status === "inactive" ? "inactive" : u.portal_role} />
                      <Select value={u.portal_role} onValueChange={(v) => portalRoleMutation.mutate({ id: u.id, role: v })} disabled={u.status === "inactive"}>
                        <SelectTrigger className="h-7 text-xs w-28 shrink-0"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">User</SelectItem>
                          <SelectItem value="dept_manager">Manager</SelectItem>
                          <SelectItem value="manager">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant={u.status !== "inactive" ? "outline" : "secondary"} size="sm" className="shrink-0 text-xs"
                        onClick={() => portalStatusMutation.mutate({ id: u.id, status: u.status === "inactive" ? "active" : "inactive" })}>
                        {u.status === "inactive" ? <><RotateCcw className="w-3 h-3 mr-1" />Reactivate</> : <><UserX className="w-3 h-3 mr-1" />Deactivate</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {dragEmpId != null && (
              <p className="text-xs text-center text-muted-foreground animate-pulse">
                Drop onto a team tile to reassign, or the bin on the right to deactivate →
              </p>
            )}
          </div>

          {/* Right: bin panel */}
          <BinZone
            dragging={dragEmpId != null}
            hovering={dragOverBin}
            onDragOver={(e) => { e.preventDefault(); setDragOverBin(true); }}
            onDragLeave={() => setDragOverBin(false)}
            onDrop={handleBinDrop}
          />
        </div>
      )}

      {/* Explosion overlay */}
      {explosionPos && (
        <Explosion x={explosionPos.x} y={explosionPos.y} onDone={() => setExplosionPos(null)} />
      )}

      {/* ── Dialogs ────────────────────────────────────────────────────────────── */}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add employee</DialogTitle></DialogHeader>
          <EmployeeForm addresses={addresses} roles={roles} allEmployees={allEmployees}
            onSave={(data, sizes) => addMutation.mutate({ data, sizes })}
            onCancel={() => setAddOpen(false)} saving={addMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit employee</DialogTitle></DialogHeader>
          {editTarget && (
            <EmployeeForm initial={editTarget} initialSizes={editSizes} addresses={addresses} roles={roles} allEmployees={allEmployees}
              onSave={(data, sizes) => editMutation.mutate({ id: editTarget.id, data, sizes })}
              onCancel={() => setEditTarget(null)} saving={editMutation.isPending} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!topupTarget} onOpenChange={(o) => { if (!o) { setTopupTarget(null); setTopupAmount(""); } }}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader><DialogTitle>Extra credits — {topupTarget?.first_name} {topupTarget?.last_name}</DialogTitle></DialogHeader>
          {topupTarget && (() => {
            const ea = topupTarget.effective_allowance != null ? parseFloat(topupTarget.effective_allowance) : null;
            const ra = topupTarget.role_allowance != null ? parseFloat(topupTarget.role_allowance) : null;
            const ct = parseFloat(topupTarget.allowance_topup ?? "0");
            const sp = parseFloat(topupTarget.spend_12m ?? "0");
            const nt = topupAmount.trim() !== "" ? parseFloat(topupAmount) : 0;
            const total = ea != null ? ea + nt : null;
            return (
              <div className="space-y-4 py-1">
                <div className="rounded-lg bg-muted/40 border px-4 py-3 text-sm space-y-1.5">
                  <div className="flex justify-between text-muted-foreground"><span>Role default</span><span>{ra != null ? `£${ra.toFixed(2)}` : "No limit"}</span></div>
                  {topupTarget.allowance != null && <div className="flex justify-between text-muted-foreground"><span>Employee override</span><span>£{parseFloat(topupTarget.allowance).toFixed(2)}</span></div>}
                  <div className="flex justify-between text-muted-foreground"><span>Spent this year</span><span className={sp > (ea ?? Infinity) ? "text-destructive font-medium" : ""}>£{sp.toFixed(2)}</span></div>
                  {ct > 0 && <div className="flex justify-between text-muted-foreground"><span>Current extra credits</span><span>£{ct.toFixed(2)}</span></div>}
                </div>
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-muted-foreground" /> Set total extra credits (£)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">£</span>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" className="pl-7" value={topupAmount} onChange={e => setTopupAmount(e.target.value)} autoFocus />
                  </div>
                  {total != null && (
                    <p className="text-xs text-muted-foreground">New total: <strong>£{total.toFixed(2)}</strong>{total > sp ? ` — £${(total - sp).toFixed(2)} remaining` : " — still over budget"}</p>
                  )}
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTopupTarget(null); setTopupAmount(""); }}>Cancel</Button>
            <Button disabled={topupMutation.isPending || topupAmount.trim() === ""} onClick={() => topupMutation.mutate({ id: topupTarget!.id, topup: parseFloat(topupAmount) || 0 })}>
              {topupMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null} Save credits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!portalTarget} onOpenChange={(o) => { if (!o) { setPortalTarget(null); setPortalInviteResult(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {portalTarget?.emp ? `Portal access — ${portalTarget.emp.first_name} ${portalTarget.emp.last_name}` : "Portal access"}
            </DialogTitle>
          </DialogHeader>
          {portalTarget && (
            portalTarget.user ? (
              <div className="space-y-4 py-1">
                <div className="rounded-lg bg-muted/40 border px-4 py-3 text-sm space-y-1.5">
                  <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="font-medium">{portalTarget.user.email}</span></div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Status</span>
                    <RoleBadge role={portalTarget.user.status === "invited" ? "invited" : portalTarget.user.status === "inactive" ? "inactive" : portalTarget.user.portal_role} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Last sign-in</span>
                    <span className="text-xs">{portalTarget.user.last_login_at ? new Date(portalTarget.user.last_login_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never"}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Portal role</Label>
                  <Select value={portalTarget.user.portal_role}
                    onValueChange={(v) => portalRoleMutation.mutate({ id: portalTarget.user.id, role: v })}
                    disabled={portalTarget.user.status === "inactive" || portalRoleMutation.isPending}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">User — place orders for themselves only</SelectItem>
                      <SelectItem value="dept_manager">Manager — place orders for their team</SelectItem>
                      <SelectItem value="manager">Admin — full access</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">Show pricing</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Allow this user to see product and order prices</p>
                  </div>
                  <Switch
                    checked={portalTarget.user.show_pricing === true}
                    onCheckedChange={(v) => portalPricingMutation.mutate({ id: portalTarget.user.id, showPricing: v })}
                    disabled={portalTarget.user.status === "inactive" || portalPricingMutation.isPending}
                  />
                </div>
                <DialogFooter>
                  <Button variant="outline" className="mr-auto text-destructive border-destructive/30 hover:bg-destructive/5"
                    onClick={() => portalStatusMutation.mutate({ id: portalTarget.user.id, status: portalTarget.user.status === "inactive" ? "active" : "inactive" })}
                    disabled={portalStatusMutation.isPending}>
                    {portalTarget.user.status === "inactive" ? "Reactivate access" : "Deactivate access"}
                  </Button>
                  <Button onClick={() => setPortalTarget(null)}>Done</Button>
                </DialogFooter>
              </div>
            ) : portalInviteResult ? (
              <div className="space-y-4 py-1">
                {portalInviteResult.emailSent ? (
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
                    <Mail className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-green-800">Invite email sent</p>
                      <p className="text-xs text-green-700 mt-0.5">Sent to <strong>{portalInviteResult.email}</strong>. The link expires in 7 days.</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Share this link to give access:</p>
                    <div className="rounded-md border bg-muted p-3 text-xs font-mono break-all select-all">{window.location.origin}{portalInviteResult.inviteUrl}</div>
                    <p className="text-xs text-muted-foreground">The link expires in 7 days.</p>
                  </div>
                )}
                <DialogFooter>
                  {!portalInviteResult.emailSent && (
                    <Button variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${portalInviteResult!.inviteUrl}`); toast({ title: "Copied to clipboard" }); }}>Copy link</Button>
                  )}
                  <Button onClick={() => { setPortalTarget(null); setPortalInviteResult(null); }}>Done</Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4 py-1">
                {portalTarget.emp?.email && (
                  <div className="rounded-lg bg-muted/40 border px-3 py-2 text-sm text-muted-foreground">
                    Inviting <strong className="text-foreground">{portalTarget.emp.email}</strong>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Portal role</Label>
                  {(["manager", "dept_manager", "member"] as const).map((r) => (
                    <button key={r} type="button" onClick={() => setPortalInviteRole(r)}
                      className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${portalInviteRole === r ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}>
                      <p className={`font-semibold text-sm ${portalInviteRole === r ? "text-primary" : ""}`}>{ROLE_LABELS[r]}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[r]}</p>
                    </button>
                  ))}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setPortalTarget(null)}>Cancel</Button>
                  <Button disabled={inviteFromEmpMutation.isPending || !portalTarget.emp?.email}
                    onClick={() => inviteFromEmpMutation.mutate({ email: portalTarget.emp!.email, portalRole: portalInviteRole })}>
                    {inviteFromEmpMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                    {emailConfigured ? "Send invite" : "Create invite"}
                  </Button>
                </DialogFooter>
              </div>
            )
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
  const [inviteSelection, setInviteSelection] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviteResult, setInviteResult] = useState<{ emailSent: boolean; inviteUrl: string; email: string } | null>(null);
  const [sendingInviteId, setSendingInviteId] = useState<number | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [linkDialogUser, setLinkDialogUser] = useState<any | null>(null);
  const [linkEmployeeId, setLinkEmployeeId] = useState<string>("none");

  const { data: users = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-team-users"],
    queryFn: () => apiFetch("/portal/team/users"),
  });

  const { data: employees = [] } = useQuery<any[]>({
    queryKey: ["portal-team-employees"],
    queryFn: () => apiFetch("/portal/team/employees"),
  });

  const { data: emailStatus } = useQuery<{ configured: boolean }>({
    queryKey: ["portal-email-status"],
    queryFn: () => apiFetch("/portal/team/email-status"),
  });

  const emailConfigured = emailStatus?.configured ?? false;

  const existingEmails = new Set((users as any[]).map((u: any) => u.email?.toLowerCase()));
  const suggestedEmployees = (employees as any[]).filter(
    (e: any) => e.email && !existingEmails.has(e.email.toLowerCase())
  );

  const resetInviteDialog = () => {
    setInviteSelection("");
    setInviteEmail("");
    setInviteRole("member");
    setInviteResult(null);
  };

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; portalRole: string }) =>
      apiFetch("/portal/team/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: data.email, portalRole: data.portalRole, sendNow: emailConfigured }),
      }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      setInviteResult({ emailSent: res.emailSent ?? false, inviteUrl: res.inviteUrl, email: res.email });
      if (res.emailSent) {
        toast({ title: "Invite sent", description: `Email sent to ${res.email}` });
      } else {
        toast({ title: "User created", description: "Share the invite link to give them access" });
      }
    },
    onError: () => toast({ title: "Failed to create invite", variant: "destructive" }),
  });

  const sendInviteEmailMutation = useMutation({
    mutationFn: (u: any) => apiFetch(`/portal/team/users/${u.id}/send-invite`, { method: "POST" }),
    onMutate: (u: any) => setSendingInviteId(u.id),
    onSettled: () => setSendingInviteId(null),
    onSuccess: (res: any, u: any) => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      if (res.emailSent) {
        toast({ title: "Invite sent", description: `Email sent to ${u.email}` });
      } else {
        toast({ title: "Failed to send email", description: res.emailError, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Failed to send invite", variant: "destructive" }),
  });

  const resendLinkMutation = useMutation({
    mutationFn: (u: any) =>
      apiFetch("/portal/team/users/invite", {
        method: "POST",
        body: JSON.stringify({ email: u.email, portalRole: u.portal_role, sendNow: false }),
      }),
    onSuccess: (res: any, u: any) => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      const link = `${window.location.origin}${res.inviteUrl}`;
      navigator.clipboard.writeText(link).catch(() => {});
      setCopiedLink(u.email);
      setTimeout(() => setCopiedLink(null), 3000);
      toast({ title: "Invite link copied to clipboard" });
    },
    onError: () => toast({ title: "Failed to regenerate invite", variant: "destructive" }),
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

  const linkMutation = useMutation({
    mutationFn: ({ id, employeeId }: { id: number; employeeId: number | null }) =>
      apiFetch(`/portal/team/users/${id}/link-employee`, { method: "PATCH", body: JSON.stringify({ employeeId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-team-users"] });
      toast({ title: "Employee linked" });
      setLinkDialogUser(null);
    },
    onError: () => toast({ title: "Failed to link employee", variant: "destructive" }),
  });

  const formatLastLogin = (ts: string | null) => {
    if (!ts) return "Never signed in";
    return `Last sign-in ${new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
  };

  const finalEmail = inviteSelection === "other" || suggestedEmployees.length === 0
    ? inviteEmail.trim()
    : (employees as any[]).find((e: any) => String(e.id) === inviteSelection)?.email ?? "";

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Button size="sm" className="gap-1.5" onClick={() => { resetInviteDialog(); setInviteOpen(true); }}>
          <Mail className="w-4 h-4" /> Invite user
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : users.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <UserCheck className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No portal users yet — invite someone to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {(users as any[]).map((u: any) => (
            <div
              key={u.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card ${u.status === "inactive" ? "opacity-60" : ""}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${u.status === "active" ? "bg-primary/10" : "bg-muted"}`}>
                <ShieldCheck className={`w-4 h-4 ${u.status === "active" ? "text-primary" : "text-muted-foreground"}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{u.email}</p>
                <p className="text-xs text-muted-foreground">
                  {u.status === "invited" ? "Invite pending — not yet signed in" : formatLastLogin(u.last_login_at)}
                </p>
              </div>

              {u.status === "invited" && (
                emailConfigured ? (
                  <Button variant="outline" size="sm" className="shrink-0 text-xs gap-1" disabled={sendingInviteId === u.id}
                    onClick={() => sendInviteEmailMutation.mutate(u)} title="Send invite email">
                    {sendingInviteId === u.id ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><Mail className="w-3 h-3" /> Send invite</>}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" className="shrink-0 text-xs gap-1" disabled={resendLinkMutation.isPending}
                    onClick={() => resendLinkMutation.mutate(u)} title="Copy invite link">
                    {copiedLink === u.email ? <><Mail className="w-3 h-3" /> Copied!</> : <><Mail className="w-3 h-3" /> Copy link</>}
                  </Button>
                )
              )}

              <Select value={u.portal_role} onValueChange={(v) => roleMutation.mutate({ id: u.id, role: v })} disabled={u.status === "inactive"}>
                <SelectTrigger className="h-7 text-xs w-28 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">User</SelectItem>
                  <SelectItem value="dept_manager">Manager</SelectItem>
                  <SelectItem value="manager">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Button variant={u.status === "active" || u.status === "invited" ? "outline" : "secondary"} size="sm" className="shrink-0 text-xs"
                onClick={() => statusMutation.mutate({ id: u.id, status: u.status === "inactive" ? "active" : "inactive" })}>
                {u.status === "inactive" ? <><RotateCcw className="w-3 h-3 mr-1" /> Reactivate</> : <><UserX className="w-3 h-3 mr-1" /> Deactivate</>}
              </Button>

              <RoleBadge role={u.status === "invited" ? "invited" : u.status === "inactive" ? "inactive" : u.portal_role} />

              <Button variant="ghost" size="sm"
                className={`shrink-0 text-xs gap-1 ${u.linked_employee_id ? "text-primary" : "text-muted-foreground"}`}
                title={u.linked_employee_id ? `Linked to ${u.linked_first_name ?? ""} ${u.linked_last_name ?? ""}` : "Link to employee record"}
                onClick={() => { setLinkDialogUser(u); setLinkEmployeeId(u.linked_employee_id ? String(u.linked_employee_id) : "none"); }}>
                <LinkIcon className="w-3.5 h-3.5" />
                {u.linked_employee_id
                  ? <span className="hidden sm:inline">{u.linked_first_name} {u.linked_last_name}</span>
                  : <span className="hidden sm:inline">Link</span>}
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!linkDialogUser} onOpenChange={(o) => { if (!o) setLinkDialogUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Link to employee record</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Linking a portal user to their employee record lets them place wardrobe orders for themselves.
            </p>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={linkEmployeeId} onValueChange={setLinkEmployeeId}>
                <SelectTrigger><SelectValue placeholder="Select employee…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No link —</SelectItem>
                  {(employees as any[]).map((e: any) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {e.first_name} {e.last_name}{e.job_title ? ` (${e.job_title})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogUser(null)}>Cancel</Button>
            <Button disabled={linkMutation.isPending}
              onClick={() => { if (!linkDialogUser) return; linkMutation.mutate({ id: linkDialogUser.id, employeeId: linkEmployeeId === "none" ? null : parseInt(linkEmployeeId, 10) }); }}>
              {linkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) { setInviteOpen(false); resetInviteDialog(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Invite a portal user</DialogTitle></DialogHeader>
          {inviteResult ? (
            <div className="space-y-4">
              {inviteResult.emailSent ? (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start gap-3">
                  <Mail className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Invite email sent</p>
                    <p className="text-xs text-green-700 mt-0.5">An invite has been emailed to <strong>{inviteResult.email}</strong>. The link expires in 7 days.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">User created. Share this link with them to give access:</p>
                  <div className="rounded-md border bg-muted p-3 text-xs font-mono break-all select-all">
                    {window.location.origin}{inviteResult.inviteUrl}
                  </div>
                  <p className="text-xs text-muted-foreground">The link expires in 7 days.</p>
                </div>
              )}
              <DialogFooter>
                {!inviteResult.emailSent && (
                  <Button variant="outline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}${inviteResult!.inviteUrl}`); toast({ title: "Copied to clipboard" }); }}>
                    Copy link
                  </Button>
                )}
                <Button onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Recipient *</Label>
                {suggestedEmployees.length > 0 ? (
                  <Select value={inviteSelection} onValueChange={val => { setInviteSelection(val); if (val !== "other") setInviteEmail(""); }}>
                    <SelectTrigger><SelectValue placeholder="Select a team member…" /></SelectTrigger>
                    <SelectContent>
                      {suggestedEmployees.map((emp: any) => (
                        <SelectItem key={emp.id} value={String(emp.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{[emp.first_name, emp.last_name].filter(Boolean).join(" ")}</span>
                            {emp.email && <span className="text-muted-foreground text-xs">{emp.email.toLowerCase()}</span>}
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="other"><span className="text-muted-foreground">Other (enter email manually)…</span></SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" autoFocus />
                )}
              </div>
              {suggestedEmployees.length > 0 && inviteSelection === "other" && (
                <div className="space-y-1">
                  <Label>Email address *</Label>
                  <Input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" autoFocus />
                </div>
              )}
              <div className="space-y-2">
                <Label>Portal role</Label>
                {(["manager", "dept_manager", "member"] as const).map((r) => (
                  <button key={r} type="button" onClick={() => setInviteRole(r)}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${inviteRole === r ? "border-primary bg-primary/5" : "border-border hover:border-primary/40 hover:bg-muted/30"}`}>
                    <p className={`font-semibold text-sm ${inviteRole === r ? "text-primary" : ""}`}>{ROLE_LABELS[r]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ROLE_DESCRIPTIONS[r]}</p>
                  </button>
                ))}
              </div>
              {!emailConfigured && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Email sending is not set up on this account — you'll get a link to share manually instead.
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Cancel</Button>
                <Button disabled={inviteMutation.isPending || !finalEmail} onClick={() => inviteMutation.mutate({ email: finalEmail, portalRole: inviteRole })}>
                  {inviteMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  {emailConfigured ? "Send invite" : "Create invite"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── My Team tab (dept_manager) ───────────────────────────────────────────────

function MyTeamTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const searchTrimmed = search.trim().toLowerCase();
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [dragEmpId, setDragEmpId] = useState<number | null>(null);
  const [dragOverBin, setDragOverBin] = useState(false);
  const [explosionPos, setExplosionPos] = useState<{ x: number; y: number } | null>(null);

  const { data: employees = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-my-team-employees", true],
    queryFn: () => apiFetch("/portal/my-team/employees?showInactive=true"),
  });

  const activeEmployees = useMemo(
    () => (employees as any[]).filter((e: any) => e.is_active),
    [employees],
  );
  const searchResults = useMemo(() => {
    if (!searchTrimmed) return [];
    return (employees as any[]).filter((e: any) =>
      `${e.first_name ?? ""} ${e.last_name ?? ""} ${e.employee_number ?? ""} ${e.email ?? ""} ${e.department ?? ""} ${e.job_title ?? ""}`
        .toLowerCase()
        .includes(searchTrimmed),
    );
  }, [employees, searchTrimmed]);

  const [form, setForm] = useState({ firstName: "", lastName: "", employeeNumber: "", email: "", phone: "", jobTitle: "", department: "" });
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));
  const resetForm = () => setForm({ firstName: "", lastName: "", employeeNumber: "", email: "", phone: "", jobTitle: "", department: "" });

  const openEdit = (emp: any) => {
    setForm({
      firstName: emp.first_name ?? "",
      lastName: emp.last_name ?? "",
      employeeNumber: emp.employee_number ?? "",
      email: emp.email ?? "",
      phone: emp.phone ?? "",
      jobTitle: emp.job_title ?? "",
      department: emp.department ?? "",
    });
    setEditTarget(emp);
  };

  const addMutation = useMutation({
    mutationFn: () => apiFetch("/portal/my-team/employees", { method: "POST", body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-my-team-employees"] });
      setAddOpen(false);
      resetForm();
      toast({ title: "Team member added" });
    },
    onError: () => toast({ title: "Failed to add team member", variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/portal/my-team/employees/${id}`, { method: "PATCH", body: JSON.stringify(form) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-my-team-employees"] });
      setEditTarget(null);
      toast({ title: "Team member updated" });
    },
    onError: () => toast({ title: "Failed to update team member", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/portal/my-team/employees/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["portal-my-team-employees"] });
      toast({ title: "Updated" });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const handleBinDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (dragEmpId == null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = rect.left + rect.width  / 2;
    const y = rect.top  + rect.height / 2;
    const empId = dragEmpId;
    setDragEmpId(null);
    setDragOverBin(false);
    setExplosionPos({ x, y });
    statusMutation.mutate({ id: empId, isActive: false });
    toast({ title: "👋 Bye then! Team member moved to leavers." });
  }, [dragEmpId, statusMutation, toast]);

  function MemberForm({ saving, onSave, onCancel }: { saving: boolean; onSave: () => void; onCancel: () => void }) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>First name *</Label><Input value={form.firstName} onChange={e => set("firstName", e.target.value)} /></div>
          <div className="space-y-1"><Label>Last name *</Label><Input value={form.lastName} onChange={e => set("lastName", e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label>Employee Number *</Label><Input placeholder="e.g. EMP-001" value={form.employeeNumber} onChange={e => set("employeeNumber", e.target.value)} /></div>
        <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
          <div className="space-y-1"><Label>Job title</Label><Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label>Department</Label><Input value={form.department} onChange={e => set("department", e.target.value)} /></div>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={saving || !form.firstName.trim() || !form.lastName.trim() || !form.employeeNumber.trim()} onClick={onSave}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {editTarget ? "Save changes" : "Add team member"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email, department…"
            className="pl-9 pr-8"
          />
          {search && (
            <button className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => { resetForm(); setAddOpen(true); }}>
          <Plus className="w-4 h-4" /> Add team member
        </Button>
      </div>

      {/* Main content with bin on right */}
      <div className="flex gap-5 items-start">
        <div className="flex-1 min-w-0">
          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : searchTrimmed ? (
            searchResults.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No team members match "{search}"</p>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {searchResults.map((emp: any) => (
                  <div key={emp.id} className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card ${emp.is_active ? "" : "opacity-60"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${getAvatarColor(emp.id)}`}>
                      {emp.first_name?.[0]}{emp.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {emp.first_name} {emp.last_name}
                        {!emp.is_active && <span className="ml-2 text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-normal">leaver</span>}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {[emp.employee_number && `#${emp.employee_number}`, emp.job_title, emp.department, emp.email].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(emp)} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      {!emp.is_active && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-green-600"
                          onClick={() => statusMutation.mutate({ id: emp.id, isActive: true })} title="Reactivate">
                          <RotateCcw className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : activeEmployees.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No active team members — add one to get started</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {activeEmployees.map((emp: any) => (
                <div
                  key={emp.id}
                  draggable={emp.is_active}
                  onDragStart={(e) => { if (!emp.is_active) return; setDragEmpId(emp.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDragEmpId(null); setDragOverBin(false); }}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card transition-all select-none
                    ${emp.is_active ? "cursor-grab active:cursor-grabbing" : "opacity-60"}
                    ${dragEmpId === emp.id ? "opacity-40 border-dashed scale-[0.98]" : ""}
                  `}
                >
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${getAvatarColor(emp.id)}`}>
                    {emp.first_name?.[0]}{emp.last_name?.[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">
                      {emp.first_name} {emp.last_name}
                      {!emp.is_active && <span className="ml-2 text-xs text-muted-foreground font-normal">(leaver)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {[emp.employee_number && `#${emp.employee_number}`, emp.job_title, emp.department, emp.email].filter(Boolean).join(" · ")}
                    </p>
                    {(() => {
                      const spend = parseFloat(emp.spend_12m ?? "0");
                      const effectiveAllowance = emp.effective_allowance != null ? parseFloat(emp.effective_allowance) : null;
                      const topup = parseFloat(emp.allowance_topup ?? "0");
                      const totalBudget = effectiveAllowance != null ? effectiveAllowance + topup : null;
                      if (totalBudget != null && totalBudget > 0) {
                        const pct = Math.min(100, (spend / totalBudget) * 100);
                        const over = spend > totalBudget;
                        return (
                          <div className="mt-1.5 max-w-xs">
                            <div className="flex items-center gap-2 text-[11px] mb-0.5">
                              <Wallet className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className={over ? "text-destructive font-medium" : "text-muted-foreground"}>
                                £{spend.toFixed(2)} of £{totalBudget.toFixed(2)} spent
                              </span>
                              {over
                                ? <span className="text-destructive font-medium">— over budget</span>
                                : <span className="text-muted-foreground/70">£{(totalBudget - spend).toFixed(2)} remaining</span>}
                            </div>
                            <div className="h-1.5 w-48 rounded-full bg-muted overflow-hidden">
                              <div className={`h-full rounded-full ${over ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                            </div>
                            {topup > 0 && <p className="text-[10px] text-muted-foreground/70 mt-0.5">Includes £{topup.toFixed(2)} extra credits</p>}
                          </div>
                        );
                      }
                      if (spend > 0) {
                        return (
                          <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                            <Wallet className="w-3 h-3 shrink-0" />£{spend.toFixed(2)} spend in last 12 months
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </div>
                  {emp.role_name && <Badge variant="outline" className="text-xs shrink-0">{emp.role_name}</Badge>}
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(emp)} title="Edit">
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon"
                      className={`h-7 w-7 ${emp.is_active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
                      onClick={() => statusMutation.mutate({ id: emp.id, isActive: !emp.is_active })}
                      title={emp.is_active ? "Mark as leaver" : "Reactivate"}>
                      {emp.is_active ? <UserMinus className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {dragEmpId != null && (
            <p className="text-xs text-center text-muted-foreground mt-3 animate-pulse">
              Drag to the bin on the right to mark as leaver →
            </p>
          )}
        </div>

        {/* Right: bin panel */}
        <BinZone
          dragging={dragEmpId != null}
          hovering={dragOverBin}
          onDragOver={(e) => { e.preventDefault(); setDragOverBin(true); }}
          onDragLeave={() => setDragOverBin(false)}
          onDrop={handleBinDrop}
        />
      </div>

      {/* Explosion overlay */}
      {explosionPos && (
        <Explosion x={explosionPos.x} y={explosionPos.y} onDone={() => setExplosionPos(null)} />
      )}

      <Dialog open={addOpen} onOpenChange={o => { if (!o) { setAddOpen(false); resetForm(); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add team member</DialogTitle></DialogHeader>
          <MemberForm saving={addMutation.isPending} onSave={() => addMutation.mutate()} onCancel={() => { setAddOpen(false); resetForm(); }} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editTarget} onOpenChange={o => { if (!o) setEditTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit team member</DialogTitle></DialogHeader>
          {editTarget && (
            <MemberForm saving={editMutation.isPending} onSave={() => editMutation.mutate(editTarget.id)} onCancel={() => setEditTarget(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Team() {
  const { isManager, isDeptManager } = useAuth();

  if (!isManager && !isDeptManager) return <Redirect to="/orders" />;

  if (isDeptManager) {
    return (
      <PortalLayout>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">My Team</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage the members of your team. Drag a member to the bin on the right to mark them as a leaver.
          </p>
        </div>
        <MyTeamTab />
      </PortalLayout>
    );
  }

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Team</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Each tile is a team manager. Drag members between tiles to reassign them, or drop onto the bin to deactivate.
        </p>
      </div>
      <EmployeesTab />
    </PortalLayout>
  );
}
