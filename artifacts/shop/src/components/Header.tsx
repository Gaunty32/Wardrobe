import { Link, useLocation } from 'wouter';
import { Search, ShoppingBag } from 'lucide-react';
import { useGetShopSettings } from '@workspace/api-client-react';
import { useCart } from '@/context/CartContext';
import logoPath from '@assets/sbs-logo-transparent.png';
import { useState, useEffect, useRef } from 'react';

export function Header() {
  const { data: settings } = useGetShopSettings();
  const { itemCount, subtotal } = useCart();
  const [location, setLocation] = useLocation();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialise input from URL so it's pre-filled when landing on a search results page
  const urlSearch = new URLSearchParams(window.location.search).get('search') || '';
  const [search, setSearch] = useState(urlSearch);

  // Keep input in sync if URL changes externally (e.g. browser back/forward)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setSearch(params.get('search') || '');
  }, [location]);

  const navigate = (value: string) => {
    if (value.trim()) {
      setLocation(`/products?search=${encodeURIComponent(value.trim())}`);
    } else {
      // Clear search — go back to plain products listing
      setLocation('/products');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => navigate(value), 350);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    navigate(search);
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
