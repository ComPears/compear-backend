import { Product } from '../types';
import { loadAllProducts } from './dataService';

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Get all products matching an identity key (EAN or token-sorted name + size).
 */
export function getProductsByIdentityKey(identityKey: string): Product[] {
  const key = identityKey.trim();
  if (!key) return [];
  const all = loadAllProducts();
  return all.filter((p) => p.identityKey === key);
}

/**
 * Get all products that match the given canonical name (exact or normalized match).
 */
export function getProductsByCanonicalName(canonicalName: string): Product[] {
  const normalized = normalizeName(canonicalName);
  const all = loadAllProducts();
  const byIdentity = new Map<string, Product[]>();

  for (const p of all) {
    const cn = normalizeName(p.canonicalName || p.productName);
    if (cn !== normalized && normalizeName(p.productName) !== normalized) continue;
    const list = byIdentity.get(p.identityKey) ?? [];
    list.push(p);
    byIdentity.set(p.identityKey, list);
  }

  // Prefer identity-key grouping: return all stores for matching identities
  const matches: Product[] = [];
  for (const group of byIdentity.values()) {
    const byStore = new Map<string, Product>();
    for (const product of group) {
      const existing = byStore.get(product.store);
      if (!existing || product.effectivePrice < existing.effectivePrice) {
        byStore.set(product.store, product);
      }
    }
    matches.push(...byStore.values());
  }
  return matches.sort((a, b) => a.effectivePrice - b.effectivePrice);
}

/**
 * Resolve comparable products: identity key first, then canonical name.
 */
export function getComparableProducts(canonicalName: string, identityKey?: string | null): Product[] {
  if (identityKey) {
    const byKey = getProductsByIdentityKey(identityKey);
    if (byKey.length > 0) return byKey;
  }
  return getProductsByCanonicalName(canonicalName);
}

/**
 * Group similar products across stores (by identity key).
 */
export function groupByIdentityKey(products: Product[]): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = p.identityKey || normalizeName(p.canonicalName || p.productName);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

/** @deprecated use groupByIdentityKey */
export function groupByCanonicalName(products: Product[]): Map<string, Product[]> {
  return groupByIdentityKey(products);
}
