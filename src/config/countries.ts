import * as fs from 'fs';
import * as path from 'path';

import { Request } from 'express';

export type CountryCode = 'nl' | 'de' | 'uk';

export const COUNTRY_CODES: CountryCode[] = ['nl', 'de', 'uk'];
export const DEFAULT_COUNTRY: CountryCode = 'nl';

export interface WranglingStoreEntry {
  display_name: string;
  dir: string;
  catalog: string;
  minimum_products?: number;
}

export interface WranglingCountryConfig {
  label: string;
  locale: string;
  currency: string;
  stores: Record<string, WranglingStoreEntry>;
}

export interface WranglingConfig {
  default_country: CountryCode;
  countries: Record<CountryCode, WranglingCountryConfig>;
}

export function parseCountryCode(value: string | undefined | null): CountryCode {
  const code = (value || DEFAULT_COUNTRY).toLowerCase();
  if (COUNTRY_CODES.includes(code as CountryCode)) {
    return code as CountryCode;
  }
  return DEFAULT_COUNTRY;
}

export function loadWranglingConfig(wranglingPath: string): WranglingConfig {
  const configPath = path.join(wranglingPath, 'config', 'stores.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  return JSON.parse(raw) as WranglingConfig;
}

export function catalogRelPath(
  config: WranglingConfig,
  country: CountryCode,
  slug: string
): string {
  const store = config.countries[country]?.stores?.[slug];
  if (!store) {
    throw new Error(`Unknown store ${country}/${slug} in wrangling config`);
  }
  return path.posix.join(store.dir, store.catalog);
}

export function listStoreSlugsForCountry(
  config: WranglingConfig,
  country: CountryCode
): string[] {
  return Object.keys(config.countries[country]?.stores ?? {});
}

export function countryFromQuery(req: Request): CountryCode {
  const raw = req.query.country;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return parseCountryCode(typeof value === 'string' ? value : undefined);
}
