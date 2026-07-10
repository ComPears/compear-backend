import { Product } from '../types';

export type ReceiptMatchStatus = 'matched' | 'needs_review' | 'unmatched';
export type ReceiptMatchMethod = 'catalog' | 'ai_normalized' | 'user_corrected' | 'user_unmatched';

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
