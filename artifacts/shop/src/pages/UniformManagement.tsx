import { Link } from 'wouter';

export default function UniformManagement() {
  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-gray-900 flex items-center justify-center overflow-hidden">
        <img
          src="https://www.selectuniforms.co.uk/wp-content/uploads/management-1x.jpg"
          alt="Uniform Management"
          className="absolute inset-0 w-full h-full object-cover opacity-40"
        />
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase text-center px-4">
          Uniform Management
        </h1>
      </section>

      {/* Intro */}
      <section className="py-16 container mx-auto px-4 max-w-4xl">
        <p className="text-lg text-gray-700 leading-relaxed mb-8">
          If you decide to use Select Branding Solutions as your uniform supplier you will find we are a lot different from any Supplier that you have used in the past. We have made many significant investments in our IT systems to ensure ordering your uniform and managing your uniform requirements is as easy as possible.
        </p>

        {/* Photo pair */}
        <div className="grid grid-cols-2 gap-4 mb-10">
          <img src="https://www.selectuniforms.co.uk/wp-content/uploads/management-1x.jpg" alt="Staff Uniform Management" className="w-full object-cover aspect-video" />
          <img src="https://www.selectuniforms.co.uk/wp-content/uploads/management-2x.jpg" alt="Work Wear Management" className="w-full object-cover aspect-video" />
        </div>

        <div className="space-y-6 text-lg text-gray-700 leading-relaxed mb-10">
          <p>
            We have many satisfied customers using our online database for managing their uniform requirements. One of the key benefits of our system is the ability to <strong>set annual spending limits</strong>. These can be set per employee, per department, per location or for the overall company. Your spend will never exceed your budget, year after year.
          </p>
          <p>
            Significant investments have been made to our IT systems and we have invested heavily to be able to offer a number of innovative solutions to manage the uniform issue, powered by the innovative Apparel Garment Management System. This includes full wearer size and your ordering history. We are able to generate stock forecasting, and bespoke reports, all available to you with your own log-in at your unique and personal bespoke section of our database.
          </p>
          <p>
            These systems allow us to despatch all orders complete in a timely manner, regardless of the size or complexity of the order.
          </p>
        </div>

        {/* Key features */}
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
