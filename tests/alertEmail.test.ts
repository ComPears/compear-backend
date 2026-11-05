import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertActionUrl, alertToken, verifyAlertToken, validAlertEmail } from '../src/services/alertEmail';
import { PriceAlert } from '../src/services/insightsStore';

test('email actions are purpose-bound, time-limited, and keep capabilities out of query strings', () => {
  const original = process.env.ALERT_SIGNING_SECRET;
  process.env.ALERT_SIGNING_SECRET = 'test-secret-not-for-production-0123456789';
  try {
    const alert = { id: '00000000-0000-4000-8000-000000000001', email: 'fixture@example.com', country: 'uk', created_at: new Date() } as PriceAlert;
    const token = alertToken(alert, 'confirm');
    assert.equal(verifyAlertToken(alert, 'confirm', token), true);
    assert.equal(verifyAlertToken(alert, 'unsubscribe', token), false);
    assert.equal(verifyAlertToken({ ...alert, id: 'other' }, 'confirm', token), false);
    assert.equal(verifyAlertToken({ ...alert, created_at: new Date(Date.now() - 2 * 86400000) }, 'confirm', token), false);
    const url = new URL(alertActionUrl(alert, 'confirm'));
    assert.equal(url.search, ''); assert.ok(url.hash.includes(token));
    assert.equal(validAlertEmail('a@example.com\r\nBcc: other@example.com'), false);
  } finally { if (original === undefined) delete process.env.ALERT_SIGNING_SECRET; else process.env.ALERT_SIGNING_SECRET = original; }
});
