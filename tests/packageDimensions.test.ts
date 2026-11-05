import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSizeLabel, legacySizeLabelForId, sanitizeProductFields } from '../src/utils/productSanitize';
import { normalizePackageData } from '../src/services/dataService';
import { legacyToScraped } from '../src/services/seedService';
import { unitComparison } from '../src/utils/offerEvidence';

test('source count, mass and volume labels keep their dimensions', () => {
  for (const [input, expected] of [['8 items', '8 items'], ['150 g', '150 g'], ['500 ml', '500 ml'], ['6 x 500 g', '6 × 500 g'], ['20 capsules', '20 items'], ['24 Stück', '24 items']]) assert.equal(normalizeSizeLabel(input, 150), expected);
  assert.equal(normalizeSizeLabel('unknown', 500), 'unknown');
  assert.equal(legacySizeLabelForId('8 items', 8), '8 ml'); // ID compatibility, never displayed.
  assert.equal(sanitizeProductFields('Gillette Razor Blades', '8 items', null, { weightInGrams: 8 })?.weightInGrams, null);
});
test('old catalog dimensions can be repaired from explicit source identity, not bare numeric weight', () => {
  const raw = { productName: 'Razor blades', canonicalName: 'razor blades', packageSize: '8 ml', weightInGrams: 8 };
  assert.deepEqual(normalizePackageData({ ...raw, identityKey: 'tok:gillette|razor-blades|8x1count' }), { packageSize: '8 items', weightInGrams: null });
  assert.deepEqual(normalizePackageData({ ...raw, identityKey: 'tok:brand|coffee|500g' }), { packageSize: '500 g', weightInGrams: 500 });
  assert.deepEqual(normalizePackageData({ ...raw, identityKey: 'ean:123' }), { packageSize: '8 ml', weightInGrams: 8 });
});
test('legacy import preserves an explicit count even for an EAN identity', () => {
  const product = legacyToScraped({ n: 'Gillette Razor Blades', s: '8 items', wg: 8, p: '10', ik: 'ean:8712345678906', observedAt: new Date().toISOString() }, 'Albert Heijn', 'albert-heijn')!;
  assert.equal(product.packageSize, '8 items');
  assert.equal(product.weightInGrams, null);
  assert.equal(unitComparison({ packageSize: product.packageSize, effectivePrice: 10 })?.basis, 'item');
});
