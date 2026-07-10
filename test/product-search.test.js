const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');

const dataService = require('../src/services/dataService');
const barcodeService = require('../src/services/barcodeService');
const { searchProducts } = require('../src/ai/semanticSearch');
const { clearSearchCache } = require('../src/utils/searchCache');
const { catalog, product } = require('./fixtures/products');
const { assertHeader, request, response } = require('./helpers/http');

const originalLoadAllProducts = dataService.loadAllProducts;
const originalLoadStoreProducts = dataService.loadStoreProducts;
const originalGetProductsByBarcode = barcodeService.getProductsByBarcode;
const productsControllerPath = require.resolve('../src/controllers/productsController');

function loadController() {
  delete require.cache[productsControllerPath];
  return require('../src/controllers/productsController');
}

beforeEach(() => {
  clearSearchCache();
  dataService.loadAllProducts = originalLoadAllProducts;
  dataService.loadStoreProducts = originalLoadStoreProducts;
  barcodeService.getProductsByBarcode = originalGetProductsByBarcode;
});

describe('indexed product search', () => {
  it('ranks exact phrases first, price-sorts ties, and honors filters', () => {
    const source = [
      product({ id: 'expensive', productName: 'Halfvolle melk', effectivePrice: 2.2 }),
      product({ id: 'cheap', productName: 'Halfvolle melk', effectivePrice: 1.1 }),
      product({ id: 'brand', productName: 'Yoghurt', brand: 'Halfvolle Melk', effectivePrice: 0.8 }),
      product({ id: 'other-store', productName: 'Halfvolle melk', store: 'Jumbo', effectivePrice: 0.9 }),
    ];

    assert.deepEqual(
      searchProducts('halfvolle melk', 10, source).map((item) => item.id),
      ['other-store', 'cheap', 'expensive', 'brand']
    );
    assert.deepEqual(
      searchProducts('melk', 10, source, (item) => item.store === 'Albert Heijn').map(
        (item) => item.id
      ),
      ['brand', 'cheap', 'expensive']
    );
  });

  it('reuses the index while returning a caller-limited result page', () => {
    const source = catalog(20);
    assert.equal(searchProducts('melk', 3, source).length, 3);
    assert.deepEqual(
      searchProducts('melk', 3, source).map((item) => item.id),
      ['ah-1', 'ah-2', 'ah-3']
    );
  });
});

describe('products controller pagination and cache', () => {
  it('paginates stable results and returns public list summaries', () => {
    const source = catalog(8);
    dataService.loadAllProducts = () => source;
    const { listProducts } = loadController();
    const res = response();

    listProducts(request({ query: { country: 'nl', limit: '3', offset: '2' } }), res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      res.body.map((item) => item.id),
      ['ah-3', 'ah-4', 'ah-5']
    );
    assert.equal('productUrl' in res.body[0], false);
    assert.equal('scrapedAt' in res.body[0], false);
    assertHeader(res, 'X-Total-Count', 8);
    assertHeader(res, 'X-Result-Limit', 3);
    assertHeader(res, 'X-Result-Offset', 2);
    assertHeader(res, 'X-Search-Cache', 'miss');
  });

  it('caches identical pages but isolates different offsets', () => {
    const source = catalog(7);
    let loads = 0;
    dataService.loadAllProducts = () => {
      loads += 1;
      return source;
    };
    const { listProducts } = loadController();

    const first = response();
    listProducts(request({ query: { limit: '2', offset: '0' } }), first);
    const repeated = response();
    listProducts(request({ query: { limit: '2', offset: '0' } }), repeated);
    const nextPage = response();
    listProducts(request({ query: { limit: '2', offset: '2' } }), nextPage);

    assertHeader(first, 'X-Search-Cache', 'miss');
    assertHeader(repeated, 'X-Search-Cache', 'hit');
    assertHeader(nextPage, 'X-Search-Cache', 'miss');
    assert.deepEqual(repeated.body, first.body);
    assert.deepEqual(nextPage.body.map((item) => item.id), ['ah-3', 'ah-4']);
    assert.equal(loads, 2);
  });

  it('normalizes barcodes, passes country through, and rejects malformed input', () => {
    const calls = [];
    barcodeService.getProductsByBarcode = (barcode, country) => {
      calls.push({ barcode, country });
      return [product()];
    };
    const { listProducts } = loadController();

    const valid = response();
    listProducts(
      request({ query: { barcode: '8712 3456 7890 6', country: 'nl' } }),
      valid
    );
    assert.deepEqual(calls, [{ barcode: '8712345678906', country: 'nl' }]);
    assert.equal(valid.body[0].barcode, '8712345678906');

    const invalid = response();
    listProducts(request({ query: { barcode: 'not-a-barcode' } }), invalid);
    assert.deepEqual(invalid.body, []);
    assert.equal(calls.length, 1);
  });
});
