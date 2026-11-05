import { CountryCode } from '../config/countries';

// Return literals rather than carrying request-derived strings to filesystem APIs.
export function labelEvidenceFileName(country: CountryCode): string {
  switch (country) {
    case 'nl': return 'nl.json';
    case 'uk': return 'uk.json';
    case 'de': return 'de.json';
    default: throw new Error('Unsupported label-evidence country');
  }
}

export interface LabelEvidence {
  version: 1;
  sourceUrl: string;
  observedAt: string;
  method: 'json_ld' | 'retailer_api' | 'retailer_page';
  ingredients?: string;
  claims: string[];
  nutrients?: { basis: '100g' | '100ml' | 'serving'; servingSize: string; proteinG?: number; sugarG?: number; fiberG?: number; fatG?: number };
}

const CLAIMS = new Set(['vegan', 'vegetarian', 'gluten-free', 'low-lactose', 'lactose-free', 'halal', 'kosher', 'no-added-sugar', 'organic']);

export function normalizeLabelEvidence(input: unknown, productUrl: string | null | undefined): LabelEvidence | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !productUrl) return;
  const value = input as Record<string, any>;
  try {
    const source = new URL(value.sourceUrl), product = new URL(productUrl);
    source.hash = ''; product.hash = '';
    if (source.protocol !== 'https:' || source.username || source.password || source.href !== product.href) return;
  } catch { return; }
  if (value.version !== 1 || !['json_ld', 'retailer_api', 'retailer_page'].includes(value.method)) return;
  const observed = typeof value.observedAt === 'string' ? Date.parse(value.observedAt) : NaN;
  if (!Number.isFinite(observed) || observed > Date.now() + 5 * 60_000) return;
  const claims = Array.isArray(value.claims) ? [...new Set(value.claims.filter((v: unknown) => typeof v === 'string' && CLAIMS.has(v)))].slice(0, 12) as string[] : [];
  const result: LabelEvidence = { version: 1, sourceUrl: value.sourceUrl, observedAt: new Date(observed).toISOString(), method: value.method, claims };
  if (typeof value.ingredients === 'string' && value.ingredients.length <= 4000 && !/[<>\x00]/.test(value.ingredients)) result.ingredients = value.ingredients.trim() || undefined;
  const facts = value.nutrients;
  if (facts && ['100g', '100ml', 'serving'].includes(facts.basis) && typeof facts.servingSize === 'string' && facts.servingSize.length <= 80 && !/[<>\x00]/.test(facts.servingSize)) {
    const nutrients: NonNullable<LabelEvidence['nutrients']> = { basis: facts.basis, servingSize: facts.servingSize };
    for (const key of ['proteinG', 'sugarG', 'fiberG', 'fatG'] as const) {
      if (typeof facts[key] === 'number' && Number.isFinite(facts[key]) && facts[key] >= 0 && facts[key] <= 1000) nutrients[key] = facts[key];
    }
    if (Object.keys(nutrients).length > 2) result.nutrients = nutrients;
  }
  return result.ingredients || claims.length || result.nutrients ? result : undefined;
}

export function freshLabelEvidence(input: unknown, productUrl: string | null | undefined, now = Date.now()): LabelEvidence | undefined {
  const evidence = normalizeLabelEvidence(input, productUrl);
  return evidence && now - Date.parse(evidence.observedAt) <= 30 * 86400_000 ? evidence : undefined;
}
