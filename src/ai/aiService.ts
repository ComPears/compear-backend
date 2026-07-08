import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const CACHE_PATH = path.join(__dirname, '..', 'data', 'ai-cache.json');
const RATE_LIMIT_DELAY_MS = 500;
let lastCallTime = 0;

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
      model: 'gpt-4o-mini',
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
      model: 'gpt-4o-mini',
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
