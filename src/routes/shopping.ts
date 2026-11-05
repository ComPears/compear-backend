import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { countryFromQuery } from '../config/countries';
import { loadAllProducts } from '../services/dataService';
import { searchProducts } from '../ai/semanticSearch';
import { assessProduct, assessmentStatus, interpretBrief, validateConstraints } from '../services/shoppingBrief';
import { presentOffer } from '../utils/offerEvidence';
import { unitComparison } from '../utils/offerEvidence';
import { buildGuide, guideDefinitions } from '../services/shoppingGuides';

export const shoppingRouter = Router();
shoppingRouter.use(rateLimit({ windowMs: 15 * 60_000, max: 90, standardHeaders: true, legacyHeaders: false }));
shoppingRouter.get('/guides', (req, res) => {
  const country = countryFromQuery(req), products = loadAllProducts(country);
  res.json(guideDefinitions(country).map(definition => {
    const guide = buildGuide(definition.slug, country, products)!;
    const { products: _products, recommendation: _recommendation, ...summary } = guide;
    return summary;
  }));
});
shoppingRouter.get('/guides/:slug', (req, res) => {
  const country = countryFromQuery(req);
  const guide = buildGuide(typeof req.params.slug === 'string' ? req.params.slug : '', country, loadAllProducts(country));
  if (!guide) { res.status(404).json({ error: 'Guide not found' }); return; }
  res.json(guide);
});
shoppingRouter.post('/search', (req, res) => {
  const country = countryFromQuery(req);
  let brief;
  try {
    brief = interpretBrief(req.body?.request, country);
    brief.constraints = validateConstraints(req.body.constraints ?? brief.constraints);
    if (brief.constraints.length) brief.warnings = brief.warnings.filter(warning => warning !== 'no-supported-constraints');
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid shopping request' }); return;
  }
  const selectedStores = req.body?.stores;
  if (selectedStores !== undefined && (!Array.isArray(selectedStores) || selectedStores.length > 18 || selectedStores.some((s: unknown) => typeof s !== 'string' || s.length > 80))) { res.status(400).json({ error: 'Invalid retailer selection' }); return; }
  const offsets = { matches: 0, unknown: 0, excluded: 0 };
  if (req.body.offsets !== undefined) {
    const supplied = req.body.offsets;
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || Object.keys(supplied).some(key => !Object.prototype.hasOwnProperty.call(offsets, key)) || Object.values(supplied).some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 480 || value % 30 !== 0)) { res.status(400).json({ error: 'Invalid result page' }); return; }
    Object.assign(offsets, supplied);
  }
  const terms = brief.query.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(term => term.length > 1) ?? [];
  const products = searchProducts(brief.query, 500, loadAllProducts(country), product => {
    if (selectedStores?.length && !selectedStores.includes(product.store)) return false;
    const text = `${product.productName} ${product.canonicalName} ${product.brand ?? ''}`.toLowerCase();
    return terms.every(term => text.includes(term));
  });
  const results = products.map(product => {
    const assessments = assessProduct(product, brief.constraints);
    const status = assessmentStatus(assessments);
    return { product: presentOffer(product, country), assessments, status: status !== 'fail' && brief.warnings.some(w => w === 'unsupported-dose-constraint' || w === 'unparsed-condition') ? 'unknown' : status };
  });
  const matches = results.filter(r => r.status === 'pass');
  const leaders = new Map<string, typeof matches[number]>();
  for (const result of matches) {
    const unit = unitComparison(result.product);
    if (!unit || result.product.promoType || result.product.priceType === 'loyalty') continue;
    const existing = leaders.get(unit.basis);
    if (!existing || unit.price < unitComparison(existing.product)!.price) leaders.set(unit.basis, result);
  }
  // Pin one leader per comparable measurement; never rank kg against litres.
  const leaderIds = new Set([...leaders.values()].map(result => result.product.id));
  matches.sort((a, b) => Number(leaderIds.has(b.product.id)) - Number(leaderIds.has(a.product.id)));
  res.json({ brief, country, currency: country === 'uk' ? 'GBP' : 'EUR', evaluated: results.length, candidateLimit: 500,
    counts: { matches: matches.length, unknown: results.filter(r => r.status === 'unknown').length, excluded: results.filter(r => r.status === 'fail').length },
    offsets, pageSize: 30,
    matches: matches.slice(offsets.matches, offsets.matches + 30), unknown: results.filter(r => r.status === 'unknown').slice(offsets.unknown, offsets.unknown + 30), excluded: results.filter(r => r.status === 'fail').slice(offsets.excluded, offsets.excluded + 30),
    unitLeaders: [...leaders.entries()].map(([basis, result]) => ({ basis, productId: result.product.id, price: unitComparison(result.product)!.price })),
    notice: 'Source-backed label checks are not allergy or medical advice. Missing evidence is not a match.' });
});
