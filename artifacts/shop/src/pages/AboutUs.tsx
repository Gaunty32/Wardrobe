import { Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';

interface TeamMember {
  name: string;
  role: string;
  photoUrl?: string | null;
}

export default function AboutUs() {
  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => fetch('/api/shop/team-members').then(r => r.json()),
    staleTime: 1000 * 60 * 15,
  });

  // Render real members if available, otherwise show nothing in that section
  const showTeam = teamMembers.length > 0;

  return (
    <div className="flex flex-col w-full">
      {/* Hero */}
      <section className="relative h-64 bg-gray-900 flex items-center justify-center">
        <img 
          src="https://www.selectuniforms.co.uk/wp-content/uploads/Uniforms-showroom.jpg" 
          alt="About Us" 
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay"
        />
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider">
          ABOUT US
        </h1>
      </section>

      {/* Content */}
      <section className="py-16 container mx-auto px-4 max-w-4xl text-gray-700 leading-relaxed text-lg space-y-8">
        <p>
          We have many innovative systems in place to help our clients manage their uniform spend and uniform distribution. This is particularly useful for clients operating at multiple sites. We offer all clients the opportunity to use our web-based ordering system. This gives clients the opportunity to manage every aspect of the uniform issue, from wearer information to specific order history for different sites.
        </p>
        <p>
          We supply all of our workwear and uniforms in individually packaged wearerpacks, and we have unique methods of ensuring that your uniform issue is completely trouble free – all at no extra cost.
        </p>
        <p>
          We are committed to ethical sourcing which is why we ensure our garments are manufactured in factories that meet both SA800 Social Accountability Standards and ISO14000 environmental standards.
        </p>
      </section>

      {/* Services grid */}
      <section className="py-16 bg-gray-50 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold text-center text-primary mb-12">Our Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 text-center">
            <div className="bg-white p-8 shadow-sm hover:-translate-y-1 transition-transform border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-3">Personalisation</h3>
              <p className="text-sm text-gray-600">In-house embroidery and heat seal printing facilities.</p>
            </div>
            <div className="bg-white p-8 shadow-sm hover:-translate-y-1 transition-transform border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-3">Uniform Management</h3>
              <p className="text-sm text-gray-600">Bespoke online ordering portals for multi-site clients.</p>
            </div>
            <div className="bg-white p-8 shadow-sm hover:-translate-y-1 transition-transform border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-3">On Site Measuring</h3>
              <p className="text-sm text-gray-600">We can visit your premises to ensure the perfect fit.</p>
            </div>
            <div className="bg-white p-8 shadow-sm hover:-translate-y-1 transition-transform border border-gray-100">
              <h3 className="font-bold text-gray-900 mb-3">Logo Conversions</h3>
              <p className="text-sm text-gray-600">Free digitization of your brand logo for our machines.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Team — only shown once members are configured */}
      {showTeam && (
        <section className="py-16">
          <div className="container mx-auto px-4 max-w-5xl">
            <h2 className="text-3xl font-bold text-center text-primary mb-12">Our Team</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {teamMembers.map((member, i) => (
                <div key={i} className="text-center group">
                  <div className="aspect-square bg-gray-200 mb-4 overflow-hidden rounded-full max-w-[200px] mx-auto border-4 border-transparent group-hover:border-primary transition-colors">
                    {member.photoUrl ? (
                      <img
                        src={member.photoUrl}
                        alt={member.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                        {member.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                    )}
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">{member.name}</h3>
                  <p className="text-accent text-sm font-semibold">{member.role}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
