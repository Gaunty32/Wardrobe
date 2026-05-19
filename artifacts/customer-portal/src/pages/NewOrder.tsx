import React, { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { sortSizesWithOrder } from "@/lib/sizeUtils";
import { useSizeOrder } from "@/hooks/useSizeOrder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, ArrowRight, Plus, Minus, Trash2, Loader2,
  Shirt, ShoppingBag, CheckCircle2, Search,
  User, Package, History, Tag, Sparkles, Heart, X, Mail, UserPlus,
  CreditCard, FileText, AlertCircle, Printer, MapPin, Boxes, TrendingUp, Paperclip, Gift,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

function ProcessImage({ url, alt }: { url: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
        <Shirt className="w-5 h-5 text-muted-foreground/40" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className="h-10 w-10 rounded object-contain bg-white border shrink-0"
      onError={() => setFailed(true)}
    />
  );
}

type ProcessLine = {
  name: string;
  type: string | null;
  price: number;
  included: boolean;
};

type OrderItem = {
  productId: number | null;
  productName: string;
  sku: string | null;
  colour: string;
  size: string;
  finishId: number | null;
  finishName: string;
  recipientType: "stock" | "person";
  recipientName: string;
  recipientEmployeeId: number | null;
  quantity: number;
  garmentBasePrice: number;
  processLines: ProcessLine[];
  unitPrice: number;
};

const EMPTY_ITEM: OrderItem = {
  productId: null,
  productName: "",
  sku: null,
  colour: "",
  size: "",
  finishId: null,
  finishName: "",
  recipientType: "stock",
  recipientName: "",
  recipientEmployeeId: null,
  quantity: 1,
  garmentBasePrice: 0,
  processLines: [],
  unitPrice: 0,
};

// ─── Step indicator ──────────────────────────────────────────────────────────

function Steps({ current, steps }: { current: number; steps: string[] }) {
  return (
    <ol className="flex items-center gap-0 mb-8 overflow-x-auto pb-1">
      {steps.map((label, i) => (
        <li key={i} className="flex items-center">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors",
              i < current ? "bg-primary text-primary-foreground" :
              i === current ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
              "bg-muted text-muted-foreground"
            )}>
              {i < current ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
            </div>
            <span className={cn(
              "text-sm font-medium whitespace-nowrap",
              i === current ? "text-foreground" : "text-muted-foreground"
            )}>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={cn("h-px w-8 mx-2 shrink-0", i < current ? "bg-primary" : "bg-border")} />
          )}
        </li>
      ))}
    </ol>
  );
}

// ─── Step 1: Mode ────────────────────────────────────────────────────────────

function ModeStep({ onSelect }: { onSelect: (mode: "wardrobe" | "catalogue") => void }) {
  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">How would you like to order?</h2>
      <p className="text-muted-foreground text-sm mb-6">
        Place an order from your pre-configured wardrobe, or send us a wishlist and we'll turn it into a quote.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("wardrobe")}
        >
          <CardContent className="py-6 px-6 flex flex-col gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Shirt className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">My Wardrobe</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-3">
                Order from your pre-configured branded garments — assign to named individuals or order as bulk stock.
              </p>
              <ul className="space-y-1.5">
                {[
                  { icon: User, text: "Each order packed & labelled per person" },
                  { icon: History, text: "Smart size suggestions from past orders" },
                  { icon: Tag, text: "Full order history per employee" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:border-primary hover:shadow-md transition-all group"
          onClick={() => onSelect("catalogue")}
        >
          <CardContent className="py-6 px-6 flex flex-col gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Looking for Inspiration</h3>
              <p className="text-muted-foreground text-sm mt-1 mb-3">
                Browse our range, pick what catches your eye, and tell us the colours and decoration styles you'd love.
                We'll review your wishlist and build a wardrobe quote.
              </p>
              <ul className="space-y-1.5">
                {[
                  { icon: Heart, text: "Add products to a wishlist — no sizes needed" },
                  { icon: Tag, text: "Tell us your preferred colours & decoration" },
                  { icon: Mail, text: "We'll come back with a tailored quote" },
                ].map(({ icon: Icon, text }) => (
                  <li key={text} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Icon className="w-3.5 h-3.5 text-primary/70 shrink-0" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Step 2a: Wardrobe ───────────────────────────────────────────────────────


function ProcessBadgeInline({ type }: { type: string }) {
  const colours: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700 border-purple-200",
    print: "bg-blue-100 text-blue-700 border-blue-200",
    dtf: "bg-cyan-100 text-cyan-700 border-cyan-200",
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    heat_transfer: "bg-orange-100 text-orange-700 border-orange-200",
  };
  const cls = colours[type?.toLowerCase()] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border ${cls}`}>
      {type?.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase())}
    </span>
  );
}

type ItemState = { size: string; qty: number };

/** Returns a friendly price-break suggestion toast payload, or null if none applies. */
function getPriceBreakSuggestion(
  productName: string,
  totalQty: number,
  priorQty: number,
  priceBreaks: { qty: number; price: number }[],
  basePrice: number,
): { title: string; description: string } | null {
  if (!priceBreaks.length) return null;
  const sorted = [...priceBreaks].sort((a, b) => a.qty - b.qty);

  // Celebrate crossing into a new tier
  const justUnlocked = sorted.filter(pb => pb.qty <= totalQty && pb.qty > priorQty);
  if (justUnlocked.length > 0) {
    const best = justUnlocked[justUnlocked.length - 1];
    return {
      title: "Bulk rate unlocked!",
      description: `${productName} are now £${best.price.toFixed(2)} each at this quantity.`,
    };
  }

  // Suggest next reachable tier
  const nextTier = sorted.find(pb => pb.qty > totalQty);
  if (!nextTier) return null;
  const saving = basePrice - nextTier.price;
  if (saving < 0.01) return null;

  const needed = nextTier.qty - totalQty;
  const isClose = needed <= Math.ceil(nextTier.qty * 0.35);
  if (isClose) {
    return {
      title: "Almost there!",
      description: `Add just ${needed} more ${productName} to unlock £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
    };
  }
  return {
    title: "Bulk discount tip",
    description: `Did you know? Order ${nextTier.qty}+ ${productName} and the price drops to £${nextTier.price.toFixed(2)} each — saving £${saving.toFixed(2)} per item.`,
  };
}

function WardrobeStep({ items, employees, lastSizes, savedSizes, sizesMap, basket, setBasket, onNext, processes, isManager, onEmployeeAdded, myEmployeeId, portalRole }: {
  items: any[];
  employees: any[];
  lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
  savedSizes: Record<string, Array<{ label: string; size: string }>>;
  sizesMap: Record<string, Record<string, string[]>>;
  processes: any[];
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onNext: () => void;
  isManager: boolean;
  onEmployeeAdded: () => void;
  myEmployeeId: number | null;
  portalRole: string;
}) {
  const { toast } = useToast();
  const sizeOrder = useSizeOrder();
  const [, setLocation] = useLocation();
  const [itemStates, setItemStates] = useState<Record<string, ItemState>>({});
  const [bulkModes, setBulkModes] = useState<Record<string, boolean>>({});
  const [bulkQtys, setBulkQtys] = useState<Record<string, Record<string, number>>>({});
  const [expandedProcs, setExpandedProcs] = useState<Set<string>>(new Set());
  const toggleProcs = (key: string) => setExpandedProcs(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  // Members are pre-locked to their own employee record; others choose freely
  const [selectedRecipient, setSelectedRecipient] = useState<string | null>(
    portalRole === "member" && myEmployeeId ? String(myEmployeeId) : null
  );

  // Auto-scroll the order summary to the bottom when items are added
  const summaryScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = summaryScrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [basket.length]);

  // Search / filter state
  const [search, setSearch] = useState("");
  const [showOtherTeams, setShowOtherTeams] = useState(false);

  // Transfer dialog (dept_manager ordering for another team's operative)
  const [transferDialogEmp, setTransferDialogEmp] = useState<any | null>(null);
  const transferMut = useMutation({
    mutationFn: (empId: number) => apiFetch(`/portal/my-team/employees/${empId}/adopt`, { method: "POST" }),
    onSuccess: (_, empId) => {
      toast({ title: "Employee transferred to your team" });
      onEmployeeAdded(); // refresh employee list
      setTransferDialogEmp(null);
      doSelectRecipient(String(empId));
    },
    onError: () => toast({ title: "Could not transfer employee", variant: "destructive" }),
  });

  // Add employee dialog
  const [addOpen, setAddOpen] = useState(false);
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  const [newDept, setNewDept] = useState("");

  const addEmpMut = useMutation({
    mutationFn: () => apiFetch("/portal/team/employees", {
      method: "POST",
      body: JSON.stringify({ firstName: newFirst, lastName: newLast, jobTitle: newJobTitle || null, department: newDept || null }),
    }),
    onSuccess: () => {
      toast({ title: "Employee added" });
      setAddOpen(false);
      setNewFirst(""); setNewLast(""); setNewJobTitle(""); setNewDept("");
      onEmployeeAdded();
    },
    onError: () => toast({ title: "Could not add employee", variant: "destructive" }),
  });

  // Split employees into my team vs others (for dept_manager)
  const isDeptManager = portalRole === "dept_manager";
  const { myTeamEmployees, otherEmployees } = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = employees.filter((emp: any) => {
      if (portalRole === "member" && myEmployeeId !== null && emp.id !== myEmployeeId) return false;
      if (!q) return true;
      return `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.toLowerCase().includes(q);
    });
    if (!isDeptManager || !myEmployeeId) return { myTeamEmployees: base, otherEmployees: [] };
    return {
      myTeamEmployees: base.filter((e: any) => e.manager_id === myEmployeeId),
      otherEmployees: base.filter((e: any) => e.manager_id !== myEmployeeId),
    };
  }, [employees, search, portalRole, myEmployeeId, isDeptManager]);

  // For non-dept-manager paths
  const filteredEmployees = isDeptManager ? myTeamEmployees : myTeamEmployees;

  const getItemState = (key: string): ItemState =>
    itemStates[key] ?? { size: "", qty: 1 };
  const setItemState = (key: string, patch: Partial<ItemState>) =>
    setItemStates(s => ({ ...s, [key]: { ...getItemState(key), ...patch } }));

  // Core selection logic (shared by normal path and post-transfer)
  const doSelectRecipient = (recipientId: string) => {
    setSelectedRecipient(recipientId);
    const emp = recipientId !== "stock"
      ? employees.find((e: any) => String(e.id) === recipientId)
      : null;
    const updates: Record<string, ItemState> = {};
    const groups = Object.values(
      items.reduce((acc: any, item: any) => {
        const fid = item.finish_id ?? 0;
        if (!acc[fid]) acc[fid] = { finish_id: fid, items: [] };
        acc[fid].items.push(item);
        return acc;
      }, {})
    ) as Array<{ finish_id: number; items: any[] }>;
    groups.forEach((g: any) => {
      g.items.forEach((wi: any, i: number) => {
        const key = `${g.finish_id}-${i}`;
        const hist = emp ? (() => {
          const empSizes = lastSizes[String(emp.id)];
          if (!empSizes) return null;
          if (wi.product_id && empSizes[String(wi.product_id)]) return empSizes[String(wi.product_id)].size;
          const name = wi.product_name ?? wi.name;
          if (name && empSizes[name]) return empSizes[name].size;
          return null;
        })() : null;
        const saved = !hist && emp ? (() => {
          const empSaved = savedSizes[String(emp.id)];
          if (!empSaved?.length) return null;
          const name = (wi.product_name ?? wi.name ?? "").toLowerCase();
          const exact = empSaved.find((s: any) => s.label.toLowerCase() === name);
          if (exact) return exact.size;
          const partial = empSaved.find((s: any) =>
            name.includes(s.label.toLowerCase()) || s.label.toLowerCase().includes(name)
          );
          return partial?.size ?? null;
        })() : null;
        updates[key] = { size: hist ?? saved ?? "", qty: 1 };
      });
    });
    setItemStates(updates);
  };

  // Intercept selection: if dept_manager picks from another team, show transfer dialog
  const handleSelectRecipient = (recipientId: string) => {
    if (isDeptManager && recipientId !== "stock" && myEmployeeId) {
      const emp = employees.find((e: any) => String(e.id) === recipientId);
      if (emp && emp.manager_id !== myEmployeeId) {
        setTransferDialogEmp(emp);
        return;
      }
    }
    doSelectRecipient(recipientId);
  };

  // Derive selected employee early so role filtering can be applied to items
  const selectedEmployee = selectedRecipient !== null && selectedRecipient !== "stock"
    ? employees.find((e: any) => String(e.id) === selectedRecipient) ?? null
    : null;

  // Filter items to only those matching the selected employee's role (or unassigned items).
  // Stock orders and unselected state show everything.
  const roleFilteredItems = useMemo(() => {
    if (!selectedEmployee) return items;
    const empRoleId = selectedEmployee.role_id ?? null;
    const effectiveRoleId = (item: any) => item.role_id ?? item.finish_role_id ?? item.effective_role_id ?? null;
    return items.filter((item: any) => effectiveRoleId(item) == null || effectiveRoleId(item) === empRoleId);
  }, [items, selectedEmployee]);

  // Group items by finish
  const finishGroups = Object.values(
    roleFilteredItems.reduce((acc: any, item: any) => {
      const fid = item.finish_id ?? 0;
      if (!acc[fid]) acc[fid] = {
        finish_id: fid,
        finish_name: item.finish_name ?? null,
        finish_code: item.finish_code ?? null,
        items: [],
      };
      acc[fid].items.push(item);
      return acc;
    }, {})
  ) as Array<{ finish_id: number; finish_name: string | null; finish_code: string | null; items: any[] }>;

  // Attach processes to each group
  // Use Number() coercion on both sides — raw SQL rows can return integers as
  // strings, causing strict === to silently fail even when the IDs match.
  const groupProcesses = (finishId: number | null) =>
    processes.filter(p => Number(p.finish_id) === Number(finishId));

  const getLastSize = (wi: any, employeeId: number): string | null => {
    const empSizes = lastSizes[String(employeeId)];
    if (!empSizes) return null;
    if (wi.product_id && empSizes[String(wi.product_id)]) return empSizes[String(wi.product_id)].size;
    const name = wi.product_name ?? wi.name;
    if (name && empSizes[name]) return empSizes[name].size;
    return null;
  };

  // Fallback: find a saved (profile) size for this item by matching label against the item name
  const getSavedSize = (wi: any, employeeId: number): string | null => {
    const empSaved = savedSizes[String(employeeId)];
    if (!empSaved || empSaved.length === 0) return null;
    const name = (wi.product_name ?? wi.name ?? "").toLowerCase();
    if (!name) return null;
    // Exact match first, then partial
    const exact = empSaved.find(s => s.label.toLowerCase() === name);
    if (exact) return exact.size;
    const partial = empSaved.find(s =>
      name.includes(s.label.toLowerCase()) || s.label.toLowerCase().includes(name)
    );
    return partial?.size ?? null;
  };

  // Returns { size, source } — source is 'history' | 'saved' | null
  const getSuggestedSize = (wi: any, employeeId: number): { size: string; source: "history" | "saved" } | null => {
    const hist = getLastSize(wi, employeeId);
    if (hist) return { size: hist, source: "history" };
    const saved = getSavedSize(wi, employeeId);
    if (saved) return { size: saved, source: "saved" };
    return null;
  };

  const getAvailableSizes = (wi: any): string[] => {
    if (!sizesMap || !wi.product_id) return [];
    const byColour = sizesMap[String(wi.product_id)];
    // No WooCommerce size data at all — treat as one-size item (e.g. caps, bags)
    if (!byColour) return [];
    // Return all sizes across all colour variants — the colour on the wardrobe item
    // is fixed for display but shouldn't restrict which sizes can be ordered
    const all = [...new Set(Object.values(byColour).flat())];
    return sortSizesWithOrder(all, sizeOrder);
  };

  // Computes the garment base price (with quantity breaks) and decoration process lines.
  // The WooCommerce price already includes the cheapest/first logo; extra logos are additive.
  // When a special_price is set it is the ALL-IN total price for this customer — no extra
  // logo surcharges are added on top; all process lines are shown as included.
  // Returns { garmentPrice, processLines, unitPrice }.
  const resolveItemPricing = (wi: any, qty: number): { garmentPrice: number; processLines: ProcessLine[]; unitPrice: number } => {
    const finishProcs = processes.filter((p: any) => p.finish_id === wi.finish_id);

    // Special price → total all-in price, all processes included
    if (wi.special_price != null && wi.special_price !== "") {
      const totalPrice = parseFloat(wi.special_price);
      const processLines: ProcessLine[] = finishProcs.map((p: any) => ({
        name: p.item_finish_name ?? p.process_type ?? "",
        type: p.process_type ?? null,
        price: parseFloat(p.price ?? "0") || 0,
        included: true,
      }));
      return { garmentPrice: totalPrice, processLines, unitPrice: totalPrice };
    }

    const wooBase = parseFloat(wi.woo_price ?? wi.unit_price ?? "0");
    const wooRegular = wi.woo_regular_price ? parseFloat(wi.woo_regular_price) : null;

    // WooCommerce sale price is all-in: product is marked on_sale, OR its current price
    // is lower than the stored regular price — meaning the decoration is bundled into
    // the sale deal. No extra logo surcharges are added in this case.
    const isWooSale = wi.woo_on_sale === true || (wooRegular != null && wooRegular > 0 && wooBase < wooRegular);
    if (isWooSale) {
      const processLines: ProcessLine[] = finishProcs.map((p: any) => ({
        name: p.item_finish_name ?? p.process_type ?? "",
        type: p.process_type ?? null,
        price: parseFloat(p.price ?? "0") || 0,
        included: true,
      }));
      return { garmentPrice: wooBase, processLines, unitPrice: wooBase };
    }

    // Standard pricing: WooCommerce base + extra logos
    const breaks: { qty: number; price: number }[] = Array.isArray(wi.price_breaks) ? wi.price_breaks : [];
    const sorted = [...breaks].sort((a, b) => b.qty - a.qty);
    const garmentPrice = breaks.length > 0 ? (sorted.find(pb => qty >= pb.qty)?.price ?? wooBase) : wooBase;

    const processLines: ProcessLine[] = [];
    let totalExtra = 0;

    if (finishProcs.length > 0) {
      const priced = finishProcs.map((p: any) => ({ ...p, numPrice: parseFloat(p.price ?? "0") || 0 }));
      const minPrice = Math.min(...priced.map(p => p.numPrice));
      let includedDone = false;
      for (const p of priced) {
        const included = !includedDone && p.numPrice === minPrice;
        if (included) includedDone = true;
        else totalExtra += p.numPrice;
        processLines.push({
          name: p.item_finish_name ?? p.process_type ?? "",
          type: p.process_type ?? null,
          price: p.numPrice,
          included,
        });
      }
    }

    return { garmentPrice, processLines, unitPrice: garmentPrice + totalExtra };
  };

  // Quick price-only helper used for the live price display on cards before adding to basket.
  const resolveUnitPrice = (wi: any, qty: number): number => resolveItemPricing(wi, qty).unitPrice;

  const makeItem = (wi: any, recipientType: "stock" | "person", size: string, qty: number, employee?: any): OrderItem => {
    const { garmentPrice, processLines, unitPrice } = resolveItemPricing(wi, qty);
    return {
      productId: wi.product_id ?? null,
      productName: wi.product_name ?? wi.name,
      sku: wi.product_sku ?? null,
      colour: wi.colour ?? "",
      size,
      finishId: wi.finish_id ?? null,
      finishName: wi.finish_name ?? "",
      recipientType,
      recipientName: employee ? `${employee.first_name} ${employee.last_name}` : "",
      recipientEmployeeId: employee?.id ?? null,
      quantity: qty,
      garmentBasePrice: garmentPrice,
      processLines,
      unitPrice,
    };
  };

  // ── Empty state ────────────────────────────────────────────────────────────
  if (finishGroups.length === 0) {
    return (
      <div>
        <h2 className="text-xl font-semibold mb-2">My Wardrobe</h2>
        <Card className="border-dashed">
          <CardContent className="py-12 px-8 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Shirt className="w-7 h-7 text-muted-foreground/60" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Your wardrobe isn't set up yet</h3>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm mx-auto">
              Contact Select Branding Solutions to get your branded garments configured.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 text-left max-w-xl mx-auto">
              {[
                { icon: User, title: "Named packing", desc: "Every order packed & labelled per person — ready to hand out." },
                { icon: History, title: "Size memory", desc: "Remembers each person's last size and suggests it automatically." },
                { icon: Tag, title: "Usage reports", desc: "Full order history per employee so you can track spend and reorder dates." },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Icon className="w-4 h-4 text-primary" />
                    <span className="font-medium text-sm">{title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button variant="outline" onClick={() => setLocation("/wardrobe")}>View My Wardrobe</Button>
              <Button asChild>
                <a href="mailto:hello@selectbranding.co.uk">Contact SBS to set up</a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Order summary grouped by recipient ─────────────────────────────────────
  const summaryGroups = basket.reduce((acc: Record<string, OrderItem[]>, item) => {
    const key = item.recipientType === "stock" ? "__stock__" : (item.recipientName || "__stock__");
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
  const summaryTotal = basket.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);

  // ── Shared summary sidebar ─────────────────────────────────────────────────
  const SummarySidebar = () => (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
        <span className="font-semibold text-sm">Order Summary</span>
        {basket.length > 0 && (
          <span className="text-xs text-muted-foreground">{basket.length} item{basket.length !== 1 ? "s" : ""}</span>
        )}
      </div>
      {basket.length === 0 ? (
        <div className="px-4 py-8 text-center text-muted-foreground text-xs">
          <Package className="w-6 h-6 mx-auto mb-2 opacity-30" />
          No items added yet
        </div>
      ) : (
        <div ref={summaryScrollRef} className="divide-y max-h-[60vh] overflow-y-auto">
          {Object.entries(summaryGroups).map(([recipKey, grpItems]) => {
            const label = recipKey === "__stock__" ? "Bulk Stock" : recipKey;
            const isStockGrp = recipKey === "__stock__";
            return (
              <div key={recipKey} className="px-4 py-3">
                <div className="flex items-center gap-1.5 mb-2">
                  {isStockGrp
                    ? <Package className="w-3 h-3 text-muted-foreground shrink-0" />
                    : <User className="w-3 h-3 text-muted-foreground shrink-0" />}
                  <span className="text-xs font-semibold truncate">{label}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {(grpItems as OrderItem[]).map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 group">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium leading-tight truncate">{item.productName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {[item.colour, item.size, item.quantity > 1 ? `×${item.quantity}` : null].filter(Boolean).join(" · ")}
                        </p>
                        {item.unitPrice > 0 && (
                          <p className="text-[11px] text-primary font-semibold">{formatCurrency(item.unitPrice * item.quantity)}</p>
                        )}
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 text-muted-foreground hover:text-destructive"
                        onClick={() => setBasket(b => b.filter(x => x !== item))}
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {basket.length > 0 && (
        <div className="px-4 py-3 border-t bg-muted/20">
          {summaryTotal > 0 && (
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">Estimated total</span>
              <span className="text-sm font-bold">{formatCurrency(summaryTotal)}</span>
            </div>
          )}
          <Button className="w-full" size="sm" onClick={onNext}>
            Review order <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      )}
    </div>
  );

  // ── Person picker (no recipient selected yet) ───────────────────────────────
  if (!selectedRecipient) {
    // Member role with no linked employee — show helpful warning instead of empty picker
    if (portalRole === "member" && myEmployeeId === null) {
      return (
        <div className="py-10 text-center max-w-md mx-auto">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <User className="w-7 h-7 text-amber-600" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Employee record not linked</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Your account needs to be linked to your employee record before you can place wardrobe orders. Please ask your admin to link your account in the Team settings.
          </p>
          <Button variant="outline" onClick={() => setLocation("/")}>Back to dashboard</Button>
        </div>
      );
    }

    return (
      <div>
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-xl font-semibold">My Wardrobe</h2>
          {isManager && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <UserPlus className="w-4 h-4 mr-1.5" /> Add employee
            </Button>
          )}
        </div>
        <div className="flex gap-6 items-start">
        <div className="flex-1 min-w-0">
        {/* Search row */}
        <div className="flex gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
            {search && (
              <button className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearch("")}>
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Who is this for?</p>

        {/* When searching as dept_manager: flat unified grid across all teams */}
        {isDeptManager && search ? (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
              {[...myTeamEmployees, ...otherEmployees].map((emp: any) => {
                const initials = [emp.first_name?.[0], emp.last_name?.[0]].filter(Boolean).join("").toUpperCase();
                const empItems = basket.filter(b => b.recipientEmployeeId === emp.id);
                const isOtherTeam = otherEmployees.includes(emp);
                return (
                  <button
                    key={emp.id}
                    onClick={() => handleSelectRecipient(String(emp.id))}
                    className={cn(
                      "rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group relative",
                      isOtherTeam && "border-dashed"
                    )}
                  >
                    {empItems.length > 0 && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {empItems.length}
                      </span>
                    )}
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm mb-3 transition-colors",
                      isOtherTeam
                        ? "bg-muted/60 text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                        : "bg-primary/10 text-primary group-hover:bg-primary/15"
                    )}>
                      {initials || <User className="w-4 h-4" />}
                    </div>
                    <p className="font-semibold text-sm leading-tight">{emp.first_name} {emp.last_name}</p>
                    {isOtherTeam && emp.manager_name
                      ? <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.manager_name}'s team</p>
                      : emp.role_name && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.role_name}</p>
                    }
                  </button>
                );
              })}
              {myTeamEmployees.length === 0 && otherEmployees.length === 0 && (
                <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                  No employees match "{search}" across all teams
                </div>
              )}
            </div>
            {(myTeamEmployees.length > 0 || otherEmployees.length > 0) && (
              <p className="text-xs text-muted-foreground mb-4">
                {myTeamEmployees.length + otherEmployees.length} result{myTeamEmployees.length + otherEmployees.length !== 1 ? "s" : ""} across all teams
              </p>
            )}
          </div>
        ) : (
          <>
            {/* My Team section (no search, or non-dept-manager) */}
            {isDeptManager && <p className="text-xs font-semibold text-muted-foreground mb-2">My Team</p>}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
              {!search && (
                <button
                  onClick={() => handleSelectRecipient("stock")}
                  className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group"
                >
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-3 group-hover:bg-muted/80 transition-colors">
                    <Package className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-sm">Bulk Stock</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Order without assigning to a person</p>
                </button>
              )}
              {myTeamEmployees.map((emp: any) => {
                const initials = [emp.first_name?.[0], emp.last_name?.[0]].filter(Boolean).join("").toUpperCase();
                const empItems = basket.filter(b => b.recipientEmployeeId === emp.id);
                return (
                  <button
                    key={emp.id}
                    onClick={() => handleSelectRecipient(String(emp.id))}
                    className="rounded-xl border bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group relative"
                  >
                    {empItems.length > 0 && (
                      <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                        {empItems.length}
                      </span>
                    )}
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm mb-3 group-hover:bg-primary/15 transition-colors">
                      {initials || <User className="w-4 h-4" />}
                    </div>
                    <p className="font-semibold text-sm leading-tight">{emp.first_name} {emp.last_name}</p>
                    {emp.role_name && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.role_name}</p>}
                    {(() => {
                      const spend = parseFloat(emp.spend_12m ?? "0");
                      const effectiveAllowance = emp.effective_allowance != null ? parseFloat(emp.effective_allowance) : null;
                      const topup = parseFloat(emp.allowance_topup ?? "0");
                      const totalBudget = effectiveAllowance != null ? effectiveAllowance + topup : null;
                      if (totalBudget != null && totalBudget > 0) {
                        const pct = Math.min(100, (spend / totalBudget) * 100);
                        const over = spend > totalBudget;
                        return (
                          <div className="mt-1.5 w-full">
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className={over ? "text-destructive font-medium" : "text-muted-foreground"}>
                                £{spend.toFixed(0)} of £{totalBudget.toFixed(0)}
                              </span>
                              {over
                                ? <span className="text-destructive font-medium">Over budget</span>
                                : <span className="text-muted-foreground">£{(totalBudget - spend).toFixed(0)} left</span>
                              }
                            </div>
                            <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${over ? "bg-destructive" : pct > 80 ? "bg-amber-500" : "bg-primary"}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      }
                      if (spend > 0) {
                        return (
                          <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-0.5">
                            <TrendingUp className="w-2.5 h-2.5 shrink-0" />
                            £{spend.toFixed(0)} this year
                          </p>
                        );
                      }
                      return null;
                    })()}
                  </button>
                );
              })}
              {myTeamEmployees.length === 0 && !isDeptManager && (
                <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                  No employees found
                </div>
              )}
            </div>

            {/* Other Teams section — dept_manager only, no search active */}
            {isDeptManager && (
              <div className="mb-8">
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-2 hover:text-foreground transition-colors"
                  onClick={() => setShowOtherTeams(v => !v)}
                >
                  <span className={cn("inline-block transition-transform", showOtherTeams ? "rotate-90" : "rotate-0")}>▶</span>
                  Other teams ({otherEmployees.length})
                </button>
                {showOtherTeams && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {otherEmployees.map((emp: any) => {
                      const initials = [emp.first_name?.[0], emp.last_name?.[0]].filter(Boolean).join("").toUpperCase();
                      const empItems = basket.filter(b => b.recipientEmployeeId === emp.id);
                      return (
                        <button
                          key={emp.id}
                          onClick={() => handleSelectRecipient(String(emp.id))}
                          className="rounded-xl border border-dashed bg-card hover:border-primary hover:shadow-md transition-all p-4 text-left group relative"
                        >
                          {empItems.length > 0 && (
                            <span className="absolute top-2 right-2 bg-primary text-primary-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
                              {empItems.length}
                            </span>
                          )}
                          <div className="w-10 h-10 rounded-full bg-muted/60 flex items-center justify-center text-muted-foreground font-bold text-sm mb-3 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                            {initials || <User className="w-4 h-4" />}
                          </div>
                          <p className="font-semibold text-sm leading-tight">{emp.first_name} {emp.last_name}</p>
                          {emp.manager_name && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{emp.manager_name}'s team</p>}
                        </button>
                      );
                    })}
                  </div>
                )}
                {myTeamEmployees.length === 0 && otherEmployees.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground text-sm">No employees found</div>
                )}
              </div>
            )}
          </>
        )}

        {/* Transfer dialog */}
        <Dialog open={!!transferDialogEmp} onOpenChange={(o) => { if (!o) setTransferDialogEmp(null); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Order for another team's operative</DialogTitle>
            </DialogHeader>
            {transferDialogEmp && (
              <div className="space-y-4 py-1">
                <p className="text-sm text-muted-foreground">
                  <strong>{transferDialogEmp.first_name} {transferDialogEmp.last_name}</strong> is currently in{" "}
                  {transferDialogEmp.manager_name ? <strong>{transferDialogEmp.manager_name}'s team</strong> : "another team"}.
                  Would you like to transfer them to your team, or just order for them without changing their team?
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={() => transferMut.mutate(transferDialogEmp.id)}
                    disabled={transferMut.isPending}
                    className="w-full"
                  >
                    {transferMut.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Transfer to my team &amp; order
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setTransferDialogEmp(null);
                      doSelectRecipient(String(transferDialogEmp.id));
                    }}
                  >
                    Order without transferring
                  </Button>
                  <Button variant="ghost" className="w-full" onClick={() => setTransferDialogEmp(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {!isDeptManager && <div className="mb-8" />}

        {/* Add employee dialog */}
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add employee</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>First name *</Label>
                  <Input value={newFirst} onChange={e => setNewFirst(e.target.value)} placeholder="Jane" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Last name *</Label>
                  <Input value={newLast} onChange={e => setNewLast(e.target.value)} placeholder="Smith" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Job title</Label>
                <Input value={newJobTitle} onChange={e => setNewJobTitle(e.target.value)} placeholder="e.g. Operative" />
              </div>
              <div className="grid gap-1.5">
                <Label>Department</Label>
                <Input value={newDept} onChange={e => setNewDept(e.target.value)} placeholder="e.g. Warehouse" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                onClick={() => addEmpMut.mutate()}
                disabled={!newFirst.trim() || !newLast.trim() || addEmpMut.isPending}
              >
                {addEmpMut.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Adding…</> : "Add employee"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Mobile: inline summary */}
        <div className="lg:hidden mt-4">
          <SummarySidebar />
        </div>
        </div>{/* end flex-1 left column */}

        {/* Desktop: sticky order summary sidebar */}
        <div className="hidden lg:block w-72 shrink-0 sticky top-4 self-start">
          <SummarySidebar />
        </div>
        </div>{/* end flex gap-6 */}
      </div>
    );
  }

  // ── Product tile grid (recipient selected) ─────────────────────────────────
  const recipientName = selectedEmployee
    ? `${selectedEmployee.first_name} ${selectedEmployee.last_name}`
    : "Bulk Stock";
  const recipientInitials = selectedEmployee
    ? [selectedEmployee.first_name?.[0], selectedEmployee.last_name?.[0]].filter(Boolean).join("").toUpperCase()
    : "";

  const handleAdd = (wi: any, key: string, forcedSize?: string) => {
    const state = getItemState(key);
    const size = forcedSize ?? state.size;
    if (!size) return;
    const isStock = selectedRecipient === "stock";
    const emp = isStock ? undefined : employees.find((e: any) => String(e.id) === selectedRecipient);
    const addedQty = state.qty;
    const productName = wi.product_name ?? wi.name ?? "item";

    // Price-break suggestion (compute before updating basket)
    const breaks: { qty: number; price: number }[] = Array.isArray(wi.price_breaks) ? wi.price_breaks : [];
    if (breaks.length > 0) {
      const existingQty = basket
        .filter((x: OrderItem) => x.productId === (wi.product_id ?? null))
        .reduce((s: number, x: OrderItem) => s + x.quantity, 0);
      const totalQty = existingQty + addedQty;
      const basePrice = parseFloat(wi.unit_price ?? "0") || 0;
      const suggestion = getPriceBreakSuggestion(productName, totalQty, existingQty, breaks, basePrice);
      if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 400);
    }

    setBasket(b => [...b, makeItem(wi, isStock ? "stock" : "person", size, addedQty, emp)]);
    setItemState(key, { size: "", qty: 1 });
  };

  const handleBulkAdd = (wi: any, key: string, sizeOptions: string[]) => {
    const qtys = bulkQtys[key] ?? {};
    const isStock = selectedRecipient === "stock";
    const emp = isStock ? undefined : employees.find((e: any) => String(e.id) === selectedRecipient);
    const newItems: OrderItem[] = sizeOptions
      .filter(s => (qtys[s] ?? 0) > 0)
      .map(s => makeItem(wi, isStock ? "stock" : "person", s, qtys[s], emp));
    if (newItems.length === 0) return;

    // Price-break suggestion (compute before updating basket)
    const breaks: { qty: number; price: number }[] = Array.isArray(wi.price_breaks) ? wi.price_breaks : [];
    if (breaks.length > 0) {
      const addedQty = newItems.reduce((s, x) => s + x.quantity, 0);
      const existingQty = basket
        .filter((x: OrderItem) => x.productId === (wi.product_id ?? null))
        .reduce((s: number, x: OrderItem) => s + x.quantity, 0);
      const totalQty = existingQty + addedQty;
      const basePrice = parseFloat(wi.unit_price ?? "0") || 0;
      const productName = wi.product_name ?? wi.name ?? "item";
      const suggestion = getPriceBreakSuggestion(productName, totalQty, existingQty, breaks, basePrice);
      if (suggestion) setTimeout(() => toast({ title: suggestion.title, description: suggestion.description }), 400);
    }

    setBasket(b => [...b, ...newItems]);
    setBulkQtys(q => ({ ...q, [key]: {} }));
    toast({ title: `${newItems.length} size${newItems.length !== 1 ? "s" : ""} added to basket` });
  };

  const handleAddAll = () => {
    const newItems: OrderItem[] = [];
    const keysToReset: string[] = [];
    const isStock = selectedRecipient === "stock";
    const emp = isStock ? undefined : employees.find((e: any) => String(e.id) === selectedRecipient);
    finishGroups.forEach((group) => {
      group.items.forEach((wi: any, i: number) => {
        const key = `${group.finish_id}-${i}`;
        const state = getItemState(key);
        if (!state.size.trim()) return;
        newItems.push(makeItem(wi, isStock ? "stock" : "person", state.size, state.qty, emp));
        keysToReset.push(key);
      });
    });
    if (newItems.length === 0) return;
    setBasket(b => [...b, ...newItems]);
    setItemStates(s => {
      const next = { ...s };
      keysToReset.forEach(key => { next[key] = { size: "", qty: 1 }; });
      return next;
    });
    setSelectedRecipient(null);
  };

  const configuredCount = finishGroups.reduce((count, group) =>
    count + group.items.filter((_: any, i: number) => !!getItemState(`${group.finish_id}-${i}`).size.trim()).length,
  0);

  return (
    <div>
      {/* Recipient banner */}
      <button
        onClick={() => setSelectedRecipient(null)}
        className="w-full flex items-center gap-3 mb-6 p-3 rounded-xl border bg-muted/30 hover:bg-muted/50 hover:border-muted-foreground/30 transition-colors text-left"
      >
        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-bold text-primary text-sm">
          {selectedRecipient === "stock"
            ? <Package className="w-4 h-4" />
            : (recipientInitials || <User className="w-4 h-4" />)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium">Ordering for</p>
          <p className="font-semibold text-sm">{recipientName}</p>
          {selectedEmployee?.role_name && <p className="text-[11px] text-muted-foreground">{selectedEmployee.role_name}</p>}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">Change</span>
      </button>

      {/* Main layout: product sections + sticky sidebar */}
      <div className="flex gap-6 items-start">

        {/* Left: single flat grid — all products flow together */}
        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 gap-3">
            {finishGroups.flatMap((group) => {
              const procs = groupProcesses(group.finish_id);
              const hasFinish = procs.length > 0 || !!group.finish_name;

              return group.items.map((wi: any, i: number) => {
                const key = `${group.finish_id}-${i}`;
                const state = getItemState(key);
                const availSizes = getAvailableSizes(wi);
                const oneSize = availSizes.length === 0;
                const sizeOptions = availSizes;
                const suggestion = selectedEmployee ? getSuggestedSize(wi, selectedEmployee.id) : null;
                const { garmentPrice, unitPrice } = resolveItemPricing(wi, state.qty);
                const logoSurcharge = unitPrice - garmentPrice;

                return (
                  <Card key={key} className="overflow-hidden flex flex-col">
                    {/* Product image */}
                    <div className="aspect-square bg-white flex items-center justify-center p-3 border-b">
                      {(wi.variant_image_url ?? wi.product_image_url) ? (
                        <img
                          src={wi.variant_image_url ?? wi.product_image_url}
                          alt={wi.product_name ?? wi.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Shirt className="w-10 h-10 text-muted-foreground/20" />
                      )}
                    </div>

                    {/* Info + controls */}
                    <div className="p-3 flex flex-col gap-2 flex-1">
                      {/* Name + colour + price */}
                      <div>
                        <p className="font-semibold text-sm leading-snug line-clamp-2">{wi.product_name ?? wi.name}</p>
                        {(wi.colour || wi.product_sku) && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {[wi.colour, wi.product_sku].filter(Boolean).join(" · ")}
                          </p>
                        )}
                        {unitPrice > 0 && (
                          <div className="mt-1">
                            <div className="flex items-baseline gap-1.5">
                              <span className="text-sm font-bold text-primary">{formatCurrency(unitPrice)}</span>
                            </div>
                            {logoSurcharge > 0 && (
                              <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
                                {formatCurrency(garmentPrice)} garment · <span className="font-medium text-foreground/70">+{formatCurrency(logoSurcharge)} extra logo</span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Finish name + process list */}
                      {hasFinish && (
                        <div className="space-y-1.5">
                          {group.finish_name && (
                            <p className="text-xs font-bold text-foreground leading-snug">{group.finish_name}</p>
                          )}
                          {(() => {
                            const isExpanded = expandedProcs.has(key);
                            const visible = isExpanded ? procs : procs.slice(0, 2);
                            const hidden = procs.length - 2;
                            return (
                              <div className="flex flex-col gap-1">
                                {visible.map((p: any) => (
                                  <div key={p.process_id} className="flex items-center gap-1 rounded border bg-muted/50 px-1.5 py-0.5">
                                    {p.process_type && <ProcessBadgeInline type={p.process_type} />}
                                    {p.item_finish_name && <span className="text-[10px] text-foreground/70 font-medium">{p.item_finish_name}</span>}
                                    {p.placement && <span className="text-[10px] text-muted-foreground">· {p.placement}</span>}
                                  </div>
                                ))}
                                {procs.length > 2 && (
                                  <button
                                    onClick={() => toggleProcs(key)}
                                    className="text-[10px] text-primary hover:underline text-left mt-0.5"
                                  >
                                    {isExpanded ? "Show less" : `+${hidden} more process${hidden !== 1 ? "es" : ""}…`}
                                  </button>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Bulk / single toggle — only for multi-size products */}
                      {!oneSize && sizeOptions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setBulkModes(m => ({ ...m, [key]: !m[key] }))}
                          className={cn(
                            "w-full py-1.5 rounded-md text-xs font-semibold transition-colors border",
                            bulkModes[key]
                              ? "bg-muted text-muted-foreground border-border hover:bg-muted/80"
                              : "bg-[hsl(218,45%,19%)] text-white border-[hsl(218,45%,19%)] hover:bg-[hsl(218,45%,24%)]"
                          )}
                        >
                          {bulkModes[key] ? "← Single item" : "Bulk Order"}
                        </button>
                      )}

                      {oneSize ? (
                        /* ── No WooCommerce sizes — one size fits all ── */
                        <div className="flex items-center gap-1.5 mt-auto">
                          <div className="flex items-center border rounded-md h-8 overflow-hidden shrink-0">
                            <button className="px-2 h-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={() => setItemState(key, { qty: Math.max(1, state.qty - 1) })}><Minus className="w-3.5 h-3.5" /></button>
                            <input type="number" min={1} value={state.qty} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setItemState(key, { qty: v }); }} className="w-7 text-center text-sm font-semibold bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                            <button className="px-2 h-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={() => setItemState(key, { qty: state.qty + 1 })}><Plus className="w-3.5 h-3.5" /></button>
                          </div>
                          <Button size="sm" className="flex-1 h-8 text-sm" onClick={() => handleAdd(wi, key, "One Size")}>Add</Button>
                        </div>
                      ) : bulkModes[key] ? (
                        /* ── Bulk entry grid ── */
                        (() => {
                          const qtys = bulkQtys[key] ?? {};
                          const total = sizeOptions.reduce((s, sz) => s + (qtys[sz] ?? 0), 0);
                          return (
                            <div className="space-y-2">
                              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(sizeOptions.length, 4)}, 1fr)` }}>
                                {sizeOptions.map((sz, si) => (
                                  <div key={sz} className="flex flex-col items-center gap-0.5">
                                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{sz}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      value={qtys[sz] || ""}
                                      placeholder="0"
                                      autoFocus={si === 0}
                                      onChange={e => {
                                        const v = parseInt(e.target.value, 10);
                                        setBulkQtys(q => ({ ...q, [key]: { ...(q[key] ?? {}), [sz]: isNaN(v) || v < 0 ? 0 : v } }));
                                      }}
                                      className="w-full h-8 text-center text-sm font-semibold rounded-md border border-input bg-transparent outline-none focus:ring-1 focus:ring-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                    />
                                  </div>
                                ))}
                              </div>
                              <Button size="sm" className="w-full h-8 text-sm" disabled={total === 0} onClick={() => handleBulkAdd(wi, key, sizeOptions)}>
                                Add {total > 0 ? `${total} ` : ""}to basket
                              </Button>
                            </div>
                          );
                        })()
                      ) : (
                        /* ── Single entry ── */
                        <>
                          {suggestion && !state.size && (
                            <p className={`text-[11px] ${suggestion.source === "saved" ? "text-blue-500" : "text-emerald-600"}`}>
                              {suggestion.source === "saved" ? "Saved" : "Last"}: <strong>{suggestion.size}</strong>
                            </p>
                          )}
                          <Select value={state.size} onValueChange={v => setItemState(key, { size: v })}>
                            <SelectTrigger className="h-8 text-sm w-full">
                              <SelectValue placeholder="Select size" />
                            </SelectTrigger>
                            <SelectContent>
                              {sizeOptions.map(s => (
                                <SelectItem key={s} value={s}>
                                  <span className="flex items-center gap-2">
                                    {s}
                                    {suggestion?.size === s && suggestion.source === "history" && <span className="text-[10px] text-emerald-600 font-semibold">last</span>}
                                    {suggestion?.size === s && suggestion.source === "saved" && <span className="text-[10px] text-blue-500 font-semibold">saved</span>}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <div className="flex items-center gap-1.5 mt-auto">
                            <div className="flex items-center border rounded-md h-8 overflow-hidden shrink-0">
                              <button className="px-2 h-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={() => setItemState(key, { qty: Math.max(1, state.qty - 1) })}><Minus className="w-3.5 h-3.5" /></button>
                              <input type="number" min={1} value={state.qty} onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v) && v >= 1) setItemState(key, { qty: v }); }} className="w-7 text-center text-sm font-semibold bg-transparent border-none outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                              <button className="px-2 h-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors" onClick={() => setItemState(key, { qty: state.qty + 1 })}><Plus className="w-3.5 h-3.5" /></button>
                            </div>
                            <Button size="sm" className="flex-1 h-8 text-sm" disabled={!state.size.trim()} onClick={() => handleAdd(wi, key)}>Add</Button>
                          </div>
                        </>
                      )}
                    </div>
                  </Card>
                );
              });
            })}
          </div>

          {/* Bulk add bar — appears when any card has a size selected */}
          {configuredCount > 0 && (
            <div className="sticky bottom-4 mt-4 z-20">
              <div className="rounded-xl border border-primary/30 bg-primary text-primary-foreground shadow-xl px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{configuredCount} item{configuredCount !== 1 ? "s" : ""} ready</p>
                  <p className="text-xs text-primary-foreground/70">Add them all to your basket at once</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="shrink-0 font-semibold"
                  onClick={handleAddAll}
                >
                  Add all to basket
                </Button>
              </div>
            </div>
          )}

          {/* "Order for someone else" link */}
          <button
            onClick={() => setSelectedRecipient(null)}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-2 hover:underline flex items-center gap-1.5 mt-4"
          >
            <User className="w-3.5 h-3.5" />
            Order for another person
          </button>

          {/* Mobile: inline summary */}
          <div className="lg:hidden mt-4">
            <SummarySidebar />
          </div>
        </div>

        {/* Right: sticky order summary (desktop only) */}
        <div className="hidden lg:block w-72 shrink-0 sticky top-4 self-start">
          <SummarySidebar />
        </div>

      </div>{/* end flex gap-6 */}

      {/* Process explainer */}
      <div className="mt-10 border-t border-border pt-8">
        <h3 className="text-sm font-semibold text-foreground mb-4">Understanding your decoration processes</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border bg-cyan-100 text-cyan-700 border-cyan-200">DTF</span>
              <span className="text-xs font-semibold text-foreground">Direct to Film</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Your logo is printed onto a special transfer film using high-resolution digital printing, then heat-bonded directly onto the garment. DTF produces vivid, full-colour results and handles complex designs or gradients with ease.</p>
          </div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border bg-blue-100 text-blue-700 border-blue-200">Print</span>
              <span className="text-xs font-semibold text-foreground">Screen / Digital Print</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Ink is applied directly onto the fabric surface using screen or digital printing techniques. Print is ideal for bold, flat designs and large coverage areas, delivering crisp, vibrant colours on t-shirts and other garments.</p>
          </div>
          <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border bg-purple-100 text-purple-700 border-purple-200">Embroidery</span>
              <span className="text-xs font-semibold text-foreground">Thread Stitching</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">Your logo is stitched directly into the fabric using coloured thread, creating a classic, premium finish. Embroidery is highly durable, wash-resistant, and gives workwear a professional, long-lasting look.</p>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Step 2b: Inspiration wishlist ───────────────────────────────────────────

type EnquiryItem = {
  productId: number | null;
  productName: string;
  imageUrl: string;
  colour: string;
  desiredProcesses: string[];
  notes: string;
};

const PROCESS_OPTIONS = [
  { id: "embroidery",    label: "Embroidery",          cls: "bg-purple-50 border-purple-200 text-purple-700 data-[active=true]:bg-purple-100 data-[active=true]:border-purple-400" },
  { id: "print",         label: "Print / DTF",          cls: "bg-blue-50 border-blue-200 text-blue-700 data-[active=true]:bg-blue-100 data-[active=true]:border-blue-400" },
  { id: "heat_transfer", label: "Heat Transfer",        cls: "bg-orange-50 border-orange-200 text-orange-700 data-[active=true]:bg-orange-100 data-[active=true]:border-orange-400" },
  { id: "badge",         label: "Badge / Woven Label",  cls: "bg-amber-50 border-amber-200 text-amber-700 data-[active=true]:bg-amber-100 data-[active=true]:border-amber-400" },
  { id: "unsure",        label: "Not sure yet",         cls: "bg-muted border-border text-muted-foreground data-[active=true]:bg-muted/80 data-[active=true]:border-foreground/30" },
];

function InspirationStep({ wishlist, setWishlist, onSubmit, submitting }: {
  wishlist: EnquiryItem[];
  setWishlist: React.Dispatch<React.SetStateAction<EnquiryItem[]>>;
  onSubmit: (data: { items: EnquiryItem[]; notes: string }) => void;
  submitting: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ colour: "", processes: [] as string[], notes: "" });
  const [overallNotes, setOverallNotes] = useState("");

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-products"],
    queryFn: () => apiFetch("/portal/products"),
  });


  const categoryGroups: { category: string; items: any[] }[] = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const p of products) {
      const cat = p.category || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, items]) => ({ category, items }));
  }, [products]);

  const toggleProcess = (id: string) =>
    setDraft(d => ({
      ...d,
      processes: d.processes.includes(id) ? d.processes.filter(p => p !== id) : [...d.processes, id],
    }));

  const openConfig = (productId: number) => {
    setExpandedId(productId);
    setDraft({ colour: "", processes: [], notes: "" });
  };

  const addToWishlist = (p: any) => {
    setWishlist(w => [...w, {
      productId: p.id,
      productName: p.name,
      imageUrl: p.image_url ?? "",
      colour: draft.colour,
      desiredProcesses: draft.processes,
      notes: draft.notes,
    }]);
    setExpandedId(null);
    setDraft({ colour: "", processes: [], notes: "" });
  };

  const removeFromWishlist = (idx: number) =>
    setWishlist(w => w.filter((_, i) => i !== idx));

  const alreadyAdded = (productId: number) =>
    wishlist.some(w => w.productId === productId);

  // Derive the active product list based on category + search
  const activeProducts = selectedCategory
    ? products.filter((p: any) => (p.category || "Other") === selectedCategory)
    : products;
  const displayProducts = search.trim()
    ? activeProducts.filter((p: any) =>
        p.name?.toLowerCase().includes(search.toLowerCase()) ||
        p.sku?.toLowerCase().includes(search.toLowerCase()) ||
        p.category?.toLowerCase().includes(search.toLowerCase())
      )
    : activeProducts;

  const renderCard = (p: any) => {
    const added = alreadyAdded(p.id);
    const isOpen = expandedId === p.id;
    return (
      <div key={p.id} className="flex flex-col">
        <Card className={cn("transition-colors", isOpen ? "border-primary/50" : "hover:border-primary/30", added && "opacity-60")}>
          <CardContent className="py-3 px-4 flex items-center gap-3">
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} className="w-12 h-12 rounded object-cover shrink-0 bg-muted" />
            ) : (
              <div className="w-12 h-12 rounded bg-muted shrink-0 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-muted-foreground/50" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.sku}</p>
            </div>
            {added ? (
              <span className="text-xs text-emerald-600 font-medium flex items-center gap-1 shrink-0">
                <Heart className="w-3 h-3 fill-current" /> Added
              </span>
            ) : (
              <Button
                size="sm" variant="outline"
                className="shrink-0 gap-1 h-7 text-xs"
                onClick={() => isOpen ? setExpandedId(null) : openConfig(p.id)}
              >
                <Heart className="w-3 h-3" /> Wishlist
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Inline config panel */}
        {isOpen && (
          <Card className="border-primary/40 border-t-0 rounded-t-none -mt-px">
            <CardContent className="px-4 py-3 flex flex-col gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-medium">Preferred colour(s)</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="e.g. Navy, Black, White"
                  value={draft.colour}
                  onChange={e => setDraft(d => ({ ...d, colour: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Decoration style</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PROCESS_OPTIONS.map(opt => (
                    <button
                      key={opt.id}
                      data-active={draft.processes.includes(opt.id)}
                      onClick={() => toggleProcess(opt.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                        opt.cls
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs font-medium">Notes (optional)</Label>
                <Input
                  className="h-8 text-sm"
                  placeholder="Any specific requirements…"
                  value={draft.notes}
                  onChange={e => setDraft(d => ({ ...d, notes: e.target.value }))}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedId(null)}>Cancel</Button>
                <Button size="sm" className="h-7 text-xs gap-1" onClick={() => addToWishlist(p)}>
                  <Heart className="w-3 h-3" /> Add to wishlist
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-1">Looking for Inspiration</h2>
      <p className="text-muted-foreground text-sm mb-4">
        Browse our range and add anything that catches your eye to your wishlist.
        Tell us your preferred colours and decoration style — we'll come back with a tailored wardrobe quote.
      </p>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products by name or SKU…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Category chips */}
      {!isLoading && categoryGroups.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-none -mx-1 px-1">
          <button
            onClick={() => { setSelectedCategory(null); setSearch(""); }}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all whitespace-nowrap",
              !selectedCategory
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
            )}
          >
            All ({products.length})
          </button>
          {categoryGroups.map(({ category, items }) => (
            <button
              key={category}
              onClick={() => { setSelectedCategory(category); setSearch(""); }}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all whitespace-nowrap",
                selectedCategory === category
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              {category} ({items.length})
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (() => {
        // Searching or a category is selected → flat list
        if (search.trim() || selectedCategory) {
          return (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {displayProducts.length} product{displayProducts.length !== 1 ? "s" : ""}
                {selectedCategory ? ` in ${selectedCategory}` : ""}
                {search.trim() ? ` matching "${search}"` : ""}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                {displayProducts.map(renderCard)}
              </div>
            </>
          );
        }

        // No filter — show all categories grouped
        return (
          <>
            {categoryGroups.map(({ category, items }) => (
              <div key={category} className="mb-7">
                <div className="flex items-center gap-2 mb-2.5">
                  <h3 className="text-sm font-semibold">{category}</h3>
                  <span className="text-xs text-muted-foreground">({items.length})</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {items.map(renderCard)}
                </div>
              </div>
            ))}
          </>
        );
      })()}

      {/* Wishlist summary */}
      {wishlist.length > 0 && (
        <div className="border rounded-xl p-4 bg-muted/20 flex flex-col gap-4">
          <div>
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-primary fill-primary/20" />
              Your wishlist ({wishlist.length})
            </h3>
            <div className="flex flex-col gap-2">
              {wishlist.map((item, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-background border px-3 py-2">
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.productName} className="w-8 h-8 rounded object-cover shrink-0 bg-muted" />
                  ) : (
                    <div className="w-8 h-8 rounded bg-muted shrink-0 flex items-center justify-center">
                      <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.productName}</p>
                    <p className="text-xs text-muted-foreground">
                      {[item.colour, item.desiredProcesses.join(", ")].filter(Boolean).join(" · ") || "No preferences set"}
                    </p>
                  </div>
                  <button
                    onClick={() => removeFromWishlist(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Anything else we should know?</Label>
            <Textarea
              placeholder="Overall budget, timeline, any other requirements…"
              value={overallNotes}
              onChange={e => setOverallNotes(e.target.value)}
              rows={2}
              className="text-sm resize-none"
            />
          </div>
          <Button
            className="w-full sm:w-auto self-end gap-1.5"
            disabled={submitting}
            onClick={() => onSubmit({ items: wishlist, notes: overallNotes })}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            Send enquiry to SBS
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Enquiry confirmation ─────────────────────────────────────────────────────

function EnquiryConfirmStep({ enquiryRef }: { enquiryRef: string }) {
  return (
    <div className="text-center py-10">
      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
        <Sparkles className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-2xl font-bold mb-2">Wishlist sent!</h2>
      <p className="text-muted-foreground mb-1">
        Your enquiry <span className="font-semibold text-foreground">{enquiryRef}</span> has been submitted.
      </p>
      <p className="text-sm text-muted-foreground mb-8 max-w-sm mx-auto">
        Our team at Select Branding Solutions will review your wishlist and come back to you with a tailored wardrobe quote.
      </p>
      <Button variant="outline" onClick={() => window.location.href = "/customer-portal/orders"}>
        Back to my orders
      </Button>
    </div>
  );
}

// ─── Step 3: Review & Submit ─────────────────────────────────────────────────

const SHIPPING_OPTIONS = [
  {
    id: "free_local",
    label: "Free Local Delivery",
    sublabel: "LS & BD postcodes · delivered Tuesdays & Fridays",
    cost: 0,
  },
  {
    id: "dpd_next_day",
    label: "Next Day DPD",
    sublabel: "Tracked courier — delivered next working day",
    cost: 8.50,
  },
  {
    id: "warehouse_collection",
    label: "Warehouse Collection",
    sublabel: "Collect from our warehouse, LS13",
    cost: 0,
  },
  {
    id: "office_collection",
    label: "Office Collection",
    sublabel: "Collect from our office, BD10",
    cost: 0,
  },
] as const;

function ReviewStep({ basket, setBasket, onSubmit, submitting, portalRole, onAddMore }: {
  basket: OrderItem[];
  setBasket: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onSubmit: (data: { requiredDate: string; notes: string; shippingOption: string; shippingCost: number; poNumber: string; paymentMethodId?: string | null; attachments: Array<{ name: string; objectPath: string }>; claimSelectExtra?: boolean }) => void;
  submitting: boolean;
  portalRole: string;
  onAddMore?: () => void;
}) {
  const { toast } = useToast();
  const [requiredDate, setRequiredDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [notes, setNotes] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [shippingId, setShippingId] = useState<string>("");
  const [paymentChoice, setPaymentChoice] = useState<"card" | "invoice">("invoice");
  const [selectedPmId, setSelectedPmId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Array<{ name: string; objectPath: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [wantsSelectExtra, setWantsSelectExtra] = useState(true);

  const { data: selectExtraData } = useQuery<{
    offer: { id: number; productName: string; description: string | null; productUrl: string | null; quantity: number; minSpend: number; title: string } | null;
    claimed: boolean;
  }>({
    queryKey: ["portal-select-extra"],
    queryFn: () => apiFetch("/portal/select-extra/current"),
    staleTime: 60_000,
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const meta = await apiFetch<{ uploadURL: string; objectPath: string }>("/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream" }),
        });
        await fetch(meta.uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        setAttachments(prev => [...prev, { name: file.name, objectPath: meta.objectPath }]);
      }
    } catch {
      toast({ title: "Upload failed", description: "Could not upload file. Please try again.", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const { data: pmData, isLoading: pmLoading } = useQuery<{ paymentMethods: any[] }>({
    queryKey: ["portal-payment-methods"],
    queryFn: () => apiFetch("/portal/stripe/payment-methods"),
    enabled: portalRole === "manager",
    staleTime: 30_000,
  });

  useEffect(() => {
    if (pmData?.paymentMethods?.length) {
      setPaymentChoice("card");
      setSelectedPmId(pmData.paymentMethods[0].id);
    }
  }, [pmData]);

  const selectedShipping = SHIPPING_OPTIONS.find(o => o.id === shippingId) ?? null;
  const shippingCost = selectedShipping?.cost ?? 0;

  const itemsTotal = basket.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const totalQty = basket.reduce((s, i) => s + i.quantity, 0);
  const orderTotal = itemsTotal + shippingCost;

  const selectExtraOffer = selectExtraData?.offer ?? null;
  const alreadyClaimed = selectExtraData?.claimed ?? false;
  const qualifiesForExtra = selectExtraOffer !== null && !alreadyClaimed && itemsTotal >= selectExtraOffer.minSpend;

  const updateQty = (idx: number, delta: number) => {
    setBasket(b => b.map((item, i) => i === idx ? { ...item, quantity: Math.max(1, item.quantity + delta) } : item));
  };
  const setQty = (idx: number, val: number) => {
    if (!isNaN(val) && val >= 1) setBasket(b => b.map((item, i) => i === idx ? { ...item, quantity: val } : item));
  };
  const removeItem = (idx: number) => setBasket(b => b.filter((_, i) => i !== idx));

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
        <h2 className="text-xl font-semibold">Review your order</h2>
        {onAddMore && (
          <Button variant="outline" size="sm" onClick={onAddMore}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add more items
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm mb-6">Check everything looks right before submitting.</p>

      <Card className="mb-5">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>For</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {basket.map((item, idx) => (
                  <React.Fragment key={idx}>
                    <TableRow>
                      <TableCell className="font-medium text-sm align-top">
                        <div>{item.productName}</div>
                        {item.sku && (
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.sku}</div>
                        )}
                        {item.finishName && (
                          <div className="text-[11px] text-primary/70 font-semibold mt-1">{item.finishName}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground align-top">
                        {[item.colour, item.size].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground align-top">
                        {item.recipientName || (item.recipientType === "stock" ? "Stock" : "—")}
                      </TableCell>
                      <TableCell className="text-right align-top">
                        <div className="flex items-center justify-end gap-0.5">
                          <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => updateQty(idx, -1)}><Minus className="w-3 h-3" /></button>
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={e => setQty(idx, parseInt(e.target.value, 10))}
                            className="w-10 text-center text-sm font-medium border rounded outline-none focus:ring-1 focus:ring-primary/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none py-0.5"
                          />
                          <button className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted" onClick={() => updateQty(idx, 1)}><Plus className="w-3 h-3" /></button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm align-top">
                        <div>{formatCurrency(item.unitPrice)}</div>
                        {item.garmentBasePrice > 0 && item.processLines?.some(p => !p.included) && (
                          <div className="text-[10px] text-muted-foreground mt-0.5">garment {formatCurrency(item.garmentBasePrice)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium align-top">{formatCurrency(item.quantity * item.unitPrice)}</TableCell>
                      <TableCell className="align-top">
                        <button onClick={() => removeItem(idx)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </TableCell>
                    </TableRow>
                    {(item.processLines?.length ?? 0) > 0 && (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={7} className="py-1.5 pb-2.5 pt-0">
                          <div className="flex flex-wrap gap-1.5 pl-1">
                            {item.processLines.map((pl, pi) => (
                              <span key={pi} className="inline-flex items-center gap-1 text-[10px] rounded border bg-background px-1.5 py-0.5">
                                {pl.type && <ProcessBadgeInline type={pl.type} />}
                                <span className="text-foreground/70">{pl.name}</span>
                                {pl.included
                                  ? <span className="text-emerald-600 font-medium">incl.</span>
                                  : <span className="text-foreground font-semibold">+{formatCurrency(pl.price)}</span>
                                }
                              </span>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="border-t px-5 py-3 space-y-1.5">
            <div className="flex justify-end gap-6">
              <span className="text-muted-foreground text-sm">Total quantity</span>
              <span className="text-sm font-medium w-20 text-right">{totalQty} item{totalQty !== 1 ? "s" : ""}</span>
            </div>
            <div className="flex justify-end gap-6">
              <span className="text-muted-foreground text-sm">Items subtotal</span>
              <span className="text-sm font-medium w-20 text-right">{formatCurrency(itemsTotal)}</span>
            </div>
            {shippingCost > 0 && (
              <div className="flex justify-end gap-6">
                <span className="text-muted-foreground text-sm">{selectedShipping?.label}</span>
                <span className="text-sm font-medium w-20 text-right">{formatCurrency(shippingCost)}</span>
              </div>
            )}
            <div className="flex justify-end gap-6 pt-1 border-t">
              <span className="text-muted-foreground text-sm font-semibold">Order total</span>
              <span className="font-bold w-20 text-right">{formatCurrency(orderTotal)}</span>
            </div>
            <p className="text-right text-[11px] text-muted-foreground">All prices exclude VAT</p>
          </div>
        </CardContent>
      </Card>

      {/* Shipping / Collection options */}
      <div className="mb-5">
        <Label className="text-sm font-semibold mb-3 block">Delivery / Collection</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {SHIPPING_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setShippingId(opt.id)}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                shippingId === opt.id
                  ? "border-primary bg-primary/5 ring-1 ring-primary"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/30"
              }`}
            >
              <div className={`mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                shippingId === opt.id ? "border-primary" : "border-muted-foreground/40"
              }`}>
                {shippingId === opt.id && <div className="h-2 w-2 rounded-full bg-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium leading-tight">{opt.label}</span>
                  <span className="text-sm font-semibold shrink-0 text-primary">
                    {opt.cost === 0 ? "Free" : `${formatCurrency(opt.cost)} + VAT`}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{opt.sublabel}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="space-y-1.5">
          <Label htmlFor="reqdate">Required by</Label>
          <Input
            id="reqdate"
            type="date"
            value={requiredDate}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => setRequiredDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="po-number">Purchase order number <span className="text-muted-foreground font-normal">(optional — can be added later)</span></Label>
          <Input
            id="po-number"
            value={poNumber}
            onChange={e => setPoNumber(e.target.value)}
            placeholder="e.g. PO-2026-0042"
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">Notes for our team (optional)</Label>
          <Textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any special instructions, delivery notes, etc." rows={3} />
        </div>

        {/* ── Attachments ─────────────────────────────────────────────────── */}
        <div className="space-y-2 sm:col-span-2">
          <Label>Attachments <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
          {attachments.length > 0 && (
            <ul className="space-y-1.5">
              {attachments.map((att, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-sm flex-1 min-w-0 truncate">{att.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className={cn(
            "inline-flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors select-none",
            uploading && "opacity-60 pointer-events-none"
          )}>
            {uploading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Paperclip className="w-3.5 h-3.5" />}
            {uploading ? "Uploading…" : "Attach a file"}
            <input type="file" multiple className="hidden" disabled={uploading} onChange={handleFileUpload} />
          </label>
        </div>
      </div>

      {/* ── Payment choice (managers only) ──────────────────────────────── */}
      {portalRole === "manager" && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold mb-3">How would you like to pay?</h3>
          {pmLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Checking saved cards…
            </div>
          ) : (
            <div className="space-y-2">
              {/* Invoice option */}
              <label className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                paymentChoice === "invoice"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              )}>
                <input
                  type="radio"
                  name="payment"
                  value="invoice"
                  checked={paymentChoice === "invoice"}
                  onChange={() => { setPaymentChoice("invoice"); setSelectedPmId(null); }}
                  className="accent-primary"
                />
                <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="text-sm font-medium">Invoice me</div>
                  <div className="text-xs text-muted-foreground">We'll send you an invoice to pay later</div>
                </div>
              </label>

              {/* Saved card options */}
              {pmData?.paymentMethods?.map((pm: any) => (
                <label key={pm.id} className={cn(
                  "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                  paymentChoice === "card" && selectedPmId === pm.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                )}>
                  <input
                    type="radio"
                    name="payment"
                    value={pm.id}
                    checked={paymentChoice === "card" && selectedPmId === pm.id}
                    onChange={() => { setPaymentChoice("card"); setSelectedPmId(pm.id); }}
                    className="accent-primary"
                  />
                  <CreditCard className="w-4 h-4 text-muted-foreground shrink-0" />
                  <div>
                    <div className="text-sm font-medium capitalize">
                      {pm.card?.brand} •••• {pm.card?.last4}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Expires {pm.card?.exp_month?.toString().padStart(2, "0")}/{pm.card?.exp_year} — charged immediately on submission
                    </div>
                  </div>
                </label>
              ))}

              {/* Link to add a card */}
              {(!pmData?.paymentMethods?.length) && (
                <p className="text-xs text-muted-foreground pt-1">
                  No saved cards. <a href="/payment-methods" className="underline underline-offset-2 hover:text-foreground">Add a card</a> to pay instantly.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Select Extra offer card ──────────────────────────────────────── */}
      {selectExtraOffer && !alreadyClaimed && (
        <div className={`mt-6 rounded-xl border px-5 py-4 ${qualifiesForExtra ? "bg-gradient-to-r from-amber-50 via-orange-50 to-transparent border-amber-200" : "bg-muted/40 border-border"}`}>
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${qualifiesForExtra ? "bg-amber-100" : "bg-muted"}`}>
              <Gift className={`w-4 h-4 ${qualifiesForExtra ? "text-amber-600" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                <span className={`text-xs font-bold uppercase tracking-wide ${qualifiesForExtra ? "text-amber-600" : "text-muted-foreground"}`}>Select Extra</span>
                <span className="text-xs text-muted-foreground">— {selectExtraOffer.title}</span>
              </div>
              {qualifiesForExtra ? (
                <>
                  <p className="text-sm font-semibold text-amber-900">
                    You qualify for a free {selectExtraOffer.productName}!
                  </p>
                  <p className="text-xs text-amber-800 mt-0.5">{selectExtraOffer.description ?? `${selectExtraOffer.quantity}× included free with this order.`}</p>
                  <label className="flex items-center gap-2 mt-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={wantsSelectExtra}
                      onChange={e => setWantsSelectExtra(e.target.checked)}
                      className="w-4 h-4 accent-amber-600 rounded"
                    />
                    <span className="text-sm text-amber-900 font-medium">Add free gift to this order</span>
                  </label>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Add{" "}
                  <span className="font-medium">£{selectExtraOffer.minSpend.toFixed(0)}</span>
                  {" "}or more (excl. VAT) to this order to claim {selectExtraOffer.productName} free.
                  {itemsTotal > 0 && (
                    <span className="ml-1 text-xs">(Current: £{itemsTotal.toFixed(2)} — need £{Math.max(0, selectExtraOffer.minSpend - itemsTotal).toFixed(2)} more)</span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      {selectExtraOffer && alreadyClaimed && (
        <div className="mt-6 rounded-xl border border-green-200 bg-green-50 px-5 py-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
          <p className="text-sm text-green-800">You've already claimed your Select Extra gift this month.</p>
        </div>
      )}

      <div className="flex flex-col gap-1 mt-6">
        <Button
          onClick={() => onSubmit({
            requiredDate,
            notes,
            shippingOption: shippingId,
            shippingCost,
            poNumber,
            paymentMethodId: portalRole === "manager" && paymentChoice === "card" ? selectedPmId : null,
            attachments,
            claimSelectExtra: qualifiesForExtra && wantsSelectExtra,
          })}
          disabled={submitting || basket.length === 0 || !shippingId}
          className="w-full sm:w-auto"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          {portalRole === "manager" ? "Submit order to SBS" : "Save for manager review"}
        </Button>
        {!shippingId && (
          <p className="text-xs text-amber-600">Please select a delivery or collection option above.</p>
        )}
        {portalRole !== "manager" && shippingId && (
          <p className="text-xs text-muted-foreground">Your manager will review and submit this order to SBS.</p>
        )}
      </div>
    </div>
  );
}

// ─── Step 4: Confirmation ────────────────────────────────────────────────────

interface PickingNoteItem {
  stockItemId: number;
  itemName: string;
  colour: string | null;
  size: string | null;
  quantity: number;
  recipientName: string | null;
  location: string | null;
}

interface PickingNote {
  ref: string;
  items: PickingNoteItem[];
}

function printPickingNote(note: PickingNote) {
  const rows = note.items.map(i => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb">
        <strong>${i.itemName}</strong>
        ${i.colour || i.size ? `<div style="font-size:12px;color:#6b7280;margin-top:2px">${[i.colour, i.size].filter(Boolean).join(" / ")}</div>` : ""}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;font-size:18px">${i.quantity}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">
        ${i.location ? `<span style="display:inline-flex;align-items:center;gap:4px">📍 ${i.location}</span>` : "—"}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280">${i.recipientName ?? "—"}</td>
    </tr>
  `).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Picking Note ${note.ref}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; color: #111; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:24px; border-bottom:2px solid #111; padding-bottom:16px; }
    .title { font-size:24px; font-weight:800; }
    .ref { font-size:14px; color:#6b7280; margin-top:4px; }
    .date { font-size:13px; color:#6b7280; text-align:right; }
    table { width:100%; border-collapse:collapse; margin-top:16px; }
    th { background:#f3f4f6; padding:10px 12px; text-align:left; font-size:13px; font-weight:600; }
    tr:last-child td { border-bottom:none; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">Picking Note</div>
      <div class="ref">Ref: ${note.ref}</div>
    </div>
    <div class="date">Date: ${new Date().toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric" })}</div>
  </div>
  <p style="font-size:14px;color:#6b7280;margin:0 0 12px">The following items should be picked from stock:</p>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th style="text-align:center">Qty</th>
        <th>Location</th>
        <th>Recipient</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:32px;border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#9ca3af">
    Generated by Select Branding Solutions Customer Portal
  </div>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

function ConfirmStep({ orderNumber, allFromStock, pickingNote, onViewOrder, stripeCharge, selectExtraClaimed }: {
  orderNumber?: string;
  allFromStock?: boolean;
  pickingNote?: PickingNote | null;
  onViewOrder?: () => void;
  stripeCharge?: { success: boolean; last4?: string; brand?: string; amount?: number; error?: string } | null;
  selectExtraClaimed?: boolean;
}) {
  return (
    <div className="py-10 max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          {allFromStock ? <Boxes className="w-8 h-8 text-green-600" /> : <CheckCircle2 className="w-8 h-8 text-green-600" />}
        </div>
        {allFromStock ? (
          <>
            <h2 className="text-2xl font-bold mb-2">All items in stock!</h2>
            <p className="text-muted-foreground">All requested items are available in your stock — no order has been sent to SBS.</p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-bold mb-2">Order submitted!</h2>
            <p className="text-muted-foreground mb-1">
              Your order <span className="font-semibold text-foreground">{orderNumber}</span> has been submitted for review.
            </p>
            <p className="text-sm text-muted-foreground">We'll be in touch shortly to confirm your order.</p>
          </>
        )}
      </div>

      {selectExtraClaimed && (
        <div className="flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-3 text-sm mb-4">
          <Gift className="w-4 h-4 shrink-0 text-amber-600" />
          <span>
            <strong>Select Extra gift claimed!</strong> Your free water bottles will be included with this order.
          </span>
        </div>
      )}

      {stripeCharge?.success && (
        <div className="flex items-center gap-2 bg-green-50 text-green-800 border border-green-200 rounded-lg px-4 py-2.5 text-sm mb-4">
          <CreditCard className="w-4 h-4 shrink-0" />
          <span>
            Payment of <strong>£{stripeCharge.amount?.toFixed(2)}</strong> taken from{" "}
            <span className="capitalize">{stripeCharge.brand}</span> card ending {stripeCharge.last4}
          </span>
        </div>
      )}

      {stripeCharge && !stripeCharge.success && (
        <div className="flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg px-4 py-2.5 text-sm mb-4">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>Card payment could not be processed — we'll be in touch about payment.</span>
        </div>
      )}

      {pickingNote && pickingNote.items.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="font-semibold text-blue-900">Picking Note — {pickingNote.ref}</p>
              <p className="text-xs text-blue-700 mt-0.5">
                {pickingNote.items.length} item{pickingNote.items.length !== 1 ? "s" : ""} to pick from stock
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-blue-300 text-blue-800 hover:bg-blue-100 shrink-0"
              onClick={() => printPickingNote(pickingNote)}
            >
              <Printer className="w-3.5 h-3.5" /> Print
            </Button>
          </div>
          <div className="space-y-2">
            {pickingNote.items.map((item, idx) => (
              <div key={idx} className="rounded-lg bg-white border border-blue-100 px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.itemName}</p>
                  {(item.colour || item.size) && (
                    <p className="text-xs text-muted-foreground">{[item.colour, item.size].filter(Boolean).join(" / ")}</p>
                  )}
                  {item.location && (
                    <p className="text-xs text-blue-600 flex items-center gap-0.5 mt-0.5">
                      <MapPin className="w-3 h-3 shrink-0" /> {item.location}
                    </p>
                  )}
                  {item.recipientName && (
                    <p className="text-xs text-muted-foreground">For: {item.recipientName}</p>
                  )}
                </div>
                <span className="text-lg font-bold text-blue-800 shrink-0">×{item.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-center flex-wrap">
        {!allFromStock && orderNumber && onViewOrder && (
          <Button onClick={onViewOrder}>View order <ArrowRight className="w-4 h-4 ml-1.5" /></Button>
        )}
        {pickingNote && (
          <Button variant={allFromStock ? "default" : "outline"} onClick={() => printPickingNote(pickingNote)}>
            <Printer className="w-4 h-4 mr-1.5" /> Print picking note
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

const SESSION_KEY = "portal-new-order";

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeSession(data: object) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

export default function NewOrder() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { portalRole, isPreview } = useAuth();
  const queryClient = useQueryClient();

  const saved = readSession();
  const savedHasItems = (saved?.basket?.length ?? 0) > 0;
  const [step, setStep] = useState<number>(savedHasItems ? (saved?.step ?? 0) : 0);
  const [mode, setMode] = useState<"wardrobe" | "catalogue" | null>(savedHasItems ? (saved?.mode ?? null) : null);
  const [basket, setBasket] = useState<OrderItem[]>(saved?.basket ?? []);
  const [wishlist, setWishlist] = useState<EnquiryItem[]>([]);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    id?: number;
    orderNumber?: string;
    allFromStock?: boolean;
    stripeCharge?: { success: boolean; last4?: string; brand?: string; amount?: number; error?: string } | null;
    pickingNote?: PickingNote | null;
    selectExtraClaimed?: boolean;
  } | null>(null);
  const [confirmedEnquiry, setConfirmedEnquiry] = useState<{ enquiryRef: string } | null>(null);
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist draft to sessionStorage whenever basket/step/mode change
  const persistedStep = step;
  const persistedMode = mode;
  const persistedBasket = basket;
  if (persistedStep > 0 && persistedMode && !confirmedOrder) {
    writeSession({ step: persistedStep, mode: persistedMode, basket: persistedBasket });
  }

  // ── Server-side basket: restore on mount if session was empty ──────────────
  const { data: serverBasket } = useQuery<{ items: OrderItem[]; mode: string | null; step: number }>({
    queryKey: ["portal-basket"],
    queryFn: () => apiFetch("/portal/basket"),
    staleTime: Infinity,
    enabled: !isPreview,
  });

  useEffect(() => {
    if (!serverBasket || isPreview) return;
    if (basket.length > 0 || step > 0) return; // local session takes priority
    if (!serverBasket.items?.length) return;
    setBasket(serverBasket.items);
    const validMode = serverBasket.mode === "wardrobe" || serverBasket.mode === "catalogue" ? serverBasket.mode : null;
    if (validMode) {
      setMode(validMode);
      if (serverBasket.step > 0) setStep(serverBasket.step);
    }
    toast({ title: "Previous basket restored", description: `${serverBasket.items.length} item${serverBasket.items.length !== 1 ? "s" : ""} loaded from your last visit.` });
  }, [serverBasket]);

  // ── Auto-save basket to server (debounced 2 s) ────────────────────────────
  useEffect(() => {
    if (isPreview || confirmedOrder || confirmedEnquiry) return;
    if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    if (basket.length === 0 && step === 0) return;
    serverSaveTimer.current = setTimeout(() => {
      if (basket.length === 0) {
        apiFetch("/portal/basket", { method: "DELETE" }).catch(() => {});
      } else {
        apiFetch("/portal/basket", { method: "PUT", body: JSON.stringify({ items: basket, mode, step }) }).catch(() => {});
      }
    }, 2000);
    return () => { if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current); };
  }, [basket, mode, step]);

  const { data: wardrobe } = useQuery<{
    items: any[];
    employees: any[];
    processes: any[];
    lastSizes: Record<string, Record<string, { size: string; colour: string | null }>>;
    savedSizes: Record<string, Array<{ label: string; size: string }>>;
    sizesMap: Record<string, Record<string, string[]>>;
    myEmployeeId: number | null;
  }>({
    queryKey: ["portal-wardrobe"],
    queryFn: () => apiFetch("/portal/wardrobe"),
    enabled: mode === "wardrobe",
  });

  const submitMutation = useMutation({
    mutationFn: (data: { requiredDate: string; notes: string; shippingOption: string; shippingCost: number; poNumber: string; paymentMethodId?: string | null; attachments: Array<{ name: string; objectPath: string }>; claimSelectExtra?: boolean }) =>
      apiFetch("/portal/orders", {
        method: "POST",
        body: JSON.stringify({
          requiredDate: data.requiredDate || undefined,
          portalNotes: data.notes || undefined,
          poNumber: data.poNumber || undefined,
          shippingOption: data.shippingOption || undefined,
          shippingCost: data.shippingCost,
          paymentMethodId: data.paymentMethodId ?? null,
          claimSelectExtra: data.claimSelectExtra ?? false,
          attachments: data.attachments.length ? data.attachments : undefined,
          items: basket.map(i => ({
            productId: i.productId,
            productName: i.productName,
            colour: i.colour || undefined,
            size: i.size || undefined,
            finishId: i.finishId || undefined,
            finishName: i.finishName || undefined,
            recipientType: i.recipientType,
            recipientName: i.recipientName || undefined,
            recipientEmployeeId: i.recipientEmployeeId || undefined,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
          })),
        }),
      }),
    onSuccess: (data) => {
      clearSession();
      apiFetch("/portal/basket", { method: "DELETE" }).catch(() => {});
      setConfirmedOrder({
        id: data.id,
        orderNumber: data.orderNumber,
        allFromStock: data.allFromStock ?? false,
        stripeCharge: data.stripeCharge ?? null,
        pickingNote: data.pickingNote ?? null,
        selectExtraClaimed: data.selectExtraClaimed ?? false,
      });
      setStep(3);
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit order", description: err?.message ?? "Please try again.", variant: "destructive" });
    },
  });

  const submitEnquiryMutation = useMutation({
    mutationFn: (data: { items: EnquiryItem[]; notes: string }) =>
      apiFetch("/portal/enquiries", {
        method: "POST",
        body: JSON.stringify({
          notes: data.notes || undefined,
          items: data.items.map(i => ({
            productId: i.productId,
            productName: i.productName,
            imageUrl: i.imageUrl || undefined,
            colour: i.colour || undefined,
            desiredProcesses: i.desiredProcesses,
            notes: i.notes || undefined,
          })),
        }),
      }),
    onSuccess: (data) => {
      clearSession();
      apiFetch("/portal/basket", { method: "DELETE" }).catch(() => {});
      setConfirmedEnquiry({ enquiryRef: data.enquiryRef });
      setStep(2);
    },
    onError: () => {
      toast({ title: "Failed to submit enquiry", description: "Please try again.", variant: "destructive" });
    },
  });

  const STEPS = mode === "catalogue"
    ? ["Choose type", "Inspiration", "Done"]
    : ["Choose type", "Wardrobe", "Review", "Done"];

  const handleModeSelect = (m: "wardrobe" | "catalogue") => {
    if (m !== mode) {
      setBasket([]);
      setWishlist([]);
    }
    setMode(m);
    setStep(1);
  };

  const handleBackToModeStep = () => {
    setStep(0);
  };

  return (
    <PortalLayout>
      <div className="mb-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => setLocation("/orders")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to orders
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">New Order</h1>
      </div>

      <Steps current={step} steps={STEPS} />

      {/* Safety net: step > 0 with no valid mode → reset to step 0 */}
      {step > 0 && mode === null && <ModeStep onSelect={handleModeSelect} />}

      {step === 0 && <ModeStep onSelect={handleModeSelect} />}

      {step === 1 && mode === "wardrobe" && (
        <div>
          <Button variant="ghost" size="sm" className="-ml-2 mb-4 text-muted-foreground" onClick={handleBackToModeStep}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <WardrobeStep
            items={wardrobe?.items ?? []}
            employees={wardrobe?.employees ?? []}
            processes={wardrobe?.processes ?? []}
            lastSizes={wardrobe?.lastSizes ?? {}}
            savedSizes={wardrobe?.savedSizes ?? {}}
            sizesMap={wardrobe?.sizesMap ?? {}}
            basket={basket}
            setBasket={setBasket}
            onNext={() => setStep(2)}
            isManager={portalRole === "manager"}
            onEmployeeAdded={() => queryClient.invalidateQueries({ queryKey: ["portal-wardrobe"] })}
            myEmployeeId={wardrobe?.myEmployeeId ?? null}
            portalRole={portalRole ?? "member"}
          />
        </div>
      )}

      {step === 1 && mode === "catalogue" && (
        <InspirationStep
          wishlist={wishlist}
          setWishlist={setWishlist}
          onSubmit={(d) => submitEnquiryMutation.mutate(d)}
          submitting={submitEnquiryMutation.isPending}
        />
      )}

      {step === 2 && mode === "wardrobe" && (
        <ReviewStep
          basket={basket}
          setBasket={setBasket}
          onSubmit={(d) => submitMutation.mutate(d)}
          submitting={submitMutation.isPending}
          portalRole={portalRole}
          onAddMore={() => setStep(1)}
        />
      )}

      {step === 2 && mode === "catalogue" && confirmedEnquiry && (
        <EnquiryConfirmStep enquiryRef={confirmedEnquiry.enquiryRef} />
      )}

      {step === 3 && confirmedOrder && (
        <ConfirmStep
          orderNumber={confirmedOrder.orderNumber}
          allFromStock={confirmedOrder.allFromStock}
          pickingNote={confirmedOrder.pickingNote}
          onViewOrder={confirmedOrder.id ? () => setLocation(`/orders/${confirmedOrder.id}`) : undefined}
          stripeCharge={confirmedOrder.stripeCharge}
          selectExtraClaimed={confirmedOrder.selectExtraClaimed}
        />
      )}

      {/* Safety net: step === 3 but no confirmed order (e.g. stale session) → restart */}
      {step === 3 && !confirmedOrder && <ModeStep onSelect={handleModeSelect} />}
    </PortalLayout>
  );
}
