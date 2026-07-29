import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

const BASE = 'https://www.selectuniforms.co.uk/wp-content/uploads';

const IMAGES = [
  { src: `${BASE}/measuring-1x.jpg`, alt: 'Corporate clothing on site measuring' },
  { src: `${BASE}/measuring-2x.jpg`, alt: 'Workwear on site measuring' },
  { src: `${BASE}/measuring-3x.jpg`, alt: 'Uniform on site measuring' },
  { src: `${BASE}/measuring-4x.jpg`, alt: 'Staff clothing on site measuring' },
];

export default function OnSiteMeasuring() {
  useSEO({
    title: 'On Site Measuring',
    description: 'Our dedicated measuring team visits your premises to measure and fit every wearer. We achieve a 95%+ fit success rate — ensuring your uniform issue is accurate first time.',
  });
  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-gray-900 flex items-center justify-center overflow-hidden">
        <img
          src={IMAGES[0].src}
          alt="On site uniform measuring"
          width={1200} height={400}
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase text-center px-4">
          On Site Measuring
        </h1>
      </section>

      {/* ── Section 1: intro text (left) + photo 1 (right) ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-5 text-lg text-gray-700 leading-relaxed">
            <p>
              Does the job of obtaining all of your wearers' measurements daunt you? It can be a
              difficult and time consuming job. However, we have the simple answer to this question.
            </p>
            <p className="font-bold text-primary">
              Why not leave all of that to our vastly experienced and dedicated Measuring Team who will
              visit you on site and undertake this very important aspect of a uniform issue for you?
            </p>
          </div>
          <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100">
            <img
              src={IMAGES[0].src}
              alt={IMAGES[0].alt}
              width={662} height={497}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Section 2: photo 2 (left) + annual session text (right) ── */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100 order-last md:order-first">
              <img
                src={IMAGES[1].src}
                alt={IMAGES[1].alt}
                width={662} height={497}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-4 text-lg text-gray-700 leading-relaxed">
              <p>
                We offer all Customers the option of an Annual Measuring and Fitting session to ensure
                that your wearers' measurement details are up to date.
              </p>
              <p>
                Our Measuring Team will visit your premises and allow each wearer time to be measured
                and will also encourage them to try all garments for best fit. Because of holidays,
                sickness and absenteeism, we generally manage to measure around{' '}
                <strong>85% of your wearers</strong> at this session. This would leave you to obtain
                the measurements for any remaining wearers.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: fitting text (left) + photo 3 (right) ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-4 text-lg text-gray-700 leading-relaxed">
            <p>
              At the Measurement session each wearer, typically, will have around 20 minutes to try
              the garments for comfort and fit and will be able to discuss any specific requirements or
              concerns with the Measuring Team.
            </p>
            <p>
              Upon receipt of their personal Uniform Pack, issued to their correct measurement
              instructions, their uniform issue will be accurate and complete. We achieve a success
              rate for fit of <strong>over 95%</strong> — impressive results which bear out the success
              of the Measurement and Fitting Sessions!
            </p>
          </div>
          <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100">
            <img
              src={IMAGES[2].src}
              alt={IMAGES[2].alt}
              width={662} height={497}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Section 4: photo 4 (left) + closing quote (right) ── */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100 order-last md:order-first">
              <img
                src={IMAGES[3].src}
                alt={IMAGES[3].alt}
                width={662} height={497}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            <blockquote className="text-lg text-gray-800 leading-relaxed italic border-l-4 border-primary pl-5">
              Without a doubt, this system is the most efficient way of ensuring that all of your
              wearers are kitted out with a smart and presentable uniform that fits — first time. Your
              investment is protected and your requirement to have your Company image projected in the
              most cost efficient way is assured.
            </blockquote>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors">
          Book a Measuring Session
        </Link>
      </section>
    </div>
  );
}
