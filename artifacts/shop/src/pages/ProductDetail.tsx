import { useState, useMemo } from 'react';
import { useWcProduct } from '@/hooks/use-wc';
import { Link, useParams } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import { Heart, Star } from 'lucide-react';

// ── Colour → CSS map ──────────────────────────────────────────────────────────

const COLOUR_CSS: Record<string, string> = {
  'Black':           '#1a1a1a',
  'White':           '#f8f8f8',
  'Navy':            '#001f5b',
  'Navy Blue':       '#001f5b',
  'Royal':           '#4169e1',
  'Royal Blue':      '#4169e1',
  'Sky':             '#87ceeb',
  'Sky Blue':        '#87ceeb',
  'Baby Blue':       '#a8d5ea',
  'Bottle':          '#004d2c',
  'Bottle Green':    '#004d2c',
  'Forest':          '#228b22',
  'Forest Green':    '#228b22',
  'Lime':            '#32cd32',
  'Lime Green':      '#32cd32',
  'Olive':           '#6b7c3e',
  'Teal':            '#008080',
  'Burgundy':        '#6d1a2c',
  'Maroon':          '#6d0015',
  'Red':             '#cc1111',
  'Scarlet':         '#ff2400',
  'Orange':          '#e86830',
  'Yellow':          '#f5c800',
  'Gold':            '#d4a017',
  'Purple':          '#6a0dad',
  'Violet':          '#7f00ff',
  'Pink':            '#e8769e',
  'Hot Pink':        '#ff69b4',
  'Fuchsia':         '#c8175d',
  'Charcoal':        '#36454f',
  'Graphite':        '#474b4e',
  'Grey':            '#7d7d7d',
  'Gray':            '#7d7d7d',
  'Silver':          '#a8a9ad',
  'Light Grey':      '#c8c8c8',
  'Light Gray':      '#c8c8c8',
  'Stone':           '#b5a695',
  'Sand':            '#c2b280',
  'Khaki':           '#c3b091',
  'Cream':           '#fffdd0',
  'Natural':         '#f5f0e8',
  'Ecru':            '#c2b280',
  'Brown':           '#7b3f00',
  'Chocolate':       '#5a2d0c',
  'Tan':             '#d2b48c',
  'Caramel':         '#af6f09',
  'Copper':          '#b87333',
  'Terracotta':      '#c66b3d',
  'Coral':           '#ff7f50',
};

/** Detect if a hex colour is "light" so we can add a dark border */
function isLightColour(hex: string): boolean {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 170;
}

// ── Guidance sub-components ───────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { icon: string; bg: string; color: string }> = {
  'Most Popular':      { icon: '🏆', bg: '#1e3a5f', color: '#fff' },
  'Best Value':        { icon: '💰', bg: '#15803d', color: '#fff' },
  'Premium Choice':    { icon: '💎', bg: '#6d28d9', color: '#fff' },
  'New Arrival':       { icon: '🆕', bg: '#0369a1', color: '#fff' },
  'Best Seller':       { icon: '⭐', bg: '#b45309', color: '#fff' },
  'Eco Friendly':      { icon: '🌿', bg: '#166534', color: '#fff' },
  'Award Winner':      { icon: '🏅', bg: '#92400e', color: '#fff' },
  'Exclusive':         { icon: '✨', bg: '#831843', color: '#fff' },
  'Sale':              { icon: '🏷️', bg: '#991b1b', color: '#fff' },
  'Staff Pick':        { icon: '⭐', bg: '#92400e', color: '#fff' },
  'Bulk Buy Discount': { icon: '📦', bg: '#075985', color: '#fff' },
};

const TAG_CONFIG: Record<string, { icon: string; color: string; border: string }> = {
  'Everyday Workwear': { icon: '👕', color: '#1d4ed8', border: '#3b82f6' },
  'Smart Uniform':     { icon: '👔', color: '#7e22ce', border: '#a855f7' },
  'Heavy Duty':        { icon: '💪', color: '#c2410c', border: '#f97316' },
  'Budget Friendly':   { icon: '💲', color: '#15803d', border: '#22c55e' },
  'Premium':           { icon: '💎', color: '#6d28d9', border: '#8b5cf6' },
};

function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i < value ? 'fill-amber-400 text-amber-400' : 'fill-transparent text-amber-300'}`}
        />
      ))}
    </div>
  );
}

function GuidancePanel({ guidance }: { guidance: any }) {
  if (!guidance) return null;
  const { valueRating, durabilityRating, technicalRating, badges, tags, bestFor, notIdealFor } = guidance;
  const hasRatings  = valueRating > 0 || durabilityRating > 0 || technicalRating > 0;
  const hasBadges   = badges?.length > 0;
  const hasTags     = tags?.length > 0;
  const hasBestFor  = bestFor?.trim();
  const hasNIF      = notIdealFor?.trim();
  if (!hasRatings && !hasBadges && !hasTags && !hasBestFor && !hasNIF) return null;

  return (
    <div className="space-y-3 mb-6">
      {hasRatings && (
        <div className="rounded p-4 flex gap-6 flex-wrap" style={{ background: 'linear-gradient(135deg,#1e3a5f,#2d5491)' }}>
          {valueRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-1">Value for Money</div>
              <StarRating value={valueRating} />
              <div className="text-xs text-blue-200 mt-0.5">{valueRating} / 5</div>
            </div>
          )}
          {durabilityRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-1">Durability</div>
              <StarRating value={durabilityRating} />
              <div className="text-xs text-blue-200 mt-0.5">{durabilityRating} / 5</div>
            </div>
          )}
          {technicalRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-1">Technical Features</div>
              <StarRating value={technicalRating} />
              <div className="text-xs text-blue-200 mt-0.5">{technicalRating} / 5</div>
            </div>
          )}
        </div>
      )}

      {hasBadges && (
        <div className="flex flex-wrap gap-2">
          {badges.map((b: string) => {
            const cfg = BADGE_CONFIG[b] ?? { icon: '✔', bg: '#1e3a5f', color: '#fff' };
            return (
              <span key={b} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold"
                style={{ background: cfg.bg, color: cfg.color }}>
                {cfg.icon} {b}
              </span>
            );
          })}
        </div>
      )}

      {hasTags && (
        <div className="flex flex-wrap gap-2">
          {tags.map((t: string) => {
            const cfg = TAG_CONFIG[t] ?? { icon: '🏷', color: '#334155', border: '#94a3b8' };
            return (
              <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 bg-white"
                style={{ color: cfg.color, borderColor: cfg.border }}>
                {cfg.icon} {t}
              </span>
            );
          })}
        </div>
      )}

      {hasBestFor && (
        <div className="rounded overflow-hidden border border-green-200">
          <div className="bg-green-700 text-white px-3 py-2 text-sm font-bold flex items-center gap-2">✅ Best For</div>
          <div className="bg-white px-4 py-3">
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {bestFor.trim().split(/\r?\n/).filter(Boolean).map((line: string, i: number) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasNIF && (
        <div className="rounded overflow-hidden border border-orange-200">
          <div className="bg-red-700 text-white px-3 py-2 text-sm font-bold flex items-center gap-2">⚠️ Not Ideal For</div>
          <div className="bg-white px-4 py-3">
            <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
              {notIdealFor.trim().split(/\r?\n/).filter(Boolean).map((line: string, i: number) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Colour swatch ─────────────────────────────────────────────────────────────

function ColourSwatch({
  colour,
  isSelected,
  isAvailable = true,
  onClick,
}: {
  colour: string;
  isSelected: boolean;
  isAvailable?: boolean;
  onClick: () => void;
}) {
  const css  = COLOUR_CSS[colour];
  const light = css ? isLightColour(css) : false;

  if (!css) {
    // Fallback: text pill for unknown colours
    return (
      <button
        onClick={onClick}
        title={colour}
        className={`px-3 py-1.5 text-sm border-2 rounded-full transition-all font-medium ${
          isSelected
            ? 'border-primary bg-primary text-white'
            : isAvailable
              ? 'border-gray-300 text-gray-700 hover:border-primary bg-white'
              : 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
        }`}
      >
        {colour}
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      title={colour}
      aria-label={colour}
      className={`relative w-9 h-9 rounded-full transition-all flex items-center justify-center ${
        isSelected
          ? 'ring-2 ring-primary ring-offset-2'
          : 'hover:ring-2 hover:ring-gray-400 hover:ring-offset-1'
      } ${!isAvailable ? 'opacity-40 cursor-not-allowed' : ''}`}
      style={{
        background: css,
        border: light ? '1.5px solid #c8c8c8' : '1.5px solid transparent',
      }}
      disabled={!isAvailable}
    >
      {isSelected && (
        <span
          className="text-xs font-black leading-none"
          style={{ color: light ? '#333' : '#fff', textShadow: light ? 'none' : '0 1px 2px rgba(0,0,0,.4)' }}
        >
          ✓
        </span>
      )}
    </button>
  );
}

// ── Size pill ─────────────────────────────────────────────────────────────────

function SizePill({
  option,
  isSelected,
  isAvailable = true,
  onClick,
}: {
  option: string;
  isSelected: boolean;
  isAvailable?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm border-2 rounded-full transition-all font-medium min-w-[2.75rem] text-center ${
        isSelected
          ? 'border-primary bg-primary text-white'
          : isAvailable
            ? 'border-gray-300 text-gray-700 hover:border-primary bg-white'
            : 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed line-through'
      }`}
      disabled={!isAvailable}
      title={!isAvailable ? 'Out of stock' : undefined}
    >
      {option}
    </button>
  );
}

// ── Attribute label ───────────────────────────────────────────────────────────

/** Maps API attribute names to friendly display labels */
function attrLabel(name: string): string {
  const map: Record<string, string> = {
    Colour:  'Colour',
    Color:   'Colour',
    Size:    'Size',
    Sleeve:  'Sleeve',
  };
  return map[name] ?? name;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductDetail() {
  const { slug } = useParams();
  const { data: product, isLoading } = useWcProduct(slug);
  const { addItem } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [mainImageIdx, setMainImageIdx] = useState(0);
  const [addedMsg, setAddedMsg] = useState(false);

  // ── Build colour → image map from variations ──────────────────────────────
  const colourImages = useMemo(() => {
    const map: Record<string, string> = {};
    if (!product?.variations) return map;
    for (const v of product.variations) {
      if (!v.image) continue;
      const colourAttr = v.attributes?.find((a: any) => a.name === 'Colour' || a.name === 'Color');
      if (colourAttr && !map[colourAttr.option]) {
        map[colourAttr.option] = v.image;
      }
    }
    return map;
  }, [product]);

  // ── Active variation ──────────────────────────────────────────────────────
  const variation = useMemo(() => {
    if (!product?.variations?.length) return null;
    return product.variations.find((v: any) =>
      v.attributes?.every((attr: any) =>
        !selectedOptions[attr.name] || selectedOptions[attr.name] === attr.option
      )
    ) ?? null;
  }, [product, selectedOptions]);

  // ── Current main image ────────────────────────────────────────────────────
  const selectedColour = selectedOptions['Colour'] || selectedOptions['Color'];
  const colourImage = selectedColour ? colourImages[selectedColour] : null;
  const images: string[] = product?.images ?? [];
  const currentImage = colourImage || variation?.image || images[mainImageIdx] || null;

  // ── Availability helpers ──────────────────────────────────────────────────
  /** Is a given option available for the currently-selected other dimensions? */
  const isOptionAvailable = (attrName: string, option: string) => {
    if (!product?.variations?.length) return true;
    const testSelection = { ...selectedOptions, [attrName]: option };
    return product.variations.some((v: any) =>
      v.attributes?.every((a: any) =>
        !testSelection[a.name] || testSelection[a.name] === a.option
      ) && v.stockStatus === 'instock'
    );
  };

  const handleOptionSelect = (name: string, option: string) => {
    setSelectedOptions(prev => ({ ...prev, [name]: option }));
    // When colour changes, reset main image index
    if (name === 'Colour' || name === 'Color') setMainImageIdx(0);
  };

  const handleAddToCart = () => {
    if (!product) return;
    const attrs = product.attributes ?? [];
    const allSelected = attrs.every((a: any) => selectedOptions[a.name]);
    if (attrs.length > 0 && !allSelected) {
      const missing = attrs.filter((a: any) => !selectedOptions[a.name]).map((a: any) => attrLabel(a.name)).join(', ');
      alert(`Please select: ${missing}`);
      return;
    }
    const price = variation ? Number(variation.price) : Number(product.price);
    const sku   = variation ? variation.sku : product.sku;
    addItem({
      wcProductId: product.id,
      variationId: variation?.id ?? null,
      name: product.name,
      sku,
      price,
      quantity,
      image: currentImage,
      colour: selectedColour ?? null,
      size: selectedOptions['Size'] ?? null,
    });
    setAddedMsg(true);
    setTimeout(() => setAddedMsg(false), 2500);
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Skeleton className="h-5 w-48 mb-8" />
        <div className="flex flex-col md:flex-row gap-12">
          <div className="w-full md:w-1/2 space-y-4">
            <Skeleton className="aspect-square w-full rounded-none" />
            <div className="grid grid-cols-5 gap-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="aspect-square rounded-none" />)}
            </div>
          </div>
          <div className="w-full md:w-1/2 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return <div className="container mx-auto px-4 py-8 text-center text-gray-500">Product not found.</div>;
  }

  const currentPrice = variation ? Number(variation.price) : Number(product.price);
  const attrs: any[] = product.attributes ?? [];
  const colourAttr = attrs.find((a: any) => a.name === 'Colour' || a.name === 'Color');
  const otherAttrs = attrs.filter((a: any) => a.name !== 'Colour' && a.name !== 'Color');

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <div className="text-sm text-gray-500 mb-6 font-medium flex items-center gap-1 flex-wrap">
        <Link href="/" className="hover:text-primary">HOME</Link>
        <span>/</span>
        <Link href="/products" className="hover:text-primary">SHOP</Link>
        {product.categories?.[0] && (
          <>
            <span>/</span>
            <Link href={`/category/${product.categories[0].slug}`} className="hover:text-primary uppercase">
              {product.categories[0].name}
            </Link>
          </>
        )}
        <span>/</span>
        <span className="text-gray-900 uppercase">{product.name}</span>
      </div>

      <div className="flex flex-col md:flex-row gap-12 mb-16">
        {/* ── Images column ── */}
        <div className="w-full md:w-1/2">
          <div className="aspect-square bg-gray-100 mb-3 overflow-hidden relative border border-gray-200">
            {currentImage ? (
              <img src={currentImage} alt={product.name} className="w-full h-full object-contain p-2" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
            )}
            {product.onSale && (
              <span className="absolute top-3 left-3 bg-red-600 text-white text-xs font-bold px-2 py-1 uppercase">
                Sale!
              </span>
            )}
          </div>

          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2 mt-3">
              {images.slice(0, 10).map((img: string, idx: number) => {
                // Is this thumbnail the active one?
                const matchingColour = Object.entries(colourImages).find(([, url]) => url === img)?.[0];
                const isActive = matchingColour
                  ? selectedColour === matchingColour
                  : !colourImage && idx === mainImageIdx;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setMainImageIdx(idx);
                      if (matchingColour && colourAttr) {
                        // Auto-select the matching colour
                        setSelectedOptions(prev => ({ ...prev, [colourAttr.name]: matchingColour }));
                      } else {
                        setSelectedOptions({});
                      }
                    }}
                    className={`aspect-square border-2 overflow-hidden transition-all cursor-pointer hover:opacity-90 ${
                      isActive
                        ? 'border-primary'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                    title={matchingColour ?? `Image ${idx + 1}`}
                  >
                    <img src={img} alt={matchingColour ?? ''} className="w-full h-full object-contain p-1" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Details column ── */}
        <div className="w-full md:w-1/2">
          <h1 className="text-2xl font-extrabold text-primary mb-1">{product.name}</h1>

          <div className="text-2xl font-bold text-gray-900 mb-0.5">
            £{currentPrice.toFixed(2)}
          </div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-4">Ex. VAT</p>

          {(variation?.sku || product.sku) && (
            <p className="text-sm text-gray-500 mb-4">
              SKU: <span className="font-mono text-gray-700">{variation?.sku || product.sku}</span>
            </p>
          )}

          <GuidancePanel guidance={product.guidance} />

          {product.shortDescription && (
            <p className="text-sm text-gray-600 mb-6 leading-relaxed">{product.shortDescription}</p>
          )}

          {/* ── Colour swatches ── */}
          {colourAttr && (
            <div className="mb-5">
              <h4 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">
                {selectedColour
                  ? <>Colour: <span className="font-normal normal-case text-gray-600">{selectedColour}</span></>
                  : 'Colour'
                }
              </h4>
              <div className="flex flex-wrap gap-2">
                {colourAttr.options.map((colour: string) => (
                  <ColourSwatch
                    key={colour}
                    colour={colour}
                    isSelected={selectedOptions[colourAttr.name] === colour}
                    isAvailable={isOptionAvailable(colourAttr.name, colour)}
                    onClick={() => handleOptionSelect(colourAttr.name, colour)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Size / Sleeve / other attributes ── */}
          {otherAttrs.map((attr: any) => {
            const sel = selectedOptions[attr.name];
            return (
              <div key={attr.name} className="mb-5">
                <h4 className="text-sm font-bold text-gray-900 mb-3 uppercase tracking-wide">
                  {sel
                    ? <>{attrLabel(attr.name)}: <span className="font-normal normal-case text-gray-600">{sel}</span></>
                    : attrLabel(attr.name)
                  }
                </h4>
                <div className="flex flex-wrap gap-2">
                  {attr.options.map((opt: string) => (
                    <SizePill
                      key={opt}
                      option={opt}
                      isSelected={selectedOptions[attr.name] === opt}
                      isAvailable={isOptionAvailable(attr.name, opt)}
                      onClick={() => handleOptionSelect(attr.name, opt)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* Quantity + Add to cart */}
          <div className="flex items-stretch gap-3 mb-4 pt-4 border-t border-gray-200">
            <div className="flex border-2 border-gray-300 h-12">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 text-gray-600 hover:bg-gray-100 transition-colors font-bold text-lg"
              >−</button>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-12 text-center focus:outline-none font-bold text-sm border-x border-gray-300"
                min="1"
              />
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 text-gray-600 hover:bg-gray-100 transition-colors font-bold text-lg"
              >+</button>
            </div>

            <Button
              size="lg"
              className="flex-1 h-12 rounded-none font-bold tracking-wider uppercase text-sm"
              onClick={handleAddToCart}
            >
              {addedMsg ? '✓ Added to Cart' : 'Add to Cart'}
            </Button>
          </div>

          {addedMsg && (
            <p className="text-green-700 text-sm font-semibold mb-3">Item added to your cart!</p>
          )}

          <button className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 transition-colors">
            <Heart className="w-4 h-4" /> Add to Wishlist
          </button>
        </div>
      </div>

      {/* Description */}
      {product.description && (
        <div className="border-t border-gray-200 pt-10 mb-16">
          <div className="border-b-2 border-primary pb-1 inline-block mb-6">
            <h3 className="text-lg font-bold text-gray-900">Description</h3>
          </div>
          <div className="prose prose-sm max-w-none text-gray-600 whitespace-pre-line">
            {product.description}
          </div>
        </div>
      )}
    </div>
  );
}
