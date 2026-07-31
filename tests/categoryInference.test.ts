import assert from 'node:assert/strict';
import test from 'node:test';
import { inferProductCategory, normalizePackageData, productSlug } from '../src/services/dataService';

test('infers useful categories for uncategorized UK catalog products', () => {
  assert.equal(
    inferProductCategory({ productName: 'Tesco British Semi Skimmed Milk 2 Pints', canonicalName: 'tesco british milk semi skimmed' }),
    'Dairy & Eggs'
  );
  assert.equal(
    inferProductCategory({ productName: 'Milk Chocolate Digestive Biscuits', canonicalName: 'milk chocolate biscuits' }),
    'Snacks'
  );
  assert.equal(
    inferProductCategory({ productName: 'Milk Frother', canonicalName: 'milk frother' }),
    'Other'
  );
  assert.equal(
    inferProductCategory({ productName: 'Milk & Honey Shower Cream', canonicalName: 'milk honey shower cream' }),
    'Personal Care'
  );
});

test('repairs units using explicit measurements in UK product names', () => {
  assert.deepEqual(
    normalizePackageData({ productName: 'Milk Chocolate 100g', canonicalName: 'milk chocolate', packageSize: '100 ml', weightInGrams: 100 }),
    { packageSize: '100 g', weightInGrams: 100 }
  );
  assert.deepEqual(
    normalizePackageData({ productName: 'British Milk 2 Pints', canonicalName: 'british milk', packageSize: '1 stuk', weightInGrams: null }),
    { packageSize: '2 pints', weightInGrams: 1137 }
  );
  assert.deepEqual(
    normalizePackageData({ productName: 'British Milk 6 x 1 Litre', canonicalName: 'british milk', packageSize: '1 l', weightInGrams: 1000 }),
    { packageSize: '6 × 1 l', weightInGrams: 6000 }
  );
});

test('creates stable descriptive product slugs', () => {
  assert.equal(
    productSlug({ canonicalName: 'Semi-skimmed UHT milk', productName: 'Milk', packageSize: '1 l' }),
    'semi-skimmed-uht-milk-1-l'
  );
});
