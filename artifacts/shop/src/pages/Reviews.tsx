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

// Deterministic colour per author name
const AVATAR_COLOURS = [
  '#E05C3A', '#2E7D32', '#1565C0', '#6A1B9A', '#AD1457',
  '#00838F', '#37474F', '#558B2F', '#4527A0', '#BF360C',
  '#00695C', '#283593', '#C62828', '#4E342E', '#1B5E20',
];
function avatarColour(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLOURS[h % AVATAR_COLOURS.length];
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <svg key={i} className={`w-4 h-4 ${i <= rating ? 'text-amber-400' : 'text-gray-200'} fill-current`} viewBox="0 0 24 24">
          <path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279-7.416-3.967-7.417 3.967 1.481-8.279-6.064-5.828 8.332-1.151z"/>
        </svg>
      ))}
    </div>
  );
}

function GoogleIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const colour = avatarColour(review.author);
  const ini = initials(review.author);
  const maxLen = 320;
  const text = review.text.length > maxLen
    ? review.text.slice(0, maxLen).trimEnd() + '…'
    : review.text;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4 break-inside-avoid mb-5">
      {/* Author header */}
      <div className="flex items-center gap-4">
        {review.authorPhoto ? (
          <img
            src={review.authorPhoto}
            alt={review.author}
            className="w-14 h-14 rounded-full object-cover flex-shrink-0"
          />
        ) : (
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0 select-none"
            style={{ backgroundColor: colour }}
          >
            {ini}
          </div>
        )}
        <div>
          <p className="font-semibold text-gray-900 text-base leading-tight">{review.author}</p>
          <StarRating rating={review.rating} />
        </div>
      </div>

      {/* Review text */}
      <p className="text-gray-700 text-sm leading-relaxed flex-1">
        "{text}"
      </p>

      {/* Platform attribution */}
      <div className="flex items-center gap-1.5 text-xs text-gray-400 pt-1 border-t border-gray-100">
        {review.source === 'google' ? (
          <>
            <GoogleIcon size={13} />
            <span>Google review</span>
          </>
        ) : (
          <>
            <FacebookIcon size={13} />
            <span>Facebook review</span>
          </>
        )}
      </div>
    </div>
  );
}

function RatingSummary({ reviews }: { reviews: Review[] }) {
  const google = reviews.filter(r => r.source === 'google');
  const facebook = reviews.filter(r => r.source === 'facebook');
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const fiveStarPct = reviews.length
    ? Math.round(reviews.filter(r => r.rating === 5).length / reviews.length * 100)
    : 0;

  return (
    <div className="flex flex-wrap justify-center gap-8 sm:gap-16">
      <div className="text-center">
        <div className="text-4xl font-extrabold text-primary">{avg.toFixed(1)}</div>
        <div className="flex justify-center mt-1">
          <StarRating rating={Math.round(avg)} />
        </div>
        <div className="text-xs text-gray-500 mt-1">{reviews.length} reviews</div>
      </div>
      {google.length > 0 && (
        <div className="text-center">
          <div className="flex items-center justify-center gap-1.5 mb-1">
            <GoogleIcon size={16} />
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
            <FacebookIcon size={16} />
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

function SkeletonGrid() {
  return (
    <div style={{ columns: '320px 3', gap: '1.25rem' }}>
      {[180, 220, 160, 240, 190, 170].map((h, i) => (
        <div
          key={i}
          className="bg-gray-100 rounded-2xl animate-pulse mb-5 break-inside-avoid"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

export default function Reviews() {
  useSEO({
    title: 'Customer Reviews',
    description: 'Read what our customers say about Select Branding Solutions. Real reviews from businesses across the UK who trust us for their workwear and branded uniform needs.',
  });

  const { data, isLoading, isError } = useQuery<{ reviews: Review[]; googleReviewUrl: string | null }>({
    queryKey: ['shop-reviews'],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/reviews`);
      if (!res.ok) throw new Error('Failed to load reviews');
      return res.json();
    },
    staleTime: 6 * 60 * 60 * 1000,
  });

  const reviews = data?.reviews ?? [];
  const googleReviewUrl = data?.googleReviewUrl ?? null;

  return (
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

      {/* Masonry grid */}
      <section className="py-12 bg-gray-50">
        <div className="container mx-auto px-4 max-w-6xl">
          {isLoading ? (
            <SkeletonGrid />
          ) : isError || reviews.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm">
              {isError
                ? 'Reviews are temporarily unavailable — please check back later.'
                : 'No reviews yet. Connect Google Business Profile and Facebook in the order system settings.'}
            </div>
          ) : (
            <div style={{ columns: '300px 3', gap: '1.25rem' }}>
              {reviews.map(r => <ReviewCard key={r.id} review={r} />)}
            </div>
          )}
        </div>
      </section>

      {/* Write a review CTA */}
      {reviews.length > 0 && (
        <section className="py-12 bg-white border-t border-gray-100">
          <div className="container mx-auto px-4 text-center max-w-xl">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Had a great experience?</h2>
            <p className="text-sm text-gray-600 mb-6">
              Your review helps other businesses find us and makes a real difference to our team.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {googleReviewUrl && (
                <a
                  href={googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  <GoogleIcon /> Leave a Google review
                </a>
              )}
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
  );
}
