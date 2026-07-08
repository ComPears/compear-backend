/**
 * Simple canonical name for Phase 1 (lowercase, trim).
 * Full normalization is in services/productMatcher.ts (Phase 2).
 */
export function simpleCanonicalName(productName: string): string {
  return productName
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
