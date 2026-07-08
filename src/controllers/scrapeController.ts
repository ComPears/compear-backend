import { Request, Response } from 'express';
import { runAlbertHeijnScraper } from '../scrapers/albert-heijn';
import { STORE_SLUGS, StoreSlug } from '../config/stores';
import { logger } from '../utils/logger';
import { seedAllStoresFromWrangling, seedStoreFromWrangling, getWranglingPath } from '../services/seedService';
import * as path from 'path';

let lastScrapeStatus: { store: string; count: number; error?: string; at: string } | null = null;
let scrapeInProgress = false;

const SEED_STORE_PATHS: Partial<Record<StoreSlug, { displayName: string; relPath: string }>> = {
  'albert-heijn': { displayName: 'Albert Heijn', relPath: 'AH/structured_all_merged.json' },
  jumbo: { displayName: 'Jumbo', relPath: 'JUMBO/jumbo_structured.json' },
  aldi: { displayName: 'ALDI', relPath: 'ALDI/structured_aldi.json' },
  dirk: { displayName: 'Dirk', relPath: 'DIRK/dirk_all.json' },
  lidl: { displayName: 'Lidl', relPath: 'LIDL/lidl_structured.json' },
  coop: { displayName: 'Coop', relPath: 'COOP/coop_structured.json' },
  plus: { displayName: 'PLUS', relPath: 'PLUS/structured_plus.json' },
};

export async function triggerScrape(req: Request, res: Response): Promise<void> {
  const store = (req.params.store || '').toLowerCase().replace(/\s+/g, '-');

  if (scrapeInProgress) {
    res.status(409).json({ error: 'Scrape already in progress' });
    return;
  }

  if (store === 'seed-all') {
    scrapeInProgress = true;
    try {
      const reports = seedAllStoresFromWrangling();
      const total = reports.reduce((sum, r) => sum + r.seeded, 0);
      lastScrapeStatus = { store: 'seed-all', count: total, at: new Date().toISOString() };
      res.json({ success: true, mode: 'seed', productsSeeded: total, reports });
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
    if (slug === 'albert-heijn') {
      const count = await runAlbertHeijnScraper();
      lastScrapeStatus = { store: slug, count, at: new Date().toISOString() };
      res.json({ success: true, mode: 'scrape', productsScraped: count, store: slug });
      return;
    }

    const seedConfig = SEED_STORE_PATHS[slug];
    if (seedConfig) {
      const filePath = path.join(getWranglingPath(), seedConfig.relPath);
      const report = seedStoreFromWrangling(slug, seedConfig.displayName, filePath);
      lastScrapeStatus = { store: slug, count: report.seeded, at: new Date().toISOString() };
      res.json({ success: true, mode: 'seed', productsSeeded: report.seeded, store: slug, report });
      return;
    }

    lastScrapeStatus = { store: slug, count: 0, error: 'Scraper not implemented', at: new Date().toISOString() };
    res.status(501).json({
      success: false,
      productsScraped: 0,
      store: slug,
      message: 'Scraper for this store not yet implemented',
    });
  } catch (e) {
    const err = e as Error;
    logger.error('Scrape failed', err);
    lastScrapeStatus = { store: slug, count: 0, error: err.message, at: new Date().toISOString() };
    res.status(500).json({
      success: false,
      productsScraped: 0,
      store: slug,
      error: 'Scrape failed',
    });
  } finally {
    scrapeInProgress = false;
  }
}

export function getScrapeStatus(_req: Request, res: Response): void {
  res.json({
    lastRun: lastScrapeStatus,
    availableStores: STORE_SLUGS,
    availableActions: [...STORE_SLUGS, 'seed-all'],
    inProgress: scrapeInProgress,
  });
}
