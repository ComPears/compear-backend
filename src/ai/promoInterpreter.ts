import { interpretPromoWithAI } from './aiService';
import { PromoType } from '../types';

/**
 * Interpret promo text (e.g. "2e halve prijs") into promo type and value.
 * Uses AI when available, with fallback to keyword matching.
 */
export async function interpretPromo(promoText: string): Promise<{ type: PromoType; value: number | null; quantity: number | null }> {
  if (!promoText || !promoText.trim()) {
    return { type: null, value: null, quantity: null };
  }

  const ai = await interpretPromoWithAI(promoText);
  if (ai?.type) {
    const type = ['BOGO', 'SECOND_FREE', 'PERCENTAGE', 'MULTI_BUY'].includes(ai.type)
      ? (ai.type as PromoType)
      : null;
    return {
      type: type ?? null,
      value: ai.value ?? null,
      quantity: ai.quantity ?? null,
    };
  }

  const lower = promoText.toLowerCase();
  if (lower.includes('halve prijs') || lower.includes('2e gratis') || lower.includes('1+1')) {
    return { type: 'SECOND_FREE', value: null, quantity: null };
  }
  if (lower.includes('2 voor') || lower.includes('3 voor') || lower.includes('multi')) {
    const qMatch = lower.match(/(\d+)\s*voor/);
    return { type: 'MULTI_BUY', value: null, quantity: qMatch ? parseInt(qMatch[1], 10) : null };
  }
  const pctMatch = lower.match(/(\d+)\s*%?\s*korting/);
  if (pctMatch) {
    return { type: 'PERCENTAGE', value: parseInt(pctMatch[1], 10) / 100, quantity: null };
  }
  return { type: null, value: null, quantity: null };
}
