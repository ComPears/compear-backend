import { Request, Response } from 'express';
import { getStoreProductCount } from '../services/dataService';
import { STORES, getStoreSlugsForCountry } from '../config/stores';
import { countryFromQuery } from '../config/countries';

export function listStores(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const stores = getStoreSlugsForCountry(country).map((slug) => {
      const info = STORES[slug];
      const productCount = getStoreProductCount(slug, country);
      return { ...info, productCount };
    });
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
