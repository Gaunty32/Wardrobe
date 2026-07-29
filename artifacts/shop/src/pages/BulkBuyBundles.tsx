import { useSEO } from '@/hooks/useSEO';
import { useWcProducts } from '@/hooks/use-wc';
import { ProductCard } from '@/components/ProductCard';
import { Skeleton } from '@/components/ui/skeleton';

export default function BulkBuyBundles() {
  useSEO({
    title: 'Bulk Buy Workwear & Bundle Deals',
    description: 'Save more when you order more. Browse our bulk buy workwear deals and pre-matched uniform bundles — ideal for kitting out teams quickly at the best price.',
  });
  const { data: products = [], isLoading } = useWcProducts({ category_slug: 'bundles', per_page: 100 });


  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-accent flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent"></div>
        <div className="relative z-10 text-center">
          <span className="inline-block bg-white text-accent font-black px-4 py-1 text-sm tracking-widest mb-4 uppercase rounded-sm shadow-md transform -rotate-2">
            Sale
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white tracking-wider uppercase">
            Bulk Buy & Bundles
          </h1>
          <p className="text-white/90 mt-4 max-w-xl mx-auto font-medium">
            Save more when you kit out your whole team. Essential workwear bundles with free logo application included.
          </p>
        </div>
      </section>

      <section className="py-16 container mx-auto px-4">
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
              <ProductCard key={p.id} product={{...p, onSale: true}} /> // force sale badge
            ))}
          </div>
        ) : (
          <div className="py-12 text-center text-gray-500">
            No bundles available at the moment. Please check back later.
          </div>
        )}
      </section>
    </div>
  );
}
