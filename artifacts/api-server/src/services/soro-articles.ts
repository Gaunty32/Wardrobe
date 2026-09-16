const SORO_RSS_URL = "https://app.trysoro.com/api/rss/1b527f8f-3e3b-4f34-b01e-a781b4388ec6";
const SELECT_UNIFORMS_HOST = "selectuniforms.co.uk";
const CACHE_TTL_MS = 15 * 60 * 1000;

export type SoroArticle = {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  date: string;
  link: string;
  slug: string;
  featuredImageUrl: string | null;
};

let cache: { articles: SoroArticle[]; fetchedAt: number } | null = null;

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'");
}

function tag(item: string, name: string): string {
  const match = item.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function attribute(item: string, element: string, name: string): string {
  const match = item.match(new RegExp(`<${element}\\b[^>]*\\b${name}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeXml(match[1].trim()) : "";
}

function plainText(html: string): string {
  return decodeXml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function canonicalLink(value: string): { link: string; slug: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase().replace(/^www\./, "") !== SELECT_UNIFORMS_HOST) {
      return null;
    }
    url.hostname = SELECT_UNIFORMS_HOST;
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    const slug = url.pathname.split("/").filter(Boolean).pop();
    return slug ? { link: url.toString(), slug } : null;
  } catch {
    return null;
  }
}

export function parseSoroArticles(xml: string): SoroArticle[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].flatMap((match) => {
    const item = match[1];
    const canonical = canonicalLink(tag(item, "canonical") || tag(item, "link"));
    if (!canonical) return [];
    const title = plainText(tag(item, "title"));
    const content = plainText(tag(item, "content:encoded") || tag(item, "description"));
    if (!title || !content) return [];
    return [{
      id: plainText(tag(item, "guid")) || canonical.link,
      title,
      excerpt: plainText(tag(item, "description")).slice(0, 600),
      content,
      date: tag(item, "pubDate"),
      link: canonical.link,
      slug: canonical.slug,
      featuredImageUrl: attribute(item, "media:content", "url")
        || attribute(item, "media:thumbnail", "url")
        || attribute(item, "enclosure", "url")
        || null,
    }];
  });
}

export async function getSoroArticles(): Promise<SoroArticle[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.articles;
  const response = await fetch(SORO_RSS_URL, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Soro RSS returned HTTP ${response.status}`);
  const xml = await response.text();
  if (xml.length > 2_000_000) throw new Error("Soro RSS response is unexpectedly large");
  const articles = parseSoroArticles(xml);
  if (!articles.length) throw new Error("Soro RSS contains no readable Select Uniforms articles");
  cache = { articles, fetchedAt: Date.now() };
  return articles;
}

export async function getSoroArticle(slug: string): Promise<SoroArticle | null> {
  const articles = await getSoroArticles();
  return articles.find((article) => article.slug === slug) ?? null;
}