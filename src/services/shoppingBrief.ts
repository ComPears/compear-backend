import { CountryCode } from '../config/countries';
import { Product } from '../types';
import { unitComparison } from '../utils/offerEvidence';
import { freshLabelEvidence } from './labelEvidence';

export type Constraint =
  | { kind: 'price'; maximum: number }
  | { kind: 'unit-price'; maximum: number; basis: 'kg' | 'l' | 'item' }
  | { kind: 'claim'; value: string }
  | { kind: 'exclude-ingredient'; value: string }
  | { kind: 'nutrient'; nutrient: 'proteinG' | 'sugarG' | 'fiberG'; comparison: 'minimum' | 'maximum'; amount: number; basis: '100g' | '100ml' | 'serving' };

export interface ShoppingBrief { query: string; constraints: Constraint[]; warnings: string[] }
export interface Assessment { status: 'pass' | 'fail' | 'unknown'; code: string; constraint: Constraint; actual?: string | number; sourceUrl?: string }

const number = (text: string) => Number(text.replace(',', '.'));
const CLAIM_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:no added sugar|without added sugar|zonder toegevoegde suiker|ohne zuckerzusatz)\b/gi, 'no-added-sugar'],
  [/\b(?:vegan|veganistisch|veganisch)\b/gi, 'vegan'],
  [/\b(?:gluten[- ]free|glutenvrij|glutenfrei)\b/gi, 'gluten-free'],
  [/\b(?:lactose[- ]free|lactosevrij|laktosefrei)\b/gi, 'lactose-free'],
  [/\b(?:vegetarian|vegetarisch)\b/gi, 'vegetarian'],
  [/\bhalal\b/gi, 'halal'],
];

export function interpretBrief(text: string, country: CountryCode): ShoppingBrief {
  if (typeof text !== 'string' || text.trim().length < 2 || text.length > 400) throw new Error('Use a shopping request between 2 and 400 characters');
  const currency = country === 'uk' ? '£' : '€';
  if (text.includes(currency === '£' ? '€' : '£')) throw new Error('Use the currency of the selected country');
  let query = text.trim();
  const constraints: Constraint[] = [], warnings: string[] = [];
  const nutrient = /\b(at least|minimum|min\.?|mindestens|minimaal|at most|maximum|max\.?|höchstens|maximaal)\s*(\d+(?:[.,]\d+)?)\s*g\s*(protein|eiwit|eiweiß|sugar|suiker|zucker|fibre|fiber|vezels|ballaststoffe)\s*(?:per|pro|\/)?\s*(100\s*(?:g|ml)|serving|portion|portie)?/gi;
  const addNutrient = (operator: string, amount: string, label: string, basis?: string) => {
    constraints.push({ kind: 'nutrient', nutrient: /protein|eiwit|eiweiß/i.test(label) ? 'proteinG' : /sugar|suiker|zucker/i.test(label) ? 'sugarG' : 'fiberG', comparison: /at most|maximum|max\.?|höchstens|maximaal/i.test(operator) ? 'maximum' : 'minimum', amount: number(amount), basis: /100\s*ml/i.test(basis ?? '') ? '100ml' : /100\s*g/i.test(basis ?? '') ? '100g' : 'serving' });
  };
  query = query.replace(nutrient, (_full, operator, amount, label, basis) => {
    addNutrient(operator, amount, label, basis);
    return ' ';
  });
  query = query.replace(/\b(\d+(?:[.,]\d+)?)\s*g\s*\+\s*(protein|eiwit|eiweiß|fibre|fiber|vezels|ballaststoffe)\s*(?:(?:per|pro|\/)\s*(100\s*(?:g|ml)|serving|portion|portie))?/gi, (_full, amount, label, basis) => {
    addNutrient('minimum', amount, label, basis);
    return ' ';
  });
  const budget = /\b(?:under|below|less than|up to|max(?:imum)?|onder|tot|unter|bis|höchstens)\s*[£€]?\s*(\d+(?:[.,]\d+)?)(?![\d.,])\s*(?:(?:per|pro|\/)\s*(kg|kilogram|litres?|liters?|l|item|stuk|stück))?/gi;
  query = query.replace(budget, (full, amount, unit, offset, source) => {
    if (/^\s*(?:g|mg|iu)\b/i.test(source.slice(offset + full.length))) return full;
    const value = number(amount);
    if (value <= 0 || value > 100000) return full;
    constraints.push(unit ? { kind: 'unit-price', maximum: value, basis: /kg|kilogram/i.test(unit) ? 'kg' : /^l/i.test(unit) ? 'l' : 'item' } : { kind: 'price', maximum: value });
    return ' ';
  });
  for (const [pattern, value] of CLAIM_ALIASES) query = query.replace(pattern, () => { constraints.push({ kind: 'claim', value }); return ' '; });
  query = query.replace(/\b(?:without|excluding|no|zonder|ohne)\s+([\p{L}][\p{L}\s-]{1,60}?)(?=\s+(?:under|below|onder|unter|with|met|mit)\b|[,;]|$)/giu, (_full, value) => {
    constraints.push({ kind: 'exclude-ingredient', value: value.trim().toLowerCase() }); return ' ';
  });
  query = query.replace(/\b(?:with|and|please|find|show me|met|en|zoek|mit|und|finde)\b/gi, ' ').replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (query.length < 2) throw new Error('Include a product name in your shopping request');
  if (!constraints.length) warnings.push('no-supported-constraints');
  if (/\d+\s*(?:mg|iu)\b|epa|dha|dosage|dosering|dosierung/i.test(query)) warnings.push('unsupported-dose-constraint');
  if (/\b(?:at least|at most|minimum|maximum|mindestens|höchstens|minimaal|maximaal)\b|\d+\s*(?:g|ml)\s*[+<>]|[<>]=?/i.test(query)) warnings.push('unparsed-condition');
  if (constraints.length > 10) warnings.push('unparsed-condition');
  return { query, constraints: constraints.slice(0, 10), warnings };
}

export function validateConstraints(value: unknown): Constraint[] {
  if (!Array.isArray(value) || value.length > 10) throw new Error('Use up to 10 constraints');
  return value.map((c) => {
    if (!c || typeof c !== 'object') throw new Error('Invalid constraint');
    const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100000;
    if (c.kind === 'price' && finite(c.maximum) && c.maximum > 0) return { kind: c.kind, maximum: c.maximum };
    if (c.kind === 'unit-price' && finite(c.maximum) && c.maximum > 0 && ['kg', 'l', 'item'].includes(c.basis)) return { kind: c.kind, maximum: c.maximum, basis: c.basis };
    if (c.kind === 'claim' && ['vegan', 'vegetarian', 'gluten-free', 'lactose-free', 'halal', 'no-added-sugar'].includes(c.value)) return { kind: c.kind, value: c.value };
    if (c.kind === 'exclude-ingredient' && typeof c.value === 'string' && /^[\p{L}\p{N}\s-]{2,60}$/u.test(c.value)) return { kind: c.kind, value: c.value.trim().toLowerCase() };
    if (c.kind === 'nutrient' && ['proteinG', 'sugarG', 'fiberG'].includes(c.nutrient) && ['minimum', 'maximum'].includes(c.comparison) && finite(c.amount) && c.amount <= 1000 && ['100g', '100ml', 'serving'].includes(c.basis)) return { kind: c.kind, nutrient: c.nutrient, comparison: c.comparison, amount: c.amount, basis: c.basis };
    throw new Error('Invalid constraint');
  }) as Constraint[];
}

export function assessProduct(product: Product, constraints: Constraint[]): Assessment[] {
  const evidence = freshLabelEvidence(product.labelEvidence, product.productUrl);
  return constraints.map((constraint): Assessment => {
    const unknown = (code: string): Assessment => ({ status: 'unknown', code, constraint });
    const verdict = (passed: boolean, actual?: string | number): Assessment => ({ status: passed ? 'pass' : 'fail', code: passed ? 'meets-constraint' : 'outside-constraint', constraint, actual, sourceUrl: evidence?.sourceUrl });
    switch (constraint.kind) {
      case 'price':
        if (!product.scrapedAt || product.priceType === 'loyalty') return unknown('price-conditions-unknown');
        return verdict(product.originalPrice <= constraint.maximum, product.originalPrice);
      case 'unit-price': {
        if (product.priceType === 'loyalty' || product.promoType) return unknown('price-conditions-unknown');
        const unit = unitComparison(product);
        return !unit || unit.basis !== constraint.basis ? unknown('incomparable-unit') : verdict(unit.price <= constraint.maximum, unit.price);
      }
      case 'claim':
        return !evidence?.claims.includes(constraint.value) ? unknown('claim-not-evidenced') : verdict(true, constraint.value);
      case 'exclude-ingredient': {
        if (!evidence?.ingredients) return unknown('ingredients-not-evidenced');
        const tokens = evidence.ingredients.toLocaleLowerCase().normalize('NFKC');
        const target = constraint.value.normalize('NFKC');
        const aliases: Record<string, string[]> = {
          'artificial sweeteners': ['sucralose', 'aspartame', 'aspartaam', 'aspartam', 'acesulfame', 'acesulfaam', 'saccharin', 'sacharine', 'cyclamate', 'cyclamaat', 'e950', 'e951', 'e952', 'e954', 'e955', 'neotame', 'advantame'],
          'sucralose': ['sucralose', 'e955'], 'aspartame': ['aspartame', 'aspartaam', 'aspartam', 'e951'],
          'sugar': ['sugar', 'suiker', 'zucker'], 'suiker': ['sugar', 'suiker', 'zucker'], 'zucker': ['sugar', 'suiker', 'zucker'],
          'palm oil': ['palm oil', 'palmolie', 'palmöl'], 'corn syrup': ['corn syrup', 'maissiroop', 'maissirup'],
        };
        const terms = aliases[target];
        if (!terms) return unknown('ingredient-term-not-supported');
        if (target === 'artificial sweeteners' && !terms.some(term => tokens.includes(term))) return unknown('ingredient-term-not-supported');
        // An ingredient-list check is not an allergy or cross-contact guarantee.
        return verdict(!terms.some(term => tokens.includes(term)), target);
      }
      case 'nutrient': {
        const facts = evidence?.nutrients;
        const actual = facts?.[constraint.nutrient];
        return !facts || facts.basis !== constraint.basis || actual === undefined ? unknown('nutrient-basis-not-evidenced') : verdict(constraint.comparison === 'minimum' ? actual >= constraint.amount : actual <= constraint.amount, actual);
      }
    }
  });
}

export function assessmentStatus(assessments: Assessment[]): 'pass' | 'fail' | 'unknown' {
  return assessments.some(a => a.status === 'fail') ? 'fail' : assessments.length && assessments.every(a => a.status === 'pass') ? 'pass' : 'unknown';
}
