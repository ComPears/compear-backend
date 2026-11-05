import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitComparison, presentOffer } from '../src/utils/offerEvidence';
import { Product } from '../src/types';
import { legacyToScraped } from '../src/services/seedService';
import { toProduct } from '../src/services/promotionService';

test('unit comparison keeps volume, mass and count separate', () => {
  for (const [size, basis, quantity] of [
    ['6 x 330 ml', 'l', 1.98], ['500 g', 'kg', 0.5], ['6 stuks', 'item', 6],
    ['4 pints', 'l', 2.273045], ['1,5 l', 'l', 1.5],
  ] as const) {
    const result = unitComparison({ packageSize: size, effectivePrice: 3 });
    assert.equal(result?.basis, basis);
    assert.ok(Math.abs(result!.quantity - quantity) < 0.000001);
    assert.ok(Math.abs(result!.price - 3 / quantity) < 0.000001);
  }
});

test('unknown quantities are not presented as per kg', () => {
  for (const size of ['', 'stuk', 'family pack', '2 x 0 ml', '100 g + 50 ml']) {
    assert.equal(unitComparison({ packageSize: size, effectivePrice: 2 }), null);
  }
});

test('response preserves freshness, provenance and unknown dietary verification without mutating catalog', () => {
  const product = { packageSize: '1 l', effectivePrice: 1.25, scrapedAt: '2026-11-05T01:00:00Z', sourceMethod: 'json_ld' } as Product;
  const result = presentOffer(product, 'uk');
  assert.equal(result.currency, 'GBP');
  assert.equal(result.sourceMethod, 'json_ld');
  assert.equal(result.scrapedAt, product.scrapedAt);
  assert.equal(result.dietaryEvidence, 'name-only');
  assert.equal(result.priceScope, 'retailer');
  assert.equal((product as any).unitComparison, undefined);
});

test('seeding carries bounded extraction provenance and price conditions into the catalog', () => {
  const raw = { n: 'Tesco Skimmed Milk', s: '1 l', p: '1.25', observedAt: '2026-11-05T01:00:00Z', sourceMethod: 'json_ld', priceType: 'loyalty' };
  const scraped = legacyToScraped(raw, 'Tesco', 'tesco')!;
  assert.equal(toProduct(scraped, 'id', 'milk', 'key').sourceMethod, 'json_ld');
  assert.equal(scraped.priceType, 'loyalty');
  assert.equal(legacyToScraped({ ...raw, sourceMethod: '<script>bad</script>' }, 'Tesco', 'tesco')!.sourceMethod, undefined);
});
