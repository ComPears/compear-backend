import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const CACHE_PATH = path.join(__dirname, '..', 'data', 'ai-cache.json');
const RATE_LIMIT_DELAY_MS = 500;
let lastCallTime = 0;

/** Text tasks (normalize, promo). Override with OPENAI_MODEL. */
function getTextModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-5.5';
}

/** Vision tasks (receipt OCR). Override with OPENAI_VISION_MODEL. */
function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.5';
}

function ensureCacheFile(): void {
  const dir = path.dirname(CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(CACHE_PATH)) {
    fs.writeFileSync(CACHE_PATH, '{}', 'utf-8');
  }
}

function loadCache(): Record<string, unknown> {
  ensureCacheFile();
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, unknown>): void {
  ensureCacheFile();
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf-8');
}

function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastCallTime;
  if (elapsed < RATE_LIMIT_DELAY_MS) {
    return new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS - elapsed));
  }
  lastCallTime = Date.now();
  return Promise.resolve();
}

export interface NormalizedProduct {
  canonicalName: string;
  category: string;
  weightInGrams: number | null;
  brand: string | null;
  keywords: string[];
}

export interface ParsedReceiptLine {
  rawName: string;
  quantity: number;
  unitPrice: number | null;
  lineTotal: number;
}

export interface ParsedReceiptData {
  store: string | null;
  purchaseDate: string | null;
  currency: string;
  items: ParsedReceiptLine[];
  receiptTotal: number | null;
}

/**
 * Call OpenAI to normalize a raw product string. Cached by input key.
 */
export async function normalizeProductWithAI(rawProductName: string): Promise<NormalizedProduct | null> {
  const cacheKey = `normalize:${rawProductName.toLowerCase().trim()}`;
  const cache = loadCache();
  if (cache[cacheKey] != null) {
    return cache[cacheKey] as NormalizedProduct;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set; skipping AI normalization');
    return null;
  }

  await rateLimit();

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: 'system',
          content: `You are a Dutch grocery product normalizer. Extract structured data from product names. Return only valid JSON with: canonicalName (short lowercase, e.g. "eieren 6 stuks"), category (e.g. "eieren"), weightInGrams (number or null), brand (string or null), keywords (string array).`,
        },
        {
          role: 'user',
          content: `Normalize this product name: "${rawProductName}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as NormalizedProduct;
    if (!parsed.canonicalName) return null;

    cache[cacheKey] = parsed;
    saveCache(cache);
    return parsed;
  } catch (e) {
    logger.error('AI normalize failed', rawProductName, e);
    return null;
  }
}

/**
 * Interpret promo text into type and value. Cached.
 */
export async function interpretPromoWithAI(promoText: string): Promise<{ type: string; value?: number; quantity?: number } | null> {
  if (!promoText || !promoText.trim()) return null;
  const cacheKey = `promo:${promoText.toLowerCase().trim()}`;
  const cache = loadCache();
  if (cache[cacheKey] != null) {
    return cache[cacheKey] as { type: string; value?: number; quantity?: number };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  await rateLimit();

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: 'system',
          content: 'Interpret Dutch supermarket promo text. Return JSON with: type (one of BOGO, SECOND_FREE, PERCENTAGE, MULTI_BUY, or null), value (number e.g. 0.25 for 25%), quantity (for MULTI_BUY e.g. 3 for "3 for €5").',
        },
        { role: 'user', content: promoText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as { type: string; value?: number; quantity?: number };
    cache[cacheKey] = parsed;
    saveCache(cache);
    return parsed;
  } catch (e) {
    logger.error('AI promo interpret failed', promoText, e);
    return null;
  }
}

const RECEIPT_PARSE_PROMPT = `You extract structured data from Dutch supermarket receipt photos.
Return JSON only with:
- store: supermarket name if visible (AH, Albert Heijn, Jumbo, Lidl, Aldi, Dirk, Plus, Coop) or null
- purchaseDate: ISO date YYYY-MM-DD if visible, else null
- currency: always "EUR"
- receiptTotal: total amount paid if visible, else null
- items: array of { rawName, quantity, unitPrice, lineTotal }
  - rawName: product name as printed
  - quantity: number (default 1)
  - unitPrice: price per unit if shown, else null
  - lineTotal: line total price as number

Ignore payment info, loyalty points, and subtotals that are not product lines.`;

/**
 * Parse a receipt image with OpenAI vision. Cached by image hash.
 */
export async function parseReceiptImageWithAI(
  imageBase64: string,
  mimeType: string
): Promise<ParsedReceiptData | null> {
  const crypto = await import('crypto');
  const imageHash = crypto.createHash('sha256').update(imageBase64).digest('hex').slice(0, 16);
  const cacheKey = `receipt:${imageHash}`;
  const cache = loadCache();
  if (cache[cacheKey] != null) {
    return cache[cacheKey] as ParsedReceiptData;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn('OPENAI_API_KEY not set; cannot parse receipt');
    return null;
  }

  await rateLimit();

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: getVisionModel(),
      messages: [
        { role: 'system', content: RECEIPT_PARSE_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all product line items from this Dutch supermarket receipt.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 4000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as ParsedReceiptData;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null;

    parsed.currency = parsed.currency || 'EUR';
    parsed.items = parsed.items
      .filter((item) => item?.rawName?.trim())
      .map((item) => ({
        rawName: String(item.rawName).trim(),
        quantity: Math.max(1, Number(item.quantity) || 1),
        unitPrice: item.unitPrice != null ? Number(item.unitPrice) : null,
        lineTotal: Number(item.lineTotal) || 0,
      }))
      .filter((item) => item.lineTotal > 0 || item.unitPrice != null);

    cache[cacheKey] = parsed;
    saveCache(cache);
    return parsed;
  } catch (e) {
    logger.error('AI receipt parse failed', e);
    return null;
  }
}
