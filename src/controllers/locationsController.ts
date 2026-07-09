import * as fs from 'fs';
import * as path from 'path';
import { Request, Response } from 'express';
import { StoreSlug, STORE_SLUGS } from '../config/stores';
import {
  readStoreLocationDataset,
  StoreLocation,
} from '../services/storeLocationImport';

export type { StoreLocation };

const locationsPath = path.join(__dirname, '../data/store-locations.json');

let cached: StoreLocation[] | null = null;
let cachedMeta: { importedAt: string; count: number } | null = null;

function loadLocations(): StoreLocation[] {
  if (cached) return cached;

  if (!fs.existsSync(locationsPath)) {
    throw new Error(
      'Store locations not found. Run: npm run import-stores'
    );
  }

  const dataset = readStoreLocationDataset(locationsPath);
  cached = dataset.locations;
  cachedMeta = { importedAt: dataset.importedAt, count: dataset.count };
  return cached;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function listStoreLocations(req: Request, res: Response): void {
  try {
    const chain = (req.query.chain as string | undefined)?.toLowerCase();
    const city = (req.query.city as string | undefined)?.toLowerCase();
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radiusKm = Math.min(50, Math.max(1, parseFloat(req.query.radius as string) || 25));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));

    let locations = loadLocations();

    if (chain && STORE_SLUGS.includes(chain as StoreSlug)) {
      locations = locations.filter((l) => l.chain === chain);
    }
    if (city) {
      locations = locations.filter((l) => l.city.toLowerCase().includes(city));
    }

    if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
      locations = locations
        .map((l) => ({ ...l, distanceKm: haversineKm(lat, lng, l.lat, l.lng) }))
        .filter((l) => (l.distanceKm ?? 0) <= radiusKm)
        .sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    }

    if (cachedMeta?.importedAt) {
      res.setHeader('X-Store-Locations-Imported-At', cachedMeta.importedAt);
    }

    res.json(locations.slice(0, limit));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal server error';
    res.status(message.includes('not found') ? 503 : 500).json({ error: message });
  }
}
