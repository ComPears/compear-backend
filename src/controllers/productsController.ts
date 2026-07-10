import { Request, Response } from 'express';
import { loadAllProducts, loadStoreProducts, getProductById } from '../services/dataService';
import { StoreSlug, getStoreDisplayName } from '../config/stores';
import { countryFromQuery } from '../config/countries';
import { buildSearchCacheKey, getCached, setCached } from '../utils/searchCache';
import { searchProducts } from '../ai/semanticSearch';
import { getProductsByBarcode } from '../services/barcodeService';
import { normalizeBarcode } from '../utils/barcode';
import { productHasDietaryLabels, parseLabelsParam } from '../utils/dietaryLabels';
import { Product, ProductCategory } from '../types';
import { logger } from '../utils/logger';

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
    const id = req.params.id;
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
