import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSEO } from '@/hooks/useSEO';
import { useSubmitShopEnquiry } from '@workspace/api-client-react';
import { CheckCircle2, Tag, Award, Megaphone, Mail, Phone } from 'lucide-react';

interface TeamMember {
  name: string;
  role: string;
  photoUrl?: string | null;
  email?: string | null;
  phone?: string | null;
}

function TeamMemberAvatar({ member }: { member: TeamMember }) {
  const [failed, setFailed] = useState(false);
  if (!member.photoUrl || failed) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-primary/10 text-primary font-extrabold text-4xl">
        {member.name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={member.photoUrl}
      alt={member.name}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

const WHY_UNIFORM = [
  {
    icon: Megaphone,
    title: 'Promote Your Company or Brand',
    body: 'When employees wear uniforms displaying corporate logos and colours they help brand and differentiate their business in the markets they serve.',
  },
  {
    icon: Award,
    title: 'Have Pride in What You Wear',
    body: "Work uniforms help instil a sense of pride and responsibility and can convert employees into brand ambassadors.",
  },
  {
    icon: Tag,
    title: 'Get Free Advertising',
    body: "Well designed work uniforms worn in public become walking advertisement boards, promoting a company's products and services.",
  },
];

const BUSINESS_AREAS = ['Retail Direct', 'Corporate Management', 'Embroidery Partners'];

export default function AboutUs() {
  useSEO({
    title: 'About Us',
    description: 'Select Branding Solutions supply branded workwear and uniforms to businesses across the UK. In-house embroidery, on-site measuring, and bespoke uniform management systems.',
  });

  const { data: teamMembers = [] } = useQuery<TeamMember[]>({
    queryKey: ['team-members'],
    queryFn: () => fetch('/api/shop/team-members').then(r => r.json()),
    staleTime: 1000 * 60 * 15,
  });

  const submitEnquiry = useSubmitShopEnquiry();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', company: '', agreed: false });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitEnquiry.mutate(
      { data: { name: `${form.firstName} ${form.lastName}`.trim(), email: form.email, phone: form.phone, message: `Company: ${form.company} — Discovery Call request` } },
      {
        onSuccess: () => setSubmitted(true),
        onError: () => alert('Something went wrong. Please try again.'),
      }
    );
  };

  return (
    <div className="flex flex-col w-full">

      {/* ── Hero ── */}
      <section className="relative h-64 bg-gray-900 flex items-center justify-center overflow-hidden">
        <img
          src="https://www.selectuniforms.co.uk/wp-content/uploads/Uniforms-showroom.jpg"
          alt="Select Branding Solutions showroom"
          className="absolute inset-0 w-full h-full object-cover opacity-30 mix-blend-overlay"
        />
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider">
          ABOUT US
        </h1>
      </section>

      {/* ── Our Team ── */}
      {teamMembers.length > 0 && (
        <section className="py-16 bg-white">
          <div className="container mx-auto px-4 max-w-6xl">
            <h2 className="text-3xl font-bold text-center text-primary mb-2">Meet the Team</h2>
            <p className="text-center text-gray-500 mb-12">The people behind Select Branding Solutions.</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-10">
              {teamMembers.map((member, i) => (
                <div key={i} className="text-center group">
                  <div className="aspect-square bg-gray-100 mb-5 overflow-hidden rounded-full max-w-[200px] mx-auto border-4 border-gray-200 group-hover:border-primary transition-colors duration-300">
                    <TeamMemberAvatar member={member} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg">{member.name}</h3>
                  <p className="text-primary text-sm font-semibold mt-0.5 uppercase tracking-wide">{member.role}</p>
                  <div className="flex flex-col items-center gap-1.5 mt-3">
                    {member.email && (
                      <a
                        href={`mailto:${member.email}`}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-primary transition-colors text-sm"
                      >
                        <Mail className="w-3.5 h-3.5 shrink-0" />
                        {member.email}
                      </a>
                    )}
                    {member.phone && (
                      <a
                        href={`tel:${member.phone}`}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-primary transition-colors text-sm"
                      >
                        <Phone className="w-3.5 h-3.5 shrink-0" />
                        {member.phone}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Intro paragraphs ── */}
      <section className="py-16 container mx-auto px-4 max-w-4xl text-gray-700 leading-relaxed text-lg space-y-6">
        <p>
          We have many innovative systems in place to help our clients manage their uniform spend and uniform distribution.
          This is particularly useful for clients operating at multiple sites. We offer all clients the opportunity to use
          our web-based ordering system. This gives clients the opportunity to manage every aspect of the uniform issue,
          from wearer information to specific order history for different sites.
        </p>
        <p>
          We supply all of our workwear and uniforms in individually packaged wearerpacks, and we have unique methods of
          ensuring that your uniform issue is completely trouble free – all at no extra cost.
        </p>
        <p>
          We are committed to ethical sourcing which is why we ensure our garments are manufactured in factories that meet
          both SA800 Social Accountability Standards and ISO14000 environmental standards.
        </p>
      </section>

      {/* ── Our Business ── */}
      <section className="py-12 bg-primary text-white">
        <div className="container mx-auto px-4 max-w-4xl text-center">
          <h2 className="text-2xl font-bold tracking-wide mb-8 uppercase">Our Business</h2>
          <div className="flex flex-wrap justify-center gap-6">
            {BUSINESS_AREAS.map(area => (
              <span key={area} className="border border-white/60 px-8 py-3 text-sm font-semibold tracking-widest uppercase">
                {area}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Not Just a Uniform ── */}
      <section className="py-16 container mx-auto px-4 max-w-4xl">
        <h2 className="text-3xl font-extrabold text-gray-900 mb-6">Not just a Uniform!</h2>
        <div className="text-gray-700 leading-relaxed text-lg space-y-5">
          <p>
            As a business, your brand is one of your greatest assets. Your people represent this brand and create the
            first impression for your clients. How your people represent your brand should not be taken lightly.
            Providing uniform clothing not only promotes your brand in a professional manner, it also helps your staff
            feel part of the team.
          </p>
          <p>
            It is important to understand that the physical product we supply is secondary to the end result we will
            achieve for you. We will work with you to ensure your brand is promoted in the most efficient and cost
            effective way, whilst also being practical for its day to day use.
          </p>
          <p className="italic text-gray-500">
            If you are looking to simply purchase workwear as cheaply as possible then in all honesty we probably aren't
            the people for you. If you are looking to work with a professional company to enhance your brand in your
            marketplace using Corporate Clothing as a tool to achieve this – then let's talk!
          </p>
        </div>
      </section>

      {/* ── Why Have a Staff Uniform ── */}
      <section className="py-16 bg-gray-50 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-5xl">
          <h2 className="text-3xl font-bold text-center text-primary mb-4">Why Have a Staff Uniform</h2>
          <p className="text-center text-gray-500 mb-12">Staff Uniforms Create That Professional Business Image.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {WHY_UNIFORM.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white p-8 shadow-sm border border-gray-100 text-center hover:-translate-y-1 transition-transform">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-bold text-gray-900 mb-3">{title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Services grid ── */}
      <section className="py-16 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-6xl">
          <h2 className="text-3xl font-bold text-center text-primary mb-12">Our Services</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 text-center">
            {[
              { title: 'Personalisation', desc: 'In-house embroidery and heat seal printing facilities.' },
              { title: 'Uniform Management', desc: 'Bespoke online ordering portals for multi-site clients.' },
              { title: 'On Site Measuring', desc: 'We can visit your premises to ensure the perfect fit.' },
              { title: 'Logo Conversions', desc: 'Free digitization of your brand logo for our machines.' },
            ].map(({ title, desc }) => (
              <div key={title} className="bg-white p-8 shadow-sm hover:-translate-y-1 transition-transform border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-3">{title}</h3>
                <p className="text-sm text-gray-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── One Size Doesn't Fit All ── */}
      <section className="py-16 bg-primary text-white">
        <div className="container mx-auto px-4 max-w-3xl text-center space-y-6">
          <h2 className="text-3xl font-extrabold tracking-wide">One Size Doesn't Fit All</h2>
          <p className="text-white/85 text-lg leading-relaxed">
            No matter what business roles you are looking to cover, our vast range of uniforms cover them all — from
            Office Staff &amp; Management uniforms to Construction, Retail &amp; Hospitality Workwear.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            {['Office & Management', 'Construction', 'Retail', 'Hospitality', 'Healthcare', 'Education'].map(cat => (
              <span key={cat} className="border border-white/50 rounded-full px-4 py-1.5 text-sm font-medium">
                {cat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Book a Discovery Call ── */}
      <section className="py-16 border-t border-gray-200">
        <div className="container mx-auto px-4 max-w-2xl">
          <h2 className="text-3xl font-extrabold text-gray-900 mb-2 text-center">Book a Discovery Call</h2>
          <p className="text-center text-gray-500 mb-10">
            Leave your details and we'll send you instant demo access, then follow up to find a time that works.
          </p>

          {submitted ? (
            <div className="text-center py-12 space-y-3">
              <CheckCircle2 className="w-14 h-14 text-green-500 mx-auto" />
              <p className="text-xl font-bold text-gray-900">Thanks — we'll be in touch!</p>
              <p className="text-gray-500 text-sm">Check your inbox for demo access details.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
                  <input
                    required
                    value={form.firstName}
                    onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
                  <input
                    required
                    value={form.lastName}
                    onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company *</label>
                <input
                  required
                  value={form.company}
                  onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary"
                />
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  required
                  type="checkbox"
                  checked={form.agreed}
                  onChange={e => setForm(f => ({ ...f, agreed: e.target.checked }))}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-sm text-gray-600">
                  I agree to your T&amp;Cs and consent to having my data stored and collected *
                </span>
              </label>
              <button
                type="submit"
                disabled={submitEnquiry.isPending}
                className="w-full bg-primary text-white font-bold py-3 px-8 hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {submitEnquiry.isPending ? 'SENDING…' : 'BOOK MY DISCOVERY CALL'}
              </button>
            </form>
          )}
        </div>
      </section>

    </div>
  );
}
