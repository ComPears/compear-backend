import * as fs from 'fs';
import * as path from 'path';
import { Product, ProductCategory } from '../types';
import { STORE_SLUGS, StoreSlug, getDataFileName } from '../config/stores';
import { logger } from '../utils/logger';
import { invalidateBarcodeIndex } from './barcodeService';
import { normalizeBarcode } from '../utils/barcode';

const DATA_DIR = path.join(__dirname, '..', 'data');

const VALID_CATEGORIES = new Set<ProductCategory>([
  'Fruits & Vegetables',
  'Dairy & Eggs',
  'Meat & Seafood',
  'Beverages',
  'Bakery',
  'Snacks',
  'Frozen Foods',
  'Pantry',
  'Personal Care',
  'Household',
  'Other',
]);

function normalizeProduct(raw: Product): Product {
  const category =
    raw.category && VALID_CATEGORIES.has(raw.category) ? raw.category : 'Other';
  const barcode = raw.barcode ? normalizeBarcode(raw.barcode) : null;
  const identityKey =
    raw.identityKey ||
    (barcode ? `ean:${barcode}` : `tok:unknown|${raw.canonicalName}|na`);
  return { ...raw, category, barcode: barcode ?? null, identityKey };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    logger.info('Created data directory:', DATA_DIR);
  }
}

function getFilePath(storeSlug: StoreSlug): string {
  return path.join(DATA_DIR, getDataFileName(storeSlug));
}

/**
 * Load all products for a store from JSON file.
 */
export function loadStoreProducts(storeSlug: StoreSlug): Product[] {
  ensureDataDir();
  const filePath = getFilePath(storeSlug);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.map((item) => normalizeProduct(item as Product));
  } catch (e) {
    logger.error('Failed to load store products', storeSlug, e);
    return [];
  }
}

/**
 * Save products for a store to JSON file.
 */
export function saveStoreProducts(storeSlug: StoreSlug, products: Product[]): void {
  ensureDataDir();
  const filePath = getFilePath(storeSlug);
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf-8');
  invalidateBarcodeIndex();
  logger.info('Saved', products.length, 'products to', filePath);
}

/**
 * Load all products from all known store files.
 */
export function loadAllProducts(): Product[] {
  let all: Product[] = [];
  for (const slug of STORE_SLUGS) {
    const products = loadStoreProducts(slug as StoreSlug);
    all = all.concat(products);
  }
  return all;
}

/**
 * Get product by id (format "storeSlug-index" or "ah-12345" style).
 */
export function getProductById(id: string): Product | null {
  const all = loadAllProducts();
  return all.find((p) => p.id === id) ?? null;
}
