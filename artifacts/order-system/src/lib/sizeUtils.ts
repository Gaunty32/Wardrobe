const SIZE_ORDER = [
  "XXXS","XXS","3XS","2XS",
  "XS","S","M","L","XL",
  "2XL","XXL","3XL","XXXL","4XL","XXXXL","5XL","6XL","7XL","8XL",
  "X-Small","X Small","XSmall","Small","Medium","Large",
  "X-Large","X Large","XLarge","XX-Large","XX Large","XXLarge",
  "4","6","8","10","12","14","16","18","20","22","24","26","28","30","32","34","36","38","40","42","44","46","48","50",
  "One Size","One-Size","Onesize","Free Size","Universal","N/A",
];

function normalise(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "");
}

function baseRank(token: string): number {
  const n = normalise(token);
  const idx = SIZE_ORDER.findIndex(r => normalise(r) === n);
  if (idx !== -1) return idx;
  // Pure numeric sizes (shoe sizes, waist sizes, etc.) — sort numerically after text sizes
  const num = parseFloat(n);
  if (!isNaN(num) && String(num) === n) return 500 + num;
  return 9999;
}

export function sizeRank(s: string | null | undefined): number {
  if (!s) return 9999;
  const parts = s.split(/[\/\-]/).map(p => p.trim()).filter(Boolean);
  return Math.min(...parts.map(baseRank));
}

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const diff = sizeRank(a) - sizeRank(b);
    if (diff !== 0) return diff;
    return a.localeCompare(b);
  });
}

export function sortBySize<T>(arr: T[], key: (item: T) => string | null | undefined): T[] {
  return [...arr].sort((a, b) => {
    const diff = sizeRank(key(a)) - sizeRank(key(b));
    if (diff !== 0) return diff;
    return (key(a) ?? "").localeCompare(key(b) ?? "");
  });
}
