import { useQuery } from '@tanstack/react-query';

// API calls go to /api/... directly — never prefixed with BASE_URL (/shop/)
const API = '/api';

export function useWcCategories() {
  return useQuery({
    queryKey: ['wc-categories'],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/wc/categories`);
      if (!res.ok) throw new Error('Failed to fetch categories');
      return res.json();
    },
    staleTime: 300_000,
  });
}

export function useWcProducts({
  category_slug,
  category,
  page = 1,
  per_page = 24,
  search = '',
}: {
  category_slug?: string;
  category?: string;
  page?: number;
  per_page?: number;
  search?: string;
}) {
  return useQuery({
    queryKey: ['wc-products', category_slug, category, page, per_page, search],
    queryFn: async () => {
      let url = `${API}/shop/wc/products?page=${page}&per_page=${per_page}`;
      if (category_slug) url += `&category_slug=${encodeURIComponent(category_slug)}`;
      if (category) url += `&category=${encodeURIComponent(category)}`;
      if (search) url += `&search=${encodeURIComponent(search)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch products');
      return res.json();
    },
  });
}

export function useWcProduct(id: string | number | undefined) {
  return useQuery({
    queryKey: ['wc-product', id],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/wc/products/${id}`);
      if (!res.ok) throw new Error('Failed to fetch product');
      return res.json();
    },
    enabled: !!id,
  });
}

export interface ShopImage {
  url: string;
  productName: string;
  productId: number;
  category: string | null;
  permalink: string | null;
  type?: 'primary' | 'gallery';
}

export interface ShopImages {
  byCategory: Record<string, ShopImage[]>;
  featured: ShopImage[];
  all: ShopImage[];
}

export function useShopImages() {
  return useQuery<ShopImages>({
    queryKey: ['shop-images'],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/images`);
      if (!res.ok) throw new Error('Failed to fetch shop images');
      return res.json();
    },
    staleTime: 600_000, // 10 min — changes only when products sync
  });
}

export function useBrandingOptions() {
  return useQuery({
    queryKey: ['branding-options'],
    queryFn: async () => {
      const res = await fetch(`${API}/shop/branding-options`);
      if (!res.ok) throw new Error('Failed to fetch branding options');
      return res.json() as Promise<{ id: string; name: string; surcharge: number; description?: string }[]>;
    },
    staleTime: 300_000,
  });
}
