import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shirt, Tag, Layers } from "lucide-react";

function ProcessBadge({ type }: { type: string }) {
  const colours: Record<string, string> = {
    embroidery: "bg-purple-100 text-purple-700",
    print: "bg-blue-100 text-blue-700",
    dtf: "bg-cyan-100 text-cyan-700",
    badge: "bg-amber-100 text-amber-700",
    heat_transfer: "bg-orange-100 text-orange-700",
  };
  const cls = colours[type?.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {type}
    </span>
  );
}

export default function Wardrobe() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["portal-wardrobe"],
    queryFn: () => apiFetch("/portal/wardrobe"),
  });

  // Group raw items by finish_id → finish_name
  const finishes: Record<string, { finishId: number; finishName: string; items: any[] }> = {};
  if (data?.items) {
    for (const item of data.items) {
      const key = String(item.finish_id);
      if (!finishes[key]) {
        finishes[key] = { finishId: item.finish_id, finishName: item.finish_name, items: [] };
      }
      finishes[key].items.push(item);
    }
  }

  const finishList = Object.values(finishes);

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Wardrobe</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Your preset garments, finishes and decoration processes set up by Select Branding Solutions.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : finishList.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <Shirt className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold">No wardrobe set up yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Contact Select Branding Solutions to get your bespoke wardrobe configured.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {finishList.map((finish) => {
            // Deduplicate processes across items in this finish
            const processMap: Record<string, any> = {};
            for (const item of finish.items) {
              if (item.item_finish_name && !processMap[item.item_finish_name]) {
                processMap[item.item_finish_name] = item;
              }
            }

            // Group items by product
            const productMap: Record<string, any[]> = {};
            for (const item of finish.items) {
              const key = item.product_name ?? item.name ?? "Unknown";
              if (!productMap[key]) productMap[key] = [];
              productMap[key].push(item);
            }

            return (
              <Card key={finish.finishId} className="overflow-hidden">
                <CardHeader className="bg-muted/40 border-b pb-4">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-primary" />
                    <CardTitle className="text-base">{finish.finishName}</CardTitle>
                    {finish.items[0]?.finish_code && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {finish.items[0].finish_code}
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {/* Garments/Products */}
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                      <Shirt className="w-3.5 h-3.5" /> Garments
                    </p>
                    <div className="flex flex-col gap-2">
                      {Object.entries(productMap).map(([productName, items]) => {
                        const firstItem = items[0];
                        const colours = [...new Set(items.map((i: any) => i.colour).filter(Boolean))];
                        const price = firstItem.special_price ?? firstItem.unit_price;
                        return (
                          <div
                            key={productName}
                            className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 bg-background"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm truncate">{productName}</p>
                              {firstItem.product_sku && (
                                <p className="text-xs text-muted-foreground font-mono">
                                  SKU: {firstItem.product_sku}
                                </p>
                              )}
                              {colours.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {colours.map((c: any) => (
                                    <Badge key={c} variant="outline" className="text-xs py-0">
                                      {c}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              {firstItem.role_name && (
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Role: {firstItem.role_name}
                                </p>
                              )}
                            </div>
                            {price && (
                              <span className="text-sm font-semibold tabular-nums shrink-0">
                                {formatCurrency(price)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Processes / finishes applied */}
                  {Object.keys(processMap).length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5" /> Decoration
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.values(processMap).map((p: any) => (
                          <div
                            key={p.item_finish_name}
                            className="flex items-center gap-1.5 rounded-md border px-2 py-1 bg-background"
                          >
                            {p.process_type && <ProcessBadge type={p.process_type} />}
                            <span className="text-xs text-muted-foreground">{p.item_finish_name}</span>
                            {p.placement && (
                              <span className="text-xs text-muted-foreground opacity-60">
                                · {p.placement}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-6 text-center">
        Want to add a new garment or finish? Contact{" "}
        <a href="mailto:hello@selectbranding.co.uk" className="underline underline-offset-2 hover:text-foreground">
          Select Branding Solutions
        </a>
      </p>
    </PortalLayout>
  );
}
