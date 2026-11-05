const assert = require('node:assert/strict');
const { test } = require('node:test');
const data = require('../dist/services/dataService');
const { product } = require('./fixtures/products');
const stamp = new Date().toISOString();
data.loadAllProducts = country => country === 'uk' ? [
  product({ id: 'low', store: 'Aldi', category: 'Household', originalPrice: 4, effectivePrice: 3, promoType: 'PERCENTAGE', promoQuantity: 2, scrapedAt: stamp }),
  product({ id: 'high', store: 'Tesco', category: 'Personal Care', originalPrice: 10, effectivePrice: 5, promoType: 'PERCENTAGE', scrapedAt: stamp }),
  product({ id: 'expired', originalPrice: 100, effectivePrice: 1, promoType: 'PERCENTAGE', scrapedAt: stamp, promoValidUntil: '2000-01-01' }),
] : [];
const { listDeals } = require('../dist/controllers/dealsController');
function page(query = {}) {
  let body, status = 200;
  const res = { status(value) { status = value; return this; }, json(value) { body = value; } };
  listDeals({ query: { country: 'uk', ...query } }, res);
  return { status, body };
}
test('offers stay filtered, sorted, paginated and country-isolated with purchase metadata', () => {
  assert.deepEqual(page().body.items.map(item => item.id), ['high', 'low']);
  assert.equal(page({ limit: '1', offset: '1' }).body.items[0].id, 'low');
  assert.equal(page({ category: 'Household' }).body.items[0].promoQuantity, 2);
  assert.equal(page({ category: 'Household' }).body.items[0].scrapedAt, stamp);
  assert.equal(page({ store: 'Tesco' }).body.total, 1);
  assert.equal(page({ sort: 'price' }).body.items[0].id, 'low');
  assert.equal(page({ country: 'de' }).body.total, 0);
  assert.equal(page({ sort: 'unsupported' }).status, 400);
  assert.equal(page({ category: ['Household'] }).status, 400);
});
