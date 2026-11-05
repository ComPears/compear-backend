import { Request, Response } from 'express';
import { loadAllProducts } from '../services/dataService';
import { countryFromQuery } from '../config/countries';
import { productSavings } from '../utils/shoppingOptimizer';
import { Product } from '../types/product';

export interface DealsDigest {
  weekLabel: string;
  generatedAt: string;
  totalDeals: number;
  totalPotentialSavings: number;
  byStore: Record<string, number>;
  topSavings: Array<{
    id: string;
    productName: string;
    store: string;
    originalPrice: number;
    effectivePrice: number;
    savings: number;
    promoType: string | null;
  }>;
  biggestPercentOff: Array<{
    id: string;
    productName: string;
    store: string;
    percentOff: number;
    effectivePrice: number;
  }>;
}

export interface SlimDeal {
  id: string;
  productName: string;
  store: string;
  originalPrice: number;
  effectivePrice: number;
  promoType: string | null;
  promoValue: number | null;
  promoValidUntil: string | null;
  category: string;
  savings: number;
  packageSize: string;
  promoQuantity: number | null;
  priceType: Product['priceType'];
  scrapedAt: string;
}

/** A promotion is an observation with conditions, not a guaranteed checkout price. */
export function eligibleDeal(p: Product, now = Date.now()): boolean {
  const observed = Date.parse(p.scrapedAt);
  const expiry = p.promoValidUntil ? Date.parse(p.promoValidUntil) : null;
  return p.priceType !== 'loyalty' && p.promoType != null && Number.isFinite(p.originalPrice) && Number.isFinite(p.effectivePrice)
    && p.originalPrice > p.effectivePrice && p.effectivePrice > 0
    && Number.isFinite(observed) && observed <= now + 300000 && observed >= now - 192 * 3600000
    && (expiry === null || (Number.isFinite(expiry) && expiry > now));
}

function getIsoWeekLabel(date = new Date()): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function toSlimDeal(p: Product): SlimDeal {
  return {
    id: p.id,
    productName: p.productName,
    store: p.store,
    originalPrice: p.originalPrice,
    effectivePrice: p.effectivePrice,
    promoType: p.promoType,
    promoValue: p.promoValue,
    promoValidUntil: p.promoValidUntil,
    category: p.category,
    savings: Math.round(productSavings(p) * 100) / 100,
    packageSize: p.packageSize,
    promoQuantity: p.promoQuantity ?? null,
    priceType: p.priceType,
    scrapedAt: p.scrapedAt,
  };
}

function parsePagination(req: Request): { limit: number; offset: number } {
  const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
  const rawOffset = parseInt(String(req.query.offset ?? '0'), 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 50;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;
  return { limit, offset };
}

export function listDeals(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const { limit, offset } = parsePagination(req);
    const all = loadAllProducts(country);
    if (['store', 'category', 'sort'].some(key => req.query[key] !== undefined && typeof req.query[key] !== 'string')) {
      res.status(400).json({ error: 'Invalid deal filters' }); return;
    }
    const sort = req.query.sort ?? 'saving';
    if (!['saving', 'percent', 'price'].includes(String(sort))) { res.status(400).json({ error: 'Invalid deal sort' }); return; }
    const deals = all.filter((p) => eligibleDeal(p) && (!req.query.store || p.store === req.query.store) && (!req.query.category || p.category === req.query.category));
    deals.sort((a, b) => (sort === 'price' ? a.effectivePrice - b.effectivePrice : sort === 'percent'
      ? productSavings(b) / b.originalPrice - productSavings(a) / a.originalPrice : productSavings(b) - productSavings(a)) || a.id.localeCompare(b.id));
    const total = deals.length;
    const items = deals.slice(offset, offset + limit).map(toSlimDeal);
    res.json({ items, total, limit, offset });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getDealsDigest(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const all = loadAllProducts(country);
    const deals = all.filter((p) => eligibleDeal(p));

    const byStore: Record<string, number> = {};
    let totalPotentialSavings = 0;

    for (const deal of deals) {
      byStore[deal.store] = (byStore[deal.store] ?? 0) + 1;
      totalPotentialSavings += productSavings(deal);
    }

    const topSavings = [...deals]
      .sort((a, b) => productSavings(b) - productSavings(a))
      .slice(0, 10)
      .map((p) => ({
        id: p.id,
        productName: p.productName,
        store: p.store,
        originalPrice: p.originalPrice,
        effectivePrice: p.effectivePrice,
        savings: productSavings(p),
        promoType: p.promoType,
      }));

    const biggestPercentOff = [...deals]
      .map((p) => ({
        id: p.id,
        productName: p.productName,
        store: p.store,
        percentOff: p.originalPrice > 0 ? productSavings(p) / p.originalPrice : 0,
        effectivePrice: p.effectivePrice,
      }))
      .sort((a, b) => b.percentOff - a.percentOff)
      .slice(0, 5);

    const digest: DealsDigest = {
      weekLabel: getIsoWeekLabel(),
      generatedAt: new Date().toISOString(),
      totalDeals: deals.length,
      totalPotentialSavings: Math.round(totalPotentialSavings * 100) / 100,
      byStore,
      topSavings,
      biggestPercentOff,
    };

    res.json(digest);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
