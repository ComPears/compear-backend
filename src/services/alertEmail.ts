import { createHmac, timingSafeEqual } from 'crypto';
import { PriceAlert } from './insightsStore';

export function emailAlertsEnabled(): boolean {
  return process.env.ENABLE_PRICE_ALERT_EMAIL === 'true' && Boolean(process.env.RESEND_API_KEY && process.env.ALERT_FROM_EMAIL && (process.env.ALERT_SIGNING_SECRET || process.env.RECEIPT_AUTH_SECRET || '').length >= 32);
}
export function validAlertEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(value);
}
function secret(): string {
  const value = process.env.ALERT_SIGNING_SECRET || process.env.RECEIPT_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error('Alert signing is not configured');
  return value;
}
export function alertToken(alert: PriceAlert, purpose: 'confirm' | 'unsubscribe'): string {
  return createHmac('sha256', secret()).update(JSON.stringify([purpose, alert.id, alert.email, alert.created_at.toISOString()])).digest('hex');
}
export function verifyAlertToken(alert: PriceAlert, purpose: 'confirm' | 'unsubscribe', value: unknown): boolean {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return false;
  if (purpose === 'confirm' && Date.now() - alert.created_at.getTime() > 86400_000) return false;
  try { return timingSafeEqual(Buffer.from(value), Buffer.from(alertToken(alert, purpose))); } catch { return false; }
}
export function alertActionUrl(alert: PriceAlert, purpose: 'confirm' | 'unsubscribe'): string {
  // Tokens stay in the fragment, out of server request logs and Referer headers.
  return `https://compears.shop/${alert.country}/alerts/${purpose}#id=${alert.id}&token=${alertToken(alert, purpose)}`;
}
export async function sendAlertEmail(to: string, subject: string, text: string, idempotencyKey: string): Promise<void> {
  if (!emailAlertsEnabled() || !validAlertEmail(to)) throw new Error('Email alerts are not configured');
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to: [to], subject, text }),
  });
  if (!result.ok) throw new Error('Email delivery was not accepted');
}
export async function sendConfirmation(alert: PriceAlert): Promise<void> {
  if (!alert.email) throw new Error('Email is required');
  await sendAlertEmail(alert.email, 'Confirm your Compears price alert',
    `Confirm that you requested this price alert:\n${alertActionUrl(alert, 'confirm')}\n\nNo price emails will be sent until you confirm. This link expires in 24 hours. If you did not request it, ignore this message.\n\nCancel this request:\n${alertActionUrl(alert, 'unsubscribe')}`,
    `confirm-${alert.id}-${alert.created_at.getTime()}`);
}
