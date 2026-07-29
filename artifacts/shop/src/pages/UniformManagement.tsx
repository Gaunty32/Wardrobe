import { Link } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

const BASE = 'https://www.selectuniforms.co.uk/wp-content/uploads';

export default function UniformManagement() {
  useSEO({
    title: 'Uniform Management System',
    description: 'Bespoke online uniform management portals for multi-site businesses. Set annual spend limits per employee, department or site. Full wearer size history and order tracking.',
  });
  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative bg-primary py-16 flex items-center justify-center overflow-hidden">
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase text-center px-4">
          Uniform Management
        </h1>
      </section>

      {/* ── Section 1: Intro text (left) + blob 1 (right) ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <p className="text-lg text-gray-700 leading-relaxed">
            If you decide to use Select Branding Solutions as your uniform supplier you will find we are a lot
            different from any Supplier that you have used in the past. We have made many significant investments
            in our IT systems to ensure ordering your uniform and managing your uniform requirements is as easy
            as possible.
          </p>
          <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100">
            <img
              src={`${BASE}/management-1x.jpg`}
              alt="1. Create an Attractive Business Image"
              width={662} height={497}
              fetchPriority="high"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Section 2: blob 2 (left) + spending limits text (right) ── */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100 order-last md:order-first">
              <img
                src={`${BASE}/management-2x.jpg`}
                alt="2. Promote Your Company or Brand"
                width={662} height={497}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-4 text-lg text-gray-700 leading-relaxed">
              <p>
                We have many satisfied customers using our online database for managing their uniform
                requirements. One of the key benefits of our system is the ability to{' '}
                <strong>set annual spending limits</strong>. These can be set per employee, per department,
                per location or for the overall company. Your spend will never exceed your budget, year after
                year.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Section 3: IT systems text (left) + blob 3 (right) ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
          <div className="space-y-4 text-lg text-gray-700 leading-relaxed">
            <p>
              Significant investments have been made to our IT systems and we have invested heavily to be
              able to offer a number of innovative solutions to manage the uniform issue, powered by the
              innovative Apparel Garment Management System. This includes full wearer size and your
              ordering history. We are able to generate stock forecasting, and bespoke reports, all
              available to you with your own log-in at your unique and personal bespoke section of our
              database.
            </p>
          </div>
          <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100">
            <img
              src={`${BASE}/management-3x.jpg`}
              alt="3. Manage the Uniform Issue"
              width={662} height={497}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Section 4: blob 4 (left) + dispatch text (right) ── */}
      <section className="py-12 bg-gray-50 border-t border-gray-100">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
            <div className="aspect-[4/3] overflow-hidden rounded-sm bg-gray-100 order-last md:order-first">
              <img
                src={`${BASE}/management-4x.jpg`}
                alt="4. Streamline Your Despatch"
                width={662} height={497}
                loading="lazy"
                decoding="async"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="space-y-4 text-lg text-gray-700 leading-relaxed">
              <p>
                These systems allow us to despatch all orders complete in a timely manner, regardless of
                the size or complexity of the order.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Key features ── */}
      <section className="py-12 container mx-auto px-4 max-w-5xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {[
            { title: 'Annual Spending Limits', desc: 'Set budgets per employee, department, location or company-wide.' },
            { title: 'Wearer Size Profiles', desc: 'Full size history for every wearer — no re-measuring needed each order.' },
            { title: 'Order History', desc: 'Complete record of every order, by wearer, department or site.' },
            { title: 'Bespoke Reports', desc: 'Stock forecasting and custom reports available via your secure log-in.' },
          ].map(({ title, desc }) => (
            <div key={title} className="border border-gray-200 p-5">
              <h3 className="font-bold text-primary mb-1">{title}</h3>
              <p className="text-sm text-gray-600">{desc}</p>
            </div>
          ))}
        </div>

        <div className="bg-primary/5 border-l-4 border-primary p-6 mb-10">
          <p className="text-base text-gray-800">
            To view a demonstration please visit{' '}
            <a href="https://www.select-logmein.co.uk" target="_blank" rel="noreferrer" className="text-primary font-semibold hover:underline">
              www.select-logmein.co.uk
            </a>{' '}
            and use the username <strong>demo</strong> and password <strong>demo</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-4">
          <Link href="/contact" className="inline-block bg-primary text-white font-bold px-8 py-3 hover:bg-primary/90 transition-colors">
            Talk to an Adviser
          </Link>
          <a
            href="https://wardrobe.selectbranding.co.uk"
            target="_blank"
            rel="noreferrer"
            className="inline-block border-2 border-primary text-primary font-bold px-8 py-3 hover:bg-primary hover:text-white transition-colors"
          >
            Corporate Portal
          </a>
        </div>
      </section>
    </div>
  );
}
