import { Request, Response } from 'express';
import { loadStoreProducts } from '../services/dataService';
import { STORES, getStoreSlugsForCountry } from '../config/stores';
import { countryFromQuery } from '../config/countries';
import { isCatalogAvailable, loadCountryAvailability } from '../services/catalogAvailability';

export function listStores(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const availability = loadCountryAvailability(country, getStoreSlugsForCountry(country));
    const stores = getStoreSlugsForCountry(country).map((slug) => {
      const info = STORES[slug];
      const products = loadStoreProducts(slug, country);
      const latestPriceAt = products.reduce<string | null>((latest, product) => {
        if (!product.scrapedAt || !Number.isFinite(Date.parse(product.scrapedAt))) return latest;
        if (!latest || Date.parse(product.scrapedAt) > Date.parse(latest)) return product.scrapedAt;
        return latest;
      }, null);
      const state = availability?.find((entry) => entry.store === slug);
      const available = state ? isCatalogAvailable(state) : products.length > 0;
      return { ...info, productCount: available ? products.length : 0,
        latestPriceAt: latestPriceAt ?? state?.last_successful_at ?? null,
        availability: available ? 'available' : 'unavailable',
        availableUntil: state?.available_until ?? null,
        unavailableReason: available ? null : state?.available ? 'data_expired' : 'source_unavailable' };
    });
    res.json(stores);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
