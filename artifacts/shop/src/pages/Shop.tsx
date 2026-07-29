import { useState } from 'react';
import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { Link, useSearch } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';

const NAVY = "#1a2335";

function CategoryTile({ category }: { category: any }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Link href={`/category/${category.slug}`}>
      <div
        className="relative overflow-hidden cursor-pointer"
        style={{ aspectRatio: "4/3", background: "#f3f4f6" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Product image */}
        {category.image ? (
          <img
            src={category.image}
            alt={category.name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out"
            style={{ transform: hovered ? "scale(1.08)" : "scale(1)" }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300" />
        )}

        {/* Permanent dark footer — always readable before hover */}
        <div
          className="absolute inset-0 transition-opacity duration-400"
          style={{
            background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.1) 45%, transparent 70%)",
            opacity: hovered ? 0 : 1,
          }}
        />

        {/* Brand-wash overlay — slides up from bottom on hover */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center transition-all duration-500 ease-out"
          style={{
            background: NAVY,
            opacity: hovered ? 0.93 : 0,
            transform: hovered ? "translateY(0)" : "translateY(6%)",
          }}
        >
          <span
            className="text-white font-extrabold tracking-widest uppercase text-center px-4 transition-all duration-500"
            style={{ fontSize: "clamp(0.85rem, 2.5vw, 1.4rem)", transform: hovered ? "translateY(0)" : "translateY(12px)", opacity: hovered ? 1 : 0 }}
          >
            {category.name}
          </span>
          {/* Animated underline */}
          <div
            className="mt-2 bg-white transition-all duration-500"
            style={{ height: 2, width: hovered ? 50 : 0, transitionDelay: hovered ? "100ms" : "0ms" }}
          />
          <span
            className="mt-3 text-white/75 text-xs tracking-widest uppercase transition-all duration-500"
            style={{ opacity: hovered ? 1 : 0, transform: hovered ? "translateY(0)" : "translateY(8px)", transitionDelay: hovered ? "160ms" : "0ms" }}
          >
            Explore Collection →
          </span>
        </div>

        {/* Default label — fades out on hover */}
        <div
          className="absolute bottom-0 left-0 right-0 px-3 pb-3 transition-opacity duration-300"
          style={{ opacity: hovered ? 0 : 1 }}
        >
          <p className="text-white font-semibold text-sm uppercase tracking-wide leading-tight drop-shadow">
            {category.name}
          </p>
          <p className="text-white/70 text-xs mt-0.5 drop-shadow">
            {category.count} {category.count === 1 ? 'product' : 'products'}
          </p>
        </div>
      </div>
    </Link>
  );
}

function CategoryTileSkeleton() {
  return <Skeleton className="aspect-[4/3] w-full rounded-none" />;
}

export default function Shop() {
  const searchString = useSearch();
  const search = new URLSearchParams(searchString).get('search') || '';

  const { data: products = [], isLoading: productsLoading } = useWcProducts(
    search ? { search, per_page: 1000 } : { per_page: 0 }
  );
  const { data: allCategories = [], isLoading: catsLoading } = useWcCategories();

  const showTiles = !search;
  const topCategories = (allCategories as any[]).filter((c: any) => c.parent === 0 && c.count > 0);

  return (
    <div className="container mx-auto px-4 py-4 md:py-8">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-4 md:mb-8 font-medium">
        <Link href="/" className="hover:text-primary">HOME</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">SHOP</span>
        {search && <><span className="mx-2">/</span><span className="text-gray-900">SEARCH: "{search}"</span></>}
      </div>

      {showTiles ? (
        /* ── Category tiles — no sidebar on mobile ── */
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 mb-1 uppercase">Shop by Category</h1>
          <p className="text-sm text-gray-500 mb-4 md:mb-6">Browse our full range — select a category to explore.</p>

          {catsLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
              {[...Array(12)].map((_, i) => <CategoryTileSkeleton key={i} />)}
            </div>
          ) : topCategories.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-3">
              {topCategories.map((cat: any) => (
                <CategoryTile key={cat.id} category={cat} />
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-gray-500">No categories found.</div>
          )}
        </div>
      ) : (
        /* ── Search results — sidebar + product grid ── */
        <div className="flex flex-col md:flex-row gap-6 md:gap-8">
          {/* Sidebar */}
          <div className="w-full md:w-[260px] shrink-0">
            <CategorySidebar />
          </div>

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4 md:mb-6">
              <p className="text-sm text-gray-600">
                {products.length > 0 ? `${products.length} result${products.length !== 1 ? 's' : ''}` : 'No results'}
                {search && <> for <span className="font-medium">"{search}"</span></>}
              </p>
              <select className="border border-gray-300 py-2 px-3 text-sm focus:outline-none focus:border-primary">
                <option>Default sorting</option>
                <option>Sort by popularity</option>
                <option>Sort by latest</option>
                <option>Sort by price: low to high</option>
                <option>Sort by price: high to low</option>
              </select>
            </div>

            {productsLoading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <Skeleton className="aspect-square w-full rounded-none" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-1/4" />
                  </div>
                ))}
              </div>
            ) : products.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-6">
                {products.map((p: any) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-gray-500">No products found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
