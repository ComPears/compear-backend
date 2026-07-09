import { Request, Response } from 'express';
import { loadAllProducts } from '../services/dataService';
import { countryFromQuery } from '../config/countries';
import { productSavings } from '../utils/shoppingOptimizer';

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

function getIsoWeekLabel(date = new Date()): string {
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function listDeals(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const all = loadAllProducts(country);
    const deals = all.filter((p) => p.promoType != null && p.effectivePrice < p.originalPrice);
    res.json(deals);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getDealsDigest(req: Request, res: Response): void {
  try {
    const country = countryFromQuery(req);
    const all = loadAllProducts(country);
    const deals = all.filter((p) => p.promoType != null && p.effectivePrice < p.originalPrice);

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
