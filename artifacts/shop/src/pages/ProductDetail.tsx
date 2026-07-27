import { useState, useMemo } from 'react';
import { useWcProduct } from '@/hooks/use-wc';
import { Link, useParams } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import { Heart } from 'lucide-react';

export default function ProductDetail() {
  const { id } = useParams();
  const { data: product, isLoading } = useWcProduct(id);
  const { addItem } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [mainImageIdx, setMainImageIdx] = useState(0);

  // Determine active variation
  const variation = useMemo(() => {
    if (!product?.variations || product.variations.length === 0) return null;
    
    // Find a variation that matches all selected options
    return product.variations.find((v: any) => {
      // v.attributes is [{name: 'Colour', option: 'Navy'}, ...]
      if (!v.attributes) return false;
      return v.attributes.every((attr: any) => 
        !selectedOptions[attr.name] || selectedOptions[attr.name] === attr.option
      );
    });
  }, [product, selectedOptions]);

  const handleOptionSelect = (name: string, option: string) => {
    setSelectedOptions(prev => ({ ...prev, [name]: option }));
  };

  const handleAddToCart = () => {
    if (!product) return;
    
    // If it's a variable product, ensure options are selected
    if (product.variations?.length > 0 && !variation) {
      alert('Please select all product options before adding to cart.');
      return;
    }

    const price = variation ? Number(variation.price) : Number(product.price);
    const sku = variation ? variation.sku : product.sku;
    const img = variation?.image || product.images?.[0];

    addItem({
      wcProductId: product.id,
      variationId: variation?.id,
      name: product.name,
      sku,
      price,
      quantity,
      image: img,
      colour: selectedOptions['Colour'] || selectedOptions['Color'] || null,
      size: selectedOptions['Size'] || null,
    });
    
    alert('Item added to cart');
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-8 w-64 mb-8" />
        <div className="flex flex-col md:flex-row gap-12">
          <div className="w-full md:w-1/2">
            <Skeleton className="aspect-square w-full rounded-none" />
          </div>
          <div className="w-full md:w-1/2 space-y-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return <div className="container mx-auto px-4 py-8 text-center">Product not found.</div>;
  }

  const currentPrice = variation ? Number(variation.price) : Number(product.price);
  const currentImage = variation?.image || product.images?.[mainImageIdx];
  const images = product.images || [];

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-8 font-medium">
        <Link href="/" className="hover:text-primary">HOME</Link>
        <span className="mx-2">/</span>
        <Link href="/shop" className="hover:text-primary">SHOP</Link>
        <span className="mx-2">/</span>
        <span className="text-gray-900 uppercase">{product.name}</span>
      </div>

      <div className="flex flex-col md:flex-row gap-12 mb-16">
        {/* Images */}
        <div className="w-full md:w-1/2">
          <div className="aspect-square bg-gray-100 mb-4 overflow-hidden relative">
            {currentImage ? (
              <img src={currentImage} alt={product.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">No Image</div>
            )}
            {product.onSale && (
              <span className="absolute top-4 left-4 bg-accent text-white text-xs font-bold px-3 py-1.5 uppercase rounded-full">
                Sale!
              </span>
            )}
          </div>
          {images.length > 1 && (
            <div className="grid grid-cols-4 gap-4">
              {images.map((img: string, idx: number) => (
                <button 
                  key={idx} 
                  onClick={() => setMainImageIdx(idx)}
                  className={`aspect-square border-2 ${mainImageIdx === idx ? 'border-primary' : 'border-transparent hover:border-gray-300'} transition-colors`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="w-full md:w-1/2">
          <h1 className="text-3xl font-extrabold text-primary mb-2">{product.name}</h1>
          <div className="text-2xl font-bold text-gray-900 mb-1">
            £{currentPrice.toFixed(2)}
          </div>
          <p className="text-sm text-gray-500 font-medium mb-6">Ex. VAT</p>

          {(variation?.sku || product.sku) && (
            <p className="text-sm text-gray-600 mb-6">SKU: <span className="font-mono">{variation?.sku || product.sku}</span></p>
          )}

          {product.shortDescription && (
            <div 
              className="prose prose-sm text-gray-600 mb-8"
              dangerouslySetInnerHTML={{ __html: product.shortDescription }}
            />
          )}

          {/* Attributes */}
          {product.attributes?.map((attr: any) => (
            <div key={attr.name} className="mb-6">
              <h4 className="text-sm font-bold text-gray-900 mb-3">{attr.name}</h4>
              <div className="flex flex-wrap gap-2">
                {attr.options.map((opt: string) => {
                  const isSelected = selectedOptions[attr.name] === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => handleOptionSelect(attr.name, opt)}
                      className={`px-4 py-2 text-sm border transition-colors ${
                        isSelected 
                          ? 'border-primary bg-primary text-white font-bold' 
                          : 'border-gray-300 text-gray-700 hover:border-gray-500 bg-white'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Add to cart block */}
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-8 pt-6 border-t border-gray-100">
            <div className="flex w-full sm:w-auto h-12 border border-gray-300">
              <button 
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-4 text-gray-500 hover:bg-gray-100 transition-colors"
              >-</button>
              <input 
                type="number" 
                value={quantity} 
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-16 text-center focus:outline-none font-bold"
                min="1"
              />
              <button 
                onClick={() => setQuantity(quantity + 1)}
                className="px-4 text-gray-500 hover:bg-gray-100 transition-colors"
              >+</button>
            </div>
            
            <Button 
              size="lg" 
              className="w-full sm:flex-1 h-12 rounded-none font-bold tracking-wider"
              onClick={handleAddToCart}
            >
              ADD TO CART
            </Button>
          </div>

          <button className="flex items-center gap-2 text-sm text-gray-600 hover:text-accent transition-colors">
            <Heart className="w-4 h-4" /> Add to Wishlist
          </button>
        </div>
      </div>

      {/* Description Tab */}
      {product.description && (
        <div className="border-t border-gray-200 pt-12 mt-12 mb-16">
          <div className="inline-block border-t-2 border-primary -mt-[2px] pt-4">
            <h3 className="text-xl font-bold text-gray-900">Description</h3>
          </div>
          <div 
            className="prose max-w-none text-gray-600 mt-6"
            dangerouslySetInnerHTML={{ __html: product.description }}
          />
        </div>
      )}
    </div>
  );
}
