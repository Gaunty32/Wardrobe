import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description?: string;
}

const BASE_TITLE = 'Select Branding Solutions';

/**
 * Updates document.title and meta tags for Google/AI search ranking.
 * Call at the top of every page component.
 */
export function useSEO({ title, description }: SEOProps) {
  const fullTitle = title === BASE_TITLE ? title : `${title} | ${BASE_TITLE}`;

  useEffect(() => {
    document.title = fullTitle;

    const setMeta = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector);
      if (el) el.setAttribute(attr, value);
    };

    setMeta('meta[property="og:title"]',       'content', fullTitle);
    setMeta('meta[name="twitter:title"]',       'content', fullTitle);

    if (description) {
      setMeta('meta[name="description"]',        'content', description);
      setMeta('meta[property="og:description"]', 'content', description);
      setMeta('meta[name="twitter:description"]','content', description);
    }

    return () => {
      // Restore defaults on unmount so stale titles don't linger on fast-nav
      document.title = `${BASE_TITLE} — Workwear & Branded Uniforms`;
    };
  }, [fullTitle, description]);
}
