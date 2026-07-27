import { Link, useLocation } from 'wouter';
import { Search, ShoppingBag } from 'lucide-react';
import { useGetShopSettings } from '@workspace/api-client-react';
import { useCart } from '@/context/CartContext';
import logoPath from '@assets/sbs-logo-transparent.png';
import { useState } from 'react';

export function Header() {
  const { data: settings } = useGetShopSettings();
  const { itemCount, subtotal } = useCart();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setLocation(`/products?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <header className="bg-white py-6 border-b border-border">
      <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Logo */}
        <Link href="/" className="block">
          <img src={logoPath} alt={settings?.businessName || 'SBS'} className="h-16 w-auto" />
        </Link>

        {/* Search */}
        <div className="flex-1 max-w-xl w-full">
          <form onSubmit={handleSearch} className="flex w-full relative">
            <input
              type="text"
              placeholder="Search for products"
              className="w-full border border-gray-300 px-4 py-2 focus:outline-none focus:border-primary"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button type="submit" className="absolute right-0 top-0 bottom-0 px-4 bg-primary text-white hover:bg-primary/90 transition-colors">
              <Search className="w-5 h-5" />
            </button>
          </form>
        </div>

        {/* Cart */}
        <Link href="/cart" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-semibold text-primary">£{subtotal.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{itemCount} items</div>
          </div>
          <div className="bg-primary text-white p-3">
            <ShoppingBag className="w-5 h-5" />
          </div>
        </Link>
      </div>
    </header>
  );
}
