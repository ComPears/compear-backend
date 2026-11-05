import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { insightsPolicy } from '../src/services/insightsPolicy';
import { InsightsStore, insightsEnabled } from '../src/services/insightsStore';
import { Product } from '../src/types';

function configured(values: Record<string, string | undefined>, action: () => void) {
  const original = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try { for (const [key, value] of Object.entries(values)) value === undefined ? delete process.env[key] : process.env[key] = value; action(); }
  finally { for (const [key, value] of Object.entries(original)) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test('trial policy is bounded, expires at the exact deadline and remains portable', () => {
  configured({ PRICE_HISTORY_RETENTION_DAYS: undefined, PRICE_INSIGHTS_EXPIRES_AT: undefined }, () => {
    assert.deepEqual(insightsPolicy(), { retentionDays: 180, expiresAt: null, active: true });
  });
  configured({ PRICE_HISTORY_RETENTION_DAYS: '14', PRICE_INSIGHTS_EXPIRES_AT: '2026-12-05T00:00:00Z' }, () => {
    assert.equal(insightsPolicy(Date.parse('2026-12-04T23:59:59Z')).active, true);
    assert.equal(insightsPolicy(Date.parse('2026-12-05T00:00:00Z')).active, false);
    assert.equal(insightsPolicy().retentionDays, 14);
  });
  for (const days of ['0', '181', 'NaN', '1.5', '1;DROP TABLE']) configured({ PRICE_HISTORY_RETENTION_DAYS: days }, () => assert.equal(insightsPolicy().active, false));
  for (const expiry of ['tomorrow', '2026-02-30T00:00:00Z', '2026-12-05']) configured({ PRICE_HISTORY_RETENTION_DAYS: '14', PRICE_INSIGHTS_EXPIRES_AT: expiry }, () => assert.equal(insightsPolicy().active, false));
  configured({ ENABLE_PRICE_INSIGHTS: 'true', DATABASE_URL: 'postgresql://fixture.invalid/test', PRICE_HISTORY_RETENTION_DAYS: '14', PRICE_INSIGHTS_EXPIRES_AT: '2000-01-01T00:00:00Z' }, () => assert.equal(insightsEnabled(), false));
  assert.throws(() => new InsightsStore({} as Pool, 0));
});

test('unchanged catalogs skip bulk writes while changed observations invalidate the checkpoint', async () => {
  let fingerprint: string | undefined;
  const queries: string[] = [];
  const pool = { async query(sql: string, values?: unknown[]) {
    queries.push(sql);
    if (sql.startsWith('SELECT fingerprint')) return { rows: fingerprint ? [{ fingerprint }] : [], rowCount: 0 };
    if (sql.startsWith('INSERT INTO compear_insights_checkpoints')) fingerprint = values?.[1] as string;
    return { rows: [], rowCount: sql.startsWith('INSERT INTO compear_price_observations') ? 1 : 0 };
  } } as unknown as Pool;
  const store = new InsightsStore(pool, 14);
  const product = { id: 'fixture', productName: 'Fixture', store: 'Fixture', packageSize: '1 l', originalPrice: 2, scrapedAt: new Date().toISOString() } as Product;
  assert.equal(await store.record('uk', [product]), 1);
  const before = queries.length;
  assert.equal(await store.record('uk', [product]), 0);
  assert.deepEqual(queries.slice(before), ['SELECT fingerprint FROM compear_insights_checkpoints WHERE country=$1']);
  assert.equal(await store.record('uk', [{ ...product, originalPrice: 1.5, scrapedAt: new Date(Date.now() + 1000).toISOString() }]), 1);
});
