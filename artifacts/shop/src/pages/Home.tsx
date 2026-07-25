import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProductCard } from '@/components/ProductCard';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { CheckCircle, Clock, MapPin, Award } from 'lucide-react';
import { useGetShopSettings, useListShopCategories, useListShopProducts } from '@workspace/api-client-react';

export default function Home() {
  const { data: settings, isLoading: settingsLoading } = useGetShopSettings();
  const { data: categories = [], isLoading: categoriesLoading } = useListShopCategories();
  const { data: featuredProducts = [], isLoading: productsLoading } = useListShopProducts({ featured: true });

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      {/* Hero Section */}
      <section className="relative bg-gradient-to-br from-primary/5 via-background to-accent/5 py-20 md:py-32">
        <div className="container mx-auto px-4">
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight mb-6" data-testid="text-hero-title">
              {settings?.heroText || 'Professional Workwear & Uniform Solutions'}
            </h1>
            <p className="text-xl text-muted-foreground mb-8" data-testid="text-hero-subtitle">
              {settings?.heroSubtext || 'Quality branding, fast turnaround, UK-based service'}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href="/products">
                <Button size="lg" data-testid="button-browse-products">
                  Browse Products
                </Button>
              </Link>
              <Link href="/quote">
                <Button size="lg" variant="outline" data-testid="button-request-quote">
                  Request a Quote
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      {categories.length > 0 && (
        <section className="py-16 bg-muted/30">
          <div className="container mx-auto px-4">
            <h2 className="text-2xl font-bold mb-8">Shop by Category</h2>
            <div className="flex flex-wrap gap-3">
              {categories.map((category, idx) => (
                <Link key={idx} href={`/products?category=${encodeURIComponent(category.name)}`}>
                  <Badge 
                    variant="secondary" 
                    className="px-4 py-2 text-sm cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                    data-testid={`badge-category-${idx}`}
                  >
                    {category.name} ({category.count})
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Products */}
      {featuredProducts.length > 0 && (
        <section className="py-16">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-2xl font-bold">Featured Products</h2>
              <Link href="/products">
                <Button variant="ghost" data-testid="button-view-all">
                  View all products
                </Button>
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {featuredProducts.slice(0, 8).map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* USPs */}
      <section className="py-16 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-12">Why Choose Us</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-foreground/10 mb-4">
                <Award className="h-6 w-6" />
              </div>
              <h3 className="font-semibold mb-2">Quality Products</h3>
              <p className="text-sm text-primary-foreground/80">
                Premium workwear and uniforms from trusted suppliers
              </p>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-foreground/10 mb-4">
                <CheckCircle className="h-6 w-6" />
              </div>
              <h3 className="font-semibold mb-2">Expert Branding</h3>
              <p className="text-sm text-primary-foreground/80">
                Professional decoration services for your company identity
              </p>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-foreground/10 mb-4">
                <Clock className="h-6 w-6" />
              </div>
              <h3 className="font-semibold mb-2">Fast Turnaround</h3>
              <p className="text-sm text-primary-foreground/80">
                Quick delivery to keep your team equipped
              </p>
            </div>

            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary-foreground/10 mb-4">
                <MapPin className="h-6 w-6" />
              </div>
              <h3 className="font-semibold mb-2">UK-Based</h3>
              <p className="text-sm text-primary-foreground/80">
                Local service and support you can count on
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <Card className="bg-gradient-to-br from-accent/10 to-primary/10 border-none">
            <CardContent className="p-12 text-center">
              <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
              <p className="text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
                Request a quote today and discover how we can help outfit your team with quality workwear and branding solutions.
              </p>
              <Link href="/quote">
                <Button size="lg" data-testid="button-cta-quote">
                  Request a Quote
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      <Footer />
    </div>
  );
}
