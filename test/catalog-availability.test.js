const assert = require('node:assert/strict');
const { it } = require('node:test');
const fs = require('node:fs');
const availability = require('../dist/services/catalogAvailability');
const data = require('../dist/services/dataService');
const { getDataFileName, getStoreSlugsForCountry } = require('../dist/config/stores');
const { getProductsByBarcode } = require('../dist/services/barcodeService');
const { listProducts } = require('../dist/controllers/productsController');
const { listStores } = require('../dist/controllers/storesController');
const { product } = require('./fixtures/products');
const { request, response } = require('./helpers/http');

it('expiry removes retained offers from cached search, barcode, detail, SEO and store coverage', (t) => {
  const now = Date.now();
  let clock = now;
  t.mock.method(Date, 'now', () => clock);
  const expiry = new Date(now + 1000).toISOString();
  t.mock.method(availability, 'loadCountryAvailability', () =>
    getStoreSlugsForCountry('uk').map((store) => ({
      country: 'uk', store, available: store === 'tesco', available_until: expiry,
      last_successful_at: new Date(now).toISOString(), products: store === 'tesco' ? 1 : 0,
      catalog_sha256: 'a'.repeat(64), reason_codes: [],
    })));
  const originalRead = fs.readFileSync;
  const filename = getDataFileName('tesco');
  t.mock.method(fs, 'readFileSync', (file, ...args) =>
    String(file).endsWith('/uk/' + filename)
      ? JSON.stringify([product({ id: 'tesco-test', store: 'Tesco', productName: 'Whole milk',
          canonicalName: 'whole milk', barcode: '5901234123457' })])
      : originalRead(file, ...args));
  data.invalidateProductCatalog('uk');
  t.after(() => data.invalidateProductCatalog('uk'));
  const query = request({ query: { country: 'uk', search: 'milk' } });
  const first = response();
  listProducts(query, first);
  assert.equal(first.body.length, 1);
  assert.equal(getProductsByBarcode('5901234123457', 'uk').length, 1);
  assert.ok(data.getProductById('tesco-test', 'uk'));
  clock = now + 1001;
  const expired = response();
  listProducts(query, expired);
  assert.deepEqual(expired.body, []);
  assert.deepEqual(getProductsByBarcode('5901234123457', 'uk'), []);
  assert.equal(data.getProductById('tesco-test', 'uk'), null);
  assert.deepEqual(data.getSeoProductGroups('uk'), []);
  const stores = response();
  listStores(request({ query: { country: 'uk' } }), stores);
  const tesco = stores.body.find((store) => store.slug === 'tesco');
  assert.equal(tesco.availability, 'unavailable');
  assert.equal(tesco.productCount, 0);
  assert.equal(tesco.unavailableReason, 'data_expired');
});
