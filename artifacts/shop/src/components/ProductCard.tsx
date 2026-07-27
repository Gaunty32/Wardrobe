import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';

export function ProductCard({ product }: { product: any }) {
  // Simple card for the product grid
  const image = product.images?.[0] || product.image;
  
  return (
    <Link href={`/shop/product/${product.id}`} className="group block">
      <Card className="rounded-none border-none shadow-sm hover:shadow-md transition-shadow h-full flex flex-col">
        <div className="relative aspect-square overflow-hidden bg-gray-100">
          {image ? (
            <img 
              src={image} 
              alt={product.name} 
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400">No image</div>
          )}
          {product.onSale && (
            <span className="absolute top-2 right-2 bg-accent text-white text-xs font-bold px-2 py-1 uppercase">
              Sale
            </span>
          )}
        </div>
        <CardContent className="p-4 flex-1 flex flex-col">
          <h3 className="text-sm font-semibold text-gray-800 line-clamp-2 mb-2 group-hover:text-primary transition-colors">
            {product.name}
          </h3>
          <div className="mt-auto">
            {product.price ? (
              <p className="text-primary font-bold">£{Number(product.price).toFixed(2)} <span className="text-xs text-gray-500 font-normal">Ex. VAT</span></p>
            ) : (
              <p className="text-gray-500 text-sm">Price unavailable</p>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
