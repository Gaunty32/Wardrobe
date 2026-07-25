import { Link } from 'wouter';
import { Phone, Mail, MapPin } from 'lucide-react';
import { useGetShopSettings } from '@workspace/api-client-react';
import logoPath from '@assets/sbs-logo-transparent.png';

export function Footer() {
  const { data: settings } = useGetShopSettings();

  return (
    <footer className="border-t bg-muted/30 mt-auto">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <img src={logoPath} alt={settings?.businessName || 'SBS Shop'} className="h-10 mb-4" />
            {settings?.tagline && (
              <p className="text-sm text-muted-foreground mb-4">{settings.tagline}</p>
            )}
          </div>

          <div>
            <h3 className="font-semibold mb-4">Shop</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/products" className="text-muted-foreground hover:text-foreground transition-colors">
                  All Products
                </Link>
              </li>
              <li>
                <Link href="/quote" className="text-muted-foreground hover:text-foreground transition-colors">
                  Request Quote
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Company</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link href="/contact" className="text-muted-foreground hover:text-foreground transition-colors">
                  Contact Us
                </Link>
              </li>
              {settings?.portalUrl && (
                <li>
                  <a href={settings.portalUrl} className="text-muted-foreground hover:text-foreground transition-colors">
                    Customer Portal
                  </a>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4">Contact</h3>
            <ul className="space-y-3 text-sm">
              {settings?.contactPhone && (
                <li className="flex items-start gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{settings.contactPhone}</span>
                </li>
              )}
              {settings?.contactEmail && (
                <li className="flex items-start gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{settings.contactEmail}</span>
                </li>
              )}
              {settings?.address && (
                <li className="flex items-start gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{settings.address}</span>
                </li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-8 border-t text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} {settings?.businessName || 'Select Branding Solutions'}. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
