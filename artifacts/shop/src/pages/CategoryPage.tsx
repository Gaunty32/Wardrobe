import { useWcProducts, useWcCategories } from '@/hooks/use-wc';
import { CategorySidebar } from '@/components/CategorySidebar';
import { ProductCard } from '@/components/ProductCard';
import { Link, useParams } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';

export default function CategoryPage() {
  const { slug } = useParams();
  const { data: categories = [] } = useWcCategories();
  const { data: products = [], isLoading } = useWcProducts({ category_slug: slug });

  const categoryName = categories.find((c: any) => c.slug === slug)?.name || slug?.replace(/-/g, ' ').toUpperCase();

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-8 font-medium">
        <Link href="/" className="hover:text-primary">HOME</Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-primary">SHOP</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 uppercase">{categoryName}</span>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar */}
        <div className="w-full md:w-[260px] shrink-0">
          <CategorySidebar activeSlug={slug} />
        </div>

        {/* Content */}
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-primary mb-6">{categoryName}</h1>
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

          {isLoading ? (
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
            <div className="py-12 text-center text-gray-500">
              No products found in this category.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
