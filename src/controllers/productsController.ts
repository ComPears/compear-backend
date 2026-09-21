import { Request, Response } from 'express';
import { loadAllProducts, loadStoreProducts, getProductById, getProductsBySlug, getSeoProductGroups, getSeoProductGroupCount } from '../services/dataService';
import { createHash } from 'crypto';
import { StoreSlug, getStoreDisplayName } from '../config/stores';
import { countryFromQuery } from '../config/countries';
import { buildSearchCacheKey, getCached, setCached } from '../utils/searchCache';
import { searchProducts } from '../ai/semanticSearch';
import { getProductsByBarcode } from '../services/barcodeService';
import { normalizeBarcode } from '../utils/barcode';
import { productHasDietaryLabels, parseLabelsParam } from '../utils/dietaryLabels';
import { Product, ProductCategory } from '../types';
import { logger } from '../utils/logger';
import { routeParam } from '../utils/requestParams';

interface ProductPage {
  items: Product[];
  total: number;
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

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toProductListItem(product: Product): Omit<Product, 'productUrl' | 'scrapedAt'> {
  const { productUrl: _productUrl, scrapedAt: _scrapedAt, ...summary } = product;
  return summary;
}

export function listProducts(req: Request, res: Response): void {
  const startedAt = performance.now();
  try {
    const country = countryFromQuery(req);
    const search = (req.query.search as string)?.trim();
    const store = req.query.store as string | undefined;
    const category = req.query.category as string | undefined;
    const barcodeRaw = (req.query.barcode as string)?.trim();
    const barcode = barcodeRaw ? normalizeBarcode(barcodeRaw) : null;
    const limit = boundedInt(req.query.limit, 100, 1, 100);
    const offset = boundedInt(req.query.offset, 0, 0, 100_000);

    const labelsRaw = req.query.labels as string | undefined;
    const labels = parseLabelsParam(labelsRaw);

    if (barcodeRaw && !barcode) {
      res.json([]);
      return;
    }

    const cacheKey = buildSearchCacheKey(
      search,
      store,
      category,
      barcode ?? undefined,
      labelsRaw,
      country,
      limit,
      offset
    );
    const cached = getCached<ProductPage>(cacheKey);
    if (cached) {
      const durationMs = performance.now() - startedAt;
      res.setHeader('X-Total-Count', String(cached.total));
      res.setHeader('X-Result-Limit', String(limit));
      res.setHeader('X-Result-Offset', String(offset));
      res.setHeader('X-Search-Cache', 'hit');
      res.setHeader('Server-Timing', `products;dur=${durationMs.toFixed(1)}`);
      res.json(cached.items.map(toProductListItem));
      return;
    }

    let products: Product[];

    if (barcode) {
      products = getProductsByBarcode(barcode, country);
      if (store) {
        const storeName = getStoreDisplayName(store as StoreSlug);
        if (storeName) {
          products = products.filter((p) => p.store === storeName);
        }
      }
    } else if (search) {
      const source = loadAllProducts(country);
      const storeName = store ? getStoreDisplayName(store as StoreSlug) : null;
      products = searchProducts(
        search,
        Number.MAX_SAFE_INTEGER,
        source,
        storeName ? (product) => product.store === storeName : undefined
      );
    } else {
      products = store ? loadStoreProducts(store as StoreSlug, country) : loadAllProducts(country);
    }

    if (category && VALID_CATEGORIES.has(category as ProductCategory)) {
      products = products.filter((p) => p.category === category);
    }

    if (labels.length > 0) {
      products = products.filter((product) => productHasDietaryLabels(product, labels));
    }

    const total = products.length;
    const page = products.slice(offset, offset + limit);
    setCached<ProductPage>(cacheKey, { items: page, total });

    const durationMs = performance.now() - startedAt;
    res.setHeader('X-Total-Count', String(total));
    res.setHeader('X-Result-Limit', String(limit));
    res.setHeader('X-Result-Offset', String(offset));
    res.setHeader('X-Search-Cache', 'miss');
    res.setHeader('Server-Timing', `products;dur=${durationMs.toFixed(1)}`);
    logger.info('Product query completed', {
      country,
      search: search ?? null,
      store: store ?? null,
      returned: page.length,
      total,
      durationMs: Math.round(durationMs * 10) / 10,
    });
    res.json(page.map(toProductListItem));
  } catch (e) {
    logger.error('Product query failed', e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getProduct(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const id = routeParam(req.params.id);
    const product = getProductById(id, country);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getProductBySlug(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const products = getProductsBySlug(routeParam(req.params.slug), country);
    if (products.length === 0) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json({ product: products[0], offers: products });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Retain one serialized legacy response per live catalog, not a new object graph
// and JSON string for every crawler/build request. Invalidation changes the key.
const seoResponseByCatalog = new WeakMap<Product[], { body: Buffer; etag: string }>();

export function getSeoIndex(req: Request, res: Response): void {
  const country = countryFromQuery(req);
  res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  res.setHeader('X-Total-Count', String(getSeoProductGroupCount(country)));
  if (req.query.limit !== undefined || req.query.offset !== undefined) {
    const limit = boundedInt(req.query.limit, 250, 1, 500);
    const offset = boundedInt(req.query.offset, 0, 0, 1_000_000);
    res.setHeader('X-Result-Limit', String(limit));
    res.setHeader('X-Result-Offset', String(offset));
    res.json(getSeoProductGroups(country, offset, limit));
    return;
  }
  // Preserve the unpaginated array contract for older frontend deployments.
  const products = loadAllProducts(country);
  let cached = seoResponseByCatalog.get(products);
  if (!cached) {
    const body = Buffer.from(JSON.stringify(getSeoProductGroups(country)));
    cached = { body, etag: `"${createHash('sha256').update(body).digest('hex')}"` };
    seoResponseByCatalog.set(products, cached);
  }
  res.setHeader('ETag', cached.etag);
  res.type('application/json').send(cached.body);
}
