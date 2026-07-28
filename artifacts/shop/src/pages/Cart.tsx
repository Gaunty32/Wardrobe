import { useCart } from '@/context/CartContext';
import { Link, useLocation } from 'wouter';
import { X, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Palette } from 'lucide-react';

export default function Cart() {
  const { items, removeItem, updateQuantity, updateWearerName, subtotal } = useCart();
  const effectivePrice = (item: (typeof items)[number]) =>
    item.price + (item.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0);
  const [, setLocation] = useLocation();

  const shipping = 8.50;
  const vat = subtotal * 0.20;
  const total = subtotal + vat + shipping;

  return (
    <div className="container mx-auto px-4 py-12">
      {/* 3-step Breadcrumb */}
      <div className="flex items-center justify-center gap-4 mb-16 text-sm sm:text-base md:text-xl font-bold">
        <span className="text-gray-900">① SHOPPING CART</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">② CHECKOUT DETAILS</span>
        <span className="text-gray-300">→</span>
        <span className="text-gray-400">③ ORDER COMPLETE</span>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-500 mb-6 text-lg">Your basket is currently empty.</p>
          <Link href="/shop">
            <Button size="lg" className="rounded-none font-bold px-8">RETURN TO SHOP</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col lg:flex-row gap-12">
          {/* Cart Table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="py-4 font-bold text-gray-900"></th>
                  <th className="py-4 font-bold text-gray-900"></th>
                  <th className="py-4 font-bold text-gray-900">Product</th>
                  <th className="py-4 font-bold text-gray-900 text-center">Price</th>
                  <th className="py-4 font-bold text-gray-900 text-center">Quantity</th>
                  <th className="py-4 font-bold text-gray-900 text-right">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100">
                    <td className="py-6 pr-4 w-10">
                      <button 
                        onClick={() => removeItem(idx)}
                        className="w-6 h-6 rounded-full border border-gray-300 flex items-center justify-center text-gray-400 hover:text-accent hover:border-accent transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </td>
                    <td className="py-6 w-24">
                      {item.image && <img src={item.image} alt={item.name} className="w-16 h-16 object-cover border border-gray-200" />}
                    </td>
                    <td className="py-6 min-w-[200px]">
                      <Link href={`/shop/product/${item.wcProductId}`} className="font-bold text-primary hover:text-accent transition-colors">
                        {item.name}
                      </Link>
                      <div className="text-sm text-gray-500 mt-1">
                        {item.colour && <span>Color: {item.colour} </span>}
                        {item.size && <span>Size: {item.size}</span>}
                      </div>
                      {item.brandingPositions && item.brandingPositions.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {item.brandingPositions.map(p => (
                            <span key={p.id} className="inline-flex items-center gap-0.5 text-xs bg-blue-50 text-blue-700 border border-blue-200 px-1.5 py-0.5 rounded">
                              <Palette className="w-2.5 h-2.5" />
                              {p.name}{p.surcharge > 0 ? ` +£${p.surcharge.toFixed(2)}` : ''}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Wearer name */}
                      <div className="flex items-center gap-1.5 mt-2">
                        <User className="w-3 h-3 text-gray-400 shrink-0" />
                        <input
                          type="text"
                          value={item.wearerName ?? ''}
                          onChange={e => updateWearerName(idx, e.target.value)}
                          placeholder="Bulk (no name)"
                          className="text-xs border-b border-dashed border-gray-300 focus:border-primary focus:outline-none bg-transparent text-gray-600 placeholder-gray-400 w-40"
                        />
                      </div>
                    </td>
                    <td className="py-6 text-center text-gray-600">
                      <div>£{item.price.toFixed(2)}</div>
                      {(item.brandingPositions?.reduce((s, p) => s + p.surcharge, 0) ?? 0) > 0 && (
                        <div className="text-xs text-amber-700 mt-0.5">
                          +£{item.brandingPositions!.reduce((s, p) => s + p.surcharge, 0).toFixed(2)} branding
                        </div>
                      )}
                    </td>
                    <td className="py-6 text-center">
                      <div className="inline-flex h-10 border border-gray-300">
                        <button 
                          onClick={() => updateQuantity(idx, item.quantity - 1)}
                          className="px-3 text-gray-500 hover:bg-gray-100"
                        >-</button>
                        <input 
                          type="number" 
                          value={item.quantity} 
                          onChange={(e) => updateQuantity(idx, parseInt(e.target.value) || 1)}
                          className="w-12 text-center focus:outline-none"
                          min="1"
                        />
                        <button 
                          onClick={() => updateQuantity(idx, item.quantity + 1)}
                          className="px-3 text-gray-500 hover:bg-gray-100"
                        >+</button>
                      </div>
                    </td>
                    <td className="py-6 text-right font-bold text-primary">
                      £{(effectivePrice(item) * item.quantity).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Cart Totals */}
          <div className="w-full lg:w-[400px]">
            <div className="border border-gray-200 p-8">
              <h2 className="text-xl font-bold text-gray-900 mb-6 uppercase tracking-wide">Cart totals</h2>
              
              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">Subtotal</span>
                <span className="text-gray-600">£{subtotal.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">Shipping</span>
                <div className="text-right">
                  <span className="text-gray-600 block">Flat rate: £{shipping.toFixed(2)}</span>
                  <span className="text-xs text-gray-500">Shipping to UK.</span>
                </div>
              </div>

              <div className="flex justify-between py-4 border-b border-gray-100">
                <span className="font-bold text-gray-700">VAT (20%)</span>
                <span className="text-gray-600">£{vat.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between py-6">
                <span className="font-bold text-gray-900 text-lg">Total</span>
                <span className="font-bold text-primary text-xl">£{total.toFixed(2)}</span>
              </div>

              <Button 
                size="lg" 
                className="w-full rounded-none font-bold text-base h-14"
                onClick={() => setLocation('/checkout')}
              >
                PROCEED TO CHECKOUT
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
