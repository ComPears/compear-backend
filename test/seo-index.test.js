const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const data = require('../dist/services/dataService');
const { getSeoIndex } = require('../dist/controllers/productsController');
const { request, response } = require('./helpers/http');

const original = { ...data };
after(() => Object.assign(data, original));

test('SEO pages honor bounds and include pagination metadata', () => {
  data.getSeoProductGroupCount = () => 1000;
  data.getSeoProductGroups = (country, offset, limit) => [{ country, offset, limit }];
  const res = response();
  getSeoIndex(request({ query: { country: 'uk', offset: '500', limit: '999999' } }), res);
  assert.deepEqual(res.body, [{ country: 'uk', offset: 500, limit: 500 }]);
  assert.equal(res.headers['x-total-count'], '1000');
  assert.equal(res.headers['x-result-limit'], '500');
  const invalid = response();
  getSeoIndex(request({ query: { offset: '-1', limit: 'bad' } }), invalid);
  assert.deepEqual(invalid.body, [{ country: 'nl', offset: 0, limit: 250 }]);
});

test('legacy SEO serialization is reused, country-isolated and catalog-invalidated', () => {
  const sources = { nl: [], uk: [] };
  let serializations = 0;
  data.loadAllProducts = (country) => sources[country];
  data.getSeoProductGroupCount = () => 1;
  data.getSeoProductGroups = (country) => { serializations++; return [{ slug: country, offers: [] }]; };
  const call = (country) => {
    const res = response();
    getSeoIndex(request({ query: { country } }), res);
    return res;
  };
  const first = call('nl');
  const repeated = call('nl');
  assert.strictEqual(first.body, repeated.body);
  assert.equal(first.headers.etag, repeated.headers.etag);
  assert.deepEqual(JSON.parse(first.body.toString()), [{ slug: 'nl', offers: [] }]);
  assert.equal(serializations, 1);
  assert.notDeepEqual(call('uk').body, first.body);
  sources.nl = [];
  assert.notStrictEqual(call('nl').body, first.body);
  assert.equal(serializations, 3);
});
