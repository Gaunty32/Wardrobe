import { Link } from 'wouter';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { ShopProduct } from '@workspace/api-client-react';

interface ProductCardProps {
  product: ShopProduct;
}

export function ProductCard({ product }: ProductCardProps) {
  const priceDisplay = product.unitPrice > 0 
    ? `from £${product.unitPrice.toFixed(2)}` 
    : 'Price on request';

  return (
    <Link href={`/products/${product.id}`}>
      <Card className="overflow-hidden hover:shadow-lg transition-all duration-200 cursor-pointer h-full flex flex-col" data-testid={`card-product-${product.id}`}>
        <div className="aspect-square bg-muted relative overflow-hidden">
          {product.imageUrl ? (
            <img 
              src={product.imageUrl} 
              alt={product.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground">
              No image
            </div>
          )}
          {product.guidanceBadges.length > 0 && (
            <div className="absolute top-2 right-2 flex flex-col gap-1">
              {product.guidanceBadges.slice(0, 2).map((badge, idx) => (
                <Badge key={idx} variant="secondary" className="text-xs">
                  {badge}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <CardContent className="flex-1 p-4">
          <h3 className="font-semibold text-base mb-1 line-clamp-2" data-testid={`text-product-name-${product.id}`}>
            {product.name}
          </h3>
          {product.category && (
            <p className="text-xs text-muted-foreground mb-2">{product.category}</p>
          )}
          {product.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {product.description}
            </p>
          )}
          {product.colours.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap mt-2">
              <span className="text-xs text-muted-foreground">Colours:</span>
              {product.colours.slice(0, 5).map((colour, idx) => (
                <Badge key={idx} variant="outline" className="text-xs">
                  {colour}
                </Badge>
              ))}
              {product.colours.length > 5 && (
                <span className="text-xs text-muted-foreground">+{product.colours.length - 5}</span>
              )}
            </div>
          )}
        </CardContent>

        <CardFooter className="p-4 pt-0">
          <p className="text-lg font-semibold text-primary" data-testid={`text-price-${product.id}`}>
            {priceDisplay}
          </p>
        </CardFooter>
      </Card>
    </Link>
  );
}
