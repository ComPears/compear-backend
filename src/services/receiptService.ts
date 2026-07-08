import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ParsedReceiptData } from '../ai/aiService';
import { searchProducts } from '../ai/semanticSearch';
import { normalizeProductWithAI } from '../ai/aiService';
import { getProductsByCanonicalName } from './productMatcher';
import { optimizeShoppingPlan } from '../utils/shoppingOptimizer';
import { Product } from '../types';
import {
  ReceiptAnalysis,
  ReceiptAnalytics,
  ReceiptItemStats,
  ReceiptLineMatch,
  ReceiptMonthStats,
  ReceiptStoreStats,
  SavedReceipt,
} from '../types/receipt';
import { logger } from '../utils/logger';

const RECEIPTS_DIR = path.join(__dirname, '..', 'data', 'receipts');

function ensureReceiptsDir(): void {
  if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  }
}

function userReceiptsPath(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(RECEIPTS_DIR, `${safeId}.json`);
}

function loadUserReceipts(userId: string): SavedReceipt[] {
  ensureReceiptsDir();
  const filePath = userReceiptsPath(userId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? (data as SavedReceipt[]) : [];
  } catch {
    return [];
  }
}

function saveUserReceipts(userId: string, receipts: SavedReceipt[]): void {
  ensureReceiptsDir();
  fs.writeFileSync(userReceiptsPath(userId), JSON.stringify(receipts, null, 2), 'utf-8');
}

function linePaidTotals(line: { quantity: number; unitPrice: number | null; lineTotal: number }) {
  const paidLineTotal =
    line.lineTotal > 0
      ? line.lineTotal
      : line.unitPrice != null
        ? line.unitPrice * line.quantity
        : 0;
  const paidUnitPrice =
    line.unitPrice != null
      ? line.unitPrice
      : line.quantity > 0
        ? paidLineTotal / line.quantity
        : paidLineTotal;
  return { paidLineTotal, paidUnitPrice };
}

async function findProductMatches(rawName: string): Promise<{
  best: Product | null;
  alternatives: Product[];
}> {
  let results = searchProducts(rawName, 8);
  if (results.length === 0) {
    const normalized = await normalizeProductWithAI(rawName);
    if (normalized?.canonicalName) {
      results = searchProducts(normalized.canonicalName, 8);
      if (results.length === 0) {
        results = getProductsByCanonicalName(normalized.canonicalName);
      }
    }
  }

  if (results.length === 0) {
    return { best: null, alternatives: [] };
  }

  const canonical = results[0].canonicalName || results[0].productName;
  const alternatives = getProductsByCanonicalName(canonical);
  const pool = alternatives.length > 0 ? alternatives : results;
  const best = [...pool].sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
  return { best, alternatives: pool };
}

export async function analyzeParsedReceipt(parsed: ParsedReceiptData): Promise<ReceiptAnalysis> {
  const lines: ReceiptLineMatch[] = [];
  const optimizerItems: Array<{
    name: string;
    options: Array<{ store: string; price: number; onSale: boolean; regularPrice?: number }>;
  }> = [];

  for (const item of parsed.items) {
    const { paidLineTotal, paidUnitPrice } = linePaidTotals(item);
    const { best, alternatives } = await findProductMatches(item.rawName);
    const cheapestAlternative =
      alternatives.length > 0
        ? [...alternatives].sort((a, b) => a.effectivePrice - b.effectivePrice)[0]
        : best;

    const cheapestUnit = cheapestAlternative?.effectivePrice ?? paidUnitPrice;
    const lineSavings =
      cheapestAlternative && paidUnitPrice > cheapestUnit
        ? (paidUnitPrice - cheapestUnit) * item.quantity
        : 0;

    lines.push({
      rawName: item.rawName,
      quantity: item.quantity,
      paidUnitPrice,
      paidLineTotal,
      matchedProduct: best,
      alternatives,
      cheapestAlternative,
      lineSavings: Math.round(lineSavings * 100) / 100,
    });

    if (alternatives.length > 0) {
      optimizerItems.push({
        name: item.rawName,
        options: alternatives.map((p) => ({
          store: p.store,
          price: p.effectivePrice,
          onSale: p.promoType != null,
          regularPrice: p.promoType ? p.originalPrice : undefined,
        })),
      });
    }
  }

  const actualTotal = lines.reduce((sum, line) => sum + line.paidLineTotal, 0);
  const cheapestPossibleTotal = lines.reduce(
    (sum, line) =>
      sum +
      (line.cheapestAlternative
        ? line.cheapestAlternative.effectivePrice * line.quantity
        : line.paidLineTotal),
    0
  );
  const potentialSavings = Math.max(0, actualTotal - cheapestPossibleTotal);
  const shoppingPlan = optimizerItems.length > 0 ? optimizeShoppingPlan(optimizerItems) : null;

  return {
    parsed,
    storeDetected: parsed.store,
    purchaseDate: parsed.purchaseDate,
    lines,
    actualTotal: Math.round(actualTotal * 100) / 100,
    cheapestPossibleTotal: Math.round(cheapestPossibleTotal * 100) / 100,
    potentialSavings: Math.round(potentialSavings * 100) / 100,
    shoppingPlan,
    unmatchedCount: lines.filter((line) => !line.matchedProduct).length,
  };
}

export function listReceipts(userId: string): SavedReceipt[] {
  return loadUserReceipts(userId).sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
}

export function saveReceipt(
  userId: string,
  analysis: ReceiptAnalysis,
  imageMimeType: string | null
): SavedReceipt {
  const receipts = loadUserReceipts(userId);
  const saved: SavedReceipt = {
    id: crypto.randomUUID(),
    userId,
    uploadedAt: new Date().toISOString(),
    imageMimeType,
    analysis,
  };
  receipts.unshift(saved);
  saveUserReceipts(userId, receipts.slice(0, 200));
  logger.info('Saved receipt', saved.id, 'for user', userId);
  return saved;
}

export function deleteReceipt(userId: string, receiptId: string): boolean {
  const receipts = loadUserReceipts(userId);
  const next = receipts.filter((r) => r.id !== receiptId);
  if (next.length === receipts.length) return false;
  saveUserReceipts(userId, next);
  return true;
}

function monthKey(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function getReceiptAnalytics(userId: string): ReceiptAnalytics {
  const receipts = loadUserReceipts(userId);
  const totalSpent = receipts.reduce((sum, r) => sum + r.analysis.actualTotal, 0);
  const totalCouldHaveSaved = receipts.reduce((sum, r) => sum + r.analysis.potentialSavings, 0);

  const byStoreMap = new Map<string, ReceiptStoreStats>();
  const byMonthMap = new Map<string, ReceiptMonthStats>();
  const itemMap = new Map<string, ReceiptItemStats>();

  for (const receipt of receipts) {
    const store = receipt.analysis.storeDetected || 'Unknown';
    const storeEntry = byStoreMap.get(store) ?? {
      store,
      receiptCount: 0,
      totalSpent: 0,
      totalCouldHaveSaved: 0,
    };
    storeEntry.receiptCount += 1;
    storeEntry.totalSpent += receipt.analysis.actualTotal;
    storeEntry.totalCouldHaveSaved += receipt.analysis.potentialSavings;
    byStoreMap.set(store, storeEntry);

    const month = monthKey(receipt.analysis.purchaseDate || receipt.uploadedAt);
    const monthEntry = byMonthMap.get(month) ?? {
      month,
      totalSpent: 0,
      totalCouldHaveSaved: 0,
      receiptCount: 0,
    };
    monthEntry.receiptCount += 1;
    monthEntry.totalSpent += receipt.analysis.actualTotal;
    monthEntry.totalCouldHaveSaved += receipt.analysis.potentialSavings;
    byMonthMap.set(month, monthEntry);

    for (const line of receipt.analysis.lines) {
      const key = line.rawName.toLowerCase();
      const itemEntry = itemMap.get(key) ?? {
        name: line.rawName,
        purchaseCount: 0,
        totalSpent: 0,
        totalCouldHaveSaved: 0,
      };
      itemEntry.purchaseCount += line.quantity;
      itemEntry.totalSpent += line.paidLineTotal;
      itemEntry.totalCouldHaveSaved += line.lineSavings;
      itemMap.set(key, itemEntry);
    }
  }

  const topItems = Array.from(itemMap.values())
    .sort((a, b) => b.totalCouldHaveSaved - a.totalCouldHaveSaved)
    .slice(0, 15);

  return {
    receiptCount: receipts.length,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalCouldHaveSaved: Math.round(totalCouldHaveSaved * 100) / 100,
    averageSavingsPerReceipt:
      receipts.length > 0 ? Math.round((totalCouldHaveSaved / receipts.length) * 100) / 100 : 0,
    byStore: Array.from(byStoreMap.values()).sort((a, b) => b.totalSpent - a.totalSpent),
    byMonth: Array.from(byMonthMap.values()).sort((a, b) => a.month.localeCompare(b.month)),
    topItems,
  };
}
