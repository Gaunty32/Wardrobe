import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { Link, useSearch } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';

function CategoryTile({ category }: { category: any }) {
  return (
    <Link href={`/category/${category.slug}`}>
      <div className="group relative overflow-hidden bg-gray-100 aspect-[4/3] cursor-pointer">
        {/* Image */}
        {category.image ? (
          <img
            src={category.image}
            alt={category.name}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-gray-200 to-gray-300" />
        )}

        {/* Dark gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Label */}
        <div className="absolute bottom-0 left-0 right-0 px-3 py-3">
          <p className="text-white font-semibold text-sm uppercase tracking-wide leading-tight drop-shadow">
            {category.name}
          </p>
          <p className="text-white/70 text-xs mt-0.5 drop-shadow">
            {category.count} {category.count === 1 ? 'product' : 'products'}
          </p>
        </div>

        {/* Hover border */}
        <div className="absolute inset-0 ring-2 ring-primary/0 group-hover:ring-primary/60 transition-all duration-300" />
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
