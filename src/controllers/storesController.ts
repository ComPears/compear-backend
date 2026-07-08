import { Request, Response } from 'express';
import { loadStoreProducts } from '../services/dataService';
import { STORE_SLUGS, STORES } from '../config/stores';

export function listStores(_req: Request, res: Response): void {
  try {
    const stores = STORE_SLUGS.map((slug) => {
      const info = STORES[slug];
      const productCount = loadStoreProducts(slug).length;
      return { ...info, productCount };
    });
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
