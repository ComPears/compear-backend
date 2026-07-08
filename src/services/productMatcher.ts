import { Product } from '../types';
import { loadAllProducts } from './dataService';

/**
 * Normalize product name for matching: lowercase, collapse spaces, remove common brand/size noise.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get all products that match the given canonical name (exact or normalized match).
 */
export function getProductsByCanonicalName(canonicalName: string): Product[] {
  const normalized = normalizeName(canonicalName);
  const all = loadAllProducts();
  return all.filter(
    (p) =>
      normalizeName(p.canonicalName) === normalized ||
      normalizeName(p.productName) === normalized
  );
}

/**
 * Group similar products across stores (by canonical name).
 * Used for GET /compare and basket comparison.
 */
export function groupByCanonicalName(products: Product[]): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = normalizeName(p.canonicalName || p.productName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}
