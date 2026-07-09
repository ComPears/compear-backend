import { Request, Response } from 'express';
import * as path from 'path';
import { runAlbertHeijnScraper } from '../scrapers/albert-heijn';
import { STORE_SLUGS, StoreSlug } from '../config/stores';
import {
  catalogRelPath,
  countryFromQuery,
  DEFAULT_COUNTRY,
  loadWranglingConfig,
} from '../config/countries';
import { logger } from '../utils/logger';
import { seedAllStoresFromWrangling, seedStoreFromWrangling, getWranglingPath } from '../services/seedService';

let lastScrapeStatus: { store: string; count: number; error?: string; at: string } | null = null;
let scrapeInProgress = false;

export async function triggerScrape(req: Request, res: Response): Promise<void> {
  const store = (req.params.store || '').toLowerCase().replace(/\s+/g, '-');
  const country = countryFromQuery(req);

  if (scrapeInProgress) {
    res.status(409).json({ error: 'Scrape already in progress' });
    return;
  }

  if (store === 'seed-all') {
    scrapeInProgress = true;
    try {
      const reports = seedAllStoresFromWrangling(getWranglingPath(), country);
      const total = reports.reduce((sum, r) => sum + r.seeded, 0);
      lastScrapeStatus = { store: 'seed-all', count: total, at: new Date().toISOString() };
      res.json({ success: true, mode: 'seed', country, productsSeeded: total, reports });
    } catch (e) {
      logger.error('Seed-all failed', e);
      res.status(500).json({ success: false, error: 'Seed failed' });
    } finally {
      scrapeInProgress = false;
    }
    return;
  }

  if (!STORE_SLUGS.includes(store as StoreSlug)) {
    res.status(400).json({
      error: 'Unknown store',
      available: [...STORE_SLUGS, 'seed-all'],
    });
    return;
  }

  const slug = store as StoreSlug;
  scrapeInProgress = true;

  try {
    if (slug === 'albert-heijn' && country === DEFAULT_COUNTRY) {
      const count = await runAlbertHeijnScraper();
      lastScrapeStatus = { store: slug, count, at: new Date().toISOString() };
      res.json({ success: true, mode: 'scrape', productsScraped: count, store: slug, country });
      return;
    }

    const wranglingPath = getWranglingPath();
    const config = loadWranglingConfig(wranglingPath);
    const storeConfig = config.countries[country]?.stores?.[slug];
    if (storeConfig) {
      const relPath = catalogRelPath(config, country, slug);
      const filePath = path.join(wranglingPath, relPath);
      const report = seedStoreFromWrangling(slug, storeConfig.display_name, filePath, country);
      lastScrapeStatus = { store: slug, count: report.seeded, at: new Date().toISOString() };
      res.json({ success: true, mode: 'seed', productsSeeded: report.seeded, store: slug, country, report });
      return;
    }

    lastScrapeStatus = { store: slug, count: 0, error: 'Scraper not implemented', at: new Date().toISOString() };
    res.status(501).json({
      success: false,
      productsScraped: 0,
      store: slug,
      country,
      message: 'Scraper for this store not yet implemented',
    });
  } catch (e) {
    logger.error('Scrape/seed failed', store, e);
    lastScrapeStatus = {
      store: slug,
      count: 0,
      error: e instanceof Error ? e.message : 'Unknown error',
      at: new Date().toISOString(),
    };
    res.status(500).json({ success: false, error: 'Scrape/seed failed' });
  } finally {
    scrapeInProgress = false;
  }
}

export function getScrapeStatus(_req: Request, res: Response): void {
  res.json(lastScrapeStatus ?? { store: null, count: 0, at: null });
}
