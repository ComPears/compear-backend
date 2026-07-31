import { StoreInfo } from '../types';
import { CountryCode } from './countries';

/** All supported store slugs across countries. */
export const STORE_SLUGS = [
  'albert-heijn',
  'jumbo',
  'aldi',
  'dirk',
  'lidl',
  'coop',
  'plus',
  'tesco',
  'sainsburys',
  'asda',
  'morrisons',
  'aldi-uk',
  'lidl-uk',
] as const;
export type StoreSlug = (typeof STORE_SLUGS)[number];

const NL_STORE_SLUGS: StoreSlug[] = [
  'albert-heijn',
  'jumbo',
  'aldi',
  'dirk',
  'lidl',
  'coop',
  'plus',
];

const UK_STORE_SLUGS: StoreSlug[] = [
  'tesco',
  'sainsburys',
  'asda',
  'morrisons',
  'aldi-uk',
  'lidl-uk',
];

export const STORES: Record<StoreSlug, StoreInfo> = {
  'albert-heijn': {
    id: 'albert-heijn',
    name: 'Albert Heijn',
    slug: 'albert-heijn',
    logo: 'https://www.ah.nl/favicon.ico',
  },
  jumbo: {
    id: 'jumbo',
    name: 'Jumbo',
    slug: 'jumbo',
    logo: 'https://www.jumbo.com/favicon.ico',
  },
  aldi: {
    id: 'aldi',
    name: 'ALDI',
    slug: 'aldi',
    logo: 'https://www.aldi.nl/favicon.ico',
  },
  dirk: {
    id: 'dirk',
    name: 'Dirk',
    slug: 'dirk',
    logo: 'https://www.dirk.nl/favicon.ico',
  },
  lidl: {
    id: 'lidl',
    name: 'Lidl',
    slug: 'lidl',
    logo: 'https://www.lidl.nl/favicon.ico',
  },
  coop: {
    id: 'coop',
    name: 'Coop',
    slug: 'coop',
    logo: 'https://www.coop.nl/favicon.ico',
  },
  plus: {
    id: 'plus',
    name: 'PLUS',
    slug: 'plus',
    logo: 'https://www.plus.nl/favicon.ico',
  },
  tesco: {
    id: 'tesco',
    name: 'Tesco',
    slug: 'tesco',
    logo: 'https://www.tesco.com/favicon.ico',
  },
  sainsburys: {
    id: 'sainsburys',
    name: "Sainsbury's",
    slug: 'sainsburys',
    logo: 'https://www.sainsburys.co.uk/favicon.ico',
  },
  asda: {
    id: 'asda',
    name: 'Asda',
    slug: 'asda',
    logo: 'https://www.asda.com/favicon.ico',
  },
  morrisons: {
    id: 'morrisons',
    name: 'Morrisons',
    slug: 'morrisons',
    logo: 'https://groceries.morrisons.com/favicon.ico',
  },
  'aldi-uk': {
    id: 'aldi-uk',
    name: 'Aldi',
    slug: 'aldi-uk',
    logo: 'https://www.aldi.co.uk/favicon.ico',
  },
  'lidl-uk': {
    id: 'lidl-uk',
    name: 'Lidl',
    slug: 'lidl-uk',
    logo: 'https://www.lidl.co.uk/favicon.ico',
  },
};

export function getStoreBySlug(slug: string): StoreInfo | undefined {
  return STORES[slug as StoreSlug];
}

export function getStoreDisplayName(slug: StoreSlug): string | null {
  return STORES[slug]?.name ?? null;
}

export function getDataFileName(slug: StoreSlug): string {
  return `${slug}.json`;
}

/** Store slugs available for a country. */
export function getStoreSlugsForCountry(country: CountryCode): StoreSlug[] {
  if (country === 'nl') return [...NL_STORE_SLUGS];
  if (country === 'uk') return [...UK_STORE_SLUGS];
  return [];
}
