import assert from 'node:assert/strict';
import test from 'node:test';
import { Product } from '../src/types';
import {
  calculateReceiptMatchConfidence,
  statusForConfidence,
} from '../src/services/receiptMatching';

const product: Product = {
  id: 'milk-1',
  canonicalName: 'halfvolle melk',
  productName: 'Halfvolle melk',
  brand: null,
  store: 'Testmarkt',
  packageSize: '1 l',
  weightInGrams: 1000,
  originalPrice: 1.29,
  effectivePrice: 1.29,
  unitPrice: 1.29,
  effectiveUnitPrice: 1.29,
  promoType: null,
  promoValue: null,
  promoValidUntil: null,
  productUrl: null,
  scrapedAt: '2026-01-01T00:00:00.000Z',
  category: 'Dairy & Eggs',
  barcode: null,
  identityKey: 'halfvolle-melk-1l',
};

test('confirms strong catalog name overlap', () => {
  const confidence = calculateReceiptMatchConfidence('halfvolle melk', product);
  assert.equal(confidence, 1);
  assert.equal(statusForConfidence(confidence), 'matched');
});

test('keeps weak catalog overlap in review state', () => {
  const confidence = calculateReceiptMatchConfidence('halfvolle yoghurt', product);
  assert.ok(confidence < 0.72);
  assert.equal(statusForConfidence(confidence), 'needs_review');
});

test('does not confirm a generic single-token query as a specific product', () => {
  const confidence = calculateReceiptMatchConfidence('melk', product);
  assert.equal(statusForConfidence(confidence), 'needs_review');
});

test('marks a zero-overlap line unmatched', () => {
  const confidence = calculateReceiptMatchConfidence('bananen', product);
  assert.equal(confidence, 0);
  assert.equal(statusForConfidence(confidence), 'unmatched');
});
