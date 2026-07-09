import { StoreInfo } from '../types';

/** All supported store slugs (NL data from data-wrangling; DE/UK can be added later). */
export const STORE_SLUGS = [
  'albert-heijn',
  'jumbo',
  'aldi',
  'dirk',
  'lidl',
  'coop',
  'plus',
] as const;
export type StoreSlug = (typeof STORE_SLUGS)[number];

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
