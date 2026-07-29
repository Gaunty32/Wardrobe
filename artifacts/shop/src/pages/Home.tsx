import { Link } from 'wouter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shirt, Handshake, TrendingUp } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useShopImages } from '@/hooks/use-wc';
import { useSEO } from '@/hooks/useSEO';

const SLIDE_COPY = [
  {
    title: 'Staff Uniforms Create That Professional Business Image',
    subtitle: 'People do judge you by the way you dress, so make sure your team looks the part with our high-quality workwear.',
  },
  {
    title: 'Helping You Find The Perfect Fit',
    subtitle: 'Quality uniforms tailored to your business needs, ensuring comfort and durability all day long.',
  },
  {
    title: 'Free Logo Application On All Garments',
    subtitle: 'Stand out from the crowd with our professional embroidery and printing services included on all items.',
  },
];

// Category slug → display label + fallback image
const CATEGORY_CONFIG: { slug: string; label: string; match: string; fallback: string }[] = [
  { slug: 'polos',       label: 'Polo Shirts',   match: 'polo',       fallback: 'https://www.selectuniforms.co.uk/wp-content/uploads/Polo-shirts-category.jpg' },
  { slug: 'sweatshirts', label: 'Sweatshirts',   match: 'sweatshirt', fallback: 'https://www.selectuniforms.co.uk/wp-content/uploads/Sweatshirts-category.jpg' },
  { slug: 'jackets',     label: 'Jackets',       match: 'jacket',     fallback: 'https://www.selectuniforms.co.uk/wp-content/uploads/Jackets-category.jpg' },
  { slug: 'trousers',    label: 'Trousers',      match: 'trouser',    fallback: 'https://www.selectuniforms.co.uk/wp-content/uploads/Trousers-category.jpg' },
];

export default function Home() {
  useSEO({
    title: 'Workwear & Branded Uniforms',
    description: 'UK supplier of high-quality workwear and branded uniforms. Free logo application on all garments, in-house embroidery, on-site measuring and bespoke uniform management portals.',
  });
  const [currentSlide, setCurrentSlide] = useState(0);
  const { data: shopImages } = useShopImages();

  // Pick 3 distinct hero images from the featured list
  const heroImages: string[] = (() => {
    const featured = shopImages?.featured ?? [];
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const img of featured) {
      if (!seen.has(img.url)) { seen.add(img.url); picked.push(img.url); }
      if (picked.length === 3) break;
    }
    return picked;
  })();

  // Pick best image per category by fuzzy-matching category name
  const categoryImages = CATEGORY_CONFIG.map(cfg => {
    const byCategory = shopImages?.byCategory ?? {};
    // Find a category key that contains the match string
    const matchKey = Object.keys(byCategory).find(k => k.toLowerCase().includes(cfg.match));
    const url = (matchKey && byCategory[matchKey]?.[0]?.url) ?? cfg.fallback;
    return { ...cfg, url };
  });

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % SLIDE_COPY.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="flex flex-col w-full">
      {/* Hero Slider */}
      <section className="relative h-[600px] w-full overflow-hidden bg-gray-900">
        {SLIDE_COPY.map((slide, index) => {
          const imgSrc = heroImages[index] ?? heroImages[0] ?? null;
          return (
            <div
              key={index}
              className={`absolute inset-0 transition-opacity duration-1000 ${
                index === currentSlide ? 'opacity-100 z-10' : 'opacity-0 z-0'
              }`}
            >
              {imgSrc && (
                <img
                  src={imgSrc}
                  alt={slide.title}
                  className="absolute inset-0 w-full h-full object-cover opacity-50"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-gray-900/80 via-gray-900/50 to-transparent" />
              <div className="container mx-auto px-4 h-full flex flex-col justify-center max-w-4xl relative z-20 pt-20">
                <h1 className="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight">
                  {slide.title}
                </h1>
                <p className="text-lg md:text-xl text-gray-200 mb-8 max-w-2xl font-light">
                  {slide.subtitle}
                </p>
                <div>
                  <Link href="/shop">
                    <Button size="lg" className="bg-primary hover:bg-primary/90 text-white rounded-none px-8 font-semibold uppercase tracking-widest">
                      SHOP NOW
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          );
        })}
        {/* Slider dots */}
        <div className="absolute bottom-6 left-0 right-0 z-20 flex justify-center gap-2">
          {SLIDE_COPY.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`w-3 h-3 rounded-full transition-colors ${
                idx === currentSlide ? 'bg-white' : 'bg-white/40'
              }`}
            />
          ))}
        </div>
      </section>

      {/* 3 USP boxes */}
      <section className="relative -mt-16 z-30 mb-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="rounded-none border-none shadow-xl bg-white text-center hover:-translate-y-1 transition-transform duration-300">
              <CardContent className="pt-10 pb-8 px-6">
                <Shirt className="w-12 h-12 mx-auto text-accent mb-6" />
                <h3 className="font-bold text-gray-900 mb-4 text-lg">PROMOTE YOUR COMPANY OR BRAND</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  A branded uniform makes your team easily identifiable and promotes a cohesive, professional look that builds trust with your customers.
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-none border-none shadow-xl bg-white text-center hover:-translate-y-1 transition-transform duration-300">
              <CardContent className="pt-10 pb-8 px-6">
                <Handshake className="w-12 h-12 mx-auto text-accent mb-6" />
                <h3 className="font-bold text-gray-900 mb-4 text-lg">HAVE PRIDE IN WHAT YOU WEAR</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  When employees wear high-quality, comfortable workwear, it boosts morale and fosters a sense of pride and belonging within the team.
                </p>
              </CardContent>
            </Card>
            <Card className="rounded-none border-none shadow-xl bg-white text-center hover:-translate-y-1 transition-transform duration-300">
              <CardContent className="pt-10 pb-8 px-6">
                <TrendingUp className="w-12 h-12 mx-auto text-accent mb-6" />
                <h3 className="font-bold text-gray-900 mb-4 text-lg">GET FREE ADVERTISING</h3>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Every time your staff are out and about, your branded uniform acts as a walking advertisement, increasing brand awareness at no extra cost.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Impression section */}
      <section className="py-12 bg-white">
        <div className="container mx-auto px-4 text-center max-w-5xl">
          <h2 className="text-3xl font-extrabold text-primary mb-6">Helping You Make The Right Impression</h2>
          <p className="text-gray-600 mb-12 max-w-3xl mx-auto">
            We are one of the UK's leading suppliers of branded workwear, uniforms, and promotional clothing. With years of experience and a commitment to quality, we ensure your team always looks their best.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {categoryImages.map(cat => (
              <Link key={cat.slug} href={`/category/${cat.slug}`} className="group relative block h-64 overflow-hidden bg-gray-200">
                <img
                  src={cat.url}
                  alt={cat.label}
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/50 transition-colors" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <h3 className="text-white text-2xl font-bold uppercase tracking-wider bg-black/50 px-6 py-3 border-2 border-white">
                    {cat.label}
                  </h3>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
