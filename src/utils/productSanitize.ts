/**
 * Product sanitization — mirrors compears-data-wrangling/product_sanitize.py
 */

const REJECT_NAME_PATTERNS: RegExp[] = [
  /prijsvoorbeeld/i,
  /actieprijzen\s+vari/i,
  /in verschillende varianten/i,
  /\ball[e]?\s+.+\s+voor\b/i,
  /\bvanaf\s*-?\d+\s*%/i,
  /alleen in de winkel vanaf/i,
  /^\s*bij\s*$/i,
  /^\s*bij\s+\d/i,
  /^\d+[.,]\d{2}\s*(euro|eur)?\s*$/i,
];

const PROMO_FRAGMENTS = [
  'prijsvoorbeeld',
  'actieprijzen',
  'in verschillende varianten',
  'alleen in de winkel',
  'met lidl plus',
  'voor eur ',
  'goedkoper',
];

const GENERIC_STOPWORDS = new Set([
  'per', 'stuk', 'stuks', 'st', 'voor', 'eur', 'euro', 'de', 'het', 'een', 'en', 'met', 'van',
  'voordeel', 'voordeelverpakking', 'voordeelpak', 'verpakking', 'pak', 'nieuw', 'prijs',
  'actie', 'aanbieding', 'gratis', 'online', 'alleen', 'winkel',
]);

const STORE_TOKENS = new Set(['ah', 'jumbo', 'plus', 'dirk', 'lidl', 'aldi', 'coop', 'huismerk', '1e', 'prijs']);

const KNOWN_BRANDS = new Set([
  'campina', 'melkunie', 'arla', 'optimel', 'sensodyne', 'prodent', 'aquafresh', 'signal', 'colgate',
  'milka', 'unox', 'knorr', 'maggi', 'heinz', 'calve', 'honig', 'jumbo', 'ah', 'plus', 'coca', 'cola',
  'pepsi', 'fanta', 'spa', 'heineken', 'amstel', 'grolsch', 'bolletje', 'wasa', 'lu', 'iglo', 'ola',
  'nivea', 'dove', 'axe', 'gillette', 'always', 'libresse', 'galbani', 'leerdammer', 'liga', 'mars',
  'snickers', 'twix', 'haribo', 'red', 'bull',
]);

const MULTI_WORD_BRANDS = [
  'cote d or', 'côte d or', 'douwe egberts', 'old amsterdam', 'red bull', 'ben jerry', 'ben & jerry',
  'grand italia',
];

export interface SanitizedProductFields {
  productName: string;
  canonicalName: string;
  identityKey: string;
  brand: string | null;
  packageSize: string;
  weightInGrams: number | null;
}

function collapseWs(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

export function shouldRejectProductName(name: string): boolean {
  const n = collapseWs(name);
  if (n.length < 3) return true;
  return REJECT_NAME_PATTERNS.some((p) => p.test(n));
}

export function stripPromoFromName(name: string): string {
  let text = name;
  const lower = text.toLowerCase();
  for (const frag of PROMO_FRAGMENTS) {
    const idx = lower.indexOf(frag);
    if (idx >= 0) text = text.slice(0, idx);
  }
  text = text.replace(/\bvoor\s+met\s+lidl\s+plus\b.*$/i, '');
  text = text.replace(/\bvoor\s+eur\b.*$/i, '');
  text = text.replace(/\s*-\d+\s*%\s*$/i, '');
  text = text.replace(/\s+voor\s*$/i, '');
  return collapseWs(text);
}

export function parseSizeToMl(size: string | null | undefined): number | null {
  if (!size) return null;
  const lower = size.toLowerCase().replace(/,/g, '.').replace(/^per\s+/, '');

  const multi = lower.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/);
  if (multi) {
    const count = parseInt(multi[1], 10);
    const qty = parseFloat(multi[2]);
    const unit = multi[3];
    if (unit === 'l') return Math.round(count * qty * 1000);
    if (unit === 'ml') return Math.round(count * qty);
    if (unit === 'kg') return Math.round(count * qty * 1000);
    if (unit === 'g') return Math.round(count * qty);
  }

  const ml = lower.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return Math.round(parseFloat(ml[1]));

  const l = lower.match(/(\d+(?:\.\d+)?)\s*l(?:iter)?(?!\w)/);
  if (l) return Math.round(parseFloat(l[1]) * 1000);

  const g = lower.match(/(\d+(?:\.\d+)?)\s*g(?:ram)?(?!\w)/);
  if (g) return Math.round(parseFloat(g[1]));

  const kg = lower.match(/(\d+(?:\.\d+)?)\s*kg\b/);
  if (kg) return Math.round(parseFloat(kg[1]) * 1000);

  const st = lower.match(/(\d+)\s*st(?:uk)?(?:s)?\b/);
  if (st) return parseInt(st[1], 10);

  if (['stuk', 'st', 'st.', 'per stuk'].includes(lower)) return 1;
  return null;
}

export function normalizeSizeLabel(size: string | null | undefined, sizeMl: number | null): string {
  if (sizeMl != null) {
    if (sizeMl >= 1000 && sizeMl % 1000 === 0) return `${sizeMl / 1000} l`;
    if (sizeMl >= 1000) return `${(sizeMl / 1000).toFixed(2).replace(/\.00$/, '')} l`;
    if (sizeMl === 1) return '1 stuk';
    return `${sizeMl} ml`;
  }
  return collapseWs(size || 'stuk');
}

export function extractBrand(name: string): string | null {
  const lower = name.toLowerCase();
  for (const phrase of MULTI_WORD_BRANDS) {
    if (lower.includes(phrase)) return collapseWs(phrase);
  }
  const tokens = lower.match(/[a-z0-9&]+/g) ?? [];
  for (const token of tokens) {
    if (KNOWN_BRANDS.has(token)) return token;
  }
  for (const word of name.split(/\s+/)) {
    const clean = word.replace(/[^a-zA-Z&]/g, '');
    if (clean.length >= 3 && clean[0] === clean[0].toUpperCase() && !GENERIC_STOPWORDS.has(clean.toLowerCase())) {
      return clean.toLowerCase();
    }
  }
  return null;
}

export function tokenizeProductName(name: string, brand: string | null): string[] {
  let lower = name.toLowerCase();
  if (brand) {
    for (const part of brand.split(/\s+/)) {
      lower = lower.replace(new RegExp(`\\b${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
    }
  }
  lower = lower.replace(/\d+(?:[.,]\d+)?\s*(ml|l|cl|g|kg|stuks?|st)\b/g, ' ');
  const tokens = lower.match(/[a-z0-9]+/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (GENERIC_STOPWORDS.has(token) || STORE_TOKENS.has(token) || token.length < 2) continue;
    if (!seen.has(token)) {
      seen.add(token);
      result.push(token);
    }
  }
  return result.sort();
}

export function buildCanonicalName(name: string, brand: string | null, tokens: string[]): string {
  if (brand && tokens.length) return `${brand} ${tokens.join(' ')}`;
  if (tokens.length) return tokens.join(' ');
  return collapseWs(name).toLowerCase();
}

export function buildIdentityKey(
  barcode: string | null,
  brand: string | null,
  tokens: string[],
  sizeMl: number | null
): string {
  if (barcode) return `ean:${barcode}`;
  const tokenPart = tokens.length ? tokens.join('-') : 'unknown';
  return `tok:${brand ?? 'unknown'}|${tokenPart}|${sizeMl ?? 'na'}`;
}

export function sanitizeProductFields(
  productName: string,
  packageSize: string,
  barcode: string | null,
  existing?: Partial<SanitizedProductFields>
): SanitizedProductFields | null {
  const cleanName = stripPromoFromName(productName);
  if (cleanName.length < 3) return null;
  if (shouldRejectProductName(cleanName)) return null;

  const brand = existing?.brand ?? extractBrand(cleanName);
  const sizeMl = existing?.weightInGrams ?? parseSizeToMl(packageSize);
  const tokens = tokenizeProductName(cleanName, brand);
  if (!tokens.length && !brand) return null;

  const canonicalName = existing?.canonicalName ?? buildCanonicalName(cleanName, brand, tokens);
  const identityKey =
    existing?.identityKey ?? buildIdentityKey(barcode, brand, tokens, sizeMl);

  return {
    productName: titleCaseWords(cleanName),
    canonicalName,
    identityKey,
    brand,
    packageSize: normalizeSizeLabel(packageSize, sizeMl),
    weightInGrams: sizeMl,
  };
}

function titleCaseWords(text: string): string {
  return collapseWs(text)
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

/** @deprecated use sanitizeProductFields */
export function simpleCanonicalName(productName: string): string {
  const brand = extractBrand(productName);
  const tokens = tokenizeProductName(stripPromoFromName(productName), brand);
  return buildCanonicalName(productName, brand, tokens);
}
