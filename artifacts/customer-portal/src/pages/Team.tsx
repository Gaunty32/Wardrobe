import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { sortBySize } from "@/lib/sizeUtils";
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
  Plus, Loader2, Users, UserCheck, UserX, UserMinus, Mail, Pencil, RotateCcw, ShieldCheck, MapPin, Ruler, Trash2, Link as LinkIcon, Wallet, GripVertical, ChevronRight, Search, X,
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

// ─── Bin drop zone ────────────────────────────────────────────────────────────

function BinZone({
  visible,
  hovering,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  visible: boolean;
  hovering: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop:     (e: React.DragEvent) => void;
}) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "28px",
        left:   "50%",
        transform: `translateX(-50%) translateY(${visible ? "0" : "calc(100% + 40px)"})`,
        transition: "transform 0.38s cubic-bezier(0.34,1.56,0.64,1)",
        zIndex: 200,
        pointerEvents: visible ? "all" : "none",
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`flex items-center gap-3 rounded-2xl border-2 px-6 py-3.5 shadow-2xl backdrop-blur-sm select-none transition-all duration-150
          ${hovering
            ? "border-red-500 bg-red-500 text-white scale-110"
            : "border-red-300 bg-white/95 text-red-500"
          }`}
      >
        <Trash2
          className={`w-6 h-6 shrink-0 transition-transform ${hovering ? "" : ""}`}
          style={hovering ? { animation: "bin-shake 0.3s ease-in-out infinite" } : undefined}
        />
        <div>
          <p className="font-bold text-sm leading-tight">
            {hovering ? "Release to say goodbye! 😬" : "Gone but not forgotten"}
          </p>
          <p className={`text-xs leading-tight mt-0.5 ${hovering ? "text-red-100" : "text-red-400"}`}>
            {hovering ? "They'll be marked as inactive — no take-backs*" : "Drop here if they've left the company 👋"}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Employee section ─────────────────────────────────────────────────────────

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

  // When role is Operative, only show Team Manager-role employees as manager options
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

      {/* Annual allowance */}
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

function EmployeesTab() {
  const qc = useQueryClient();
  const { toast } = useToast();

  // ── data ─────────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const searchTrimmed = search.trim().toLowerCase();

  const { data: employees = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-team-employees", true],
    queryFn: () => apiFetch("/portal/team/employees?showInactive=true"),
  });
  // Active-only list used by the employee form manager picker
  const { data: allEmployees = [] } = useQuery<any[]>({
    queryKey: ["portal-team-employees", false],
    queryFn: () => apiFetch("/portal/team/employees?showInactive=false"),
  });
  // When not searching, hierarchy only shows active employees
  const activeEmployees = useMemo(
    () => (employees as any[]).filter((e: any) => e.is_active),
    [employees],
  );
  // When searching, flat list across all employees
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

  // ── portal user lookup ────────────────────────────────────────────────────────
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

  // ── hierarchy (active employees only) ────────────────────────────────────────
  // groups: manager_id → direct reports list
  const groups = useMemo(() => {
    const m = new Map<number | null, any[]>();
    for (const e of activeEmployees as any[]) {
      const key = e.manager_id != null ? Number(e.manager_id) : null;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(e);
    }
    return m;
  }, [activeEmployees]);

  // IDs of employees who are managers of at least one other
  const leaderIds = useMemo(() => {
    const s = new Set<number>();
    for (const e of activeEmployees as any[]) {
      if (e.manager_id != null) s.add(Number(e.manager_id));
    }
    return s;
  }, [activeEmployees]);

  // Section keys: the leader IDs, sorted by leader surname
  const sectionKeys = useMemo(() => {
    const keys = [...groups.keys()].filter((k): k is number => k !== null);
    return keys.sort((a, b) => {
      const la = (activeEmployees as any[]).find((e: any) => e.id === a);
      const lb = (activeEmployees as any[]).find((e: any) => e.id === b);
      return (la?.last_name ?? "").localeCompare(lb?.last_name ?? "");
    });
  }, [groups, activeEmployees]);

  // Unassigned: top-level employees who do NOT lead anyone
  const unassigned = useMemo(
    () => (groups.get(null) ?? []).filter((e: any) => !leaderIds.has(e.id)),
    [groups, leaderIds],
  );

  // ── expanded sections ─────────────────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

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
  // portalTarget: { emp, user } — user=null means invite flow
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

  // ── employee card renderer ────────────────────────────────────────────────────
  const renderEmpCard = (emp: any) => {
    const portalUser = portalByEmpId.get(emp.id);
    const spend = parseFloat(emp.spend_12m ?? "0");
    const effectiveAllowance = emp.effective_allowance != null ? parseFloat(emp.effective_allowance) : null;
    const topup = parseFloat(emp.allowance_topup ?? "0");
    const totalBudget = effectiveAllowance != null ? effectiveAllowance + topup : null;
    const isDragging = dragEmpId === emp.id;

    return (
      <div
        key={emp.id}
        draggable
        onDragStart={(e) => { setDragEmpId(emp.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragEmpId(null); setDragOverKey(undefined); setDragOverBin(false); }}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 bg-card select-none transition-all
          ${emp.is_active ? "" : "opacity-60"}
          ${isDragging ? "opacity-40 border-dashed" : ""}
        `}
      >
        <GripVertical className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 cursor-grab active:cursor-grabbing" />
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${emp.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {emp.first_name?.[0]}{emp.last_name?.[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm leading-tight">
            {emp.first_name} {emp.last_name}
            {!emp.is_active && <span className="ml-1.5 text-xs text-muted-foreground font-normal">(inactive)</span>}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {[emp.employee_number && `#${emp.employee_number}`, emp.role_name, emp.job_title, emp.department].filter(Boolean).join(" · ")}
          </p>
          {totalBudget != null && totalBudget > 0 && (() => {
            const pct = Math.min(100, (spend / totalBudget) * 100);
            const over = spend > totalBudget;
            return (
              <div className="mt-1 max-w-[220px]">
                <div className="flex justify-between text-[10px] mb-0.5">
                  <span className={over ? "text-destructive font-medium" : "text-muted-foreground"}>£{spend.toFixed(0)} / £{totalBudget.toFixed(0)}</span>
                  {over ? <span className="text-destructive font-medium">Over</span> : <span className="text-muted-foreground">£{(totalBudget - spend).toFixed(0)} left</span>}
                </div>
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${over ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Portal badge or Invite */}
        {portalUser ? (
          <button onClick={() => openPortal(emp)} className="shrink-0" title="Manage portal access">
            <RoleBadge role={portalUser.status === "invited" ? "invited" : portalUser.status === "inactive" ? "inactive" : portalUser.portal_role} />
          </button>
        ) : emp.email ? (
          <Button variant="ghost" size="sm" className="shrink-0 text-xs h-6 px-2 gap-1 text-muted-foreground hover:text-primary"
            onClick={() => openPortal(emp)}>
            <Mail className="w-3 h-3" /> Invite
          </Button>
        ) : null}

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          {effectiveAllowance != null && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary" onClick={() => openTopup(emp)} title="Extra credits">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditTarget(emp)} title="Edit">
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon"
            className={`h-7 w-7 ${emp.is_active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
            onClick={() => statusMutation.mutate({ id: emp.id, isActive: !emp.is_active })}
            title={emp.is_active ? "Deactivate" : "Reactivate"}>
            {emp.is_active ? <UserMinus className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>
    );
  };

  // Drop zone styles helper
  const dropZoneCls = (key: number | null) =>
    dragEmpId != null && dragOverKey === key
      ? "border-primary ring-1 ring-primary/50 bg-primary/5"
      : "";

  // ── JSX ───────────────────────────────────────────────────────────────────────
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
        <Button size="sm" className="gap-1.5 shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="w-4 h-4" /> Add employee
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : searchTrimmed ? (
        /* ── Search results: flat list ── */
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${emp.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
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
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditTarget(emp); }} title="Edit">
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
            <p className="text-sm text-muted-foreground">No active employees — add one to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* ── Team sections (leaders with direct reports) ── */}
          {sectionKeys.map((leaderId) => {
            const leader = (activeEmployees as any[]).find((e: any) => e.id === leaderId);
            if (!leader) return null;
            const members = groups.get(leaderId) ?? [];
            const isOpen = expanded.has(leaderId);
            const leaderPortalUser = portalByEmpId.get(leaderId);
            const leaderPortalRole = leaderPortalUser
              ? (leaderPortalUser.status === "invited" ? "invited" : leaderPortalUser.status === "inactive" ? "inactive" : leaderPortalUser.portal_role)
              : null;

            return (
              <div
                key={leaderId}
                className={`rounded-xl border bg-card overflow-hidden transition-all ${dropZoneCls(leaderId)}`}
                onDragOver={(e) => { if (dragEmpId != null) { e.preventDefault(); setDragOverKey(leaderId); } }}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(leaderId); }}
              >
                {/* Leader header row */}
                <div className="flex items-center gap-2 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <button className="flex items-center gap-2 flex-1 min-w-0 text-left" onClick={() => toggle(leaderId)}>
                    <ChevronRight className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${leader.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {leader.first_name?.[0]}{leader.last_name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-tight">
                        {leader.first_name} {leader.last_name}
                        {!leader.is_active && <span className="ml-1.5 text-xs text-muted-foreground font-normal">(inactive)</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[leader.role_name, leader.job_title].filter(Boolean).join(" · ") || "Team Leader"}
                        {" · "}{members.length} {members.length === 1 ? "member" : "members"}
                      </p>
                    </div>
                  </button>
                  {/* Portal badge on leader */}
                  {leaderPortalRole ? (
                    <button onClick={() => openPortal(leader)} className="shrink-0" title="Manage portal access">
                      <RoleBadge role={leaderPortalRole} />
                    </button>
                  ) : leader.email ? (
                    <Button variant="ghost" size="sm" className="shrink-0 text-xs h-6 px-2 gap-1 text-muted-foreground hover:text-primary"
                      onClick={() => openPortal(leader)}>
                      <Mail className="w-3 h-3" /> Invite
                    </Button>
                  ) : null}
                  {leader.effective_allowance != null && (
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary shrink-0" onClick={() => openTopup(leader)} title="Extra credits">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditTarget(leader)} title="Edit">
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon"
                    className={`h-7 w-7 shrink-0 ${leader.is_active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
                    onClick={() => statusMutation.mutate({ id: leader.id, isActive: !leader.is_active })}
                    title={leader.is_active ? "Deactivate" : "Reactivate"}>
                    {leader.is_active ? <UserMinus className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                  </Button>
                </div>

                {/* Expanded members */}
                {isOpen && (
                  <div className="border-t bg-muted/10 px-3 py-2 space-y-1.5">
                    {members.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-3">No team members yet — drag employees here to assign them.</p>
                    ) : (
                      members.map((emp: any) => renderEmpCard(emp))
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── Unassigned (no manager, not a leader) ── */}
          {unassigned.length > 0 && (
            <div
              className={`rounded-xl border bg-card overflow-hidden transition-all ${dropZoneCls(null)}`}
              onDragOver={(e) => { if (dragEmpId != null) { e.preventDefault(); setDragOverKey(null); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(undefined); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(null); }}
            >
              <div className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide border-b bg-muted/20">
                <Users className="w-3.5 h-3.5" /> Unassigned ({unassigned.length})
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {unassigned.map((emp: any) => renderEmpCard(emp))}
              </div>
            </div>
          )}

          {/* ── Portal-only users (not linked to an employee) ── */}
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
        </div>
      )}

      {/* Drag-in-progress hint */}
      {dragEmpId != null && (
        <p className="text-xs text-center text-muted-foreground mt-3 animate-pulse">
          Drop onto a team leader section to reassign — or into the bin below 👇
        </p>
      )}

      {/* Bin zone — slides up from bottom when dragging */}
      <BinZone
        visible={dragEmpId != null}
        hovering={dragOverBin}
        onDragOver={(e) => { e.preventDefault(); setDragOverBin(true); }}
        onDragLeave={() => setDragOverBin(false)}
        onDrop={handleBinDrop}
      />

      {/* Particle explosion overlay */}
      {explosionPos && (
        <Explosion
          x={explosionPos.x}
          y={explosionPos.y}
          onDone={() => setExplosionPos(null)}
        />
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}

      {/* Add */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add employee</DialogTitle></DialogHeader>
          <EmployeeForm addresses={addresses} roles={roles} allEmployees={allEmployees}
            onSave={(data, sizes) => addMutation.mutate({ data, sizes })}
            onCancel={() => setAddOpen(false)} saving={addMutation.isPending} />
        </DialogContent>
      </Dialog>

      {/* Edit */}
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

      {/* Top-up credits */}
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

      {/* Portal access dialog */}
      <Dialog open={!!portalTarget} onOpenChange={(o) => { if (!o) { setPortalTarget(null); setPortalInviteResult(null); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {portalTarget?.emp ? `Portal access — ${portalTarget.emp.first_name} ${portalTarget.emp.last_name}` : "Portal access"}
            </DialogTitle>
          </DialogHeader>
          {portalTarget && (
            portalTarget.user ? (
              /* ── Manage existing user ── */
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
              /* ── Invite success ── */
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
              /* ── Invite form ── */
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
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs gap-1"
                    disabled={sendingInviteId === u.id}
                    onClick={() => sendInviteEmailMutation.mutate(u)}
                    title="Send invite email"
                  >
                    {sendingInviteId === u.id ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                    ) : (
                      <><Mail className="w-3 h-3" /> Send invite</>
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 text-xs gap-1"
                    disabled={resendLinkMutation.isPending}
                    onClick={() => resendLinkMutation.mutate(u)}
                    title="Copy invite link"
                  >
                    {copiedLink === u.email ? (
                      <><Mail className="w-3 h-3" /> Copied!</>
                    ) : (
                      <><Mail className="w-3 h-3" /> Copy link</>
                    )}
                  </Button>
                )
              )}

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

              <Button
                variant="ghost"
                size="sm"
                className={`shrink-0 text-xs gap-1 ${u.linked_employee_id ? "text-primary" : "text-muted-foreground"}`}
                title={u.linked_employee_id ? `Linked to ${u.linked_first_name ?? ""} ${u.linked_last_name ?? ""}` : "Link to employee record"}
                onClick={() => {
                  setLinkDialogUser(u);
                  setLinkEmployeeId(u.linked_employee_id ? String(u.linked_employee_id) : "none");
                }}
              >
                <LinkIcon className="w-3.5 h-3.5" />
                {u.linked_employee_id
                  ? <span className="hidden sm:inline">{u.linked_first_name} {u.linked_last_name}</span>
                  : <span className="hidden sm:inline">Link</span>
                }
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Link employee dialog */}
      <Dialog open={!!linkDialogUser} onOpenChange={(o) => { if (!o) setLinkDialogUser(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Link to employee record</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              Linking a portal user to their employee record lets them place wardrobe orders for themselves.
            </p>
            <div className="space-y-1.5">
              <Label>Employee</Label>
              <Select value={linkEmployeeId} onValueChange={setLinkEmployeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select employee…" />
                </SelectTrigger>
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
            <Button
              disabled={linkMutation.isPending}
              onClick={() => {
                if (!linkDialogUser) return;
                linkMutation.mutate({
                  id: linkDialogUser.id,
                  employeeId: linkEmployeeId === "none" ? null : parseInt(linkEmployeeId, 10),
                });
              }}
            >
              {linkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite dialog */}
      <Dialog open={inviteOpen} onOpenChange={(o) => { if (!o) { setInviteOpen(false); resetInviteDialog(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a portal user</DialogTitle>
          </DialogHeader>

          {inviteResult ? (
            /* ── Success state ── */
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
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}${inviteResult!.inviteUrl}`);
                      toast({ title: "Copied to clipboard" });
                    }}
                  >
                    Copy link
                  </Button>
                )}
                <Button onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            /* ── Form state ── */
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Recipient *</Label>
                {suggestedEmployees.length > 0 ? (
                  <Select
                    value={inviteSelection}
                    onValueChange={val => {
                      setInviteSelection(val);
                      if (val !== "other") setInviteEmail("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a team member…" />
                    </SelectTrigger>
                    <SelectContent>
                      {suggestedEmployees.map((emp: any) => (
                        <SelectItem key={emp.id} value={String(emp.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">
                              {[emp.first_name, emp.last_name].filter(Boolean).join(" ")}
                            </span>
                            {emp.email && (
                              <span className="text-muted-foreground text-xs">{emp.email.toLowerCase()}</span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                      <SelectItem value="other">
                        <span className="text-muted-foreground">Other (enter email manually)…</span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    autoFocus
                  />
                )}
              </div>

              {suggestedEmployees.length > 0 && inviteSelection === "other" && (
                <div className="space-y-1">
                  <Label>Email address *</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
                    autoFocus
                  />
                </div>
              )}

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

              {!emailConfigured && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  Email sending is not set up on this account — you'll get a link to share manually instead.
                </p>
              )}

              <DialogFooter>
                <Button variant="outline" onClick={() => { setInviteOpen(false); resetInviteDialog(); }}>Cancel</Button>
                <Button
                  disabled={inviteMutation.isPending || !finalEmail}
                  onClick={() => inviteMutation.mutate({ email: finalEmail, portalRole: inviteRole })}
                >
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
        <div className="space-y-1"><Label>Employee Number</Label><Input placeholder="e.g. EMP-001" value={form.employeeNumber} onChange={e => set("employeeNumber", e.target.value)} /></div>
        <div className="space-y-1"><Label>Email</Label><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1"><Label>Phone</Label><Input value={form.phone} onChange={e => set("phone", e.target.value)} /></div>
          <div className="space-y-1"><Label>Job title</Label><Input value={form.jobTitle} onChange={e => set("jobTitle", e.target.value)} /></div>
        </div>
        <div className="space-y-1"><Label>Department</Label><Input value={form.department} onChange={e => set("department", e.target.value)} /></div>
        <DialogFooter className="pt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={saving || !form.firstName.trim() || !form.lastName.trim()} onClick={onSave}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            {editTarget ? "Save changes" : "Add team member"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <div>
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
              <div
                key={emp.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 bg-card ${emp.is_active ? "" : "opacity-60"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${emp.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
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
                ${emp.is_active ? "" : "opacity-60"}
                ${dragEmpId === emp.id ? "opacity-40 border-dashed" : ""}
              `}
            >
              <GripVertical className={`w-3.5 h-3.5 text-muted-foreground/30 shrink-0 cursor-grab active:cursor-grabbing ${emp.is_active ? "" : "invisible"}`} />
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${emp.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
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
                            : <span className="text-muted-foreground/70">£{(totalBudget - spend).toFixed(2)} remaining</span>
                          }
                        </div>
                        <div className="h-1.5 w-48 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full ${over ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-primary"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {topup > 0 && (
                          <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                            Includes £{topup.toFixed(2)} extra credits
                          </p>
                        )}
                      </div>
                    );
                  }
                  if (spend > 0) {
                    return (
                      <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                        <Wallet className="w-3 h-3 shrink-0" />
                        £{spend.toFixed(2)} spend in last 12 months
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
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${emp.is_active ? "text-muted-foreground hover:text-destructive" : "text-muted-foreground hover:text-green-600"}`}
                  onClick={() => statusMutation.mutate({ id: emp.id, isActive: !emp.is_active })}
                  title={emp.is_active ? "Mark as leaver" : "Reactivate"}
                >
                  {emp.is_active ? <UserMinus className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drag-in-progress hint */}
      {dragEmpId != null && (
        <p className="text-xs text-center text-muted-foreground mt-3 animate-pulse">
          Drag to the bin below to mark as leaver 👇
        </p>
      )}

      {/* Bin zone */}
      <BinZone
        visible={dragEmpId != null}
        hovering={dragOverBin}
        onDragOver={(e) => { e.preventDefault(); setDragOverBin(true); }}
        onDragLeave={() => setDragOverBin(false)}
        onDrop={handleBinDrop}
      />

      {/* Explosion overlay */}
      {explosionPos && (
        <Explosion
          x={explosionPos.x}
          y={explosionPos.y}
          onDone={() => setExplosionPos(null)}
        />
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

  // Dept managers see only their own team
  if (isDeptManager) {
    return (
      <PortalLayout>
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">My Team</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Manage the members of your team — add new starters or mark leavers.
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
          Manage employees and portal access. Drag team members between leaders to reassign them.
        </p>
      </div>
      <EmployeesTab />
    </PortalLayout>
  );
}
