/** Optional trial limits; provider-independent so the same app can move to a VPS. */
export function insightsPolicy(now = Date.now()) {
  const rawDays = process.env.PRICE_HISTORY_RETENTION_DAYS ?? '180';
  const days = /^\d{1,3}$/.test(rawDays) ? Number(rawDays) : NaN;
  const validDays = Number.isInteger(days) && days >= 1 && days <= 180;
  const rawExpiry = process.env.PRICE_INSIGHTS_EXPIRES_AT || '';
  const expiry = rawExpiry ? Date.parse(rawExpiry) : null;
  const validExpiry = !rawExpiry || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(rawExpiry) && Number.isFinite(expiry) && new Date(expiry!).toISOString().slice(0, 19) === rawExpiry.slice(0, 19));
  return { retentionDays: validDays ? days : 180, expiresAt: validExpiry && expiry !== null ? new Date(expiry).toISOString() : null,
    active: validDays && validExpiry && (expiry === null || now < expiry) };
}
