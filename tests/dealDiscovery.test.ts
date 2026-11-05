import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleDeal } from '../src/controllers/dealsController';
import { guideDefinitions } from '../src/services/shoppingGuides';
import { Product } from '../src/types';
import { parsePromoText } from '../src/services/seedService';
import { computeEffectivePrice } from '../src/services/promotionService';

const now = Date.now();
const promotion = { promoType: 'PERCENTAGE', originalPrice: 3, effectivePrice: 2, scrapedAt: new Date(now).toISOString(), promoValidUntil: null } as Product;
test('deal discovery excludes stale, future, expired and malformed prices', () => {
  assert.equal(eligibleDeal(promotion, now), true);
  for (const change of [{ effectivePrice: 0 }, { originalPrice: NaN }, { effectivePrice: Infinity }, { effectivePrice: 4 }, { scrapedAt: 'invalid' }, { scrapedAt: new Date(now - 193 * 3600000).toISOString() }, { scrapedAt: new Date(now + 3600000).toISOString() }, { promoValidUntil: new Date(now - 1).toISOString() }, { promoValidUntil: 'invalid' }, { promoType: null }]) {
    assert.equal(eligibleDeal({ ...promotion, ...change } as Product, now), false);
  }
});
test('family guides exist in every live country with count-based nappy and wipe comparisons', () => {
  for (const country of ['uk', 'nl', 'de'] as const) {
    const definitions = guideDefinitions(country);
    assert.equal(definitions.length, 11);
    assert.deepEqual(definitions.filter(topic => topic.section === 'family').map(topic => topic.basis), ['item', 'item', 'l']);
  }
});

test('count promotions, currency totals and meal deals cannot be confused', () => {
  const count = parsePromoText('Any 3 for 2 Clubcard Price - Cheapest Product Free - Selected Vitamins');
  assert.deepEqual(count, { promoType: 'BUNDLE_FREE', promoValue: 2, promoQuantity: 3 });
  assert.equal(computeEffectivePrice(24, count.promoType, count.promoValue, count.promoQuantity), 16);
  for (const [text, total, quantity] of [['Any 3 for £6 Clubcard Price', 6, 3], ['2 voor €4,50', 4.5, 2], ['3 for 90p', .9, 3]] as const) {
    assert.deepEqual(parsePromoText(text), { promoType: 'MULTI_BUY', promoValue: total, promoQuantity: quantity });
  }
  for (const text of ['3 for 2', '2 voor 5', 'Meal deal any 3 for £5', '0 for £3', '200 for £2']) assert.equal(parsePromoText(text).promoType, null);
  assert.equal(eligibleDeal({ ...promotion, priceType: 'loyalty' }, now), false);
});
