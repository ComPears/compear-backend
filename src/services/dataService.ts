import * as fs from 'fs';
import * as path from 'path';
import { Product, ProductCategory } from '../types';
import { CountryCode, COUNTRY_CODES, DEFAULT_COUNTRY } from '../config/countries';
import { StoreSlug, getDataFileName, getStoreSlugsForCountry } from '../config/stores';
import { logger } from '../utils/logger';
import { invalidateBarcodeIndex } from './barcodeService';
import { normalizeBarcode } from '../utils/barcode';
import { clearSearchCache } from '../utils/searchCache';
import { precomputeProductDietaryLabels } from '../utils/dietaryLabels';

const DATA_DIR = path.join(__dirname, '..', 'data');

interface ProductCatalog {
  all: Product[];
  byStore: Map<StoreSlug, Product[]>;
  byId: Map<string, Product>;
}

const catalogByCountry = new Map<CountryCode, ProductCatalog>();

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

function ensureDataDir(country: CountryCode = DEFAULT_COUNTRY): void {
  const dir = path.join(DATA_DIR, country);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    logger.info('Created data directory:', dir);
  }
}

function getFilePath(country: CountryCode, storeSlug: StoreSlug): string {
  const countryPath = path.join(DATA_DIR, country, getDataFileName(storeSlug));
  const legacyPath = path.join(DATA_DIR, getDataFileName(storeSlug));
  if (fs.existsSync(countryPath)) return countryPath;
  return legacyPath;
}

function readStoreProductsFromDisk(
  storeSlug: StoreSlug,
  country: CountryCode = DEFAULT_COUNTRY
): Product[] {
  ensureDataDir(country);
  const filePath = getFilePath(country, storeSlug);
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

function buildCatalog(country: CountryCode): ProductCatalog {
  const startedAt = performance.now();
  const byStore = new Map<StoreSlug, Product[]>();
  const byId = new Map<string, Product>();
  const all: Product[] = [];

  for (const slug of getStoreSlugsForCountry(country)) {
    const products = readStoreProductsFromDisk(slug, country);
    byStore.set(slug, products);
    for (const product of products) {
      all.push(product);
      byId.set(product.id, product);
    }
  }

  precomputeProductDietaryLabels(all);

  logger.info('Product catalog loaded', {
    country,
    products: all.length,
    stores: byStore.size,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });

  return { all, byStore, byId };
}

function getCatalog(country: CountryCode): ProductCatalog {
  let catalog = catalogByCountry.get(country);
  if (!catalog) {
    catalog = buildCatalog(country);
    catalogByCountry.set(country, catalog);
  }
  return catalog;
}

export function preloadProductCatalogs(): void {
  for (const country of COUNTRY_CODES) {
    getCatalog(country);
  }
}

export function invalidateProductCatalog(country?: CountryCode): void {
  if (country) {
    catalogByCountry.delete(country);
  } else {
    catalogByCountry.clear();
  }
  invalidateBarcodeIndex();
  clearSearchCache();
}

/**
 * Return normalized products for a store from the in-memory catalog.
 */
export function loadStoreProducts(
  storeSlug: StoreSlug,
  country: CountryCode = DEFAULT_COUNTRY
): Product[] {
  return getCatalog(country).byStore.get(storeSlug) ?? [];
}

/**
 * Save products for a store to JSON file.
 */
export function saveStoreProducts(
  storeSlug: StoreSlug,
  products: Product[],
  country: CountryCode = DEFAULT_COUNTRY
): void {
  ensureDataDir(country);
  const filePath = path.join(DATA_DIR, country, getDataFileName(storeSlug));
  fs.writeFileSync(filePath, JSON.stringify(products, null, 2), 'utf-8');
  invalidateProductCatalog(country);
  logger.info('Saved', products.length, 'products to', filePath);
}

/**
 * Load all products from all known store files for a country.
 */
export function loadAllProducts(country: CountryCode = DEFAULT_COUNTRY): Product[] {
  return getCatalog(country).all;
}

export function getStoreProductCount(
  storeSlug: StoreSlug,
  country: CountryCode = DEFAULT_COUNTRY
): number {
  return getCatalog(country).byStore.get(storeSlug)?.length ?? 0;
}

/**
 * Get product by id (format "storeSlug-index" or "ah-12345" style).
 */
export function getProductById(
  id: string,
  country: CountryCode = DEFAULT_COUNTRY
): Product | null {
  return getCatalog(country).byId.get(id) ?? null;
}
