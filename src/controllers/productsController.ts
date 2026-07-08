import { Request, Response } from 'express';
import { loadAllProducts, loadStoreProducts, getProductById } from '../services/dataService';
import { STORE_SLUGS, StoreSlug } from '../config/stores';
import { buildSearchCacheKey, getCached, setCached } from '../utils/searchCache';
import { searchProducts } from '../ai/semanticSearch';
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
    const search = (req.query.search as string)?.trim();
    const store = req.query.store as string | undefined;
    const category = req.query.category as string | undefined;
    const cacheKey = buildSearchCacheKey(search, store, category);
    const cached = getCached<Product[]>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    let products: Product[];

    if (search) {
      const source = store ? loadStoreProducts(store as StoreSlug) : undefined;
      products = searchProducts(search, 100, source);
    } else {
      products = store ? loadStoreProducts(store as StoreSlug) : loadAllProducts();
    }

    if (category && VALID_CATEGORIES.has(category as ProductCategory)) {
      products = products.filter((p) => p.category === category);
    }

    setCached(cacheKey, products);
    res.json(products);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getProduct(req: Request, res: Response): void {
  try {
    const id = req.params.id;
    const product = getProductById(id);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.json(product);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
