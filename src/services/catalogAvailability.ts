import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { CountryCode } from '../config/countries';

export interface CatalogAvailability {
  country: string;
  store: string;
  available: boolean;
  available_until: string | null;
  last_successful_at: string | null;
  catalog_sha256: string | null;
  products: number;
  reason_codes: string[];
}

export function parseAvailabilityManifest(value: unknown, country: CountryCode, slugs: string[]): CatalogAvailability[] {
  const manifest = value as { schema_version?: unknown; stores?: unknown };
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.stores)) {
    throw new Error('Invalid catalog availability manifest');
  }
  const entries = manifest.stores.filter((row) => row?.country === country) as CatalogAvailability[];
  if (entries.length !== slugs.length || new Set(entries.map((row) => row.store)).size !== slugs.length) {
    throw new Error('Incomplete or duplicate catalog availability entries');
  }
  for (const row of entries) {
    if (!slugs.includes(row.store) || typeof row.available !== 'boolean' ||
        !Number.isInteger(row.products) || row.products < 0 ||
        !Array.isArray(row.reason_codes) || !row.reason_codes.every((reason) => typeof reason === 'string') ||
        (row.available && (!row.products || !Number.isFinite(Date.parse(row.available_until ?? '')) ||
          !Number.isFinite(Date.parse(row.last_successful_at ?? '')) ||
          !/^[a-f0-9]{64}$/.test(row.catalog_sha256 ?? '')))) {
      throw new Error('Invalid retailer availability entry');
    }
  }
  return entries;
}

export function isCatalogAvailable(row: CatalogAvailability, now = Date.now()): boolean {
  return row.available && Number.isFinite(Date.parse(row.available_until ?? '')) &&
    Date.parse(row.available_until!) > now;
}

export function verifyAvailableCatalog(row: CatalogAvailability, bytes: Buffer, maximumAgeHours = 48, now = Date.now()): void {
  if (createHash('sha256').update(bytes).digest('hex') !== row.catalog_sha256) {
    throw new Error('Catalog checksum does not match its availability manifest');
  }
  const products = JSON.parse(bytes.toString('utf8')) as Array<{ observedAt?: string }>;
  if (!Array.isArray(products) || products.length !== row.products) throw new Error('Catalog count mismatch');
  let oldest = Infinity;
  let newest = -Infinity;
  for (const product of products) {
    const timestamp = Date.parse(product?.observedAt ?? '');
    if (!Number.isFinite(timestamp)) throw new Error('Invalid catalog observation');
    oldest = Math.min(oldest, timestamp);
    newest = Math.max(newest, timestamp);
  }
  if (!Number.isFinite(oldest) || newest > now + 3600000 ||
      oldest + maximumAgeHours * 3600000 < Date.parse(row.available_until ?? '') ||
      oldest + maximumAgeHours * 3600000 <= now) {
    throw new Error('Available catalog contains stale or invalid observations');
  }
}

export function availabilityPath(country: CountryCode): string {
  // Resolve only literal allowlisted directories at the filesystem boundary.
  // A TypeScript union alone cannot validate an HTTP-derived runtime value.
  switch (country) {
    case 'nl': return path.join(__dirname, '..', 'data', 'nl', 'catalog-availability.json');
    case 'uk': return path.join(__dirname, '..', 'data', 'uk', 'catalog-availability.json');
    case 'de': return path.join(__dirname, '..', 'data', 'de', 'catalog-availability.json');
    default: throw new Error('Unsupported catalog country');
  }
}

export function saveCountryAvailability(country: CountryCode, stores: CatalogAvailability[]): void {
  const filename = availabilityPath(country);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify({ schema_version: 1, stores }, null, 2) + '\n');
}

export function loadCountryAvailability(country: CountryCode, slugs: string[]): CatalogAvailability[] | null {
  const filename = availabilityPath(country);
  if (!fs.existsSync(filename)) return null; // Compatible with pre-contract deployments.
  try {
    return parseAvailabilityManifest(JSON.parse(fs.readFileSync(filename, 'utf8')), country, slugs);
  } catch {
    // A corrupt status file must not make retained offers public.
    return slugs.map((store) => ({ country, store, available: false, products: 0,
      available_until: null, last_successful_at: null, catalog_sha256: null,
      reason_codes: ['invalid_availability_contract'] }));
  }
}
