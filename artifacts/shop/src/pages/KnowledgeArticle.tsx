import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Calendar } from 'lucide-react';
import { Link, useParams } from 'wouter';
import { useSEO } from '@/hooks/useSEO';

type Article = {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  link: string;
  slug: string;
  featuredImageUrl: string | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function KnowledgeArticle() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { data: article, isLoading, error } = useQuery<Article>({
    queryKey: ['knowledge-article', slug],
    queryFn: async () => {
      const response = await fetch(`/api/shop/blog-posts/${encodeURIComponent(slug)}`);
      if (!response.ok) throw new Error(response.status === 404 ? 'Article not found' : 'Article unavailable');
      return response.json();
    },
    retry: false,
    staleTime: 15 * 60 * 1000,
  });

  useSEO({
    title: article ? `${article.title} | Select Uniforms` : 'Knowledge Centre | Select Uniforms',
    description: article?.excerpt || 'Practical advice on workwear, uniforms and branded clothing.',
  });

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <main className="container mx-auto px-4 py-20 text-center">
        <BookOpen className="w-12 h-12 mx-auto mb-4 text-gray-300" />
        <h1 className="text-2xl font-bold text-gray-900">Article not found</h1>
        <p className="mt-2 text-gray-500">This Knowledge Centre article is not available.</p>
        <Link href="/knowledge-centre" className="inline-flex items-center gap-2 mt-6 font-semibold text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" /> Back to the Knowledge Centre
        </Link>
      </main>
    );
  }

  const paragraphs = article.content.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);

  return (
    <main className="bg-gray-50 py-10 sm:py-16">
      <article className="container mx-auto px-4 max-w-3xl">
        <Link href="/knowledge-centre" className="inline-flex items-center gap-2 mb-6 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft className="w-4 h-4" /> Knowledge Centre
        </Link>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          {article.featuredImageUrl && (
            <img
              src={article.featuredImageUrl}
              alt={article.title}
              className="w-full aspect-video object-cover"
              width={1200}
              height={675}
            />
          )}
          <div className="p-6 sm:p-10">
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <Calendar className="w-4 h-4" />
              {formatDate(article.date)}
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900">{article.title}</h1>
            <p className="mt-5 text-lg font-medium leading-relaxed text-gray-600">{article.excerpt}</p>
            <div className="mt-8 space-y-5 text-[1.05rem] leading-8 text-gray-700">
              {paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            </div>
          </div>
        </div>
      </article>
    </main>
  );
}