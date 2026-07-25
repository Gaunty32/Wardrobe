import { useState, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ProductCard } from '@/components/ProductCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { useListShopCategories, useListShopProducts } from '@workspace/api-client-react';

export default function Products() {
  const [location, setLocation] = useLocation();
  const urlParams = new URLSearchParams(location.split('?')[1] || '');
  const initialCategory = urlParams.get('category') || '';
  
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(initialCategory);

  const { data: categories = [] } = useListShopCategories();
  const { data: products = [], isLoading } = useListShopProducts({ 
    search: search || undefined, 
    category: selectedCategory || undefined 
  });

  const handleCategoryClick = (categoryName: string) => {
    if (selectedCategory === categoryName) {
      setSelectedCategory('');
      setLocation('/products');
    } else {
      setSelectedCategory(categoryName);
      setLocation(`/products?category=${encodeURIComponent(categoryName)}`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1">
        <div className="bg-muted/30 border-b py-8">
          <div className="container mx-auto px-4">
            <h1 className="text-3xl font-bold mb-4">All Products</h1>
            <p className="text-muted-foreground">Browse our complete range of workwear and uniforms</p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col gap-6">
            {/* Search */}
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search-products"
              />
            </div>

            {/* Category filter */}
            {categories.length > 0 && (
              <div>
                <h3 className="text-sm font-medium mb-3">Filter by Category</h3>
                <div className="flex flex-wrap gap-2">
                  {categories.map((category, idx) => (
                    <Badge
                      key={idx}
                      variant={selectedCategory === category.name ? 'default' : 'secondary'}
                      className="px-3 py-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => handleCategoryClick(category.name)}
                      data-testid={`badge-filter-${idx}`}
                    >
                      {category.name} ({category.count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Products grid */}
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="h-96 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : products.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-muted-foreground text-lg">No products found</p>
                {(search || selectedCategory) && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Try adjusting your filters or search terms
                  </p>
                )}
              </div>
            ) : (
              <div>
                <p className="text-sm text-muted-foreground mb-4">
                  Showing {products.length} product{products.length !== 1 ? 's' : ''}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {products.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
