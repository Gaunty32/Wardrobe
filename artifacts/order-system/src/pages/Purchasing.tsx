import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ShoppingBag, Package, AlertTriangle, CheckCircle, Mail, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import Layout from "@/components/Layout";

const API_BASE = "/api";

interface PurchaseRequirement {
  itemId: number;
  orderId: number;
  orderNumber: string | null;
  customerName: string | null;
  productId: number | null;
  productName: string;
  colour: string | null;
  size: string | null;
  purchaseQuantity: number | null;
  supplierId: number | null;
  supplierName: string;
  supplierEmail: string | null;
}

interface SupplierGroup {
  supplierId: number | null;
  supplierName: string;
  supplierEmail: string | null;
  items: PurchaseRequirement[];
}

function buildEmailBody(group: SupplierGroup, notes: string): string {
  const productMap = new Map<string, Map<string, number>>();

  for (const item of group.items) {
    const key = item.productName;
    if (!productMap.has(key)) productMap.set(key, new Map());
    const sizeKey = [item.colour, item.size].filter(Boolean).join(" / ") || "N/A";
    const existing = productMap.get(key)!.get(sizeKey) ?? 0;
    productMap.get(key)!.set(sizeKey, existing + (item.purchaseQuantity ?? 0));
  }

  const lines: string[] = [];
  lines.push(`Dear ${group.supplierName},`);
  lines.push(``);
  lines.push(`Please supply the following items:`);
  lines.push(``);

  for (const [product, sizes] of productMap.entries()) {
    lines.push(`${product}:`);
    for (const [size, qty] of sizes.entries()) {
      lines.push(`  ${size}: ${qty}`);
    }
    lines.push(``);
  }

  const orders = [...new Set(group.items.map((i) => i.orderNumber).filter(Boolean))];
  lines.push(`These are required for orders: ${orders.join(", ")}`);

  if (notes.trim()) {
    lines.push(``);
    lines.push(`Notes: ${notes.trim()}`);
  }

  lines.push(``);
  lines.push(`Kind regards,`);
  lines.push(`Select Branding Solutions`);

  return lines.join("\n");
}

function MatrixTable({ items }: { items: PurchaseRequirement[] }) {
  const products = [...new Set(items.map((i) => i.productName))];
  const sizeKeys = [
    ...new Set(
      items.map((i) => [i.colour, i.size].filter(Boolean).join(" / ") || "N/A")
    ),
  ];

  if (products.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead className="font-semibold min-w-[160px]">Product</TableHead>
            {sizeKeys.map((s) => (
              <TableHead key={s} className="text-center font-semibold min-w-[80px]">{s}</TableHead>
            ))}
            <TableHead className="text-center font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            const productItems = items.filter((i) => i.productName === product);
            const totalQty = productItems.reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
            return (
              <TableRow key={product}>
                <TableCell className="font-medium">{product}</TableCell>
                {sizeKeys.map((sizeKey) => {
                  const qty = productItems
                    .filter(
                      (i) =>
                        ([i.colour, i.size].filter(Boolean).join(" / ") || "N/A") === sizeKey
                    )
                    .reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);
                  return (
                    <TableCell key={sizeKey} className="text-center">
                      {qty > 0 ? <span className="font-semibold text-primary">{qty}</span> : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  );
                })}
                <TableCell className="text-center font-bold">{totalQty}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

interface EmailDialogProps {
  group: SupplierGroup;
  open: boolean;
  onClose: () => void;
  onSent: (itemIds: number[]) => void;
}

function EmailDialog({ group, open, onClose, onSent }: EmailDialogProps) {
  const [notes, setNotes] = useState("");
  const emailBody = buildEmailBody(group, notes);
  const subject = encodeURIComponent(`Purchase Order — Select Branding Solutions`);
  const body = encodeURIComponent(emailBody);
  const mailto = `mailto:${group.supplierEmail ?? ""}?subject=${subject}&body=${body}`;
  const itemIds = group.items.map((i) => i.itemId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-primary" />
            Purchase Order — {group.supplierName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Additional Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional notes for this supplier..."
              rows={2}
            />
          </div>

          <div className="space-y-1">
            <Label>Email Preview</Label>
            <pre className="text-xs bg-muted/50 border border-border rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">
              {emailBody}
            </pre>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              window.open(mailto, "_blank");
              onSent(itemIds);
            }}
            className="gap-2"
          >
            <Mail className="w-4 h-4" />
            Open Email Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Purchasing() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedItems, setSelectedItems] = useState<Record<number, boolean>>({});
  const [emailGroup, setEmailGroup] = useState<SupplierGroup | null>(null);

  const { data: groups = [], isLoading, refetch } = useQuery<SupplierGroup[]>({
    queryKey: ["purchasing-requirements"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/purchasing/requirements`);
      if (!res.ok) throw new Error("Failed to load purchasing requirements");
      return res.json();
    },
  });

  const fulfillMutation = useMutation({
    mutationFn: async (itemIds: number[]) => {
      const res = await fetch(`${API_BASE}/purchasing/mark-fulfilled`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds }),
      });
      if (!res.ok) throw new Error("Failed to mark as fulfilled");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["purchasing-requirements"] });
      setSelectedItems({});
      toast({ title: "Marked as fulfilled", description: "Items removed from purchasing requirements." });
    },
    onError: () => {
      toast({ title: "Error", description: "Could not update items.", variant: "destructive" });
    },
  });

  const toggleGroup = (name: string) => {
    setExpandedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const toggleItem = (itemId: number) => {
    setSelectedItems((prev) => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const toggleGroupItems = (group: SupplierGroup) => {
    const allSelected = group.items.every((i) => selectedItems[i.itemId]);
    const updated = { ...selectedItems };
    for (const item of group.items) {
      updated[item.itemId] = !allSelected;
    }
    setSelectedItems(updated);
  };

  const selectedCount = Object.values(selectedItems).filter(Boolean).length;
  const selectedIds = Object.entries(selectedItems)
    .filter(([, v]) => v)
    .map(([k]) => parseInt(k));

  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <Layout>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShoppingBag className="w-7 h-7 text-primary" />
            Purchasing
          </h1>
          <p className="text-muted-foreground mt-1">
            Consolidated purchase requirements by supplier.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button
              variant="outline"
              onClick={() => fulfillMutation.mutate(selectedIds)}
              disabled={fulfillMutation.isPending}
              className="gap-2 border-green-500 text-green-700 hover:bg-green-50"
            >
              <CheckCircle className="w-4 h-4" />
              Mark {selectedCount} Fulfilled
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          Loading requirements...
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <CheckCircle className="w-12 h-12 text-green-400" />
          <p className="text-lg font-medium">No purchasing required</p>
          <p className="text-sm">All order items are either in stock or already fulfilled.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span>{totalItems} item{totalItems !== 1 ? "s" : ""} across {groups.length} supplier{groups.length !== 1 ? "s" : ""} need purchasing</span>
          </div>

          {groups.map((group) => {
            const isExpanded = expandedGroups[group.supplierName] !== false;
            const allGroupSelected = group.items.every((i) => selectedItems[i.itemId]);
            const someGroupSelected = group.items.some((i) => selectedItems[i.itemId]);
            const totalQty = group.items.reduce((sum, i) => sum + (i.purchaseQuantity ?? 0), 0);

            return (
              <div key={group.supplierName} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                <div
                  className="flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => toggleGroup(group.supplierName)}
                >
                  <div className="flex items-center gap-3">
                    <div onClick={(e) => { e.stopPropagation(); toggleGroupItems(group); }}>
                      <Checkbox
                        checked={allGroupSelected}
                        className={someGroupSelected && !allGroupSelected ? "data-[state=unchecked]:bg-primary/20" : ""}
                      />
                    </div>
                    <div>
                      <div className="font-semibold text-base">{group.supplierName}</div>
                      {group.supplierEmail && (
                        <div className="text-xs text-muted-foreground">{group.supplierEmail}</div>
                      )}
                    </div>
                    <Badge variant="secondary" className="ml-2">
                      {group.items.length} line{group.items.length !== 1 ? "s" : ""}
                    </Badge>
                    <Badge className="bg-amber-100 text-amber-800 border-amber-200">
                      {totalQty} units needed
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2 text-xs"
                      onClick={(e) => { e.stopPropagation(); setEmailGroup(group); }}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email PO
                    </Button>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border">
                    <div className="px-5 py-4 space-y-5">
                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Purchase Matrix</h4>
                        <MatrixTable items={group.items} />
                      </div>

                      <div>
                        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Line Details</h4>
                        <div className="space-y-2">
                          {group.items.map((item) => (
                            <div
                              key={item.itemId}
                              className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
                            >
                              <Checkbox
                                checked={!!selectedItems[item.itemId]}
                                onCheckedChange={() => toggleItem(item.itemId)}
                              />
                              <Package className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{item.productName}</div>
                                <div className="flex items-center gap-2 mt-0.5">
                                  {item.colour && <Badge variant="outline" className="text-xs py-0">{item.colour}</Badge>}
                                  {item.size && <Badge variant="outline" className="text-xs py-0">{item.size}</Badge>}
                                  <span className="text-xs text-muted-foreground">
                                    Order: <a href={`/orders/${item.orderId}`} className="text-primary hover:underline">{item.orderNumber}</a>
                                    {item.customerName && ` · ${item.customerName}`}
                                  </span>
                                </div>
                              </div>
                              <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-sm font-semibold">
                                × {item.purchaseQuantity ?? 0}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {emailGroup && (
        <EmailDialog
          group={emailGroup}
          open={!!emailGroup}
          onClose={() => setEmailGroup(null)}
          onSent={(ids) => {
            setEmailGroup(null);
            fulfillMutation.mutate(ids);
          }}
        />
      )}
    </div>
    </Layout>
  );
}
