import { Product } from '../types';
import { CountryCode, DEFAULT_COUNTRY } from '../config/countries';
import { loadAllProducts } from './dataService';
import { normalizeBarcode } from '../utils/barcode';

const barcodeIndexByCountry = new Map<CountryCode, Map<string, Product[]>>();

function buildBarcodeIndex(country: CountryCode): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const product of loadAllProducts(country)) {
    if (!product.barcode) continue;
    const list = map.get(product.barcode) ?? [];
    list.push(product);
    map.set(product.barcode, list);
  }
  return map;
}

export function invalidateBarcodeIndex(): void {
  barcodeIndexByCountry.clear();
}

export function getProductsByBarcode(
  rawBarcode: string,
  country: CountryCode = DEFAULT_COUNTRY
): Product[] {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) return [];

  if (!barcodeIndexByCountry.has(country)) {
    barcodeIndexByCountry.set(country, buildBarcodeIndex(country));
  }

  const matches = barcodeIndexByCountry.get(country)!.get(barcode) ?? [];
  return [...matches].sort((a, b) => a.effectivePrice - b.effectivePrice);
}
