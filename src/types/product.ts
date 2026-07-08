/**
 * Promotion types for effective price calculation.
 */
export type PromoType =
  | 'BOGO'           // 1+1 gratis → price / 2
  | 'SECOND_FREE'    // Second free → price / 2
  | 'SECOND_HALF'    // 2e halve prijs → ~75% of shelf price per item (pair)
  | 'BUNDLE_FREE'    // e.g. 2+1 gratis → pay promoValue of promoQuantity items
  | 'PERCENTAGE'     // e.g. 25% off → price * (1 - promoValue)
  | 'MULTI_BUY'      // e.g. 3 for €5 → per-unit from promoValue
  | null;

export interface Product {
  id: string;
  canonicalName: string;
  productName: string;
  brand: string | null;
  store: string;
  packageSize: string;
  weightInGrams: number | null;
  originalPrice: number;
  effectivePrice: number;
  unitPrice: number;
  effectiveUnitPrice: number;
  promoType: PromoType;
  promoValue: number | null;
  /** For MULTI_BUY: number of items (e.g. 3 in "3 for €5") */
  promoQuantity?: number | null;
  promoValidUntil: string | null;
  productUrl: string | null;
  scrapedAt: string;
}

export interface ProductWithStore extends Product {
  store: string;
}

/**
 * Raw product as scraped (before effective price calculation).
 */
export interface ScrapedProduct {
  productName: string;
  brand?: string | null;
  packageSize: string;
  weightInGrams?: number | null;
  price: number;
  unitPrice?: number;
  promoType?: PromoType | null;
  promoValue?: number | null;
  promoQuantity?: number | null;
  promoValidUntil?: string | null;
  store: string;
  productUrl?: string | null;
  scrapedAt: string;
}

export interface StoreInfo {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  productCount?: number;
}
