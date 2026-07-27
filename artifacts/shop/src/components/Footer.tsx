import { Link } from 'wouter';
import { useGetShopSettings } from '@workspace/api-client-react';

export function Footer() {
  const { data: settings } = useGetShopSettings();

  return (
    <footer className="bg-white border-t border-gray-200 py-8">
      <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-gray-500 font-medium">
        <div className="flex flex-wrap items-center justify-center md:justify-start gap-4">
          <Link href="/about" className="hover:text-primary transition-colors">ABOUT US</Link>
          <Link href="/contact" className="hover:text-primary transition-colors">CONTACT US</Link>
          <Link href="/terms" className="hover:text-primary transition-colors">T&CS</Link>
          <Link href="/privacy" className="hover:text-primary transition-colors">PRIVACY</Link>
          <Link href="/cookie-policy" className="hover:text-primary transition-colors">COOKIE POLICY</Link>
          <a href={settings?.portalUrl || '#'} className="hover:text-primary transition-colors">CORPORATE PORTAL</a>
          <a href="https://www.selectuniforms.co.uk/embroidery-portal/" target="_blank" rel="noreferrer" className="hover:text-primary transition-colors">EMBROIDERY PORTAL</a>
        </div>
        
        <div className="flex flex-col items-center md:items-end gap-2 text-xs text-gray-400">
          <div>
            &copy; {new Date().getFullYear()} {settings?.businessName || 'Select Branding Solutions'} : {settings?.contactPhone || '0113 255 2694'}
          </div>
          <div className="flex gap-2 opacity-50">
            {/* simple placeholders for payment icons */}
            <div className="px-2 py-1 border rounded bg-gray-50">Stripe</div>
            <div className="px-2 py-1 border rounded bg-gray-50">Visa</div>
            <div className="px-2 py-1 border rounded bg-gray-50">Mastercard</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
