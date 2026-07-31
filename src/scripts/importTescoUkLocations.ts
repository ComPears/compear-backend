/**
 * Fetch missing Tesco UK locations and merge into store-locations.json.
 * Usage: npx ts-node src/scripts/importTescoUkLocations.ts
 */
import * as path from 'path';
import {
  fetchOsmElements,
  readStoreLocationDataset,
  writeStoreLocationDataset,
  StoreLocation,
} from '../services/storeLocationImport';
import { StoreSlug } from '../config/stores';

const outputPath = path.join(__dirname, '../data/store-locations.json');

const QUERIES = [
  `[out:json][timeout:120];area["ISO3166-1"="GB"][admin_level=2]->.a;(node["shop"="supermarket"]["brand"~"Tesco",i](area.a);way["shop"="supermarket"]["brand"~"Tesco",i](area.a););out center tags;`,
  `[out:json][timeout:120];area["ISO3166-1"="GB"][admin_level=2]->.a;(node["shop"="convenience"]["brand"~"Tesco",i](area.a);way["shop"="convenience"]["brand"~"Tesco",i](area.a););out center tags;`,
  `[out:json][timeout:120];area["ISO3166-1"="GB"][admin_level=2]->.a;(node["brand:wikidata"="Q487494"](area.a);way["brand:wikidata"="Q487494"](area.a););out center tags;`,
];

function elementToLocation(el: {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}): StoreLocation | null {
  const tags = el.tags || {};
  const text = [tags.brand, tags.name, tags.operator].filter(Boolean).join(' ');
  if (!/tesco/i.test(text) && tags['brand:wikidata'] !== 'Q487494') return null;
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (lat == null || lng == null) return null;
  const city =
    tags['addr:city'] || tags['addr:place'] || tags['addr:suburb'] || tags['addr:town'] || '';
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const postcode = tags['addr:postcode'] || '';
  const address =
    [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') ||
    tags['addr:full'] ||
    city ||
    tags.name ||
    'Tesco';
  return {
    id: `uk-tesco-${el.type}-${el.id}`,
    chain: 'tesco' as StoreSlug,
    country: 'uk',
    name: tags.name || tags.brand || 'Tesco',
    address,
    city,
    lat: Math.round(lat * 1e6) / 1e6,
    lng: Math.round(lng * 1e6) / 1e6,
  };
}

async function main(): Promise<void> {
  const byId = new Map<string, StoreLocation>();
  for (const [i, query] of QUERIES.entries()) {
    console.info(`Tesco query ${i + 1}/${QUERIES.length}`);
    try {
      const elements = await fetchOsmElements({ region: 'uk', query });
      console.info(`  → ${elements.length} elements`);
      for (const el of elements) {
        const loc = elementToLocation(el);
        if (loc) byId.set(loc.id, loc);
      }
    } catch (error) {
      console.warn(`  failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  const tesco = Array.from(byId.values());
  console.info(`Tesco locations matched: ${tesco.length}`);
  const dataset = readStoreLocationDataset(outputPath);
  const kept = dataset.locations.filter((l) => !(l.country === 'uk' && l.chain === 'tesco'));
  const merged = [...kept, ...tesco].sort((a, b) => {
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.name.localeCompare(b.name);
  });
  dataset.locations = merged;
  dataset.count = merged.length;
  dataset.importedAt = new Date().toISOString();
  writeStoreLocationDataset(outputPath, dataset);
  console.info(`Wrote ${dataset.count} locations (incl. ${tesco.length} Tesco)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
