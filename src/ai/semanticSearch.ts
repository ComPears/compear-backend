import { Product } from '../types';
import { loadAllProducts } from '../services/dataService';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,./\-+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function scoreProduct(product: Product, queryTokens: string[], fullQuery: string): number {
  const haystack = [
    product.productName,
    product.canonicalName,
    product.brand ?? '',
    product.store,
    product.packageSize,
  ]
    .join(' ')
    .toLowerCase();

  if (haystack.includes(fullQuery)) {
    return 100 + (haystack.startsWith(fullQuery) ? 10 : 0);
  }

  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 3 : 2;
      if (product.productName.toLowerCase().startsWith(token)) score += 2;
      if (product.canonicalName?.startsWith(token)) score += 1;
    }
  }

  return score;
}

/**
 * Ranked text search over product names, canonical names, brand, and store.
 * Supports multi-word queries like "melk halfvol".
 */
export function searchProducts(query: string, limit = 50, source?: Product[]): Product[] {
  const fullQuery = query.toLowerCase().trim();
  if (!fullQuery) return [];

  const queryTokens = tokenize(fullQuery);
  if (queryTokens.length === 0) return [];

  const all = source ?? loadAllProducts();

  return all
    .map((p) => ({ p, score: scoreProduct(p, queryTokens, fullQuery) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.effectivePrice - b.p.effectivePrice)
    .slice(0, limit)
    .map((x) => x.p);
}
