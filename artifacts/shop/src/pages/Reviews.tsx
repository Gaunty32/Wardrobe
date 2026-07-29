import { useQuery } from '@tanstack/react-query';
import { useSEO } from '@/hooks/useSEO';

const API = '/api';

interface Review {
  id: string;
  source: 'google' | 'facebook';
  author: string;
  authorPhoto?: string;
  rating: number;
  text: string;
  date: string;
}

function StarRating({ rating, size = 'md' }: { rating: number; size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} className={`${cls} ${i <= rating ? 'text-amber-400' : 'text-gray-200'} fill-current`} viewBox="0 0 24 24">
          <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
        </svg>
      ))}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const maxLen = 180;
  const text = review.text.length > maxLen ? review.text.slice(0, maxLen).trimEnd() + '…' : review.text;
  const initials = review.author.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex-shrink-0 w-72 sm:w-80 bg-white rounded-xl shadow-sm border border-gray-100 p-5 mx-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          {review.authorPhoto ? (
            <img src={review.authorPhoto} alt={review.author} width={36} height={36} loading="lazy"
              className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{review.author}</p>
            <p className="text-xs text-gray-400">
              {new Date(review.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
        <div className="flex-shrink-0 mt-0.5">
          {review.source === 'google' ? <GoogleIcon /> : <FacebookIcon />}
        </div>
      </div>

      {/* Stars */}
      <StarRating rating={review.rating} />

      {/* Text */}
      <p className="text-sm text-gray-700 leading-relaxed flex-1">{text}</p>
    </div>
  );
}

function ReviewRow({ reviews, reverse = false }: { reviews: Review[]; reverse?: boolean }) {
  // Duplicate to create seamless loop
  const doubled = [...reviews, ...reviews];
  const dir = reverse ? 'marquee-reverse' : 'marquee';

  return (
    <div
      className="flex overflow-hidden"
      style={{ maskImage: 'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)' }}
      onMouseEnter={e => (e.currentTarget.querySelector('[data-row]') as HTMLElement | null)?.style.setProperty('animation-play-state', 'paused')}
      onMouseLeave={e => (e.currentTarget.querySelector('[data-row]') as HTMLElement | null)?.style.setProperty('animation-play-state', 'running')}
    >
      <div
        data-row
        className={`flex animate-[${dir}_40s_linear_infinite]`}
        style={{ animationName: dir, animationDuration: `${Math.max(30, reviews.length * 8)}s`, animationTimingFunction: 'linear', animationIterationCount: 'infinite', animationDirection: reverse ? 'reverse' : 'normal' }}
      >
        {doubled.map((r, i) => <ReviewCard key={`${r.id}-${i}`} review={r} />)}
      </div>
    </div>
  );
}

function RatingSummary({ reviews }: { reviews: Review[] }) {
  const google = reviews.filter(r => r.source === 'google');
  const facebook = reviews.filter(r => r.source === 'facebook');
  const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) : 0;
  const fiveStarPct = reviews.length ? Math.round(reviews.filter(r => r.rating === 5).length / reviews.length * 100) : 0;

  return (
    <div className="flex flex-wrap justify-center gap-6 sm:gap-12">
      <div className="text-center">
        <div className="text-4xl font-extrabold text-primary">{avg.toFixed(1)}</div>
        <StarRating rating={Math.round(avg)} />
        <div className="text-xs text-gray-500 mt-1">{reviews.length} reviews</div>
      </div>
      {google.length > 0 && (
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <GoogleIcon />
            <span className="text-sm font-semibold text-gray-700">Google</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">
            {(google.reduce((s, r) => s + r.rating, 0) / google.length).toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">{google.length} reviews</div>
        </div>
      )}
      {facebook.length > 0 && (
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <FacebookIcon />
            <span className="text-sm font-semibold text-gray-700">Facebook</span>
          </div>
          <div className="text-2xl font-bold text-gray-800">
            {(facebook.reduce((s, r) => s + r.rating, 0) / facebook.length).toFixed(1)}
          </div>
          <div className="text-xs text-gray-500">{facebook.length} reviews</div>
        </div>
      )}
      {fiveStarPct > 0 && (
        <div className="text-center">
          <div className="text-4xl font-extrabold text-amber-500">{fiveStarPct}%</div>
          <div className="text-xs text-gray-500 mt-1">5-star ratings</div>
        </div>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex gap-6 overflow-hidden py-2">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex-shrink-0 w-72 sm:w-80 bg-gray-100 rounded-xl h-40 animate-pulse mx-3" />
      ))}
    </div>
  );
}

export default function Reviews() {
  useSEO({
    title: 'Customer Reviews',
    description: 'Read what our customers say about Select Branding Solutions. Real reviews from businesses across the UK who trust us for their workwear and branded uniform needs.',
  });

  const { data, isLoading, isError } = useQuery<{ reviews: Review[] }>({
    queryKey: ['shop-reviews'],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/reviews`);
      if (!res.ok) throw new Error('Failed to load reviews');
      return res.json();
    },
    staleTime: 6 * 60 * 60 * 1000, // 6 hours — matches server cache
  });

  const reviews = data?.reviews ?? [];

  // Split into two rows: odd indices on row 1, even on row 2 — mixes sources naturally
  const row1 = reviews.filter((_, i) => i % 2 === 0);
  const row2 = reviews.filter((_, i) => i % 2 !== 0);

  return (
    <>
      {/* Keyframe CSS */}
      <style>{`
        @keyframes marquee {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-reverse {
          0%   { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
      `}</style>

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

        {/* Rating summary */}
        {!isLoading && reviews.length > 0 && (
          <section className="py-10 bg-gray-50 border-b border-gray-200">
            <div className="container mx-auto px-4">
              <RatingSummary reviews={reviews} />
            </div>
          </section>
        )}

        {/* Scrolling carousel */}
        <section className="py-10 overflow-hidden bg-white">
          {isLoading ? (
            <div className="space-y-4 px-4">
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : isError || reviews.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm px-4">
              {isError
                ? 'Reviews are temporarily unavailable — please check back later.'
                : 'No reviews found. Connect Google Business Profile and Facebook in the order system settings.'}
            </div>
          ) : (
            <div className="space-y-5">
              {row1.length > 0 && <ReviewRow reviews={row1} />}
              {row2.length > 0 && <ReviewRow reviews={row2} reverse />}
            </div>
          )}
        </section>

        {/* Write a review CTA */}
        {reviews.length > 0 && (
          <section className="py-12 bg-gray-50 border-t border-gray-100">
            <div className="container mx-auto px-4 text-center max-w-xl">
              <h2 className="text-xl font-bold text-gray-900 mb-2">Had a great experience?</h2>
              <p className="text-sm text-gray-600 mb-6">
                Your review helps other businesses find us and makes a real difference to our team.
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                <a
                  href="https://search.google.com/local/writereview?placeid=ChIJ"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  <GoogleIcon /> Leave a Google review
                </a>
                <a
                  href="https://www.facebook.com/selectuniforms.co.uk/reviews"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  <FacebookIcon /> Leave a Facebook review
                </a>
              </div>
            </div>
          </section>
        )}
      </div>
    </>
  );
}
