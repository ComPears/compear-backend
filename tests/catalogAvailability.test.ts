import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createHash } from 'crypto';
import { CatalogAvailability, isCatalogAvailable, parseAvailabilityManifest, verifyAvailableCatalog } from '../src/services/catalogAvailability';
import { legacyToScraped } from '../src/services/seedService';

const now = Date.parse('2026-10-12T12:00:00Z');
const bytes = Buffer.from(JSON.stringify([{ observedAt: '2026-10-12T06:00:00Z' }]));
const entry: CatalogAvailability = {
  country: 'uk', store: 'tesco', available: true, products: 1, reason_codes: [],
  last_successful_at: '2026-10-12T06:00:00Z', available_until: '2026-10-14T06:00:00Z',
  catalog_sha256: createHash('sha256').update(bytes).digest('hex'),
};

it('requires complete, unique retailer states and valid hashes', () => {
  assert.deepEqual(parseAvailabilityManifest({ schema_version: 1, stores: [entry] }, 'uk', ['tesco']), [entry]);
  for (const stores of [[], [entry, entry], [{ ...entry, catalog_sha256: 'bad' }]]) {
    assert.throws(() => parseAvailabilityManifest({ schema_version: 1, stores }, 'uk', ['tesco']));
  }
});

it('fails closed for unavailable and expired retailers', () => {
  assert.equal(isCatalogAvailable(entry, now), true);
  assert.equal(isCatalogAvailable({ ...entry, available: false }, now), false);
  assert.equal(isCatalogAvailable(entry, Date.parse(entry.available_until!)), false);
});

it('binds availability to the exact catalog and its real observation dates', () => {
  assert.doesNotThrow(() => verifyAvailableCatalog(entry, bytes, 48, now));
  assert.throws(() => verifyAvailableCatalog(entry, Buffer.from('[]'), 48, now), /checksum/);
  assert.throws(() => verifyAvailableCatalog({ ...entry, products: 2 }, bytes, 48, now), /count/);
  assert.throws(() => verifyAvailableCatalog({ ...entry, available_until: '2026-12-01T00:00:00Z' }, bytes, 48, now), /stale/);
  assert.throws(() => verifyAvailableCatalog(entry, bytes, 48, now + 72 * 3600000), /stale/);
});

it('seeding preserves observation time and does not invent missing timestamps', () => {
  const raw = { n: 'Whole Milk', p: '1.25', s: '1 l', observedAt: '2026-10-07T01:00:00Z',
    productUrl: 'https://www.tesco.com/groceries/en-GB/products/milk' };
  const product = legacyToScraped(raw, 'Tesco', 'tesco');
  assert.equal(product?.scrapedAt, '2026-10-07T01:00:00.000Z');
  assert.equal(product?.productUrl, raw.productUrl);
  assert.equal(legacyToScraped({ ...raw, observedAt: undefined }, 'Tesco', 'tesco'), null);
});
