import { Product } from '../types';
import { loadAllProducts } from '../services/dataService';
import { logger } from '../utils/logger';
import { COUNTRY_CODES } from '../config/countries';

interface SearchDocument {
  product: Product;
  haystack: string;
  productName: string;
  canonicalName: string;
  productTokens: Set<string>;
  canonicalTokens: Set<string>;
  brandTokens: Set<string>;
}

interface SearchIndex {
  documents: SearchDocument[];
  postings: Map<string, number[]>;
}

const indexBySource = new WeakMap<Product[], SearchIndex>();

const CATEGORY_INTENT_TERMS: Partial<Record<Product['category'], Set<string>>> = {
  'Dairy & Eggs': new Set([
    'milk', 'melk', 'milch', 'yogurt', 'yoghurt', 'joghurt', 'egg', 'eggs',
    'ei', 'eieren', 'eier', 'cheese', 'kaas', 'käse', 'butter',
  ]),
  Bakery: new Set(['bread', 'brood', 'brot', 'croissant', 'bagel']),
  Beverages: new Set([
    'coffee', 'koffie', 'kaffee', 'tea', 'thee', 'tee', 'juice', 'sap',
    'saft', 'water',
  ]),
  'Fruits & Vegetables': new Set([
    'apple', 'apples', 'appel', 'appels', 'apfel', 'banana', 'bananas',
    'banaan', 'bananen', 'banane', 'tomato', 'tomatoes', 'tomaat', 'tomaten',
    'tomate',
  ]),
  'Meat & Seafood': new Set([
    'chicken', 'kip', 'huhn', 'beef', 'rund', 'fish', 'vis', 'fisch',
  ]),
  Pantry: new Set([
    'pasta', 'rice', 'rijst', 'reis', 'flour', 'meel', 'mehl',
  ]),
};

function categoryIntentScore(product: Product, queryTokens: string[]): number {
  const intentTerms = CATEGORY_INTENT_TERMS[product.category];
  if (!intentTerms) return 0;
  return queryTokens.reduce(
    (score, token) => score + (intentTerms.has(token) ? 90 / queryTokens.length : 0),
    0
  );
}

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
      productTokens: new Set(tokenize(product.productName)),
      canonicalTokens: new Set(tokenize(product.canonicalName ?? '')),
      brandTokens: new Set(tokenize(product.brand ?? '')),
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
  const {
    haystack,
    productName,
    canonicalName,
    productTokens,
    canonicalTokens,
    brandTokens,
  } = document;

  // Search intent is strongest when the full name or complete words match.
  // This prevents a query such as "melk" from ranking the brand "Melkan"
  // above products whose name actually contains the word "melk".
  if (productName === fullQuery || canonicalName === fullQuery) return 500;

  let score = 0;
  if (productName.includes(fullQuery)) score += 120;
  if (canonicalName.includes(fullQuery)) score += 100;
  if (productName.startsWith(fullQuery)) score += 35;
  if (canonicalName.startsWith(fullQuery)) score += 25;

  for (const token of queryTokens) {
    if (productTokens.has(token)) score += 75;
    else if (canonicalTokens.has(token)) score += 65;
    else if (brandTokens.has(token)) score += 20;
    else if (haystack.includes(token)) score += token.length >= 4 ? 4 : 2;
  }

  // Generic grocery queries should favor the aisle they name. For example,
  // "milk" should surface dairy before milk chocolate or milk-bottle sweets.
  score += categoryIntentScore(document.product, queryTokens);

  const matchedProductTokens = queryTokens.filter((token) => productTokens.has(token)).length;
  if (matchedProductTokens === queryTokens.length) {
    score += Math.max(8, 40 - Math.max(0, productTokens.size - queryTokens.length) * 4);
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

  return scoreDocument(
    {
      product,
      haystack,
      productName: product.productName.toLowerCase(),
      canonicalName: product.canonicalName?.toLowerCase() ?? '',
      productTokens: new Set(tokenize(product.productName)),
      canonicalTokens: new Set(tokenize(product.canonicalName ?? '')),
      brandTokens: new Set(tokenize(product.brand ?? '')),
    },
    queryTokens,
    fullQuery
  );
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
