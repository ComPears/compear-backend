import { Product } from '../types';
import { loadAllProducts } from '../services/dataService';
import { logger } from '../utils/logger';
import { COUNTRY_CODES } from '../config/countries';

interface SearchDocument {
  product: Product;
  haystack: string;
  productName: string;
  canonicalName: string;
}

interface SearchIndex {
  documents: SearchDocument[];
  postings: Map<string, number[]>;
}

const indexBySource = new WeakMap<Product[], SearchIndex>();

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,./\-+]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function buildSearchIndex(products: Product[]): SearchIndex {
  const startedAt = performance.now();
  const documents: SearchDocument[] = [];
  const postings = new Map<string, number[]>();

  products.forEach((product, index) => {
    const haystack = [
      product.productName,
      product.canonicalName,
      product.brand ?? '',
      product.store,
      product.packageSize,
    ]
      .join(' ')
      .toLowerCase();
    documents.push({
      product,
      haystack,
      productName: product.productName.toLowerCase(),
      canonicalName: product.canonicalName?.toLowerCase() ?? '',
    });

    for (const token of new Set(tokenize(haystack))) {
      const ids = postings.get(token) ?? [];
      ids.push(index);
      postings.set(token, ids);
    }
  });

  logger.info('Product search index built', {
    products: products.length,
    tokens: postings.size,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });
  return { documents, postings };
}

function getSearchIndex(products: Product[]): SearchIndex {
  let index = indexBySource.get(products);
  if (!index) {
    index = buildSearchIndex(products);
    indexBySource.set(products, index);
  }
  return index;
}

export function preloadProductSearchIndexes(): void {
  for (const country of COUNTRY_CODES) {
    const products = loadAllProducts(country);
    if (products.length > 0) getSearchIndex(products);
  }
}

function scoreDocument(document: SearchDocument, queryTokens: string[], fullQuery: string): number {
  const { product, haystack, productName, canonicalName } = document;

  if (haystack.includes(fullQuery)) {
    return 100 + (haystack.startsWith(fullQuery) ? 10 : 0);
  }

  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 3 : 2;
      if (productName.startsWith(token)) score += 2;
      if (canonicalName.startsWith(token)) score += 1;
    }
  }

  return score;
}

function candidateDocumentIds(index: SearchIndex, queryTokens: string[]): Set<number> {
  const candidates = new Set<number>();
  for (const queryToken of queryTokens) {
    for (const [indexedToken, ids] of index.postings) {
      if (!indexedToken.includes(queryToken)) continue;
      for (const id of ids) candidates.add(id);
    }
  }
  return candidates;
}

function legacyScoreProduct(product: Product, queryTokens: string[], fullQuery: string): number {
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
export function searchProducts(
  query: string,
  limit = 50,
  source?: Product[],
  productFilter?: (product: Product) => boolean
): Product[] {
  const fullQuery = query.toLowerCase().trim();
  if (!fullQuery) return [];

  const queryTokens = tokenize(fullQuery);
  if (queryTokens.length === 0) return [];

  const all = source ?? loadAllProducts();
  const index = getSearchIndex(all);
  const candidates = candidateDocumentIds(index, queryTokens);

  // Fallback preserves behavior for unusual punctuation-only catalog values.
  if (candidates.size === 0) {
    return all
      .filter((product) => !productFilter || productFilter(product))
      .map((p) => ({ p, score: legacyScoreProduct(p, queryTokens, fullQuery) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.p.effectivePrice - b.p.effectivePrice)
      .slice(0, limit)
      .map((x) => x.p);
  }

  return Array.from(candidates)
    .map((id) => {
      const document = index.documents[id];
      return { p: document.product, score: scoreDocument(document, queryTokens, fullQuery) };
    })
    .filter((result) => !productFilter || productFilter(result.p))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.effectivePrice - b.p.effectivePrice)
    .slice(0, limit)
    .map((x) => x.p);
}
