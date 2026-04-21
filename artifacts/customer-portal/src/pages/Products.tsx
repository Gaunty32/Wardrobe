import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, ShoppingBag, Package } from "lucide-react";

export default function Products() {
  const [search, setSearch] = useState("");

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-products", search],
    queryFn: () => apiFetch(`/portal/products?search=${encodeURIComponent(search)}`),
    staleTime: 60_000,
  });

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Browse the Select Branding Solutions product range. See something you'd like added to your wardrobe?{" "}
          <a
            href="mailto:hello@selectbranding.co.uk"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Get in touch
          </a>
          .
        </p>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : products.length === 0 ? (
        <Card>
          <CardContent className="py-20 text-center">
            <ShoppingBag className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
            <h2 className="text-lg font-semibold">No products found</h2>
            <p className="text-muted-foreground text-sm mt-1">Try a different search term</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product: any) => (
            <Card key={product.id} className="overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all">
              {product.image_url ? (
                <div className="aspect-square bg-muted overflow-hidden">
                  <img
                    src={product.image_url}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              ) : (
                <div className="aspect-square bg-muted flex items-center justify-center">
                  <Package className="w-10 h-10 text-muted-foreground/30" />
                </div>
              )}
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight truncate">{product.name}</p>
                {product.sku && (
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">{product.sku}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  {product.unit_price ? (
                    <span className="text-sm font-semibold tabular-nums">
                      {formatCurrency(product.unit_price)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">POA</span>
                  )}
                  {product.category && (
                    <Badge variant="outline" className="text-xs py-0">
                      {product.category}
                    </Badge>
                  )}
                </div>
                {Number(product.variant_count) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {product.variant_count} variant{Number(product.variant_count) !== 1 ? "s" : ""} available
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PortalLayout>
  );
}
