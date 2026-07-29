import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

// ── Add more logo URLs here — they'll appear automatically in the banner ──────
const LOGO_SAMPLES = [
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/7-800x333.png',           alt: 'Embroidery sample' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/holmeswood-800x800.jpg',  alt: 'Holmeswood Coaches' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/bcc-800x800-1.jpg',       alt: 'Birmingham City Council' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/belvoir-800x800-1.jpg',   alt: 'Belvoir Castle' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/far-800x800-1.jpg',       alt: 'Farnell' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/SKILLS-800x800.jpg',      alt: 'Skills' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/LOCHS-800x800.jpg',       alt: 'Lochs & Glens Holidays' },
];

// Duplicate for seamless loop
const SCROLLING = [...LOGO_SAMPLES, ...LOGO_SAMPLES];

export default function Personalisation() {
  useSEO({
    title: 'Personalisation & Embroidery Services',
    description: 'In-house embroidery and heatsealing on all workwear and uniforms. Send us your logo as a JPEG and receive an embroidered sample within a week. One-off digitisation fee of £35 + VAT.',
  });

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-gray-900 flex items-center justify-center overflow-hidden">
        <img
          src="https://www.selectuniforms.co.uk/wp-content/uploads/Uniforms-showroom.jpg"
          alt="Personalisation and embroidery services"
          width={1200} height={400}
          fetchPriority="high"
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase">
          Personalisation
        </h1>
      </section>

      {/* Intro */}
      <section className="py-16 container mx-auto px-4 max-w-4xl">
        <p className="text-lg text-gray-700 leading-relaxed mb-10">
          Our in-house Design Service allows us to apply your choice of garment embellishment. Depending upon your requirements
          we can personalise your garments using our state of the art heatsealing or embroidery process. We can reproduce your
          supplied logo in to embroidery format. If you are looking for a new logo we can put you in touch with skilled designers
          who can help.
        </p>

        {/* ── Scrolling logo banner ─────────────────────────────────────────── */}
        <div className="relative overflow-hidden mb-10 -mx-4 px-0">
          {/* Left/right fade masks */}
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

          <style>{`
            @keyframes logo-scroll {
              0%   { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .logo-track {
              display: flex;
              width: max-content;
              animation: logo-scroll 28s linear infinite;
            }
            .logo-track:hover {
              animation-play-state: paused;
            }
          `}</style>

          <div className="logo-track">
            {SCROLLING.map((img, i) => (
              <div
                key={i}
                className="shrink-0 w-44 h-36 mx-3 border border-gray-200 bg-white flex items-center justify-center overflow-hidden rounded"
              >
                <img
                  src={img.src}
                  alt={img.alt}
                  width={400}
                  height={400}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-contain p-3"
                />
              </div>
            ))}
          </div>
        </div>

        <p className="text-lg text-gray-700 leading-relaxed mb-6">
          Whatever your requirements — Company Name, Department Identification, Employee Names etc. — we are able to apply to your
          exact specification in the most appropriate manner. All we need is a JPEG of your design. Within a week you can expect a
          crisply embroidered sample, in up to twelve colours, ready for your approval.
        </p>

        <p className="text-lg text-gray-700 leading-relaxed mb-10">
          Once you have approved your embroidered sample we will complete your full order. Origination of your supplied design in
          embroidery format is £35.00 plus VAT. This is a once only cost as we reuse the design on any future orders. All prices
          include one free application charge of your logo.
        </p>

        {/* CTA */}
        <div className="flex flex-wrap gap-4">
          <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors">
            Get a Quote
          </Link>
          <Link href="/products" className="inline-block border-2 border-primary text-primary font-bold px-8 py-3 hover:bg-primary hover:text-white transition-colors">
            Shop Now
          </Link>
        </div>
      </section>
    </div>
  );
}
