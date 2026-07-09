import { PromoType, Product, ScrapedProduct } from '../types';

/**
 * Compute effective price from promo type and value.
 * BOGO / SECOND_FREE → price / 2
 * PERCENTAGE → price * (1 - promoValue) where promoValue is 0..1 (e.g. 0.25 = 25% off)
 * MULTI_BUY → promoValue is total price, promoQuantity is count; per-unit = promoValue / promoQuantity
 */
export function computeEffectivePrice(
  price: number,
  promoType: PromoType,
  promoValue: number | null,
  promoQuantity?: number | null
): number {
  if (!promoType || promoType === null) return price;
  switch (promoType) {
    case 'BOGO':
    case 'SECOND_FREE':
      return price / 2;
    case 'SECOND_HALF':
      return price * (promoValue ?? 0.75);
    case 'BUNDLE_FREE':
      if (promoValue != null && promoQuantity != null && promoQuantity > 0) {
        return price * (promoValue / promoQuantity);
      }
      return price;
    case 'PERCENTAGE':
      if (promoValue == null) return price;
      return price * (1 - promoValue);
    case 'MULTI_BUY':
      if (promoValue != null && promoQuantity != null && promoQuantity > 0) {
        return promoValue / promoQuantity;
      }
      return price;
    default:
      return price;
  }
}

/**
 * Compute effective unit price (per kg or per liter etc.) from effective price and weight/volume.
 * If weightInGrams: effectiveUnitPrice = effectivePrice / (weightInGrams/1000) per kg.
 * Otherwise use existing unitPrice ratio: effectiveUnitPrice = unitPrice * (effectivePrice / price).
 */
export function computeEffectiveUnitPrice(
  effectivePrice: number,
  originalPrice: number,
  unitPrice: number,
  weightInGrams: number | null
): number {
  if (originalPrice <= 0) return unitPrice;
  if (weightInGrams != null && weightInGrams > 0) {
    return (effectivePrice / (weightInGrams / 1000));
  }
  return (effectivePrice / originalPrice) * unitPrice;
}

/**
 * Turn a scraped product into a full Product with id, canonicalName, effectivePrice, effectiveUnitPrice.
 */
export function toProduct(scraped: ScrapedProduct, id: string, canonicalName: string): Product {
  const price = scraped.price;
  const unitPrice = scraped.unitPrice ?? price;
  const promoType = scraped.promoType ?? null;
  const promoValue = scraped.promoValue ?? null;
  const promoQuantity = scraped.promoQuantity ?? null;

  const effectivePrice = computeEffectivePrice(price, promoType, promoValue, promoQuantity);
  const effectiveUnitPrice = computeEffectiveUnitPrice(
    effectivePrice,
    price,
    unitPrice,
    scraped.weightInGrams ?? null
  );

  return {
    id,
    canonicalName,
    productName: scraped.productName,
    brand: scraped.brand ?? null,
    store: scraped.store,
    packageSize: scraped.packageSize,
    weightInGrams: scraped.weightInGrams ?? null,
    originalPrice: price,
    effectivePrice,
    unitPrice,
    effectiveUnitPrice,
    promoType,
    promoValue,
    promoQuantity: promoQuantity ?? null,
    promoValidUntil: scraped.promoValidUntil ?? null,
    productUrl: scraped.productUrl ?? null,
    scrapedAt: scraped.scrapedAt,
    category: scraped.category ?? 'Other',
    barcode: scraped.barcode ?? null,
  };
}
