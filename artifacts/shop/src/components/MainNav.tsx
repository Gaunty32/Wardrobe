import { Link } from 'wouter';
import { useGetShopSettings } from '@workspace/api-client-react';

export function MainNav() {
  const { data: settings } = useGetShopSettings();

  return (
    <nav className="bg-primary text-primary-foreground">
      <div className="container mx-auto px-4 flex flex-wrap items-center justify-between">
        <ul className="flex flex-wrap items-center text-sm font-semibold tracking-wide">
          <li className="group relative">
            <Link href="/about" className="block py-4 px-4 hover:bg-primary/90 transition-colors">
              OUR COMPANY ▾
            </Link>
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
        <div className="py-4">
          <a href={settings?.portalUrl || '#'} className="text-sm font-semibold tracking-wide hover:text-gray-300 transition-colors">
            LOGIN
          </a>
        </div>
      </div>
    </nav>
  );
}
