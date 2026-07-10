import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  acquireAiSlot,
  AiRateLimitContext,
  AiRateLimitError,
  isAiRateLimitError,
} from './aiRateLimiter';

const CACHE_PATH = path.join(__dirname, '..', 'data', 'ai-cache.json');

/** Text tasks (normalize, promo). Override with OPENAI_MODEL. */
function getTextModel(): string {
  return process.env.OPENAI_MODEL || 'gpt-5.5';
}

/** Vision tasks (receipt OCR). Override with OPENAI_VISION_MODEL. */
function getVisionModel(): string {
  return process.env.OPENAI_VISION_MODEL || 'gpt-4o';
}

function parseReceiptNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value)
    .trim()
    .replace(/€/g, '')
    .replace(/\s/g, '')
    .replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeReceiptLine(item: ParsedReceiptLine): ParsedReceiptLine | null {
  const rawName = String(item.rawName ?? '').trim();
  if (!rawName) return null;

  const quantity = Math.max(1, Number(item.quantity) || 1);
  const unitPrice = parseReceiptNumber(item.unitPrice);
  let lineTotal = parseReceiptNumber(item.lineTotal) ?? 0;

  if (lineTotal <= 0 && unitPrice != null) {
    lineTotal = unitPrice * quantity;
  }
  if (lineTotal <= 0 && unitPrice == null) return null;

  return {
    rawName,
    quantity,
    unitPrice,
    lineTotal,
  };
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

export type { AiRateLimitContext } from './aiRateLimiter';
export { AiRateLimitError, isAiRateLimitError } from './aiRateLimiter';

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
export async function normalizeProductWithAI(
  rawProductName: string,
  context?: AiRateLimitContext
): Promise<NormalizedProduct | null> {
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

  try {
    await acquireAiSlot('text', context);
  } catch (error) {
    if (isAiRateLimitError(error)) {
      logger.warn('AI normalize rate limited', rawProductName);
      return null;
    }
    throw error;
  }

  try {
    const openai = new OpenAI({
      apiKey,
      maxRetries: 3,
      timeout: 60_000,
    });
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

const RECEIPT_PARSE_PROMPT = `You extract structured data from Dutch supermarket receipt photos (kassabon).
Supported chains include Albert Heijn, Jumbo, Lidl, Aldi, Dirk, Plus, Coop, Hoogvliet, and similar Dutch supermarkets.

Return JSON only with:
- store: supermarket name if visible, else null
- purchaseDate: ISO date YYYY-MM-DD if visible, else null
- currency: always "EUR"
- receiptTotal: total amount paid (Totaal) if visible, else null
- items: array of { rawName, quantity, unitPrice, lineTotal }
  - rawName: product name as printed (without leading quantity prefix when possible)
  - quantity: number (default 1; Dutch receipts often prefix lines with "1 ")
  - unitPrice: price per unit if shown, else null
  - lineTotal: line total price as a number using dot decimals (e.g. 4.69 not 4,69)

Dutch receipts often show quantity and product on one line and the price on the next line.
Include every purchased product line. Ignore BTW/tax lines, payment terminals, loyalty points, and subtotals.`;

/**
 * Parse a receipt image with OpenAI vision. Cached by image hash.
 */
export async function parseReceiptImageWithAI(
  imageBase64: string,
  mimeType: string,
  context?: AiRateLimitContext
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

  await acquireAiSlot('vision', context);

  try {
    const openai = new OpenAI({
      apiKey,
      maxRetries: 3,
      timeout: 60_000,
      // Avoid intermittent truncated gzip responses seen with node-fetch.
      defaultHeaders: { 'Accept-Encoding': 'identity' },
    });
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
                detail: 'high',
              },
            },
          ],
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      logger.warn('AI receipt parse returned empty content', { model: getVisionModel() });
      return null;
    }

    const parsed = JSON.parse(content) as ParsedReceiptData;
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
      logger.warn('AI receipt parse returned no items', { model: getVisionModel(), content });
      return null;
    }

    parsed.currency = parsed.currency || 'EUR';
    parsed.receiptTotal = parseReceiptNumber(parsed.receiptTotal);
    parsed.items = parsed.items
      .map((item) =>
        normalizeReceiptLine({
          rawName: String(item.rawName),
          quantity: Number(item.quantity) || 1,
          unitPrice: item.unitPrice,
          lineTotal: Number(item.lineTotal) || 0,
        })
      )
      .filter((item): item is ParsedReceiptLine => item != null);

    if (parsed.items.length === 0) {
      logger.warn('AI receipt parse filtered all items', { model: getVisionModel() });
      return null;
    }

    cache[cacheKey] = parsed;
    saveCache(cache);
    return parsed;
  } catch (e) {
    if (isAiRateLimitError(e)) throw e;
    logger.error('AI receipt parse failed', e);
    return null;
  }
}
