import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import PortalLayout from "@/components/Layout";
import { apiFetch } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Search, ShoppingBag, Package, ArrowLeft, Tag } from "lucide-react";

const UNCATEGORISED = "Uncategorised";

// Simple emoji map for common categories
const CAT_EMOJI: Record<string, string> = {
  "T-Shirts": "👕",
  "Polos": "👔",
  "Hoodies": "🧥",
  "Sweatshirts": "👚",
  "Jackets": "🧥",
  "Winter Jackets": "🧤",
  "Gilets": "🦺",
  "Fleece": "🧶",
  "Knitwear": "🧶",
  "Shirts": "👔",
  "Ladies Shirts": "👗",
  "Chefswear": "👨‍🍳",
  "Headwear": "🧢",
  "Work Trousers": "👖",
  "Safety Boots": "🥾",
  "Bib Aprons": "🍽️",
  "Childrens": "👶",
  "Health & Beauty": "💄",
  "Bulk Buys": "📦",
  "Additions": "➕",
  [UNCATEGORISED]: "🏷️",
};

export default function Products() {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery<any[]>({
    queryKey: ["portal-products"],
    queryFn: () => apiFetch(`/portal/products`),
    staleTime: 60_000,
  });

  // Derive categories with counts from the full product list
  const categories = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of products) {
      const cat = p.category?.trim() || UNCATEGORISED;
      map[cat] = (map[cat] ?? 0) + 1;
    }
    return Object.entries(map)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => {
        if (a.name === UNCATEGORISED) return 1;
        if (b.name === UNCATEGORISED) return -1;
        return b.count - a.count;
      });
  }, [products]);

  // Filtered products based on search or selected category
  const filteredProducts = useMemo(() => {
    let list = products;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.sku?.toLowerCase().includes(q) ||
          p.category?.toLowerCase().includes(q)
      );
    } else if (selectedCategory) {
      list = list.filter((p) =>
        selectedCategory === UNCATEGORISED
          ? !p.category?.trim()
          : p.category?.trim() === selectedCategory
      );
    }
    return list;
  }, [products, search, selectedCategory]);

  const isSearching = search.trim().length > 0;
  const showCategories = !isSearching && !selectedCategory;

  return (
    <PortalLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Browse the Select Branding Solutions product range. See something you'd like added to your wardrobe?{" "}
          <a href="mailto:hello@selectbranding.co.uk" className="underline underline-offset-2 hover:text-foreground">
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
          placeholder="Search products or categories…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (e.target.value) setSelectedCategory(null);
          }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : showCategories ? (
        /* ── Category grid ── */
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {categories.length} categories · {products.length} products total
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setSelectedCategory(cat.name)}
                className="flex flex-col items-start gap-1 rounded-xl border bg-card px-4 py-4 text-left hover:border-primary/50 hover:bg-primary/5 hover:shadow-sm transition-all group"
              >
                <span className="text-2xl">{CAT_EMOJI[cat.name] ?? "🏷️"}</span>
                <span className="font-semibold text-sm mt-1 group-hover:text-primary transition-colors leading-tight">
                  {cat.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {cat.count} product{cat.count !== 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        /* ── Product list (category selected or searching) ── */
        <div>
          {/* Header row */}
          <div className="flex items-center gap-3 mb-4">
            {!isSearching && selectedCategory && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 -ml-1"
                onClick={() => setSelectedCategory(null)}
              >
                <ArrowLeft className="w-4 h-4" /> All categories
              </Button>
            )}
            <div className="flex items-center gap-2">
              {selectedCategory && (
                <span className="text-lg">{CAT_EMOJI[selectedCategory] ?? "🏷️"}</span>
              )}
              <h2 className="font-semibold text-base">
                {isSearching
                  ? `Results for "${search}"`
                  : selectedCategory}
              </h2>
              <Badge variant="secondary" className="text-xs">
                {filteredProducts.length}
              </Badge>
            </div>
          </div>

          {filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="py-20 text-center">
                <ShoppingBag className="w-14 h-14 mx-auto mb-4 text-muted-foreground/30" />
                <h2 className="text-lg font-semibold">No products found</h2>
                <p className="text-muted-foreground text-sm mt-1">Try a different search term</p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProducts.map((product: any) => (
                <Card
                  key={product.id}
                  className="overflow-hidden hover:border-primary/40 hover:shadow-sm transition-all"
                >
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
                    <p className="font-semibold text-sm leading-tight">{product.name}</p>
                    {product.sku && (
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">{product.sku}</p>
                    )}
                    <div className="flex items-center justify-between mt-2 gap-2">
                      {product.unit_price ? (
                        <span className="text-sm font-semibold tabular-nums">
                          {formatCurrency(product.unit_price)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">POA</span>
                      )}
                      {isSearching && product.category && (
                        <button
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => { setSearch(""); setSelectedCategory(product.category); }}
                        >
                          <Tag className="w-3 h-3" />
                          {product.category}
                        </button>
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
        </div>
      )}
    </PortalLayout>
  );
}
