import { Request, Response } from 'express';
import { loadStoreProducts } from '../services/dataService';
import { STORES, getStoreSlugsForCountry } from '../config/stores';
import { countryFromQuery } from '../config/countries';

export function listStores(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const stores = getStoreSlugsForCountry(country).map((slug) => {
      const info = STORES[slug];
      const products = loadStoreProducts(slug, country);
      const latestPriceAt = products.reduce<string | null>((latest, product) => {
        if (!product.scrapedAt || !Number.isFinite(Date.parse(product.scrapedAt))) return latest;
        if (!latest || Date.parse(product.scrapedAt) > Date.parse(latest)) return product.scrapedAt;
        return latest;
      }, null);
      return { ...info, productCount: products.length, latestPriceAt };
    });
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
