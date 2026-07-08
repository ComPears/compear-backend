import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { PromoType, Product, ScrapedProduct } from '../types';
import { toProduct } from './promotionService';
import { simpleCanonicalName } from '../utils/canonicalName';
import { saveStoreProducts } from './dataService';
import { STORE_SLUGS, StoreSlug } from '../config/stores';
import { logger } from '../utils/logger';

interface LegacyProduct {
  n: string;
  o?: string;
  p: string;
  s?: string;
  l?: string;
  i?: string;
}

export interface SeedReport {
  store: StoreSlug;
  sourceFile: string;
  totalRows: number;
  seeded: number;
  skippedInvalidPrice: number;
  missingUrl: number;
  withPromo: number;
}

const STORE_CONFIG: Array<{ slug: StoreSlug; displayName: string; relPath: string }> = [
  { slug: 'albert-heijn', displayName: 'Albert Heijn', relPath: 'AH/structured_all_merged.json' },
  { slug: 'jumbo', displayName: 'Jumbo', relPath: 'JUMBO/jumbo_structured.json' },
  { slug: 'aldi', displayName: 'ALDI', relPath: 'ALDI/structured_aldi.json' },
  { slug: 'dirk', displayName: 'Dirk', relPath: 'DIRK/dirk_all.json' },
  { slug: 'lidl', displayName: 'Lidl', relPath: 'LIDL/lidl_structured.json' },
  { slug: 'coop', displayName: 'Coop', relPath: 'COOP/coop_structured.json' },
  { slug: 'plus', displayName: 'PLUS', relPath: 'PLUS/structured_plus.json' },
];

function parseLegacyPrice(p: string): number | null {
  const normalized = String(p).trim().replace(',', '.');
  if (!normalized) return null;
  const n = parseFloat(normalized);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function parseWeightFromSize(s: string): number | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  const gMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*g(?:ram)?/);
  if (gMatch) return Math.round(parseFloat(gMatch[1].replace(',', '.')));
  const kgMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1].replace(',', '.')) * 1000);
  const mlMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*ml/);
  if (mlMatch) return Math.round(parseFloat(mlMatch[1].replace(',', '.')));
  const lMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*l(?:iter)?(?!\w)/);
  if (lMatch) return Math.round(parseFloat(lMatch[1].replace(',', '.')) * 1000);
  return null;
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

function legacyToScraped(legacy: LegacyProduct, store: string): ScrapedProduct | null {
  const price = parseLegacyPrice(legacy.p);
  if (price == null) return null;

  const size = legacy.s || 'stuk';
  const weightInGrams = parseWeightFromSize(size);
  const promo = parsePromoText(legacy.o);
  const scrapedAt = new Date().toISOString();

  return {
    productName: legacy.n,
    brand: null,
    packageSize: size,
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
  maxProducts = Number(process.env.SEED_MAX_PRODUCTS ?? 0) || undefined
): SeedReport {
  const report: SeedReport = {
    store: storeSlug,
    sourceFile: filePath,
    totalRows: 0,
    seeded: 0,
    skippedInvalidPrice: 0,
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
      report.skippedInvalidPrice += 1;
      continue;
    }

    if (!scraped.productUrl) report.missingUrl += 1;
    if (scraped.promoType) report.withPromo += 1;

    const id = stableProductId(storeSlug, scraped.productName, scraped.packageSize);
    const canonicalName = simpleCanonicalName(scraped.productName);
    products.push(toProduct(scraped, id, canonicalName));
  }

  saveStoreProducts(storeSlug, products);
  report.seeded = products.length;
  logger.info('Seeded', products.length, 'products for', storeSlug);
  return report;
}

export function seedAllStoresFromWrangling(wranglingPath = getWranglingPath()): SeedReport[] {
  const reports: SeedReport[] = [];

  for (const { slug, displayName, relPath } of STORE_CONFIG) {
    const filePath = path.join(wranglingPath, relPath);
    reports.push(seedStoreFromWrangling(slug, displayName, filePath));
  }

  const total = reports.reduce((sum, r) => sum + r.seeded, 0);
  logger.info('Total products seeded:', total);
  return reports;
}

export function getAvailableStoreSlugs(): StoreSlug[] {
  return [...STORE_SLUGS];
}
