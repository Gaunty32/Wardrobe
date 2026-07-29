import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

const LOGO_SAMPLES = [
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/7-800x333.png', alt: 'Embroidery sample' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/holmeswood-800x800.jpg', alt: 'Select Uniforms logo to embroidery conversion' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/bcc-800x800-1.jpg', alt: 'BCC logo embroidery' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/belvoir-800x800-1.jpg', alt: 'Belvoir logo embroidery' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/far-800x800-1.jpg', alt: 'FAR logo embroidery' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/SKILLS-800x800.jpg', alt: 'Skills logo embroidery' },
  { src: 'https://www.selectuniforms.co.uk/wp-content/uploads/LOCHS-800x800.jpg', alt: 'Lochs logo embroidery' },
];

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
        <p className="text-lg text-gray-700 leading-relaxed mb-8">
          Our in-house Design Service allows us to apply your choice of garment embellishment. Depending upon your requirements we can personalise your garments using our state of the art heatsealing or embroidery process. We can reproduce your supplied logo in to embroidery format. If you are looking for a new logo we can put you in touch with skilled designers who can help.
        </p>

        {/* Logo gallery */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 mb-10">
          {LOGO_SAMPLES.map((img, i) => (
            <a key={i} href={img.src} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden border border-gray-200 hover:border-primary transition-colors">
              <img src={img.src} alt={img.alt} width={400} height={400} loading="lazy" decoding="async" className="w-full h-full object-cover hover:scale-105 transition-transform duration-300" />
            </a>
          ))}
        </div>

        <p className="text-lg text-gray-700 leading-relaxed mb-6">
          Whatever your requirements — Company Name, Department Identification, Employee Names etc. — we are able to apply to your exact specification in the most appropriate manner. All we need is a JPEG of your design. Within a week you can expect a crisply embroidered sample, in up to twelve colours, ready for your approval.
        </p>

        <p className="text-lg text-gray-700 leading-relaxed mb-10">
          Once you have approved your embroidered sample we will complete your full order. Origination of your supplied design in embroidery format is £35.00 plus VAT. This is a once only cost as we reuse the design on any future orders. All prices include one free application charge of your logo.
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
