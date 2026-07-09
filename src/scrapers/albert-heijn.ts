import { chromium, Browser, Page } from 'playwright';
import * as path from 'path';
import { ScrapedProduct } from '../types';
import { toProduct } from '../services/promotionService';
import { simpleCanonicalName, sanitizeProductFields } from '../utils/canonicalName';
import { saveStoreProducts } from '../services/dataService';
import { logger } from '../utils/logger';
import { Product } from '../types';

const STORE = 'Albert Heijn';
const BASE_URL = 'https://www.ah.nl';
const USER_AGENT = 'ComPears-Bot/1.0 (NL grocery price comparison; +https://compears.shop)';
const RATE_LIMIT_MS = 1500;

function parsePrice(text: string): number | null {
  const match = text.replace(/,/g, '.').match(/[\d]+\.?\d*/);
  return match ? parseFloat(match[0]) : null;
}

function parseWeightGrams(size: string): number | null {
  const lower = size.toLowerCase();
  const gMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*g(?:ram)?/);
  if (gMatch) return Math.round(parseFloat(gMatch[1].replace(',', '.')));
  const kgMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) return Math.round(parseFloat(kgMatch[1].replace(',', '.')) * 1000);
  return null;
}

/**
 * Scrape one category or search listing page. AH uses dynamic markup; we look for common patterns.
 */
async function scrapeListingPage(page: Page, url: string): Promise<ScrapedProduct[]> {
  const products: ScrapedProduct[] = [];
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const scrapedAt = new Date().toISOString();

  // Try multiple selectors for product cards (AH may use different structures)
  const cards = await page.$$('[data-testid="product-card"], article[class*="product"], .product-card, [class*="ProductCard"]');
  if (cards.length === 0) {
    const links = await page.$$('a[href*="/producten/product/"]');
    for (const link of links.slice(0, 30)) {
      const nameEl = await link.$('span, h2, [class*="title"], [class*="name"]');
      const priceEl = await link.$('[class*="price"], [data-testid*="price"]');
      const name = nameEl ? await nameEl.textContent() : null;
      const priceText = priceEl ? await priceEl.textContent() : null;
      const href = await link.getAttribute('href');
      if (name && priceText && href) {
        const price = parsePrice(priceText);
        if (price != null) {
          const size = ''; // might be in subtitle
          products.push({
            productName: name.trim(),
            brand: null,
            packageSize: size || 'stuk',
            weightInGrams: null,
            price,
            unitPrice: price,
            promoType: null,
            promoValue: null,
            promoValidUntil: null,
            store: STORE,
            productUrl: href.startsWith('http') ? href : `${BASE_URL}${href}`,
            scrapedAt,
          });
        }
      }
    }
    return products;
  }

  for (const card of cards.slice(0, 50)) {
    try {
      const nameEl = await card.$('a[href*="/producten/"] span, h2, [class*="title"]');
      const priceEl = await card.$('[class*="price"]');
      const name = nameEl ? await nameEl.textContent() : null;
      const priceText = priceEl ? await priceEl.textContent() : null;
      const linkEl = await card.$('a[href*="/producten/"]');
      const href = linkEl ? await linkEl.getAttribute('href') : null;
      if (!name || !priceText) continue;
      const price = parsePrice(priceText);
      if (price == null) continue;

      const sizeEl = await card.$('[class*="size"], [class*="weight"], [class*="quantity"]');
      const size = sizeEl ? (await sizeEl.textContent())?.trim() || '' : '';
      const weightInGrams = size ? parseWeightGrams(size) : null;

      products.push({
        productName: name.trim(),
        brand: null,
        packageSize: size || 'stuk',
        weightInGrams,
        price,
        unitPrice: weightInGrams ? (price / (weightInGrams / 1000)) : price,
        promoType: null,
        promoValue: null,
        promoValidUntil: null,
        store: STORE,
        productUrl: href ? (href.startsWith('http') ? href : `${BASE_URL}${href}`) : null,
        scrapedAt,
      });
    } catch (_) {
      // skip card
    }
  }

  return products;
}

export async function runAlbertHeijnScraper(): Promise<number> {
  let browser: Browser | null = null;
  const allScraped: ScrapedProduct[] = [];
  const seen = new Set<string>();

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 720 },
    });

    const page = await context.newPage();

    // Respect robots: optional check (we use public product pages only)
    const categoryUrls = [
      `${BASE_URL}/producten?pagina=1`,
      `${BASE_URL}/producten`,
    ];

    for (const url of categoryUrls) {
      try {
        const batch = await scrapeListingPage(page, url);
        for (const p of batch) {
          const key = `${p.productName}-${p.price}-${p.packageSize}`;
          if (!seen.has(key)) {
            seen.add(key);
            allScraped.push(p);
          }
        }
        await page.waitForTimeout(RATE_LIMIT_MS);
      } catch (e) {
        logger.warn('Scrape page failed', url, e);
      }
    }

    await context.close();
  } finally {
    if (browser) await browser.close();
  }

  const products: Product[] = allScraped.map((s, i) => {
    const id = `ah-${Date.now()}-${i}`;
    const fields = sanitizeProductFields(
      s.productName,
      s.packageSize ?? 'stuk',
      s.barcode ?? null
    );
    const canonicalName = fields?.canonicalName ?? simpleCanonicalName(s.productName);
    const identityKey = fields?.identityKey ?? canonicalName;
    return toProduct(s, id, canonicalName, identityKey);
  });

  saveStoreProducts('albert-heijn', products);
  return products.length;
}
