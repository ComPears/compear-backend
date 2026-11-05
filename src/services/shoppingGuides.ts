import { CountryCode } from '../config/countries';
import { Product } from '../types';
import { searchProducts } from '../ai/semanticSearch';
import { presentOffer, unitComparison } from '../utils/offerEvidence';

const TOPICS = [
  { slug: 'milk', section: 'breakfast', labels: ['Milk', 'Melk', 'Milch'], queries: ['milk', 'melk', 'Milch'], basis: 'l' },
  { slug: 'coffee', section: 'breakfast', labels: ['Coffee', 'Koffie', 'Kaffee'], queries: ['coffee', 'koffie', 'Kaffee'], basis: 'kg' },
  { slug: 'oats', section: 'breakfast', labels: ['Oats', 'Havermout', 'Haferflocken'], queries: ['oats', 'havermout', 'Haferflocken'], basis: 'kg' },
  { slug: 'rice', section: 'pantry', labels: ['Rice', 'Rijst', 'Reis'], queries: ['rice', 'rijst', 'Reis'], basis: 'kg' },
  { slug: 'pasta', section: 'pantry', labels: ['Pasta', 'Pasta', 'Nudeln'], queries: ['pasta', 'pasta', 'Nudeln'], basis: 'kg' },
  { slug: 'olive-oil', section: 'pantry', labels: ['Olive oil', 'Olijfolie', 'Olivenöl'], queries: ['olive oil', 'olijfolie', 'Olivenöl'], basis: 'l' },
  { slug: 'laundry', section: 'household', labels: ['Laundry detergent', 'Wasmiddel', 'Waschmittel'], queries: ['laundry detergent', 'wasmiddel', 'Waschmittel'], basis: 'l' },
  { slug: 'shampoo', section: 'household', labels: ['Shampoo', 'Shampoo', 'Shampoo'], queries: ['shampoo', 'shampoo', 'Shampoo'], basis: 'l' },
  { slug: 'nappies', section: 'family', labels: ['Nappies', 'Luiers', 'Windeln'], queries: ['nappies', 'luiers', 'Windeln'], basis: 'item' },
  { slug: 'baby-wipes', section: 'family', labels: ['Baby wipes', 'Babydoekjes', 'Feuchttücher'], queries: ['baby wipes', 'babydoekjes', 'Feuchttücher'], basis: 'item' },
  { slug: 'toothpaste', section: 'family', labels: ['Toothpaste', 'Tandpasta', 'Zahnpasta'], queries: ['toothpaste', 'tandpasta', 'Zahnpasta'], basis: 'l' },
] as const;

function localIndex(country: CountryCode): number { return country === 'uk' ? 0 : country === 'nl' ? 1 : 2; }
export function guideDefinitions(country: CountryCode) {
  const index = localIndex(country);
  return TOPICS.map(topic => ({ slug: topic.slug, section: topic.section, title: topic.labels[index], query: topic.queries[index], basis: topic.basis }));
}
export function buildGuide(slug: string, country: CountryCode, products: Product[]) {
  const definition = guideDefinitions(country).find(g => g.slug === slug);
  if (!definition) return null;
  const tokens = definition.query.toLowerCase().split(/\s+/);
  const candidates = searchProducts(definition.query, 500, products).filter(product => tokens.every(token => product.productName.toLowerCase().includes(token)));
  const standard = candidates.filter(p => !p.promoType && p.priceType !== 'loyalty');
  const known = standard.filter(p => unitComparison(p)?.basis === definition.basis).sort((a, b) => unitComparison(a)!.price - unitComparison(b)!.price);
  return { ...definition, candidateLimit: 500, offerCount: candidates.length, storeCount: new Set(candidates.map(p => p.store)).size,
    lowPackPrice: candidates.length ? Math.min(...candidates.map(p => p.originalPrice)) : null,
    knownUnitCount: known.length, recommendation: known[0] ? { product: presentOffer(known[0], country), reason: 'lowest-known-standard-unit-price', basis: definition.basis, unitPrice: unitComparison(known[0])!.price } : null,
    products: [...known, ...candidates.filter(p => !known.includes(p))].slice(0, 60).map(p => presentOffer(p, country)),
    scope: 'catalog-sample', notice: 'Alternatives are not identical products. Unit-price leaders exclude conditional promotions and membership prices.' };
}
