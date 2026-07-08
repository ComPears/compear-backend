import { normalizeProductWithAI, NormalizedProduct } from './aiService';

/**
 * Normalize product name: try AI first, fallback to simple lowercase trim.
 */
export async function normalizeProduct(rawProductName: string): Promise<NormalizedProduct | null> {
  const trimmed = rawProductName.trim();
  if (!trimmed) return null;
  const aiResult = await normalizeProductWithAI(trimmed);
  if (aiResult) return aiResult;
  return {
    canonicalName: trimmed.toLowerCase().replace(/\s+/g, ' '),
    category: 'overig',
    weightInGrams: null,
    brand: null,
    keywords: trimmed.toLowerCase().split(/\s+/).filter((w) => w.length > 1),
  };
}
