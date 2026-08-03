import { useEffect } from 'react';
import { useSEO } from '@/hooks/useSEO';

declare global {
  interface Window {
    NDRSL?: { init: (id: string) => void };
  }
}

const ENDORSAL_ID = '6399e7d386b265154e1a1515';

export default function Reviews() {
  useSEO({
    title: 'Customer Reviews',
    description: 'Read what our customers say about Select Branding Solutions. Real reviews from businesses across the UK who trust us for their workwear and branded uniform needs.',
  });

  useEffect(() => {
    // Load the Endorsal widget script once
    if (document.getElementById('endorsal-script')) {
      // Script already in DOM — just re-init if NDRSL is ready
      if (window.NDRSL) window.NDRSL.init(ENDORSAL_ID);
      return;
    }
    const script = document.createElement('script');
    script.id = 'endorsal-script';
    script.defer = true;
    script.src = 'https://d2oeplw15jeq9j.cloudfront.net/widgets/widget.min.js';
    script.onload = () => window.NDRSL?.init(ENDORSAL_ID);
    document.head.appendChild(script);
  }, []);

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative bg-primary py-14 sm:py-20 text-white text-center overflow-hidden">
        <div className="relative z-10 container mx-auto px-4">
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-wide uppercase mb-3">
            Our Reviews
          </h1>
          <p className="text-white/70 text-sm sm:text-base max-w-md mx-auto">
            Don't take our word for it — here's what UK businesses say about working with us.
          </p>
        </div>
      </section>

      {/* Endorsal widget */}
      <section className="py-12 bg-gray-50">
        <div className="container mx-auto px-4 max-w-6xl">
          <div id="ndrsl-widget" />
        </div>
      </section>

      {/* Write a review CTA */}
      <section className="py-12 bg-white border-t border-gray-100">
        <div className="container mx-auto px-4 text-center max-w-xl">
          <h2 className="text-xl font-bold text-gray-900 mb-2">Had a great experience?</h2>
          <p className="text-sm text-gray-600 mb-6">
            Your review helps other businesses find us and makes a real difference to our team.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <a
              href="https://www.google.com/maps/place/Select+Uniforms+-+Showroom/@53.8328195,-1.7171273,17z/data=!4m6!3m5!1s0x48795f52e0bbd22d:0xda5a1a52eba2b012!8m2!3d53.8328195!4d-1.7171273!16s%2Fg%2F1tgnr5by#lrd=0x48795f52e0bbd22d:0xda5a1a52eba2b012,1"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Leave a Google review
            </a>
            <a
              href="https://www.facebook.com/selectuniforms.co.uk/reviews"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              Leave a Facebook review
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
