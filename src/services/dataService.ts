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
  bySlug: Map<string, Product[]>;
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

const CATEGORY_RULES: Array<{ category: ProductCategory; terms: RegExp }> = [
  {
    category: 'Personal Care',
    terms: /\b(shower|shampoo|conditioner|toothpaste|toothbrush|deodorant|soap|skincare|moisturiser|moisturizer)\b/i,
  },
  {
    category: 'Household',
    terms: /\b(detergent|cleaner|cleaning|bin bags?|foil|toilet rolls?|kitchen rolls?|sponges?|dishwasher|laundry)\b/i,
  },
  {
    category: 'Frozen Foods',
    terms: /\b(frozen|ice creams?|ice loll(?:y|ies)|fish fingers?)\b/i,
  },
  {
    category: 'Snacks',
    terms: /\b(chocolates?|biscuits?|cookies?|sweets?|crisps?|popcorn|snack bars?|cereal bars?)\b/i,
  },
  {
    category: 'Dairy & Eggs',
    terms: /\b(milk|melk|milch|yoghurts?|yogurts?|joghurts?|eggs?|eieren|eier|cheeses?|kaas|käse|butter|cream)\b/i,
  },
  {
    category: 'Bakery',
    terms: /\b(bread|brood|brot|croissants?|bagels?|baguettes?|muffins?)\b/i,
  },
  {
    category: 'Beverages',
    terms: /\b(coffee|koffie|kaffee|tea|thee|tee|juice|sap|saft|water|cola|lemonade)\b/i,
  },
  {
    category: 'Fruits & Vegetables',
    terms: /\b(apples?|appels?|apfel|bananas?|bananen?|banane|tomatoes?|tomaten?|tomate|potatoes?|aardappelen|kartoffeln|carrots?|wortels?)\b/i,
  },
  {
    category: 'Meat & Seafood',
    terms: /\b(chicken|kip|huhn|beef|rund|pork|varken|schwein|fish|vis|fisch|salmon|zalm|lachs)\b/i,
  },
  {
    category: 'Pantry',
    terms: /\b(pasta|rice|rijst|reis|flour|meel|mehl|sugar|suiker|zucker|salt|zout|salz|beans?|sauces?)\b/i,
  },
];

const NON_FOOD_PRODUCT_TERMS = /\b(frother|machine|appliance)\b/i;

export function inferProductCategory(raw: Pick<Product, 'productName' | 'canonicalName'>): ProductCategory {
  const searchableName = `${raw.productName} ${raw.canonicalName}`;
  if (NON_FOOD_PRODUCT_TERMS.test(searchableName)) return 'Other';
  return CATEGORY_RULES.find((rule) => rule.terms.test(searchableName))?.category ?? 'Other';
}

function compactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
}

export function normalizePackageData(
  raw: Pick<Product, 'productName' | 'canonicalName' | 'packageSize' | 'weightInGrams'>
): Pick<Product, 'packageSize' | 'weightInGrams'> {
  const name = `${raw.productName} ${raw.canonicalName}`;
  const multiPack = name.match(/\b(\d+)\s*(?:x|×)\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|litres?|liters?|l|pints?)\b/i);
  if (multiPack) {
    const count = Number(multiPack[1]);
    const each = Number(multiPack[2].replace(',', '.'));
    const unit = multiPack[3].toLowerCase();
    const multiplier = unit === 'kg' ? 1000 : unit === 'g' || unit === 'ml' ? 1 : unit === 'cl' ? 10 : unit.startsWith('pint') ? 568.261 : 1000;
    const label = unit.startsWith('lit') ? 'l' : unit.startsWith('pint') ? (each === 1 ? 'pint' : 'pints') : unit;
    if (Number.isFinite(count) && Number.isFinite(each) && count > 0 && each > 0) {
      return {
        packageSize: `${compactNumber(count)} × ${compactNumber(each)} ${label}`,
        weightInGrams: Math.round(count * each * multiplier),
      };
    }
  }
  const matches = Array.from(
    name.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|litres?|liters?|l|pints?)\b/gi)
  );
  const explicit = matches[matches.length - 1];
  if (!explicit) {
    return { packageSize: raw.packageSize, weightInGrams: raw.weightInGrams };
  }

  const quantity = Number(explicit[1].replace(',', '.'));
  const unit = explicit[2].toLowerCase();
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { packageSize: raw.packageSize, weightInGrams: raw.weightInGrams };
  }

  let packageSize = raw.packageSize;
  let inferredWeight = raw.weightInGrams;
  if (unit === 'kg') {
    packageSize = `${compactNumber(quantity)} kg`;
    inferredWeight = Math.round(quantity * 1000);
  } else if (unit === 'g') {
    packageSize = `${compactNumber(quantity)} g`;
    inferredWeight = Math.round(quantity);
  } else if (unit === 'ml') {
    packageSize = `${compactNumber(quantity)} ml`;
    inferredWeight = Math.round(quantity);
  } else if (unit === 'cl') {
    packageSize = `${compactNumber(quantity)} cl`;
    inferredWeight = Math.round(quantity * 10);
  } else if (unit === 'l' || unit.startsWith('lit')) {
    packageSize = `${compactNumber(quantity)} l`;
    inferredWeight = Math.round(quantity * 1000);
  } else if (unit.startsWith('pint')) {
    packageSize = `${compactNumber(quantity)} ${quantity === 1 ? 'pint' : 'pints'}`;
    inferredWeight = Math.round(quantity * 568.261);
  }

  return { packageSize, weightInGrams: inferredWeight };
}

export function productSlug(raw: Pick<Product, 'canonicalName' | 'productName' | 'packageSize'>): string {
  return `${raw.canonicalName || raw.productName} ${raw.packageSize}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeProduct(raw: Product): Product {
  const suppliedCategory =
    raw.category && VALID_CATEGORIES.has(raw.category) ? raw.category : 'Other';
  const category = suppliedCategory === 'Other' ? inferProductCategory(raw) : suppliedCategory;
  const barcode = raw.barcode ? normalizeBarcode(raw.barcode) : null;
  const identityKey =
    raw.identityKey ||
    (barcode ? `ean:${barcode}` : `tok:unknown|${raw.canonicalName}|na`);
  const packageData = normalizePackageData(raw);
  return { ...raw, ...packageData, category, barcode: barcode ?? null, identityKey };
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
  const bySlug = new Map<string, Product[]>();
  const all: Product[] = [];

  for (const slug of getStoreSlugsForCountry(country)) {
    const products = readStoreProductsFromDisk(slug, country);
    byStore.set(slug, products);
    for (const product of products) {
      all.push(product);
      byId.set(product.id, product);
      const slug = productSlug(product);
      const slugProducts = bySlug.get(slug) ?? [];
      slugProducts.push(product);
      bySlug.set(slug, slugProducts);
    }
  }

  precomputeProductDietaryLabels(all);

  logger.info('Product catalog loaded', {
    country,
    products: all.length,
    stores: byStore.size,
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
  });

  return { all, byStore, byId, bySlug };
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

export function getProductsBySlug(
  slug: string,
  country: CountryCode = DEFAULT_COUNTRY
): Product[] {
  return [...(getCatalog(country).bySlug.get(slug.toLowerCase()) ?? [])].sort(
    (a, b) => a.effectivePrice - b.effectivePrice
  );
}

export function getSeoProductGroups(country: CountryCode = DEFAULT_COUNTRY): Array<{
  slug: string;
  offers: Array<Pick<Product, 'canonicalName' | 'productName' | 'brand' | 'store' | 'packageSize' | 'effectivePrice' | 'scrapedAt' | 'category'>>;
}> {
  return Array.from(getCatalog(country).bySlug.entries())
    .filter(([, products]) => new Set(products.map((product) => product.store)).size > 1)
    .map(([slug, products]) => ({
      slug,
      offers: products.map((product) => ({
        canonicalName: product.canonicalName,
        productName: product.productName,
        brand: product.brand,
        store: product.store,
        packageSize: product.packageSize,
        effectivePrice: product.effectivePrice,
        scrapedAt: product.scrapedAt,
        category: product.category,
      })),
    }));
}
