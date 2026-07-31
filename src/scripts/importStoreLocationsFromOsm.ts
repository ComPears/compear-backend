import * as path from 'path';
import * as fs from 'fs';
import {
  importStoreLocationsFromOsm,
  OsmRegion,
  readStoreLocationDataset,
  writeStoreLocationDataset,
  StoreLocation,
} from '../services/storeLocationImport';

const outputPath = path.join(__dirname, '../data/store-locations.json');

function parseRegions(): OsmRegion[] {
  const raw = process.env.OSM_REGIONS?.trim();
  if (!raw) return ['nl', 'uk'];
  return raw
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part): part is OsmRegion => part === 'nl' || part === 'uk');
}

function mergeById(
  existing: StoreLocation[],
  incoming: StoreLocation[],
  replaceCountries: Set<string>
): StoreLocation[] {
  const byId = new Map<string, StoreLocation>();
  for (const loc of existing) {
    if (replaceCountries.has(loc.country)) continue;
    byId.set(loc.id, loc);
  }
  for (const loc of incoming) {
    byId.set(loc.id, loc);
  }
  return Array.from(byId.values());
}

async function main(): Promise<void> {
  const regions = parseRegions();
  console.info(`Fetching supermarket locations from OpenStreetMap for: ${regions.join(', ')}`);
  const dataset = await importStoreLocationsFromOsm(regions);

  if (fs.existsSync(outputPath) && regions.length < 2) {
    const previous = readStoreLocationDataset(outputPath);
    const merged = mergeById(
      previous.locations,
      dataset.locations,
      new Set(regions)
    );
    dataset.locations = merged.sort((a, b) => {
      if (a.country !== b.country) return a.country.localeCompare(b.country);
      if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
      if (a.city !== b.city) return a.city.localeCompare(b.city);
      return a.name.localeCompare(b.name);
    });
    dataset.count = dataset.locations.length;
    console.info(`Merged with existing file → ${dataset.count} total locations`);
  }

  writeStoreLocationDataset(outputPath, dataset);
  console.info(`Wrote ${dataset.count} locations to ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
