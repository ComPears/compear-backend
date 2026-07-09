import * as fs from 'fs';
import * as path from 'path';
import { StoreSlug, STORE_SLUGS } from '../config/stores';

export interface StoreLocation {
  id: string;
  chain: StoreSlug;
  name: string;
  address: string;
  city: string;
  lat: number;
  lng: number;
  distanceKm?: number;
}

export interface StoreLocationDataset {
  source: 'openstreetmap';
  importedAt: string;
  attribution: string;
  count: number;
  locations: StoreLocation[];
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface ChainMatcher {
  slug: StoreSlug;
  test: (text: string, tags: Record<string, string>) => boolean;
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'ComPear/1.0 (https://compears.shop; store-locator import)';

const CHAIN_MATCHERS: ChainMatcher[] = [
  {
    slug: 'albert-heijn',
    test: (text) => /albert\s*heijn/i.test(text) || /\bah\s+(xl|to\s?go|city)?\b/i.test(text),
  },
  {
    slug: 'jumbo',
    test: (text) => /\bjumbo\b/i.test(text),
  },
  {
    slug: 'aldi',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'aldi' || /\baldi\b/i.test(text);
    },
  },
  {
    slug: 'dirk',
    test: (text) => /dirk(\s+van\s+den\s+broek)?/i.test(text),
  },
  {
    slug: 'lidl',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'lidl' || /\blidl\b/i.test(text);
    },
  },
  {
    slug: 'coop',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      if (brand === 'coop') return true;
      return /\bcoop\b/i.test(text) && !/cooper/i.test(text);
    },
  },
  {
    slug: 'plus',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      if (brand === 'plus') return true;
      if (!/\bplus\b/i.test(text)) return false;
      return !/plush|bonus|surplus|plusplus|coop/i.test(text);
    },
  },
];

const OVERPASS_QUERY = `
[out:json][timeout:180];
area["ISO3166-1"="NL"][admin_level=2]->.nl;
(
  node["shop"="supermarket"](area.nl);
  way["shop"="supermarket"](area.nl);
);
out center tags;
`.trim();

function detectChain(tags: Record<string, string>): StoreSlug | null {
  const text = [tags.brand, tags.name, tags.operator, tags['brand:name']]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return null;

  for (const matcher of CHAIN_MATCHERS) {
    if (matcher.test(text, tags)) return matcher.slug;
  }
  return null;
}

function elementCoords(el: OsmElement): { lat: number; lng: number } | null {
  if (typeof el.lat === 'number' && typeof el.lon === 'number') {
    return { lat: el.lat, lng: el.lon };
  }
  if (el.center) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function buildAddress(tags: Record<string, string>): string {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(' ');
  const postcode = tags['addr:postcode'] || '';
  const city = tags['addr:city'] || tags['addr:place'] || tags['addr:suburb'] || '';
  const parts = [street, [postcode, city].filter(Boolean).join(' ')].filter(Boolean);
  return parts.join(', ') || tags['addr:full'] || '';
}

function buildCity(tags: Record<string, string>): string {
  return (
    tags['addr:city'] ||
    tags['addr:place'] ||
    tags['addr:suburb'] ||
    tags['addr:municipality'] ||
    ''
  );
}

function toStoreLocation(el: OsmElement): StoreLocation | null {
  const tags = el.tags || {};
  const chain = detectChain(tags);
  if (!chain) return null;

  const coords = elementCoords(el);
  if (!coords) return null;

  const name = tags.name || tags.brand || chain;
  const city = buildCity(tags);
  const address = buildAddress(tags);

  return {
    id: `${chain}-${el.type}-${el.id}`,
    chain,
    name,
    address: address || city || name,
    city,
    lat: Math.round(coords.lat * 1e6) / 1e6,
    lng: Math.round(coords.lng * 1e6) / 1e6,
  };
}

async function fetchOsmElements(): Promise<OsmElement[]> {
  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Overpass API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { elements?: OsmElement[] };
  return data.elements || [];
}

export async function importStoreLocationsFromOsm(): Promise<StoreLocationDataset> {
  const elements = await fetchOsmElements();
  const byId = new Map<string, StoreLocation>();

  for (const el of elements) {
    const loc = toStoreLocation(el);
    if (!loc) continue;
    byId.set(loc.id, loc);
  }

  const locations = Array.from(byId.values()).sort((a, b) => {
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.name.localeCompare(b.name);
  });

  const counts = STORE_SLUGS.reduce(
    (acc, slug) => {
      acc[slug] = locations.filter((l) => l.chain === slug).length;
      return acc;
    },
    {} as Record<StoreSlug, number>
  );

  console.info('OSM import counts by chain:', counts);
  console.info(`Total: ${locations.length} store locations`);

  return {
    source: 'openstreetmap',
    importedAt: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors (ODbL)',
    count: locations.length,
    locations,
  };
}

export function writeStoreLocationDataset(outputPath: string, dataset: StoreLocationDataset): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf-8');
}

export function readStoreLocationDataset(filePath: string): StoreLocationDataset {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as StoreLocationDataset | StoreLocation[];

  // Legacy flat array (pre-OSM manual file)
  if (Array.isArray(parsed)) {
    return {
      source: 'openstreetmap',
      importedAt: '',
      attribution: '© OpenStreetMap contributors (ODbL)',
      count: parsed.length,
      locations: parsed,
    };
  }

  if (!parsed.locations || !Array.isArray(parsed.locations)) {
    throw new Error(`Invalid store locations file: ${filePath}`);
  }

  return parsed;
}
