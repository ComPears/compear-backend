/** Dietary / product labels inferred from product names (NL, EN, DE keywords). */
export type DietaryLabel =
  | 'vegan'
  | 'vegetarian'
  | 'gluten-free'
  | 'lactose-free'
  | 'organic'
  | 'sugar-free'
  | 'nut-free'
  | 'halal';

export const DIETARY_LABELS: DietaryLabel[] = [
  'vegan',
  'vegetarian',
  'gluten-free',
  'lactose-free',
  'organic',
  'sugar-free',
  'nut-free',
  'halal',
];

const LABEL_PATTERNS: Record<DietaryLabel, RegExp[]> = {
  vegan: [/\bvegan/i, /\bplant(?:based|aardig)/i, /\b100\s*%\s*plantaardig/i],
  vegetarian: [/\bvegetari/i, /\bvega\b/i, /\bveggie/i],
  'gluten-free': [/\bglutenvrij/i, /\bgluten[- ]free/i, /\bglutenfrei/i, /\bwithout gluten/i],
  'lactose-free': [/\blactosevrij/i, /\blactose[- ]free/i, /\blaktosefrei/i, /\blactosevrije/i],
  organic: [/\bbio\b/i, /\bbiologisch/i, /\borganic/i, /\bökologisch/i, /\bekologisk/i],
  'sugar-free': [/\bsuikervrij/i, /\bsugar[- ]free/i, /\bzuckerfrei/i, /\bzero sugar/i],
  'nut-free': [/\bnotenvrij/i, /\bnut[- ]free/i, /\bwithout nuts/i],
  halal: [/\bhalal/i],
};

export function extractDietaryLabels(productName: string, canonicalName?: string): DietaryLabel[] {
  const text = `${productName} ${canonicalName ?? ''}`.toLowerCase();
  const found: DietaryLabel[] = [];
  for (const label of DIETARY_LABELS) {
    if (LABEL_PATTERNS[label].some((re) => re.test(text))) {
      found.push(label);
    }
  }
  if (found.includes('vegan') && !found.includes('vegetarian')) {
    found.push('vegetarian');
  }
  return found;
}

export function productMatchesLabels(
  productName: string,
  canonicalName: string | undefined,
  required: DietaryLabel[]
): boolean {
  if (required.length === 0) return true;
  const labels = new Set(extractDietaryLabels(productName, canonicalName));
  return required.every((l) => labels.has(l));
}

export function parseLabelsParam(raw: string | undefined): DietaryLabel[] {
  if (!raw?.trim()) return [];
  const valid = new Set(DIETARY_LABELS);
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase() as DietaryLabel)
    .filter((l) => valid.has(l));
}
