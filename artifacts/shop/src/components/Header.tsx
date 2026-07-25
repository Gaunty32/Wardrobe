import { Link } from 'wouter';
import { Search, ShoppingCart, Phone, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useGetShopSettings } from '@workspace/api-client-react';
import logoPath from '@assets/sbs-logo-transparent.png';

export function Header() {
  const { data: settings } = useGetShopSettings();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4">
        {/* Top bar */}
        <div className="flex h-12 items-center justify-between border-b text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            {settings?.contactPhone && (
              <div className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                <span>{settings.contactPhone}</span>
              </div>
            )}
            {settings?.contactEmail && (
              <div className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" />
                <span>{settings.contactEmail}</span>
              </div>
            )}
          </div>
          {settings?.portalUrl && (
            <Link href={settings.portalUrl} className="hover:text-foreground transition-colors">
              Customer Login
            </Link>
          )}
        </div>

        {/* Main header */}
        <div className="flex h-16 items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3">
            <img src={logoPath} alt={settings?.businessName || 'SBS Shop'} className="h-10" />
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link href="/" className="text-sm font-medium transition-colors hover:text-primary">
              Home
            </Link>
            <Link href="/products" className="text-sm font-medium transition-colors hover:text-primary">
              Products
            </Link>
            <Link href="/quote" className="text-sm font-medium transition-colors hover:text-primary">
              Request Quote
            </Link>
            <Link href="/contact" className="text-sm font-medium transition-colors hover:text-primary">
              Contact
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            <Link href="/quote">
              <Button size="sm" data-testid="button-quote-header">
                Get Quote
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
