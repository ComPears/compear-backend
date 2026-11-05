import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpretBrief, validateConstraints, assessProduct, assessmentStatus, Constraint } from '../src/services/shoppingBrief';
import { labelEvidenceFileName, normalizeLabelEvidence } from '../src/services/labelEvidence';
import { Product } from '../src/types';

const url = 'https://shop.example/product/milk';
const evidence = { version: 1, sourceUrl: url, method: 'json_ld', observedAt: new Date().toISOString(), claims: ['vegan'], ingredients: 'Oats, water, sucralose', nutrients: { basis: '100ml', servingSize: '100 ml', sugarG: 0, proteinG: 3 } };
const product = (extra = {}) => ({ productName: 'Oat milk', productUrl: url, packageSize: '1 l', originalPrice: 1.5, effectivePrice: 1.5, scrapedAt: new Date().toISOString(), promoType: null, labelEvidence: normalizeLabelEvidence(evidence, url), ...extra } as Product);

test('label evidence paths are selected from literals and reject path-shaped country input', () => {
  assert.deepEqual(['nl', 'uk', 'de'].map(country => labelEvidenceFileName(country as any)), ['nl.json', 'uk.json', 'de.json']);
  for (const value of ['../secret', '/etc/passwd', 'nl/../../secret', 'nl.json', '', null, ['nl']]) assert.throws(() => labelEvidenceFileName(value as any));
});

test('interprets equivalent English, Dutch and German shopping requests', () => {
  for (const [request, country] of [['oat milk without added sugar under £2 per litre', 'uk'], ['havermelk zonder toegevoegde suiker onder €2 per liter', 'nl'], ['Hafermilch ohne Zuckerzusatz unter €2 pro Liter', 'de']] as const) {
    const brief = interpretBrief(request, country);
    assert.equal(brief.constraints.length, 2);
    assert.ok(brief.constraints.some(c => c.kind === 'claim' && c.value === 'no-added-sugar'));
    assert.ok(brief.constraints.some(c => c.kind === 'unit-price' && c.basis === 'l' && c.maximum === 2));
  }
});
test('parses nutrient thresholds with explicit measurement basis', () => {
  const brief = interpretBrief('yogurt with at least 10g protein per 100g', 'uk');
  assert.deepEqual(brief.constraints, [{ kind: 'nutrient', nutrient: 'proteinG', comparison: 'minimum', amount: 10, basis: '100g' }]);
  assert.equal(brief.query, 'yogurt');
  assert.ok(interpretBrief('fish oil with 1000mg EPA+DHA', 'uk').warnings.includes('unsupported-dose-constraint'));
  assert.deepEqual(interpretBrief('yogurt with 25g+ protein per 100g', 'uk').constraints, [{ kind: 'nutrient', nutrient: 'proteinG', comparison: 'minimum', amount: 25, basis: '100g' }]);
  assert.ok(interpretBrief('yogurt with at least 3 vitamins under £2', 'uk').warnings.includes('unparsed-condition'));
});
test('rejects wrong currency, unbounded and malformed user-edited constraints', () => {
  assert.throws(() => interpretBrief('milk under €2', 'uk'));
  assert.throws(() => interpretBrief('x'.repeat(401), 'nl'));
  assert.throws(() => validateConstraints([{ kind: 'price', maximum: NaN }]));
  assert.throws(() => validateConstraints([{ kind: 'exclude-ingredient', value: '<script>' }]));
});
test('missing, stale and different-serving evidence cannot pass constraints', () => {
  const constraints: Constraint[] = [{ kind: 'claim', value: 'vegan' }, { kind: 'nutrient', nutrient: 'proteinG', comparison: 'minimum', amount: 2, basis: '100g' }];
  assert.equal(assessmentStatus(assessProduct(product({ labelEvidence: undefined }), constraints)), 'unknown');
  assert.equal(assessmentStatus(assessProduct(product(), constraints)), 'unknown');
  const stale = { ...evidence, observedAt: new Date(Date.now() - 40 * 86400000).toISOString() };
  assert.equal(assessmentStatus(assessProduct(product({ labelEvidence: stale }), [constraints[0]])), 'unknown');
});
test('zero sugar is a known value, not missing evidence or a no-added-sugar claim', () => {
  assert.equal(assessmentStatus(assessProduct(product(), [{ kind: 'nutrient', nutrient: 'sugarG', comparison: 'maximum', amount: 0, basis: '100ml' }])), 'pass');
  assert.equal(assessmentStatus(assessProduct(product(), [{ kind: 'claim', value: 'no-added-sugar' }])), 'unknown');
});
test('ingredient checks recognize sweetener aliases but never infer allergy safety', () => {
  assert.equal(assessmentStatus(assessProduct(product(), [{ kind: 'exclude-ingredient', value: 'artificial sweeteners' }])), 'fail');
  assert.equal(assessmentStatus(assessProduct(product(), [{ kind: 'exclude-ingredient', value: 'nuts' }])), 'unknown');
});
test('checkout budget uses pack price, not conditional multibuy price', () => {
  const promo = product({ originalPrice: 3, effectivePrice: 1.5, promoType: 'BOGO' });
  assert.equal(assessmentStatus(assessProduct(promo, [{ kind: 'price', maximum: 2 }])), 'fail');
  assert.equal(assessmentStatus(assessProduct(promo, [{ kind: 'unit-price', maximum: 2, basis: 'l' }])), 'unknown');
});
test('label validation binds evidence to this product and rejects markup and nonfinite facts', () => {
  assert.equal(normalizeLabelEvidence(evidence, 'https://shop.example/product/other'), undefined);
  assert.equal(normalizeLabelEvidence({ ...evidence, ingredients: '<script>', claims: [], nutrients: undefined }, url), undefined);
  const normalized = normalizeLabelEvidence({ ...evidence, nutrients: { ...evidence.nutrients, sugarG: NaN } }, url);
  assert.equal(normalized?.nutrients?.sugarG, undefined);
});
