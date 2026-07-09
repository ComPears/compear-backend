import { Request, Response } from 'express';
import { loadAllProducts, loadStoreProducts, getProductById } from '../services/dataService';
import { StoreSlug, getStoreDisplayName } from '../config/stores';
import { countryFromQuery } from '../config/countries';
import { buildSearchCacheKey, getCached, setCached } from '../utils/searchCache';
import { searchProducts } from '../ai/semanticSearch';
import { getProductsByBarcode } from '../services/barcodeService';
import { normalizeBarcode } from '../utils/barcode';
import { productMatchesLabels, parseLabelsParam } from '../utils/dietaryLabels';
import { Product, ProductCategory } from '../types';

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

export function listProducts(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const search = (req.query.search as string)?.trim();
    const store = req.query.store as string | undefined;
    const category = req.query.category as string | undefined;
    const barcodeRaw = (req.query.barcode as string)?.trim();
    const barcode = barcodeRaw ? normalizeBarcode(barcodeRaw) : null;

    const labelsRaw = req.query.labels as string | undefined;
    const labels = parseLabelsParam(labelsRaw);

    if (barcodeRaw && !barcode) {
      res.json([]);
      return;
    }

    const cacheKey = buildSearchCacheKey(search, store, category, barcode ?? undefined, labelsRaw, country);
    const cached = getCached<Product[]>(cacheKey);
    if (cached) {
      res.json(cached);
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
      const source = store ? loadStoreProducts(store as StoreSlug, country) : undefined;
      products = searchProducts(search, 100, source);
    } else {
      products = store ? loadStoreProducts(store as StoreSlug, country) : loadAllProducts(country);
    }

    if (category && VALID_CATEGORIES.has(category as ProductCategory)) {
      products = products.filter((p) => p.category === category);
    }

    if (labels.length > 0) {
      products = products.filter((p) =>
        productMatchesLabels(p.productName, p.canonicalName, labels)
      );
    }

    setCached(cacheKey, products);
    res.json(products);
  } catch (e) {
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
