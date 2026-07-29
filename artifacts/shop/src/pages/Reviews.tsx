import { useSEO } from '@/hooks/useSEO';

export default function Reviews() {
  useSEO({
    title: 'Customer Reviews',
    description: 'Read what our customers say about Select Branding Solutions. Real reviews from businesses across the UK who trust us for their workwear and branded uniform needs.',
  });
  return (
    <div className="flex flex-col w-full min-h-[60vh]">
      <section className="relative h-48 bg-gray-900 flex items-center justify-center">
        <h1 className="text-4xl md:text-5xl font-extrabold text-white relative z-10 tracking-wider uppercase">
          Our Reviews
        </h1>
      </section>

      <section className="flex-1 py-16 container mx-auto px-4 text-center max-w-3xl">
        <h2 className="text-2xl font-bold text-primary mb-6">See what our customers say about us</h2>
        <p className="text-gray-600 mb-12">
          We pride ourselves on delivering excellent quality workwear and outstanding customer service.
        </p>
        
        {/* Placeholder for Trustpilot embed */}
        <div className="border border-gray-200 bg-gray-50 p-12 flex flex-col items-center justify-center">
          <div className="flex text-green-500 mb-4 gap-1">
            {/* Stars */}
            {[1, 2, 3, 4, 5].map(i => (
              <svg key={i} className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
              </svg>
            ))}
          </div>
          <h3 className="font-bold text-xl mb-2 text-gray-900">Excellent 4.9/5</h3>
          <p className="text-gray-500 text-sm">[ Trustpilot Widget Placeholder ]</p>
        </div>
      </section>
    </div>
  );
}
