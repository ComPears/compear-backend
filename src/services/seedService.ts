import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PromoType, Product, ProductCategory, ScrapedProduct } from '../types';
import { toProduct } from './promotionService';
import { sanitizeProductFields, shouldRejectProductName } from '../utils/productSanitize';
import { extractBarcodeFromText, normalizeBarcode } from '../utils/barcode';
import { saveStoreProducts } from './dataService';
import { STORE_SLUGS, StoreSlug } from '../config/stores';
import {
  CountryCode,
  DEFAULT_COUNTRY,
  catalogRelPath,
  loadWranglingConfig,
  listStoreSlugsForCountry,
} from '../config/countries';
import { logger } from '../utils/logger';

interface LegacyProduct {
  n: string;
  o?: string;
  p: string;
  s?: string;
  l?: string;
  i?: string;
  c?: string;
  b?: string;
  cn?: string;
  ik?: string;
  bn?: string;
  wg?: number;
}

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

function parseCategory(value?: string): ProductCategory {
  if (value && VALID_CATEGORIES.has(value as ProductCategory)) {
    return value as ProductCategory;
  }
  return 'Other';
}

export interface SeedReport {
  store: StoreSlug;
  sourceFile: string;
  totalRows: number;
  seeded: number;
  skippedInvalidPrice: number;
  skippedRejected: number;
  missingUrl: number;
  withPromo: number;
}

export function seedAllStoresFromWrangling(
  wranglingPath = getWranglingPath(),
  country: CountryCode = DEFAULT_COUNTRY
): SeedReport[] {
  const config = loadWranglingConfig(wranglingPath);
  const reports: SeedReport[] = [];
  const slugs = listStoreSlugsForCountry(config, country);

  for (const slug of slugs) {
    if (!STORE_SLUGS.includes(slug as StoreSlug)) continue;
    const storeSlug = slug as StoreSlug;
    const displayName = config.countries[country].stores[slug].display_name;
    const relPath = catalogRelPath(config, country, slug);
    const filePath = path.join(wranglingPath, relPath);
    reports.push(seedStoreFromWrangling(storeSlug, displayName, filePath, country));
  }

  const total = reports.reduce((sum, r) => sum + r.seeded, 0);
  logger.info(`Total products seeded for ${country}:`, total);
  return reports;
}

function parseLegacyPrice(p: string): number | null {
  const normalized = String(p).trim().replace(',', '.');
  if (!normalized) return null;
  const n = parseFloat(normalized);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function normalizePromoText(o: string): string {
  return o
    .toLowerCase()
    .replace(/\u200b/g, '')
    .replace(/vandaag|vanaf\s+\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePromoText(o?: string): {
  promoType: PromoType;
  promoValue: number | null;
  promoQuantity: number | null;
} {
  const empty = { promoType: null, promoValue: null, promoQuantity: null };
  if (!o?.trim()) {
    return empty;
  }

  const text = normalizePromoText(o);

  const bundleFree = text.match(/(\d+)\s*\+\s*(\d+)\s*gratis/);
  if (bundleFree) {
    const pay = parseInt(bundleFree[1], 10);
    const free = parseInt(bundleFree[2], 10);
    const total = pay + free;
    if (pay > 0 && total > pay) {
      return { promoType: 'BUNDLE_FREE', promoValue: pay, promoQuantity: total };
    }
  }

  if (/1\s*\+\s*1|1\+1/.test(text) && /gratis/.test(text)) {
    return { promoType: 'BOGO', promoValue: null, promoQuantity: null };
  }

  if (/2e\s*halve\s*prijs|2e\s*50\s*%\s*korting|2\s*\+\s*1\s*50/.test(text)) {
    return { promoType: 'SECOND_HALF', promoValue: 0.75, promoQuantity: 2 };
  }

  if (/2e\s*gratis|tweede\s*gratis|2\s*e\s*product\s*gratis/.test(text)) {
    return { promoType: 'BOGO', promoValue: null, promoQuantity: null };
  }

  const pct = text.match(/(\d+)\s*%/);
  if (pct) {
    return {
      promoType: 'PERCENTAGE',
      promoValue: parseInt(pct[1], 10) / 100,
      promoQuantity: null,
    };
  }

  const multi = text.match(/(\d+)\s*(?:voor|for)\s*€?\s*(\d+(?:[.,]\d+)?)/);
  if (multi) {
    return {
      promoType: 'MULTI_BUY',
      promoValue: parseFloat(multi[2].replace(',', '.')),
      promoQuantity: parseInt(multi[1], 10),
    };
  }

  return empty;
}

function stableProductId(storeSlug: StoreSlug, productName: string, size: string): string {
  const hash = crypto
    .createHash('sha1')
    .update(`${storeSlug}|${productName}|${size}`)
    .digest('hex')
    .slice(0, 12);
  return `${storeSlug}-${hash}`;
}

function resolveProductUrl(legacy: LegacyProduct): string | null {
  const candidate = legacy.l || legacy.i;
  if (!candidate?.startsWith('http')) return null;
  return candidate;
}

function resolveBarcode(legacy: LegacyProduct): string | null {
  if (legacy.b) {
    return normalizeBarcode(legacy.b);
  }
  for (const field of [legacy.l, legacy.i]) {
    const fromField = extractBarcodeFromText(field);
    if (fromField) return fromField;
  }
  return null;
}

function legacyToScraped(legacy: LegacyProduct, store: string): ScrapedProduct | null {
  const price = parseLegacyPrice(legacy.p);
  if (price == null) return null;

  const rawName = legacy.n?.trim() ?? '';
  if (shouldRejectProductName(rawName)) return null;

  const barcode = resolveBarcode(legacy);
  const size = legacy.s || 'stuk';
  const sanitized = sanitizeProductFields(rawName, size, barcode, {
    canonicalName: legacy.cn,
    identityKey: legacy.ik,
    brand: legacy.bn ?? null,
    weightInGrams: legacy.wg ?? null,
    packageSize: size,
    productName: rawName,
  });
  if (!sanitized) return null;

  const promo = parsePromoText(legacy.o);
  const scrapedAt = new Date().toISOString();
  const weightInGrams = sanitized.weightInGrams;

  return {
    productName: sanitized.productName,
    brand: sanitized.brand,
    packageSize: sanitized.packageSize,
    weightInGrams,
    price,
    unitPrice: weightInGrams ? price / (weightInGrams / 1000) : price,
    promoType: promo.promoType,
    promoValue: promo.promoValue,
    promoQuantity: promo.promoQuantity,
    promoValidUntil: null,
    store,
    productUrl: resolveProductUrl(legacy),
    scrapedAt,
    category: parseCategory(legacy.c),
    barcode,
    identityKey: sanitized.identityKey,
    canonicalName: sanitized.canonicalName,
  };
}

export function getWranglingPath(): string {
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return process.env.WRANGLING_PATH || path.join(projectRoot, 'compears-data-wrangling');
}

export function seedStoreFromWrangling(
  storeSlug: StoreSlug,
  storeName: string,
  filePath: string,
  country: CountryCode = DEFAULT_COUNTRY,
  maxProducts = Number(process.env.SEED_MAX_PRODUCTS ?? 0) || undefined
): SeedReport {
  const report: SeedReport = {
    store: storeSlug,
    sourceFile: filePath,
    totalRows: 0,
    seeded: 0,
    skippedInvalidPrice: 0,
    skippedRejected: 0,
    missingUrl: 0,
    withPromo: 0,
  };

  if (!fs.existsSync(filePath)) {
    logger.warn('Seed file not found:', filePath);
    return report;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const arr = JSON.parse(raw) as LegacyProduct[];
  if (!Array.isArray(arr)) {
    logger.warn('Expected JSON array at', filePath);
    return report;
  }

  report.totalRows = arr.length;
  const limit = maxProducts && maxProducts > 0 ? maxProducts : arr.length;
  const products: Product[] = [];

  for (let i = 0; i < Math.min(arr.length, limit); i++) {
    const item = arr[i];
    const scraped = legacyToScraped(item, storeName);
    if (!scraped) {
      if (item.n && shouldRejectProductName(item.n)) {
        report.skippedRejected += 1;
      } else {
        report.skippedInvalidPrice += 1;
      }
      continue;
    }

    if (!scraped.productUrl) report.missingUrl += 1;
    if (scraped.promoType) report.withPromo += 1;

    const id = stableProductId(storeSlug, scraped.productName, scraped.packageSize);
    products.push(
      toProduct(
        scraped,
        id,
        scraped.canonicalName ?? sanitizedFallbackName(scraped.productName),
        scraped.identityKey ?? id
      )
    );
  }

  saveStoreProducts(storeSlug, products, country);
  report.seeded = products.length;
  logger.info('Seeded', products.length, 'products for', storeSlug);
  return report;
}

function sanitizedFallbackName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function getAvailableStoreSlugs(): StoreSlug[] {
  return [...STORE_SLUGS];
}
