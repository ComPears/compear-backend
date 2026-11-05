import { Product } from '../types';
import { CountryCode } from '../config/countries';

export interface UnitComparison {
  basis: 'kg' | 'l' | 'item';
  quantity: number;
  price: number;
}

/** Never infer a mass/volume dimension from the legacy weightInGrams field. */
export function unitComparison(product: Pick<Product, 'packageSize' | 'effectivePrice'>): UnitComparison | null {
  const size = product.packageSize.toLowerCase().trim().replace(/,/g, '.');
  const match = size.match(/^(?:(\d+)\s*[x×]\s*)?(\d+(?:\.\d+)?)\s*(kg|g|gr|ml|cl|l|litres?|liters?|pints?|stuks?|st\.?|pieces?|pcs|count|pack|pk|items?)$/);
  if (!match || !Number.isFinite(product.effectivePrice) || product.effectivePrice <= 0) return null;
  const total = Number(match[1] ?? 1) * Number(match[2]);
  const unit = match[3];
  const basis = /^(kg|g|gr)$/.test(unit) ? 'kg' : /^(ml|cl|l|litres?|liters?|pints?)$/.test(unit) ? 'l' : 'item';
  const factor = /^(g|gr|ml)$/.test(unit) ? 0.001 : unit === 'cl' ? 0.01 : /^pint/.test(unit) ? 0.56826125 : 1;
  const quantity = total * factor;
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return { basis, quantity, price: product.effectivePrice / quantity };
}

/** Derived on response only: do not retain another object per catalog row. */
export function presentOffer(product: Product, country: CountryCode) {
  return {
    ...product,
    currency: country === 'uk' ? 'GBP' : 'EUR',
    unitComparison: unitComparison(product),
    dietaryEvidence: 'name-only' as const,
    priceScope: 'retailer' as const,
  };
}
