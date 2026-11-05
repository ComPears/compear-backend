import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { CountryCode } from '../config/countries';
import { Product } from '../types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS compear_price_observations (
 country text NOT NULL CHECK(country IN ('nl','uk','de')), product_id text NOT NULL,
 observed_at timestamptz NOT NULL, price numeric(12,4) NOT NULL CHECK(price > 0),
 store text NOT NULL, package_size text NOT NULL, currency text NOT NULL,
 PRIMARY KEY(country,product_id,observed_at)
);
CREATE INDEX IF NOT EXISTS compear_prices_lookup ON compear_price_observations(country,product_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS compear_price_alerts (
 id uuid PRIMARY KEY, user_id text NOT NULL, country text NOT NULL CHECK(country IN ('nl','uk','de')),
 product_id text NOT NULL, target_price numeric(12,2) NOT NULL CHECK(target_price > 0),
 channel text NOT NULL CHECK(channel IN ('inapp','email')), email text,
 confirmed_at timestamptz, enabled boolean NOT NULL DEFAULT true,
 below_target boolean NOT NULL DEFAULT false, last_observed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,country,product_id)
);
CREATE INDEX IF NOT EXISTS compear_alerts_user ON compear_price_alerts(user_id,country);
CREATE TABLE IF NOT EXISTS compear_price_notifications (
 id uuid PRIMARY KEY, alert_id uuid NOT NULL REFERENCES compear_price_alerts(id) ON DELETE CASCADE,
 user_id text NOT NULL, country text NOT NULL, product_id text NOT NULL, product_name text NOT NULL,
 price numeric(12,2) NOT NULL, store text NOT NULL, observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 delivery_state text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 claimed_at timestamptz, UNIQUE(alert_id,observed_at)
);
`;

export type AlertChannel = 'inapp' | 'email';
export interface PriceAlert { id: string; user_id: string; country: CountryCode; product_id: string; target_price: string; channel: AlertChannel; email: string | null; confirmed_at: Date | null; enabled: boolean; below_target: boolean; last_observed_at: Date | null; created_at: Date }

export class InsightsStore {
  private initialized?: Promise<void>;
  constructor(readonly pool: Pool) {}
  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.pool.query(SCHEMA).then(() => undefined).catch(error => { this.initialized = undefined; throw error; });
    return this.initialized;
  }
  async record(country: CountryCode, products: Product[]): Promise<number> {
    await this.initialize();
    let count = 0;
    for (let offset = 0; offset < products.length; offset += 250) {
      const rows = products.slice(offset, offset + 250).filter(p => Number.isFinite(p.originalPrice) && p.originalPrice > 0 && Number.isFinite(Date.parse(p.scrapedAt)) && Date.parse(p.scrapedAt) <= Date.now() + 300000 && Date.parse(p.scrapedAt) >= Date.now() - 192 * 3600000 && p.priceType !== 'loyalty').map(p => ({ product_id: p.id, observed_at: p.scrapedAt, price: p.originalPrice, store: p.store, package_size: p.packageSize }));
      if (!rows.length) continue;
      const result = await this.pool.query(`INSERT INTO compear_price_observations(country,product_id,observed_at,price,store,package_size,currency)
        SELECT $1,r.product_id,r.observed_at,r.price,r.store,r.package_size,$2 FROM jsonb_to_recordset($3::jsonb)
        AS r(product_id text,observed_at timestamptz,price numeric,store text,package_size text)
        ON CONFLICT DO NOTHING`, [country, country === 'uk' ? 'GBP' : 'EUR', JSON.stringify(rows)]);
      count += result.rowCount ?? 0;
    }
    return count;
  }
  async history(country: CountryCode, id: string) {
    await this.initialize();
    const result = await this.pool.query(`SELECT to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,
      min(price)::float8 AS low, max(price)::float8 AS high, max(observed_at) AS "observedAt"
      FROM compear_price_observations WHERE country=$1 AND product_id=$2 AND observed_at >= now()-interval '180 days'
      GROUP BY 1 ORDER BY 1 LIMIT 180`, [country, id]);
    return result.rows;
  }
  async listAlerts(userId: string, country: CountryCode) {
    await this.initialize();
    return (await this.pool.query<PriceAlert>('SELECT * FROM compear_price_alerts WHERE user_id=$1 AND country=$2 ORDER BY enabled DESC,created_at DESC LIMIT 100', [userId, country])).rows;
  }
  async createAlert(userId: string, country: CountryCode, productId: string, target: number, channel: AlertChannel, email?: string): Promise<PriceAlert | null> {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize creations per authenticated user to enforce the limit under concurrency.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [userId]);
      const existing = (await client.query<PriceAlert>('SELECT * FROM compear_price_alerts WHERE user_id=$1 AND country=$2 AND product_id=$3', [userId, country, productId])).rows[0];
      const count = Number((await client.query('SELECT count(*) AS count FROM compear_price_alerts WHERE user_id=$1 AND enabled=true', [userId])).rows[0].count);
      if ((!existing?.enabled && count >= 25) || (!existing && Number((await client.query('SELECT count(*) AS count FROM compear_price_alerts WHERE user_id=$1', [userId])).rows[0].count) >= 100)) { await client.query('ROLLBACK'); return null; }
      if (existing) {
        const confirmed = channel === 'inapp' || (existing.channel === 'email' && existing.email === email && Boolean(existing.confirmed_at));
        const updated = await client.query<PriceAlert>(`UPDATE compear_price_alerts SET target_price=$2,channel=$3,email=$4,confirmed_at=CASE WHEN $5 THEN now() ELSE NULL END,
          enabled=true,below_target=false,last_observed_at=NULL,created_at=CASE WHEN $5 THEN created_at ELSE now() END WHERE id=$1 RETURNING *`, [existing.id, target, channel, email ?? null, confirmed]);
        await client.query('COMMIT'); return updated.rows[0];
      }
      const result = await client.query<PriceAlert>(`INSERT INTO compear_price_alerts(id,user_id,country,product_id,target_price,channel,email,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6='inapp' THEN now() ELSE NULL END) RETURNING *`, [randomUUID(), userId, country, productId, target, channel, email ?? null]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async getAlert(id: string): Promise<PriceAlert | undefined> {
    await this.initialize();
    return (await this.pool.query<PriceAlert>('SELECT * FROM compear_price_alerts WHERE id=$1', [id])).rows[0];
  }
  async confirm(id: string): Promise<void> {
    await this.pool.query('UPDATE compear_price_alerts SET confirmed_at=COALESCE(confirmed_at,now()) WHERE id=$1 AND enabled=true', [id]);
  }
  async disable(userId: string, id: string): Promise<boolean> {
    await this.initialize();
    const result = await this.pool.query('UPDATE compear_price_alerts SET enabled=false,email=NULL WHERE user_id=$1 AND id=$2 RETURNING id', [userId, id]);
    return Boolean(result.rowCount);
  }
  async notify(alertId: string, product: Product): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const alert = (await client.query<PriceAlert>('SELECT * FROM compear_price_alerts WHERE id=$1 FOR UPDATE', [alertId])).rows[0];
      if (!alert?.enabled || !alert.confirmed_at || alert.product_id !== product.id || product.priceType === 'loyalty' || !Number.isFinite(product.originalPrice) || product.originalPrice <= 0 || !Number.isFinite(Date.parse(product.scrapedAt)) || (alert.last_observed_at && Date.parse(product.scrapedAt) <= alert.last_observed_at.getTime())) { await client.query('ROLLBACK'); return false; }
      const below = product.originalPrice <= Number(alert.target_price);
      let created = false;
      if (below && !alert.below_target) {
        const inserted = await client.query(`INSERT INTO compear_price_notifications(id,alert_id,user_id,country,product_id,product_name,price,store,observed_at,delivery_state)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`, [randomUUID(), alert.id, alert.user_id, alert.country, product.id, product.productName.slice(0, 300), product.originalPrice, product.store, product.scrapedAt, alert.channel === 'inapp' ? 'not-required' : 'pending']);
        created = Boolean(inserted.rowCount);
      }
      await client.query('UPDATE compear_price_alerts SET below_target=$2,last_observed_at=$3 WHERE id=$1', [alert.id, below, product.scrapedAt]);
      await client.query('COMMIT'); return created;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async notifications(userId: string, country: CountryCode) {
    await this.initialize();
    return (await this.pool.query(`SELECT id,product_id AS "productId",product_name AS "productName",price::float8 AS price,store,observed_at AS "observedAt",read_at AS "readAt"
      FROM compear_price_notifications WHERE user_id=$1 AND country=$2 ORDER BY created_at DESC LIMIT 50`, [userId, country])).rows;
  }
  async markRead(userId: string, id: string) {
    await this.initialize();
    await this.pool.query('UPDATE compear_price_notifications SET read_at=now() WHERE id=$1 AND user_id=$2', [id, userId]);
  }
}

let configured: InsightsStore | undefined;
export function insightsEnabled(): boolean { return process.env.ENABLE_PRICE_INSIGHTS === 'true' && Boolean(process.env.DATABASE_URL); }
export function getInsightsStore(): InsightsStore | undefined {
  if (!insightsEnabled()) return;
  if (!configured) {
    const url = new URL(process.env.DATABASE_URL!);
    if (process.env.NODE_ENV === 'production' && !['verify-full', 'verify-ca'].includes(url.searchParams.get('sslmode') ?? '')) url.searchParams.set('sslmode', 'verify-full');
    const pool = new Pool({ connectionString: url.href, max: 2, connectionTimeoutMillis: 3000, statement_timeout: 10000, idleTimeoutMillis: 10000 });
    pool.on('error', () => { /* Never log connection strings or private alert data. */ });
    configured = new InsightsStore(pool);
  }
  return configured;
}
