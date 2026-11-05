const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const express = require('express');
const data = require('../dist/services/dataService');
const insights = require('../dist/services/insightsStore');
const { product } = require('./fixtures/products');
const { issueReceiptCredentials } = require('../dist/utils/receiptAuth');

const source = 'https://shop.example/milk';
const catalog = [
  product({ id: 'verified', productName: 'Oat milk', canonicalName: 'oat milk', productUrl: source, scrapedAt: new Date().toISOString(), labelEvidence: { version: 1, sourceUrl: source, observedAt: new Date().toISOString(), method: 'json_ld', claims: ['vegan'] } }),
  product({ id: 'unknown', productName: 'Oat milk', canonicalName: 'oat milk', originalPrice: 1.4, scrapedAt: new Date().toISOString() }),
  product({ id: 'expensive', productName: 'Oat milk', canonicalName: 'oat milk', originalPrice: 3, effectivePrice: 3, scrapedAt: new Date().toISOString() }),
];
data.loadAllProducts = country => country === 'uk' ? catalog : [];
data.getProductById = (id, country) => country === 'uk' ? catalog.find(p => p.id === id) : undefined;
let enabled = false, creates = [];
insights.insightsEnabled = () => enabled;
insights.getInsightsStore = () => ({
  async createAlert(user, country, id, target, channel, email) { creates.push({ user, country, id, target, channel, email }); return { id: '123', country, product_id: id, target_price: String(target), channel, confirmed_at: new Date(), enabled: true }; },
  async listAlerts() { return []; },
});
const app = express();
app.use(express.json({ limit: '16kb' }));
app.use('/shopping', require('../dist/routes/shopping').shoppingRouter);
app.use('/insights', require('../dist/routes/insights').insightsRouter);
let server;
after(() => server && new Promise(resolve => server.close(resolve)));

test('shopping and insights HTTP boundaries are country-safe, explicit and private', async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  let result = await post('/shopping/search?country=uk', { request: 'vegan oat milk under £2' });
  assert.equal(result.status, 200);
  const brief = await result.json();
  assert.deepEqual(brief.matches.map(r => r.product.id), ['verified']);
  assert.deepEqual(brief.unknown.map(r => r.product.id), ['unknown']);
  assert.deepEqual(brief.excluded.map(r => r.product.id), ['expensive']);
  result = await post('/shopping/search?country=nl', { request: 'milk under €2' });
  assert.equal((await result.json()).evaluated, 0);
  assert.equal((await post('/shopping/search?country=uk', { request: 'milk under €2' })).status, 400);
  assert.equal((await post('/shopping/search?country=uk', { request: 'milk', stores: ['x'.repeat(81)] })).status, 400);
  assert.equal((await post('/shopping/search?country=uk', { request: 'milk', offsets: { matches: -30 } })).status, 400);
  result = await post('/shopping/search?country=uk', { request: 'milk under £2', offsets: { matches: 30 } });
  const page = await result.json();
  assert.equal(page.offsets.matches, 30);
  assert.equal(page.matches.length, 0);
  assert.equal(page.counts.matches, 2);
  assert.equal((await fetch(base + '/shopping/guides/not-a-guide?country=de')).status, 404);
  result = await fetch(base + '/insights/features');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).alerts, false);
  assert.equal((await post('/insights/alerts', {})).status, 503);
  enabled = true;
  assert.equal((await post('/insights/alerts', {})).status, 401);
  const credential = issueReceiptCredentials();
  const headers = { 'x-compear-user-id': credential.userId, 'x-compear-user-token': credential.token };
  const watch = { productId: 'verified', targetPrice: 1.2, consent: true };
  assert.equal((await post('/insights/alerts?country=uk', { ...watch, consent: false }, headers)).status, 400);
  assert.equal((await post('/insights/alerts?country=uk', { ...watch, targetPrice: 1.234 }, headers)).status, 400);
  assert.equal((await post('/insights/alerts?country=nl', watch, headers)).status, 404);
  assert.equal((await post('/insights/alerts?country=uk', { ...watch, channel: 'email', email: 'fixture@example.com' }, headers)).status, 400);
  result = await post('/insights/alerts?country=uk', { ...watch, email: { malicious: 'not persisted' } }, headers);
  assert.equal(result.status, 201);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].email, undefined);
  const saved = await result.json();
  assert.equal(saved.productName, 'Oat milk');
  assert.equal(saved.email, undefined);
  assert.equal(saved.user_id, undefined);
  assert.equal((await post('/insights/refresh', {})).status, 503); // no configured ops key
});
