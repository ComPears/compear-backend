import { Product } from '../types';
import { loadAllProducts } from './dataService';
import { normalizeBarcode } from '../utils/barcode';

let barcodeIndex: Map<string, Product[]> | null = null;

function buildBarcodeIndex(): Map<string, Product[]> {
  const map = new Map<string, Product[]>();
  for (const product of loadAllProducts()) {
    if (!product.barcode) continue;
    const list = map.get(product.barcode) ?? [];
    list.push(product);
    map.set(product.barcode, list);
  }
  return map;
}

export function invalidateBarcodeIndex(): void {
  barcodeIndex = null;
}

export function getProductsByBarcode(rawBarcode: string): Product[] {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) return [];

  if (!barcodeIndex) {
    barcodeIndex = buildBarcodeIndex();
  }

  const matches = barcodeIndex.get(barcode) ?? [];
  return [...matches].sort((a, b) => a.effectivePrice - b.effectivePrice);
}
