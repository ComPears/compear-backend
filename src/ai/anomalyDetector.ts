import { Product } from '../types';
import { loadAllProducts } from '../services/dataService';

/**
 * Detect potential price anomalies: same canonical product with unusually high price variance.
 */
export function detectPriceAnomalies(products?: Product[]): Array<{ canonicalName: string; products: Product[]; maxPrice: number; minPrice: number }> {
  const list = products ?? loadAllProducts();
  const byCanonical = new Map<string, Product[]>();
  for (const p of list) {
    const key = (p.canonicalName || p.productName).toLowerCase().trim();
    if (!byCanonical.has(key)) byCanonical.set(key, []);
    byCanonical.get(key)!.push(p);
  }

  const anomalies: Array<{ canonicalName: string; products: Product[]; maxPrice: number; minPrice: number }> = [];
  byCanonical.forEach((prods, name) => {
    if (prods.length < 2) return;
    const prices = prods.map((x) => x.effectivePrice);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const ratio = min > 0 ? max / min : 0;
    if (ratio > 2) {
      anomalies.push({ canonicalName: name, products: prods, minPrice: min, maxPrice: max });
    }
  });
  return anomalies;
}
