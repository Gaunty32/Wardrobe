import { useState } from 'react';
import { useParams, Link } from 'wouter';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ProductCard } from '@/components/ProductCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ChevronRight, CheckCircle, XCircle } from 'lucide-react';
import { useGetShopProduct, getGetShopProductQueryKey } from '@workspace/api-client-react';

export default function ProductDetail() {
  const params = useParams<{ id: string }>();
  const productId = params.id ? Number(params.id) : 0;
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);

  const { data: product, isLoading } = useGetShopProduct(productId, {
    query: {
      enabled: !!productId,
      queryKey: getGetShopProductQueryKey(productId),
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 container mx-auto px-4 py-8">
          <div className="animate-pulse">
            <div className="h-8 bg-muted rounded w-64 mb-8" />
            <div className="grid md:grid-cols-2 gap-8">
              <div className="aspect-square bg-muted rounded-lg" />
              <div className="space-y-4">
                <div className="h-10 bg-muted rounded w-3/4" />
                <div className="h-6 bg-muted rounded w-1/2" />
                <div className="h-24 bg-muted rounded" />
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-4">Product not found</h1>
          <Link href="/products">
            <Button>Browse all products</Button>
          </Link>
        </div>
        <Footer />
      </div>
    );
  }

  const priceDisplay = product.unitPrice > 0 
    ? `from £${product.unitPrice.toFixed(2)}` 
    : 'Price on request';

  const images = product.imageUrls.length > 0 ? product.imageUrls : product.imageUrl ? [product.imageUrl] : [];
  const displayImage = images[selectedImageIndex] || images[0];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1">
        {/* Breadcrumb */}
        <div className="border-b bg-muted/30 py-4">
          <div className="container mx-auto px-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Link href="/" className="hover:text-foreground">Home</Link>
              <ChevronRight className="h-4 w-4" />
              <Link href="/products" className="hover:text-foreground">Products</Link>
              <ChevronRight className="h-4 w-4" />
              <span className="text-foreground">{product.name}</span>
            </div>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8">
          <div className="grid md:grid-cols-2 gap-8 lg:gap-12 mb-16">
            {/* Images */}
            <div>
              <div className="aspect-square bg-muted rounded-lg overflow-hidden mb-4">
                {displayImage ? (
                  <img 
                    src={displayImage} 
                    alt={product.name}
                    className="w-full h-full object-cover"
                    data-testid="img-product-main"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No image
                  </div>
                )}
              </div>
              {images.length > 1 && (
                <div className="grid grid-cols-4 gap-2">
                  {images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSelectedImageIndex(idx)}
                      className={`aspect-square bg-muted rounded overflow-hidden border-2 transition-colors ${
                        selectedImageIndex === idx ? 'border-primary' : 'border-transparent'
                      }`}
                      data-testid={`button-image-${idx}`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div>
              <div className="mb-4">
                {product.category && (
                  <p className="text-sm text-muted-foreground mb-2">{product.category}</p>
                )}
                <h1 className="text-3xl font-bold mb-2" data-testid="text-product-name">
                  {product.name}
                </h1>
                {product.sku && (
                  <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                )}
              </div>

              <div className="mb-6">
                <p className="text-2xl font-bold text-primary" data-testid="text-product-price">
                  {priceDisplay}
                </p>
              </div>

              {product.guidanceBadges.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6">
                  {product.guidanceBadges.map((badge, idx) => (
                    <Badge key={idx} variant="secondary">{badge}</Badge>
                  ))}
                </div>
              )}

              {product.description && (
                <div className="mb-6">
                  <h2 className="font-semibold mb-2">Description</h2>
                  <p className="text-muted-foreground">{product.description}</p>
                </div>
              )}

              {/* Colours */}
              {product.colours.length > 0 && (
                <div className="mb-6">
                  <h2 className="font-semibold mb-3">Available Colours</h2>
                  <div className="flex flex-wrap gap-2">
                    {product.colours.map((colourItem, idx) => (
                      <div key={idx} className="flex flex-col items-center gap-1">
                        {colourItem.imageUrl && (
                          <div className="w-16 h-16 rounded border overflow-hidden">
                            <img src={colourItem.imageUrl} alt={colourItem.colour} className="w-full h-full object-cover" />
                          </div>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {colourItem.colour}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sizes */}
              {product.sizes.length > 0 && (
                <div className="mb-6">
                  <h2 className="font-semibold mb-3">Available Sizes</h2>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((size, idx) => (
                      <Badge key={idx} variant="outline">{size}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Guidance */}
              {product.guidanceBestFor && (
                <Card className="mb-4 border-green-200 bg-green-50">
                  <CardContent className="p-4 flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Best for</h3>
                      <p className="text-sm text-muted-foreground">{product.guidanceBestFor}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {product.guidanceNotIdealFor && (
                <Card className="mb-6 border-amber-200 bg-amber-50">
                  <CardContent className="p-4 flex items-start gap-3">
                    <XCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-semibold text-sm mb-1">Not ideal for</h3>
                      <p className="text-sm text-muted-foreground">{product.guidanceNotIdealFor}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* CTA */}
              <div className="flex gap-3">
                <Link href="/quote" className="flex-1">
                  <Button size="lg" className="w-full" data-testid="button-request-quote">
                    Request a Quote
                  </Button>
                </Link>
              </div>
            </div>
          </div>

          {/* Related Products */}
          {product.relatedProducts.length > 0 && (
            <div>
              <h2 className="text-2xl font-bold mb-6">Related Products</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {product.relatedProducts.map((relatedProduct) => (
                  <ProductCard key={relatedProduct.id} product={relatedProduct} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
