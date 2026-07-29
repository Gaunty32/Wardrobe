import { Link } from 'wouter';
import { useGetShopSettings } from '@workspace/api-client-react';
import { useShopAuth } from '@/context/ShopAuthContext';

export function MainNav() {
  const { data: settings } = useGetShopSettings();
  const { isLoggedIn, customer } = useShopAuth();

  const displayName = customer
    ? (customer.first_name || customer.email.split('@')[0])
    : null;

  return (
    <nav className="bg-primary text-primary-foreground">
      <div className="container mx-auto px-4 flex flex-wrap items-center justify-between">
        <ul className="flex flex-wrap items-center text-sm font-semibold tracking-wide">

          {/* Our Company dropdown */}
          <li className="group relative">
            <button className="flex items-center gap-1 py-4 px-4 hover:bg-primary/90 transition-colors cursor-pointer">
              OUR COMPANY <span className="text-xs">▾</span>
            </button>
            <ul className="absolute left-0 top-full z-50 min-w-[200px] bg-white text-gray-800 shadow-lg border border-gray-200
                           hidden group-hover:block">
              <li>
                <Link href="/about"
                  className="block px-4 py-3 text-sm font-bold hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100 uppercase tracking-wide">
                  About Us
                </Link>
              </li>
              <li>
                <Link href="/personalisation"
                  className="block px-4 py-3 text-sm hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                  Personalisation
                </Link>
              </li>
              <li>
                <Link href="/on-site-measuring"
                  className="block px-4 py-3 text-sm hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                  On Site Measuring
                </Link>
              </li>
              <li>
                <Link href="/uniform-management"
                  className="block px-4 py-3 text-sm hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                  Uniform Management
                </Link>
              </li>
              <li>
                <Link href="/logo-conversions"
                  className="block px-4 py-3 text-sm hover:bg-gray-50 hover:text-primary transition-colors border-b border-gray-100">
                  Logo Conversions
                </Link>
              </li>
              <li>
                <Link href="/faq"
                  className="block px-4 py-3 text-sm hover:bg-gray-50 hover:text-primary transition-colors">
                  FAQs
                </Link>
              </li>
            </ul>
          </li>

          <li>
            <Link href="/products" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              SHOP
            </Link>
          </li>
          <li>
            <Link href="/bulk-buy-bundles" className="block py-4 px-4 hover:bg-primary/90 transition-colors relative flex items-center gap-2">
              BULK BUY & BUNDLES
              <span className="bg-accent text-white text-[10px] px-1.5 py-0.5 rounded-sm absolute -top-1 right-1 font-bold">SALE</span>
            </Link>
          </li>
          <li>
            <Link href="/reviews" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              OUR REVIEWS
            </Link>
          </li>
          <li>
            <Link href="/knowledge-centre" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              KNOWLEDGE CENTRE
            </Link>
          </li>
          <li>
            <Link href="/contact" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              CONTACT US
            </Link>
          </li>
          <li>
            <Link href="/faq" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              FAQ
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-4 py-4 text-sm font-semibold tracking-wide">
          {isLoggedIn ? (
            <Link href="/account" className="hover:text-gray-300 transition-colors">
              MY ACCOUNT{displayName ? ` (${displayName})` : ''}
            </Link>
          ) : (
            <Link href="/login" className="hover:text-gray-300 transition-colors">
              LOGIN
            </Link>
          )}
          <a
            href={settings?.portalUrl || '#'}
            className="hover:text-gray-300 transition-colors opacity-70 hover:opacity-100"
            title="Corporate Portal"
          >
            CORPORATE PORTAL
          </a>
        </div>
      </div>
    </nav>
  );
}
