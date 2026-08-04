import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_FALSE_AUTO_MATCH_MAX,
  DEFAULT_STATUS_ACCURACY_MIN,
  loadMiniCatalog,
  runReceiptMatchingEval,
} from '../src/scripts/evalReceiptMatching';
import { matchReceiptLine } from '../src/services/receiptMatching';

const catalog = loadMiniCatalog();

test('matchReceiptLine auto-matches strong overlap and keeps generics in review', () => {
  const strong = matchReceiptLine('halfvolle melk', catalog);
  assert.equal(strong.matchStatus, 'matched');
  assert.ok(strong.matchedProduct);
  assert.equal(strong.matchedProduct!.store, 'Lidl');

  const generic = matchReceiptLine('melk', catalog);
  assert.equal(generic.matchStatus, 'needs_review');
  assert.equal(generic.matchedProduct, null);
  assert.ok(generic.matchConfidence > 0);

  const junk = matchReceiptLine('BONUS', catalog);
  assert.equal(junk.matchStatus, 'unmatched');
  assert.equal(junk.matchConfidence, 0);
});

test('matchReceiptLine can use a simulated AI-normalized name without OpenAI', () => {
  const withoutAi = matchReceiptLine('AH HV MELK', catalog);
  assert.equal(withoutAi.matchStatus, 'needs_review');

  const withAi = matchReceiptLine('AH HV MELK', catalog, {
    aiNormalizedName: 'halfvolle melk',
  });
  assert.equal(withAi.matchStatus, 'matched');
  assert.equal(withAi.matchedProduct?.canonicalName, 'halfvolle melk');
});

test('receipt matching evaluation fixtures meet accuracy gates', () => {
  const report = runReceiptMatchingEval();

  assert.ok(
    report.metrics.total >= 25,
    `expected at least 25 labelled cases, got ${report.metrics.total}`
  );
  assert.ok(
    report.metrics.statusAccuracy >= DEFAULT_STATUS_ACCURACY_MIN,
    `statusAccuracy ${report.metrics.statusAccuracy}`
  );
  assert.ok(
    report.metrics.falseAutoMatchRate <= DEFAULT_FALSE_AUTO_MATCH_MAX,
    `falseAutoMatchRate ${report.metrics.falseAutoMatchRate}`
  );
  assert.equal(report.passed, true, report.failures.join('; '));
});
