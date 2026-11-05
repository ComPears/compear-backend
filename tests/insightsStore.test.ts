import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { InsightsStore } from '../src/services/insightsStore';
import { Product } from '../src/types';

test('durable history and alerts preserve identity, ownership and threshold transitions', { skip: !process.env.INSIGHTS_TEST_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.INSIGHTS_TEST_DATABASE_URL, max: 4 });
  const store = new InsightsStore(pool);
  const id = `fixture-${randomUUID()}`, user = randomUUID().replace(/-/g, '');
  const product = (price: number, minutes: number): Product => ({ id, productName: 'Fixture Milk', store: 'Fixture retailer', packageSize: '1 l', originalPrice: price, effectivePrice: price, scrapedAt: new Date(Date.now() - (10 - minutes) * 60000).toISOString() } as Product);
  try {
    await store.initialize();
    const first = product(2, 0);
    assert.equal(await store.record('uk', [first]), 1);
    assert.equal(await store.record('uk', [first]), 0);
    assert.equal((await store.history('uk', id)).length, 1);
    assert.equal((await store.history('nl', id)).length, 0);
    const alert = await store.createAlert(user, 'uk', id, 1.5, 'inapp');
    assert.ok(alert);
    assert.equal(await store.notify(alert.id, first), false);
    const lower = product(1.2, 1);
    assert.equal(await store.notify(alert.id, lower), true);
    assert.equal(await store.notify(alert.id, lower), false);
    assert.equal(await store.notify(alert.id, product(1.1, 2)), false);
    assert.equal(await store.notify(alert.id, product(2, 3)), false);
    assert.equal(await store.notify(alert.id, product(1.3, 4)), true);
    assert.equal((await store.notifications(user, 'uk')).length, 2);
    assert.equal((await store.notifications('other-user', 'uk')).length, 0);
    assert.equal(await store.disable('other-user', alert.id), false);
    assert.equal(await store.disable(user, alert.id), true);
    assert.equal(await store.notify(alert.id, product(1, 5)), false);
    const email = await store.createAlert(user, 'nl', id, 2, 'email', 'fixture@example.com');
    assert.ok(email);
    assert.equal(await store.notify(email.id, first), false); // double opt-in required
    await store.confirm(email.id);
    assert.equal(await store.notify(email.id, first), true);
    const concurrentId = `concurrent-${id}`;
    const watchers = await Promise.all(Array.from({ length: 4 }, () => store.createAlert(user, 'uk', concurrentId, 2, 'inapp')));
    assert.equal(new Set(watchers.map(w => w?.id)).size, 1);
    const concurrent = { ...first, id: concurrentId };
    assert.equal((await Promise.all(watchers.map(w => store.notify(w!.id, concurrent)))).filter(Boolean).length, 1);
  } finally {
    await pool.query('DELETE FROM compear_price_alerts WHERE user_id=$1', [user]);
    await pool.query('DELETE FROM compear_price_observations WHERE product_id=$1', [id]);
    await pool.end();
  }
});
