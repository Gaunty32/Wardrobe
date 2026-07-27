import { Link } from 'wouter';
import { Facebook, Mail, Youtube } from 'lucide-react';
import { useGetShopSettings } from '@workspace/api-client-react';

export function TopBar() {
  const { data: settings } = useGetShopSettings();

  return (
    <div className="bg-topbar text-topbar-foreground text-xs py-2 hidden md:block">
      <div className="container mx-auto px-4 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <span>UK Delivery £8.50 Per Order</span>
          <span className="opacity-50">|</span>
          <span>Tel : {settings?.contactPhone || '0113 255 2694'}</span>
          <div className="flex items-center gap-3">
            <a href="#" className="hover:text-accent transition-colors"><Facebook className="w-4 h-4" /></a>
            <a href="#" className="hover:text-accent transition-colors"><Mail className="w-4 h-4" /></a>
            <a href="#" className="hover:text-accent transition-colors"><Youtube className="w-4 h-4" /></a>
          </div>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-semibold tracking-wider">
          <a href={settings?.portalUrl || '#'} className="hover:text-accent transition-colors">CORPORATE PORTAL</a>
          <a href="https://www.selectuniforms.co.uk/embroidery-portal/" className="hover:text-accent transition-colors" target="_blank" rel="noreferrer">EMBROIDERY PORTAL</a>
        </div>
      </div>
    </div>
  );
}
