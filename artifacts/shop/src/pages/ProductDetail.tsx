import { useState, useMemo, useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';
import { useWcProduct, useBrandingOptions } from '@/hooks/use-wc';
import { proxyImageUrl } from '@/lib/imageProxy';
import { Link, useParams } from 'wouter';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useCart } from '@/context/CartContext';
import type { BrandingPosition } from '@/context/CartContext';
import { Heart, Star, Ruler, X, Tag, Palette, MessageSquare, Loader2, CheckCircle2, Send } from 'lucide-react';

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
  const { valueRating, durabilityRating, technicalRating, badges, tags, bestFor, notIdealFor, staffRecommendation, staffQuotes } = guidance;
  const hasRatings   = valueRating > 0 || durabilityRating > 0 || technicalRating > 0;
  const hasBadges    = badges?.length > 0;
  const hasTags      = tags?.length > 0;
  const hasBestFor   = bestFor?.trim();
  const hasNIF       = notIdealFor?.trim();
  // Prefer structured staff quotes (with photos) over legacy plain text field
  const quotesArr: { name: string; role: string; imageUrl: string | null; quote: string }[] =
    Array.isArray(staffQuotes) && staffQuotes.length > 0
      ? staffQuotes
      : (staffRecommendation?.trim() ? [{ name: '', role: '', imageUrl: null, quote: staffRecommendation.trim() }] : []);
  const hasStaffRec  = quotesArr.length > 0;
  if (!hasRatings && !hasBadges && !hasTags && !hasBestFor && !hasNIF && !hasStaffRec) return null;

  return (
    <div className="space-y-3 mb-6">
      {hasRatings && (
        <div className="rounded-2xl p-5 flex gap-6 flex-wrap shadow-sm" style={{ background: 'linear-gradient(135deg,#1e3a5f 0%,#2d5491 60%,#3a6bc4 100%)' }}>
          {valueRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-[11px] font-bold text-blue-200 uppercase tracking-widest mb-1.5">Value for Money</div>
              <StarRating value={valueRating} />
              <div className="text-xs text-blue-300 mt-1">{valueRating} / 5</div>
            </div>
          )}
          {durabilityRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-[11px] font-bold text-blue-200 uppercase tracking-widest mb-1.5">Durability</div>
              <StarRating value={durabilityRating} />
              <div className="text-xs text-blue-300 mt-1">{durabilityRating} / 5</div>
            </div>
          )}
          {technicalRating > 0 && (
            <div className="text-center flex-1 min-w-[90px]">
              <div className="text-[11px] font-bold text-blue-200 uppercase tracking-widest mb-1.5">Technical Features</div>
              <StarRating value={technicalRating} />
              <div className="text-xs text-blue-300 mt-1">{technicalRating} / 5</div>
            </div>
          )}
        </div>
      )}

      {hasBadges && (
        <div className="flex flex-wrap gap-2">
          {badges.map((b: string) => {
            const cfg = BADGE_CONFIG[b] ?? { icon: '✔', bg: '#1e3a5f', color: '#fff' };
            return (
              <span key={b} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold shadow-sm"
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
              <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border-2 bg-white shadow-sm"
                style={{ color: cfg.color, borderColor: cfg.border }}>
                {cfg.icon} {t}
              </span>
            );
          })}
        </div>
      )}

      {hasBestFor && (
        <div className="rounded-2xl border border-green-200 bg-green-50/50 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-green-200">
            <span className="text-base">✅</span>
            <span className="text-sm font-bold text-green-800">Best For</span>
          </div>
          <div className="px-4 py-3">
            <ul className="space-y-1.5 text-sm text-gray-700">
              {bestFor.trim().split(/\r?\n/).filter(Boolean).map((line: string, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 text-green-500 shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasNIF && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50/40 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-orange-200">
            <span className="text-base">⚠️</span>
            <span className="text-sm font-bold text-orange-800">Not Ideal For</span>
          </div>
          <div className="px-4 py-3">
            <ul className="space-y-1.5 text-sm text-gray-700">
              {notIdealFor.trim().split(/\r?\n/).filter(Boolean).map((line: string, i: number) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-0.5 text-orange-400 shrink-0">•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {hasStaffRec && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/50 overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-blue-200">
            <span className="text-[11px]">💬</span>
            <span className="text-xs font-bold text-blue-800 uppercase tracking-widest">Staff Recommendations</span>
          </div>
          <div className="divide-y divide-blue-100">
            {quotesArr.map((q, i) => {
              const proxyUrl = q.imageUrl
                ? `/api/shop/image-proxy?url=${encodeURIComponent(q.imageUrl)}`
                : null;
              return (
                <div key={i} className="px-5 py-5">
                  <div className="flex items-center gap-4 mb-3">
                    {/* Avatar — large */}
                    <div className="shrink-0 w-20 h-20 rounded-full overflow-hidden border-4 border-white shadow-md bg-primary/10 flex items-center justify-center">
                      {proxyUrl ? (
                        <>
                          <img src={proxyUrl} alt={q.name} className="w-full h-full object-cover object-top" loading="eager"
                            onError={e => {
                              (e.target as HTMLImageElement).style.display = 'none';
                              const sib = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                              if (sib) sib.style.display = 'flex';
                            }} />
                          <span style={{ display: 'none' }} className="w-full h-full items-center justify-center text-3xl font-bold text-primary">
                            {(q.name || '?')[0].toUpperCase()}
                          </span>
                        </>
                      ) : (
                        <span className="text-3xl font-bold text-primary">{(q.name || '?')[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div>
                      {q.name && <p className="font-bold text-gray-900 text-base leading-tight">{q.name}</p>}
                      {q.role && <p className="text-sm text-primary font-semibold mt-0.5">{q.role}</p>}
                    </div>
                  </div>
                  {/* Quote */}
                  <blockquote className="text-sm text-gray-700 leading-relaxed italic border-l-4 border-primary/40 pl-4 py-0.5">
                    "{q.quote}"
                  </blockquote>
                </div>
              );
            })}
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
    Sleeve:  'Length',
  };
  return map[name] ?? name;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProductDetail() {
  const { slug } = useParams();
  const { data: product, isLoading } = useWcProduct(slug);
  useSEO({
    title: product?.name ?? 'Workwear & Uniforms',
    description: product
      ? `Buy ${product.name} from Select Branding Solutions. Free logo application and in-house embroidery available. UK delivery from £8.50.`
      : undefined,
  });
  const { addItem, items, repriceProduct } = useCart();

  const [quantity, setQuantity] = useState(1);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [mainImageIdx, setMainImageIdx] = useState(0);
  const [addedMsg, setAddedMsg] = useState(false);
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
  const [selectedPositions, setSelectedPositions] = useState<BrandingPosition[]>([]);
  const [otherBrandingNotes, setOtherBrandingNotes] = useState('');
  const [wearerName, setWearerName] = useState('');
  const [enquiryOpen, setEnquiryOpen]   = useState(false);
  const [enquiryForm, setEnquiryForm]   = useState({ name: '', email: '', phone: '', message: '' });
  const [enquiryStatus, setEnquiryStatus] = useState<'idle'|'loading'|'success'|'error'>('idle');
  const [enquiryRef,   setEnquiryRef]   = useState('');

  // ── Branding options ───────────────────────────────────────────────────────
  // Use product-level override if set, otherwise fall back to global defaults.
  // override === null  → use global; override === [] → no branding for this product
  const { data: globalBrandingOptions = [] } = useBrandingOptions();
  const effectiveBrandingOptions: BrandingPosition[] =
    product?.brandingPositionsOverride != null
      ? product.brandingPositionsOverride
      : (globalBrandingOptions as BrandingPosition[]);

  // Pre-select free (non-notes) positions once options are known
  useEffect(() => {
    if (effectiveBrandingOptions.length > 0 && selectedPositions.length === 0) {
      setSelectedPositions(
        effectiveBrandingOptions.filter((p: BrandingPosition) => p.surcharge === 0 && !p.notes_field)
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBrandingOptions.length]);

  const togglePosition = (pos: BrandingPosition) => {
    setSelectedPositions(prev =>
      prev.some(p => p.id === pos.id)
        ? prev.filter(p => p.id !== pos.id)
        : [...prev, pos]
    );
    // When "Other" is unchecked, clear its notes
    if (pos.notes_field && selectedPositions.some(p => p.id === pos.id)) {
      setOtherBrandingNotes('');
    }
  };

  const totalBrandingSurcharge = selectedPositions.reduce((s, p) => s + p.surcharge, 0);

  // ── Pricing tiers ──────────────────────────────────────────────────────────
  const priceBreaks: { qty: number; price: number }[] = product?.priceBreaks ?? [];

  /** Total qty of this product already in the cart (all colours/sizes combined) */
  const cartQtyForProduct = useMemo(
    () => items.filter((i) => i.wcProductId === product?.id).reduce((s, i) => s + i.quantity, 0),
    [items, product?.id]
  );

  /** The applicable tier for (cartQtyForProduct + quantity being added) */
  const activeTier = useMemo(() => {
    if (!priceBreaks.length) return null;
    const totalQty = cartQtyForProduct + quantity;
    // Find highest tier whose min qty is ≤ totalQty
    return [...priceBreaks].reverse().find((t) => totalQty >= t.qty) ?? null;
  }, [priceBreaks, cartQtyForProduct, quantity]);

  /** Unit price after tier discount */
  const tierUnitPrice = activeTier?.price ?? null;

  /** When the active tier changes, reprice all existing cart lines for this product */
  useEffect(() => {
    if (!product) return;
    const newPrice = tierUnitPrice ?? (variation ? Number(variation.price) : Number(product.price));
    const cartHasItems = items.some((i) => i.wcProductId === product.id);
    if (cartHasItems) repriceProduct(product.id, newPrice);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTier]);

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
  // Hero always shows the primary product image (gallery index).
  // Colour-variant images are secondary — they appear as thumbnails only.
  const selectedColour = selectedOptions['Colour'] || selectedOptions['Color'];
  const colourImage = selectedColour ? colourImages[selectedColour] : null;
  const images: string[] = product?.images ?? [];
  const currentImage = images[mainImageIdx] || colourImage || variation?.image || null;

  // ── Availability helpers ──────────────────────────────────────────────────
  /** Is a given option available for the currently-selected other dimensions?
   *  We don't gate on stock status — this is a made-to-order shop. */
  const isOptionAvailable = (attrName: string, option: string) => {
    if (!product?.variations?.length) return true;
    const testSelection = { ...selectedOptions, [attrName]: option };
    return product.variations.some((v: any) =>
      v.attributes?.every((a: any) =>
        !testSelection[a.name] || testSelection[a.name] === a.option
      )
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
    const basePrice = variation ? Number(variation.price) : Number(product.price);
    // After adding this qty the new total may unlock a deeper tier — compute that
    const newTotal = cartQtyForProduct + quantity;
    const newTier = priceBreaks.length
      ? [...priceBreaks].reverse().find((t) => newTotal >= t.qty) ?? null
      : null;
    const price = newTier?.price ?? basePrice;
    const sku   = variation ? variation.sku : product.sku;

    // Attach "Other" notes to the relevant position before adding to cart
    const positionsWithNotes = selectedPositions.map(p =>
      p.notes_field ? { ...p, notes: otherBrandingNotes.trim() || undefined } : p
    );

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
      brandingPositions: positionsWithNotes,
      wearerName: wearerName.trim() || null,
    });

    // Reprice any existing lines for this product to match the new tier
    if (newTier) repriceProduct(product.id, price);

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

  const basePrice    = variation ? Number(variation.price) : Number(product.price);
  const currentPrice = tierUnitPrice ?? basePrice;
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
          <div className="aspect-square bg-gray-50 mb-3 overflow-hidden relative rounded-2xl border border-gray-200 shadow-sm">
            {currentImage ? (
              <img src={proxyImageUrl(currentImage) ?? ''} alt={product.name} className="w-full h-full object-contain p-4" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">No image</div>
            )}
            {product.onSale && (
              <span className="absolute top-3 left-3 bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase shadow-sm">
                Sale!
              </span>
            )}
          </div>

          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2 mt-3">
              {images.slice(0, 10).map((img: string, idx: number) => {
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
                        setSelectedOptions(prev => ({ ...prev, [colourAttr.name]: matchingColour }));
                      } else {
                        setSelectedOptions({});
                      }
                    }}
                    className={`aspect-square border-2 rounded-xl overflow-hidden transition-all cursor-pointer hover:opacity-90 ${
                      isActive
                        ? 'border-primary shadow-sm'
                        : 'border-gray-200 hover:border-gray-400'
                    }`}
                    title={matchingColour ?? `Image ${idx + 1}`}
                  >
                    <img src={proxyImageUrl(img) ?? ''} alt={matchingColour ?? ''} className="w-full h-full object-contain p-1" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Details column ── */}
        <div className="w-full md:w-1/2">
          <h1 className="text-2xl font-extrabold text-primary mb-1">{product.name}</h1>

          <div className="flex items-baseline gap-3 mb-0.5">
            <div className="text-2xl font-bold text-gray-900">
              £{currentPrice.toFixed(2)}
            </div>
            {tierUnitPrice && (
              <span className="text-sm font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                Bulk discount applied
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-4">Ex. VAT</p>

          {/* ── Pricing tiers table ── */}
          {priceBreaks.length > 0 && (
            <div className="mb-5 rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Quantity Pricing</span>
                {cartQtyForProduct > 0 && (
                  <span className="ml-auto text-xs text-gray-500">{cartQtyForProduct} already in basket</span>
                )}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {/* Base tier row */}
                  {(() => {
                    const firstBreakQty = priceBreaks[0].qty;
                    const baseTotalQty  = cartQtyForProduct + quantity;
                    const isBaseActive  = baseTotalQty < firstBreakQty;
                    return (
                      <tr className={isBaseActive ? 'bg-primary/5' : ''}>
                        <td className="px-3 py-2 text-gray-600">
                          1 – {firstBreakQty - 1} items
                        </td>
                        <td className="px-3 py-2 font-semibold text-right text-gray-900">
                          £{basePrice.toFixed(2)} each
                        </td>
                        <td className="w-6 pr-3 text-right">
                          {isBaseActive && <span className="text-primary text-xs font-bold">◀</span>}
                        </td>
                      </tr>
                    );
                  })()}
                  {priceBreaks.map((tier, i) => {
                    const nextTierQty   = priceBreaks[i + 1]?.qty;
                    const label         = nextTierQty ? `${tier.qty} – ${nextTierQty - 1} items` : `${tier.qty}+ items`;
                    const totalQty      = cartQtyForProduct + quantity;
                    const isActive      = activeTier?.qty === tier.qty;
                    const saving        = basePrice - tier.price;
                    return (
                      <tr key={tier.qty} className={isActive ? 'bg-green-50' : 'even:bg-gray-50/50'}>
                        <td className="px-3 py-2 text-gray-600">{label}</td>
                        <td className="px-3 py-2 font-semibold text-right text-gray-900">
                          £{tier.price.toFixed(2)} each
                          {saving > 0 && (
                            <span className="ml-2 text-xs text-green-700">save £{saving.toFixed(2)}</span>
                          )}
                        </td>
                        <td className="w-6 pr-3 text-right">
                          {isActive && <span className="text-green-600 text-xs font-bold">◀</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="px-3 py-2 text-xs text-gray-400 border-t border-gray-100 bg-gray-50">
                Mix colours &amp; sizes — the total quantity counts towards your discount.
              </p>
            </div>
          )}

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
            const isSizeAttr = attr.name === 'Size' || attr.name === 'size';
            return (
              <div key={attr.name} className="mb-5">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wide">
                    {sel
                      ? <>{attrLabel(attr.name)}: <span className="font-normal normal-case text-gray-600">{sel}</span></>
                      : attrLabel(attr.name)
                    }
                  </h4>
                  {isSizeAttr && product.sizeGuideHtml && (
                    <button
                      onClick={() => setSizeGuideOpen(true)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                    >
                      <Ruler className="w-3.5 h-3.5" />
                      Size Guide
                    </button>
                  )}
                </div>
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

          {/* ── Size guide modal ── */}
          {sizeGuideOpen && product.sizeGuideHtml && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
              onClick={() => setSizeGuideOpen(false)}
            >
              <div
                className="bg-white w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded shadow-xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                  <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <Ruler className="w-4 h-4 text-primary" />
                    Size Guide — {product.name}
                  </h3>
                  <button
                    onClick={() => setSizeGuideOpen(false)}
                    className="text-gray-400 hover:text-gray-700 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div
                  className="px-5 py-4 prose prose-sm max-w-none text-gray-700
                    [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm
                    [&_th]:bg-primary [&_th]:text-white [&_th]:px-3 [&_th]:py-2 [&_th]:text-left
                    [&_td]:border [&_td]:border-gray-200 [&_td]:px-3 [&_td]:py-1.5
                    [&_tr:nth-child(even)_td]:bg-gray-50"
                  dangerouslySetInnerHTML={{ __html: product.sizeGuideHtml }}
                />
              </div>
            </div>
          )}

          {/* ── Branding positions ── */}
          {effectiveBrandingOptions.length > 0 && (
            <div className="mb-5 rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
              <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Logo Positions</span>
                <span className="ml-2 text-xs text-gray-400">Select where your logo(s) will appear</span>
              </div>
              <div className="divide-y divide-gray-100">
                {effectiveBrandingOptions.map((opt) => {
                  const isSelected = selectedPositions.some(p => p.id === opt.id);
                  return (
                    <div key={opt.id}>
                      <label
                        className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => togglePosition(opt)}
                          className="w-4 h-4 rounded accent-primary flex-shrink-0"
                        />
                        <span className="text-sm text-gray-800 flex-1">{opt.name}</span>
                        {opt.notes_field ? (
                          <span className="text-xs text-gray-400">Priced separately</span>
                        ) : opt.surcharge === 0 ? (
                          <span className="text-xs text-green-700 font-medium bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                            Included
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-gray-600">
                            +£{opt.surcharge.toFixed(2)}<span className="font-normal text-gray-400">/item</span>
                          </span>
                        )}
                      </label>
                      {/* Notes input shown inline when "Other" is selected */}
                      {opt.notes_field && isSelected && (
                        <div className="px-10 pb-3">
                          <input
                            type="text"
                            value={otherBrandingNotes}
                            onChange={e => setOtherBrandingNotes(e.target.value)}
                            placeholder="Describe the position (e.g. centre back, left sleeve cuff)…"
                            className="w-full border border-gray-300 rounded h-9 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                            onClick={e => e.preventDefault()}
                          />
                          <p className="text-xs text-gray-400 mt-1">We'll confirm the price with you before processing.</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {totalBrandingSurcharge > 0 && (
                <div className="bg-amber-50 border-t border-amber-100 px-3 py-2.5 flex justify-between items-center">
                  <span className="text-sm text-amber-800 font-semibold">Branding surcharge</span>
                  <div className="text-right">
                    <div className="text-sm font-bold text-amber-900">+£{totalBrandingSurcharge.toFixed(2)} per item</div>
                    <div className="text-xs text-amber-700">
                      = £{(currentPrice + totalBrandingSurcharge).toFixed(2)} total per item ex. VAT
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Wearer name */}
          <div className="pt-4 border-t border-gray-100 mb-4">
            <label className="flex items-center gap-1.5 text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              Wearer name <span className="text-gray-400 normal-case font-normal tracking-normal">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={wearerName}
                onChange={e => setWearerName(e.target.value)}
                placeholder="Leave blank for bulk / enter a name"
                className="flex-1 border border-gray-200 rounded-xl h-10 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
              {wearerName.trim() && (
                <button
                  onClick={() => setWearerName('')}
                  className="px-3 h-10 border border-gray-200 rounded-xl text-xs text-gray-500 hover:bg-gray-100 transition-colors"
                >Bulk</button>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Used for packing and reporting only — the name is not printed or embroidered on the garment.
            </p>
          </div>

          {/* Quantity + Add to cart */}
          <div className="flex items-stretch gap-3 mb-4">
            <div className="flex border-2 border-gray-200 rounded-xl h-12 overflow-hidden">
              <button
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="px-3 text-gray-600 hover:bg-gray-100 transition-colors font-bold text-lg"
              >−</button>
              <input
                type="number"
                value={quantity}
                onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-12 text-center focus:outline-none font-bold text-sm border-x border-gray-200"
                min="1"
              />
              <button
                onClick={() => setQuantity(quantity + 1)}
                className="px-3 text-gray-600 hover:bg-gray-100 transition-colors font-bold text-lg"
              >+</button>
            </div>

            <Button
              size="lg"
              className="flex-1 h-12 rounded-xl font-bold tracking-wider uppercase text-sm"
              onClick={handleAddToCart}
            >
              {addedMsg ? '✓ Added to Basket' : 'Add to Basket'}
            </Button>
          </div>

          {addedMsg && (
            <p className="text-green-700 text-sm font-semibold mb-3">Item added to your basket!</p>
          )}

          <div className="flex items-center gap-4">
            <button className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-500 transition-colors">
              <Heart className="w-4 h-4" /> Add to Wishlist
            </button>
            <button
              onClick={() => { setEnquiryOpen(true); setEnquiryStatus('idle'); setEnquiryRef(''); }}
              className="flex items-center gap-2 text-sm text-primary font-semibold hover:text-accent transition-colors"
            >
              <MessageSquare className="w-4 h-4" /> Enquire about this product
            </button>
          </div>
        </div>
      </div>

      {/* ── Enquiry modal ──────────────────────────────────────────────────── */}
      {enquiryOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          onClick={e => { if (e.target === e.currentTarget) setEnquiryOpen(false); }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            {/* Header */}
            <div className="bg-primary px-6 py-4 flex items-center justify-between">
              <div>
                <p className="text-white font-bold text-base">Enquire about this product</p>
                {product && <p className="text-white/70 text-xs mt-0.5 truncate">{product.name}</p>}
              </div>
              <button onClick={() => setEnquiryOpen(false)} className="text-white/70 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6">
              {enquiryStatus === 'success' ? (
                <div className="text-center py-4 space-y-3">
                  <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-7 h-7 text-green-600" />
                  </div>
                  <p className="font-bold text-gray-900 text-lg">Enquiry sent!</p>
                  <p className="text-sm text-gray-500">We'll be in touch shortly. Check your inbox for a confirmation.</p>
                  {enquiryRef && <p className="text-xs text-gray-400">Reference: {enquiryRef}</p>}
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() => setEnquiryOpen(false)}
                  >Close</Button>
                </div>
              ) : (
                <form
                  onSubmit={async e => {
                    e.preventDefault();
                    setEnquiryStatus('loading');
                    try {
                      const res = await fetch('/api/shop/product-enquiry', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          productId:   product?.id ?? null,
                          productName: product?.name ?? null,
                          productUrl:  window.location.href,
                          name:    enquiryForm.name,
                          email:   enquiryForm.email,
                          phone:   enquiryForm.phone || null,
                          message: enquiryForm.message,
                          source:  'product_page',
                        }),
                      });
                      if (!res.ok) throw new Error('Failed');
                      const data = await res.json();
                      setEnquiryRef(data.referenceNumber ?? '');
                      setEnquiryStatus('success');
                    } catch {
                      setEnquiryStatus('error');
                    }
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Your name *</label>
                      <input
                        required
                        value={enquiryForm.name}
                        onChange={e => setEnquiryForm(p => ({ ...p, name: e.target.value }))}
                        placeholder="Jane Smith"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-600 mb-1">Phone</label>
                      <input
                        value={enquiryForm.phone}
                        onChange={e => setEnquiryForm(p => ({ ...p, phone: e.target.value }))}
                        placeholder="07700 900000"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Email address *</label>
                    <input
                      type="email"
                      required
                      value={enquiryForm.email}
                      onChange={e => setEnquiryForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="jane@company.com"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Message *</label>
                    <textarea
                      required
                      rows={4}
                      value={enquiryForm.message}
                      onChange={e => setEnquiryForm(p => ({ ...p, message: e.target.value }))}
                      placeholder={`I'm interested in the ${product?.name ?? 'this product'} and would like to know…`}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
                    />
                  </div>
                  {enquiryStatus === 'error' && (
                    <p className="text-xs text-red-600">Something went wrong — please try again.</p>
                  )}
                  <Button
                    type="submit"
                    disabled={enquiryStatus === 'loading'}
                    className="w-full gap-2"
                  >
                    {enquiryStatus === 'loading'
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                      : <><Send className="w-4 h-4" /> Send enquiry</>
                    }
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

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
