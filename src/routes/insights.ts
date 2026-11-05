import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { countryFromQuery } from '../config/countries';
import { getProductById } from '../services/dataService';
import { getInsightsStore, insightsEnabled, PriceAlert } from '../services/insightsStore';
import { emailAlertsEnabled, sendConfirmation, validAlertEmail, verifyAlertToken } from '../services/alertEmail';
import { requireVerifiedReceiptUser } from '../controllers/receiptsController';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { refreshInsights } from '../services/insightsRefresh';
import { insightsPolicy } from '../services/insightsPolicy';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const publicAlert = (alert: PriceAlert) => ({ id: alert.id, productId: alert.product_id, productName: getProductById(alert.product_id, alert.country)?.productName ?? null, country: alert.country, targetPrice: Number(alert.target_price), channel: alert.channel, confirmed: Boolean(alert.confirmed_at), enabled: alert.enabled });

export const insightsRouter = Router();
insightsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
insightsRouter.get('/features', (_req, res) => { const policy = insightsPolicy(); res.json({ history: insightsEnabled(), alerts: insightsEnabled(), email: insightsEnabled() && emailAlertsEnabled(), retentionDays: policy.retentionDays, expiresAt: policy.expiresAt }); });
insightsRouter.use((_req, res, next) => {
  if (!insightsEnabled()) { res.status(503).json({ error: 'Durable price insights are not configured', code: 'insights-not-configured' }); return; }
  next();
});
insightsRouter.get('/history/:id', async (req, res) => {
  const country = countryFromQuery(req);
  const id = typeof req.params.id === 'string' ? req.params.id : '';
  if (id.length > 100 || !getProductById(id, country)) { res.status(404).json({ error: 'Listing not available' }); return; }
  try { res.json({ country, productId: id, currency: country === 'uk' ? 'GBP' : 'EUR', scope: 'retailer-listing', points: await getInsightsStore()!.history(country, id) }); }
  catch { res.status(503).json({ error: 'Price history is temporarily unavailable' }); }
});
insightsRouter.post('/refresh', apiKeyAuth, async (_req, res) => {
  try { res.json(await refreshInsights(getInsightsStore()!)); }
  catch { res.status(503).json({ error: 'Insights refresh failed' }); }
});
const alertLimit = rateLimit({ windowMs: 3600000, max: 10, standardHeaders: true, legacyHeaders: false });
insightsRouter.get('/alerts', async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  try { res.json((await getInsightsStore()!.listAlerts(user, countryFromQuery(req))).map(publicAlert)); }
  catch { res.status(503).json({ error: 'Alerts temporarily unavailable' }); }
});
insightsRouter.post('/alerts', alertLimit, async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  const country = countryFromQuery(req), { productId, targetPrice, channel = 'inapp', email, consent } = req.body ?? {};
  if (typeof productId !== 'string' || productId.length > 100 || typeof targetPrice !== 'number' || !Number.isFinite(targetPrice) || targetPrice <= 0 || targetPrice > 10000 || Math.abs(targetPrice * 100 - Math.round(targetPrice * 100)) > 0.000001 || !['inapp', 'email'].includes(channel) || consent !== true) { res.status(400).json({ error: 'A product, two-decimal target price and explicit consent are required' }); return; }
  if (!getProductById(productId, country)) { res.status(404).json({ error: 'Listing not available' }); return; }
  if (channel === 'email' && (!validAlertEmail(email) || !emailAlertsEnabled())) { res.status(400).json({ error: 'Email alerts are unavailable or the address is invalid' }); return; }
  try {
    const alert = await getInsightsStore()!.createAlert(user, country, productId, targetPrice, channel, channel === 'email' ? email : undefined);
    if (!alert) { res.status(409).json({ error: 'This listing is already tracked or the 25-alert limit was reached' }); return; }
    if (channel === 'email' && !alert.confirmed_at) await sendConfirmation(alert);
    res.status(201).json(publicAlert(alert));
  } catch { res.status(503).json({ error: 'Could not create or confirm delivery of this alert. Check your saved alerts before retrying.' }); }
});
insightsRouter.post('/alerts/:id/disable', async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  if (!uuid(req.params.id)) { res.status(400).json({ error: 'Invalid alert' }); return; }
  try { res.status(await getInsightsStore()!.disable(user, req.params.id) ? 204 : 404).send(); }
  catch { res.status(503).json({ error: 'Alerts temporarily unavailable' }); }
});
insightsRouter.post('/alerts/:id/resend', alertLimit, async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  if (!uuid(req.params.id)) { res.status(400).json({ error: 'Invalid alert' }); return; }
  try {
    const alert = await getInsightsStore()!.getAlert(req.params.id);
    if (!alert || alert.user_id !== user || !alert.enabled || alert.confirmed_at || alert.created_at.getTime() < Date.now() - 86400000) { res.status(404).json({ error: 'Confirmation request unavailable' }); return; }
    await sendConfirmation(alert); res.status(202).json({ status: 'confirmation-sent' });
  } catch { res.status(503).json({ error: 'Confirmation delivery unavailable' }); }
});
for (const action of ['confirm', 'unsubscribe'] as const) insightsRouter.post(`/alerts/${action}`, alertLimit, async (req, res) => {
  if (!uuid(req.body?.id)) { res.status(400).json({ error: 'Invalid action link' }); return; }
  try {
    const alert = await getInsightsStore()!.getAlert(req.body.id);
    if (!alert || !verifyAlertToken(alert, action, req.body.token)) { res.status(400).json({ error: 'Invalid or expired action link' }); return; }
    if (action === 'confirm') await getInsightsStore()!.confirm(alert.id);
    else await getInsightsStore()!.disable(alert.user_id, alert.id);
    res.json({ status: action === 'confirm' ? 'confirmed' : 'disabled' });
  } catch { res.status(503).json({ error: 'Alerts temporarily unavailable' }); }
});
insightsRouter.get('/notifications', async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  try { res.json(await getInsightsStore()!.notifications(user, countryFromQuery(req))); }
  catch { res.status(503).json({ error: 'Notifications temporarily unavailable' }); }
});
insightsRouter.post('/notifications/:id/read', async (req, res) => {
  const user = requireVerifiedReceiptUser(req, res); if (!user) return;
  if (!uuid(req.params.id)) { res.status(400).json({ error: 'Invalid notification' }); return; }
  try { await getInsightsStore()!.markRead(user, req.params.id); res.status(204).send(); }
  catch { res.status(503).json({ error: 'Notifications temporarily unavailable' }); }
});
