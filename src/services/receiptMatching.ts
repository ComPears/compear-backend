import { searchProducts } from '../ai/semanticSearch';
import { Product } from '../types';

export type ReceiptMatchStatus = 'matched' | 'needs_review' | 'unmatched';
export type ReceiptMatchMethod = 'catalog' | 'ai_normalized' | 'user_corrected' | 'user_unmatched';

export interface ReceiptLineMatchResult {
  matchConfidence: number;
  matchStatus: ReceiptMatchStatus;
  matchedProduct: Product | null;
  alternatives: Product[];
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
}

/**
 * Conservative lexical confidence. Receipt abbreviations may produce suggestions,
 * but only strong overlap is safe enough to affect savings automatically.
 */
export function calculateReceiptMatchConfidence(query: string, product: Product): number {
  const queryTokens = new Set(tokens(query));
  const productTokens = new Set(
    tokens([product.productName, product.canonicalName, product.brand ?? ''].join(' '))
  );
  if (queryTokens.size === 0 || productTokens.size === 0) return 0;

  const overlap = [...queryTokens].filter((token) => productTokens.has(token)).length;
  const coverage = overlap / queryTokens.size;
  const precision = overlap / Math.min(productTokens.size, Math.max(queryTokens.size, 1));
  const normalizedQuery = [...queryTokens].join(' ');
  const canonical = tokens(product.canonicalName || product.productName).join(' ');
  const exactBonus =
    normalizedQuery === canonical ? 0.2 : canonical.includes(normalizedQuery) ? 0.1 : 0;

  const score = Math.min(
    1,
    Math.round((coverage * 0.65 + precision * 0.25 + exactBonus) * 100) / 100
  );
  // A single generic token cannot safely select a more specific catalog identity.
  if (queryTokens.size === 1 && canonical.split(' ').length > 1 && normalizedQuery !== canonical) {
    return Math.min(score, 0.65);
  }
  return score;
}

export function statusForConfidence(confidence: number): ReceiptMatchStatus {
  if (confidence >= 0.72) return 'matched';
  if (confidence > 0) return 'needs_review';
  return 'unmatched';
}

function productsByCanonicalName(catalog: Product[], canonical: string): Product[] {
  const key = canonical.toLowerCase().trim();
  return catalog.filter(
    (product) => (product.canonicalName || product.productName).toLowerCase().trim() === key
  );
}

function pickCheapest(pool: Product[]): Product {
  return [...pool].sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
}

/**
 * Offline receipt-line matcher for CI / eval. Uses catalog search + lexical confidence
 * only — no OpenAI. Optional `aiNormalizedName` simulates a prior AI rewrite.
 */
export function matchReceiptLine(
  rawName: string,
  catalog: Product[],
  opts?: { aiNormalizedName?: string | null }
): ReceiptLineMatchResult {
  let results = searchProducts(rawName, 8, catalog);
  let searchName = rawName;
  const initialConfidence =
    results.length > 0 ? calculateReceiptMatchConfidence(rawName, results[0]) : 0;

  const normalized = opts?.aiNormalizedName?.trim();
  if (normalized && (results.length === 0 || initialConfidence < 0.72)) {
    const normalizedResults = searchProducts(normalized, 8, catalog);
    const exactResults = productsByCanonicalName(catalog, normalized);
    const candidateResults = exactResults.length > 0 ? exactResults : normalizedResults;
    const normalizedConfidence =
      candidateResults.length > 0
        ? calculateReceiptMatchConfidence(normalized, candidateResults[0])
        : 0;
    if (normalizedConfidence > initialConfidence) {
      results = candidateResults;
      searchName = normalized;
    }
  }

  if (results.length === 0) {
    return {
      matchConfidence: 0,
      matchStatus: 'unmatched',
      matchedProduct: null,
      alternatives: [],
    };
  }

  const matchConfidence = calculateReceiptMatchConfidence(searchName, results[0]);
  const matchStatus = statusForConfidence(matchConfidence);
  const canonical = results[0].canonicalName || results[0].productName;
  const sameCanonical = productsByCanonicalName(catalog, canonical);
  const alternatives = sameCanonical.length > 0 ? sameCanonical : results;
  const best = pickCheapest(alternatives);

  return {
    matchConfidence,
    matchStatus,
    matchedProduct: matchStatus === 'matched' ? best : null,
    alternatives,
  };
}
