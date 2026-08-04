import * as fs from 'fs';
import * as path from 'path';
import { StoreSlug, STORE_SLUGS, getStoreSlugsForCountry } from '../config/stores';
import { CountryCode } from '../config/countries';

export interface StoreLocation {
  id: string;
  chain: StoreSlug;
  /** Country this location belongs to (nl / uk / de). */
  country: CountryCode;
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

export type OsmRegion = 'nl' | 'uk' | 'de';

/** Primary + public Overpass mirrors (rotated on 429/5xx/network errors). */
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const USER_AGENT = 'ComPear/1.0 (https://compears.shop; store-locator import)';
const FETCH_TIMEOUT_MS = 210_000;
const MAX_ATTEMPTS = 5;
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

const NL_CHAIN_MATCHERS: ChainMatcher[] = [
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

const UK_CHAIN_MATCHERS: ChainMatcher[] = [
  {
    slug: 'tesco',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand.includes('tesco') || /\btesco\b/i.test(text);
    },
  },
  {
    slug: 'sainsburys',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand.includes('sainsbury') || /sainsbury/i.test(text);
    },
  },
  {
    slug: 'asda',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'asda' || /\basda\b/i.test(text);
    },
  },
  {
    slug: 'morrisons',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand.includes('morrison') || /morrison/i.test(text);
    },
  },
  {
    slug: 'aldi-uk',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'aldi' || /\baldi\b/i.test(text);
    },
  },
  {
    slug: 'lidl-uk',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'lidl' || /\blidl\b/i.test(text);
    },
  },
];

/** German chain matchers (sample catalogs live; OSM import optional via region=de). */
const DE_CHAIN_MATCHERS: ChainMatcher[] = [
  {
    slug: 'edeka',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand.includes('edeka') || /\bedeka\b/i.test(text);
    },
  },
  {
    slug: 'rewe',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'rewe' || /\brewe\b/i.test(text);
    },
  },
  {
    slug: 'lidl-de',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'lidl' || /\blidl\b/i.test(text);
    },
  },
  {
    slug: 'aldi-sud',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return (
        brand.includes('aldi') ||
        /aldi\s*(süd|sued|sud)?/i.test(text) ||
        /\baldi\b/i.test(text)
      );
    },
  },
  {
    slug: 'penny',
    test: (text, tags) => {
      const brand = (tags.brand || '').toLowerCase();
      return brand === 'penny' || /\bpenny\b/i.test(text);
    },
  },
];

const REGION_CONFIG: Record<
  OsmRegion,
  { iso: string; country: CountryCode; matchers: ChainMatcher[] }
> = {
  nl: { iso: 'NL', country: 'nl', matchers: NL_CHAIN_MATCHERS },
  uk: { iso: 'GB', country: 'uk', matchers: UK_CHAIN_MATCHERS },
  de: { iso: 'DE', country: 'de', matchers: DE_CHAIN_MATCHERS },
};

function overpassQueryForRegion(iso: string): string {
  return `
[out:json][timeout:180];
area["ISO3166-1"="${iso}"][admin_level=2]->.searchArea;
(
  node["shop"="supermarket"](area.searchArea);
  way["shop"="supermarket"](area.searchArea);
);
out center tags;
`.trim();
}

/** Smaller per-brand GB queries — full UK supermarket dumps often time out or return empty. */
function overpassQueriesForUkBrand(brandRegex: string): string[] {
  // Split supermarket vs convenience so large chains (Tesco) fit Overpass limits.
  return [
    `
[out:json][timeout:120];
area["ISO3166-1"="GB"][admin_level=2]->.searchArea;
(
  node["shop"="supermarket"]["brand"~"${brandRegex}",i](area.searchArea);
  way["shop"="supermarket"]["brand"~"${brandRegex}",i](area.searchArea);
);
out center tags;
`.trim(),
    `
[out:json][timeout:120];
area["ISO3166-1"="GB"][admin_level=2]->.searchArea;
(
  node["shop"="convenience"]["brand"~"${brandRegex}",i](area.searchArea);
  way["shop"="convenience"]["brand"~"${brandRegex}",i](area.searchArea);
);
out center tags;
`.trim(),
    `
[out:json][timeout:120];
area["ISO3166-1"="GB"][admin_level=2]->.searchArea;
(
  node["shop"~"^(supermarket|convenience)$"]["name"~"${brandRegex}",i](area.searchArea);
  way["shop"~"^(supermarket|convenience)$"]["name"~"${brandRegex}",i](area.searchArea);
);
out center tags;
`.trim(),
  ];
}

const UK_BRAND_QUERIES: { label: string; regex: string }[] = [
  { label: 'tesco', regex: 'Tesco' },
  { label: 'sainsburys', regex: 'Sainsbury' },
  { label: 'asda', regex: 'Asda' },
  { label: 'morrisons', regex: 'Morrison' },
  { label: 'aldi', regex: 'Aldi' },
  { label: 'lidl', regex: 'Lidl' },
];

function detectChain(
  tags: Record<string, string>,
  matchers: ChainMatcher[]
): StoreSlug | null {
  const text = [tags.brand, tags.name, tags.operator, tags['brand:name']]
    .filter(Boolean)
    .join(' ')
    .trim();
  if (!text) return null;

  for (const matcher of matchers) {
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

function toStoreLocation(
  el: OsmElement,
  region: OsmRegion,
  matchers: ChainMatcher[]
): StoreLocation | null {
  const tags = el.tags || {};
  const chain = detectChain(tags, matchers);
  if (!chain) return null;

  const coords = elementCoords(el);
  if (!coords) return null;

  const country = REGION_CONFIG[region].country;
  const name = tags.name || tags.brand || chain;
  const city = buildCity(tags);
  const address = buildAddress(tags);

  return {
    id: `${country}-${chain}-${el.type}-${el.id}`,
    chain,
    country,
    name,
    address: address || city || name,
    city,
    lat: Math.round(coords.lat * 1e6) / 1e6,
    lng: Math.round(coords.lng * 1e6) / 1e6,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function overpassBackoffMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}

async function postOverpass(
  endpoint: string,
  query: string,
  fetchImpl: typeof fetch = fetch
): Promise<OsmElement[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      const error = new Error(
        `Overpass API error ${response.status} from ${endpoint}: ${body.slice(0, 200)}`
      ) as Error & { status?: number; retryable?: boolean };
      error.status = response.status;
      error.retryable = RETRYABLE_STATUS.has(response.status);
      throw error;
    }

    const data = (await response.json()) as { elements?: OsmElement[] };
    return data.elements || [];
  } finally {
    clearTimeout(timer);
  }
}

/** Exported for tests; production callers use importStoreLocationsFromOsm. */
export async function fetchOsmElements(
  options: {
    endpoints?: string[];
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    sleepImpl?: (ms: number) => Promise<void>;
    query?: string;
    region?: OsmRegion;
  } = {}
): Promise<OsmElement[]> {
  const endpoints = options.endpoints?.length ? options.endpoints : OVERPASS_ENDPOINTS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const sleepImpl = options.sleepImpl ?? sleep;
  const region = options.region ?? 'nl';
  const query = options.query ?? overpassQueryForRegion(REGION_CONFIG[region].iso);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const endpoint = endpoints[(attempt - 1) % endpoints.length];
    try {
      console.info(`Overpass attempt ${attempt}/${maxAttempts} via ${endpoint} (${region})`);
      return await postOverpass(endpoint, query, fetchImpl);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof Error &&
        ((error as Error & { retryable?: boolean }).retryable === true ||
          error.name === 'AbortError' ||
          /fetch failed|network|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(error.message));
      if (!retryable || attempt === maxAttempts) {
        throw error instanceof Error
          ? error
          : new Error(`Overpass request failed: ${String(error)}`);
      }
      const delay = overpassBackoffMs(attempt);
      console.warn(
        `Overpass attempt ${attempt} failed (${error instanceof Error ? error.message : error}); retrying in ${delay}ms…`
      );
      await sleepImpl(delay);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Overpass request failed after ${maxAttempts} attempts`);
}

function buildDataset(locations: StoreLocation[]): StoreLocationDataset {
  const sorted = [...locations].sort((a, b) => {
    if (a.country !== b.country) return a.country.localeCompare(b.country);
    if (a.chain !== b.chain) return a.chain.localeCompare(b.chain);
    if (a.city !== b.city) return a.city.localeCompare(b.city);
    return a.name.localeCompare(b.name);
  });

  const counts = STORE_SLUGS.reduce(
    (acc, slug) => {
      acc[slug] = sorted.filter((l) => l.chain === slug).length;
      return acc;
    },
    {} as Record<StoreSlug, number>
  );

  console.info('OSM import counts by chain:', counts);
  console.info(`Total: ${sorted.length} store locations`);

  return {
    source: 'openstreetmap',
    importedAt: new Date().toISOString(),
    attribution: '© OpenStreetMap contributors (ODbL)',
    count: sorted.length,
    locations: sorted,
  };
}

/** Import supermarket locations for one or more regions (default: NL + UK). */
export async function importStoreLocationsFromOsm(
  regions: OsmRegion[] = ['nl', 'uk']
): Promise<StoreLocationDataset> {
  const byId = new Map<string, StoreLocation>();

  for (const region of regions) {
    const cfg = REGION_CONFIG[region];
    console.info(`Fetching ${region.toUpperCase()} supermarket locations from OpenStreetMap…`);

    let elements: OsmElement[] = [];
    if (region === 'uk') {
      for (const brand of UK_BRAND_QUERIES) {
        console.info(`  UK brand query: ${brand.label}`);
        let brandCount = 0;
        for (const query of overpassQueriesForUkBrand(brand.regex)) {
          try {
            const chunk = await fetchOsmElements({
              region: 'uk',
              query,
            });
            brandCount += chunk.length;
            elements.push(...chunk);
          } catch (error) {
            console.warn(
              `  ${brand.label} sub-query failed: ${error instanceof Error ? error.message : error}`
            );
          }
          await sleep(800);
        }
        console.info(`  ${brand.label}: ${brandCount} OSM elements`);
        await sleep(1500);
      }
    } else {
      elements = await fetchOsmElements({ region });
    }

    let added = 0;
    for (const el of elements) {
      const loc = toStoreLocation(el, region, cfg.matchers);
      if (!loc) continue;
      // Keep only chains that belong to this country registry.
      if (!getStoreSlugsForCountry(cfg.country).includes(loc.chain)) continue;
      byId.set(loc.id, loc);
      added += 1;
    }
    console.info(`${region.toUpperCase()}: kept ${added} matched locations from ${elements.length} OSM elements`);
  }

  return buildDataset(Array.from(byId.values()));
}

export function writeStoreLocationDataset(outputPath: string, dataset: StoreLocationDataset): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf-8');
}

export function readStoreLocationDataset(filePath: string): StoreLocationDataset {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as StoreLocationDataset | StoreLocation[];

  if (Array.isArray(parsed)) {
    return {
      source: 'openstreetmap',
      importedAt: '',
      attribution: '© OpenStreetMap contributors (ODbL)',
      count: parsed.length,
      locations: parsed.map((loc) => ({
        ...loc,
        country: loc.country ?? inferCountryFromChain(loc.chain),
      })),
    };
  }

  if (!parsed.locations || !Array.isArray(parsed.locations)) {
    throw new Error(`Invalid store locations file: ${filePath}`);
  }

  return {
    ...parsed,
    locations: parsed.locations.map((loc) => ({
      ...loc,
      country: loc.country ?? inferCountryFromChain(loc.chain),
    })),
  };
}

function inferCountryFromChain(chain: StoreSlug): CountryCode {
  if (getStoreSlugsForCountry('uk').includes(chain)) return 'uk';
  if (getStoreSlugsForCountry('de').includes(chain)) return 'de';
  return 'nl';
}
