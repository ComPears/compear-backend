import { COUNTRY_CODES } from '../config/countries';
import { getProductById, loadAllProducts } from './dataService';
import { InsightsStore, PriceAlert } from './insightsStore';
import { alertActionUrl, emailAlertsEnabled, sendAlertEmail } from './alertEmail';

export async function refreshInsights(store: InsightsStore) {
  await store.initialize();
  const lock = await store.pool.connect();
  let locked = false;
  let recorded = 0, notified = 0, emails = 0;
  try {
    locked = (await lock.query("SELECT pg_try_advisory_lock(hashtext('compear-insights-refresh')) AS locked")).rows[0].locked;
    if (!locked) return { skipped: 'already-running' };
    for (const country of COUNTRY_CODES) recorded += await store.record(country, loadAllProducts(country));
    const deadline = Date.now() + 120000;
    let cursor = '00000000-0000-0000-0000-000000000000';
    while (Date.now() < deadline) {
      const alerts = (await store.pool.query<PriceAlert>('SELECT * FROM compear_price_alerts WHERE enabled=true AND confirmed_at IS NOT NULL AND id>$1 ORDER BY id LIMIT 100', [cursor])).rows;
      if (!alerts.length) break;
      for (const alert of alerts) {
        cursor = alert.id;
        const product = getProductById(alert.product_id, alert.country);
        if (product && Date.parse(product.scrapedAt) >= Date.now() - 192 * 3600000 && Date.parse(product.scrapedAt) <= Date.now() + 300000) notified += Number(await store.notify(alert.id, product));
      }
    }
    if (emailAlertsEnabled()) {
      for (let count = 0; count < 25 && Date.now() < deadline; count++) {
        const claim = await store.pool.query(`WITH candidate AS (
          SELECT n.id FROM compear_price_notifications n JOIN compear_price_alerts a ON a.id=n.alert_id
          WHERE a.enabled=true AND a.confirmed_at IS NOT NULL AND a.channel='email' AND a.email IS NOT NULL AND n.attempts<5
          AND (n.delivery_state='pending' OR (n.delivery_state='processing' AND n.claimed_at<now()-interval '5 minutes'))
          ORDER BY n.created_at FOR UPDATE OF n SKIP LOCKED LIMIT 1)
          UPDATE compear_price_notifications SET delivery_state='processing',claimed_at=now(),attempts=attempts+1
          WHERE id IN(SELECT id FROM candidate) RETURNING *`);
        const notification = claim.rows[0];
        if (!notification) break;
        const alert = await store.getAlert(notification.alert_id);
        const product = alert && getProductById(alert.product_id, alert.country);
        // Never deliver a queued signal after the listing became unavailable,
        // rose above the target, or the notification itself became stale.
        if (!alert?.enabled || !alert.email || !alert.confirmed_at || alert.channel !== 'email' || !product ||
          product.priceType === 'loyalty' || !Number.isFinite(product.originalPrice) || product.originalPrice > Number(alert.target_price) ||
          Date.parse(product.scrapedAt) < Date.now() - 192 * 3600000 ||
          new Date(notification.observed_at).getTime() < Date.now() - 48 * 3600000) {
          await store.pool.query("UPDATE compear_price_notifications SET delivery_state='cancelled' WHERE id=$1", [notification.id]);
          continue;
        }
        try {
          await sendAlertEmail(alert.email, 'Your Compears target price was reached',
            `${notification.product_name} at ${notification.store}: ${alert.country === 'uk' ? 'GBP' : 'EUR'} ${Number(notification.price).toFixed(2)} per pack.\nObserved ${new Date(notification.observed_at).toISOString()}. This is a retailer observation, not a live stock guarantee.\n\nManage your alerts: https://compears.shop/${alert.country}/alerts\nStop this alert: ${alertActionUrl(alert, 'unsubscribe')}`,
            `price-${notification.id}`);
          await store.pool.query("UPDATE compear_price_notifications SET delivery_state='sent' WHERE id=$1", [notification.id]); emails++;
        } catch {
          // Lease delays retries; a stable provider idempotency key prevents duplicate deliveries.
          await store.pool.query("UPDATE compear_price_notifications SET delivery_state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'processing' END WHERE id=$1", [notification.id]);
        }
      }
    }
    await store.pool.query("DELETE FROM compear_price_observations WHERE observed_at<now()-interval '180 days'");
    await store.pool.query("DELETE FROM compear_price_notifications WHERE created_at<now()-interval '180 days'");
    await store.pool.query("DELETE FROM compear_price_alerts WHERE (enabled=false AND created_at<now()-interval '30 days') OR (confirmed_at IS NULL AND created_at<now()-interval '2 days')");
    return { recorded, notified, emails };
  } finally {
    try { if (locked) await lock.query("SELECT pg_advisory_unlock(hashtext('compear-insights-refresh'))"); }
    finally { lock.release(); }
  }
}
