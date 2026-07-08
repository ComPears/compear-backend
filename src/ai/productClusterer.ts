import { Product } from '../types';
import { loadAllProducts } from '../services/dataService';

/**
 * Group products by canonical name for clustering. Same as productMatcher groupByCanonicalName.
 */
export function clusterByCanonicalName(products: Product[]): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = (p.canonicalName || p.productName).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return map;
}

/**
 * Get all clusters (canonical name -> products) from current data.
 */
export function getAllClusters(): Map<string, Product[]> {
  const all = loadAllProducts();
  return clusterByCanonicalName(all);
}
