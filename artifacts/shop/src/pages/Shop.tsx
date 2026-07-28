import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { Link, useSearch } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';

function CategoryTile({ category }: { category: any }) {
  return (
    <Link href={`/category/${category.slug}`}>
      <div className="group relative overflow-hidden bg-gray-100 aspect-square cursor-pointer">
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

        {/* Dark gradient overlay — stronger at bottom */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

        {/* Label */}
        <div className="absolute bottom-0 left-0 right-0 px-4 py-4">
          <p className="text-white font-semibold text-sm sm:text-base uppercase tracking-wide leading-tight drop-shadow">
            {category.name}
          </p>
          <p className="text-white/70 text-xs mt-0.5 drop-shadow">
            {category.count} {category.count === 1 ? 'product' : 'products'}
          </p>
        </div>

        {/* Hover border flash */}
        <div className="absolute inset-0 ring-2 ring-primary/0 group-hover:ring-primary/60 transition-all duration-300" />
      </div>
    </Link>
  );
}

function CategoryTileSkeleton() {
  return <Skeleton className="aspect-square w-full rounded-none" />;
}

export default function Shop() {
  const searchString = useSearch();
  const search = new URLSearchParams(searchString).get('search') || '';

  const { data: products = [], isLoading: productsLoading } = useWcProducts(
    search ? { search, per_page: 1000 } : { per_page: 0 }  // skip products when showing tiles
  );
  const { data: allCategories = [], isLoading: catsLoading } = useWcCategories();

  // Show tiles on the main /products page with no active search.
  const showTiles = !search;

  // Top-level categories (parent === 0), already sorted by count from the API.
  const topCategories = (allCategories as any[]).filter((c: any) => c.parent === 0 && c.count > 0);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-8 font-medium">
        <Link href="/" className="hover:text-primary">HOME</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900">SHOP</span>
        {search && <><span className="mx-2">/</span><span className="text-gray-900">SEARCH: "{search}"</span></>}
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full md:w-[260px] shrink-0">
          <CategorySidebar />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {showTiles ? (
            <>
              <h1 className="text-2xl font-bold text-gray-900 mb-2 uppercase">Shop by Category</h1>
              <p className="text-sm text-gray-500 mb-6">Browse our full range — select a category to explore products.</p>

              {catsLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[...Array(12)].map((_, i) => <CategoryTileSkeleton key={i} />)}
                </div>
              ) : topCategories.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {topCategories.map((cat: any) => (
                    <CategoryTile key={cat.id} category={cat} />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-500">No categories found.</div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-center justify-between mb-6">
                <p className="text-sm text-gray-600">
                  Showing {products.length > 0 ? `1–${products.length}` : '0'} results
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
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <Skeleton className="aspect-square w-full rounded-none" />
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-4 w-1/4" />
                    </div>
                  ))}
                </div>
              ) : products.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {products.map((p: any) => (
                    <ProductCard key={p.id} product={p} />
                  ))}
                </div>
              ) : (
                <div className="py-12 text-center text-gray-500">No products found.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
