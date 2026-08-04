import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getStoreSlugsForCountry } from '../src/config/stores';

describe('getStoreSlugsForCountry', () => {
  it('returns the five German grocery chains for de', () => {
    const slugs = getStoreSlugsForCountry('de');
    assert.deepEqual(slugs, ['edeka', 'rewe', 'lidl-de', 'aldi-sud', 'penny']);
    assert.equal(slugs.length, 5);
  });

  it('still returns NL and UK registries', () => {
    assert.ok(getStoreSlugsForCountry('nl').includes('albert-heijn'));
    assert.ok(getStoreSlugsForCountry('uk').includes('tesco'));
  });
});
