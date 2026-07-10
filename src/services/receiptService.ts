import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  ParsedReceiptData,
  normalizeProductWithAI,
  AiRateLimitContext,
  removeAiCacheEntries,
} from '../ai/aiService';
import { searchProducts } from '../ai/semanticSearch';
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
  ReceiptLineCorrection,
  SavedReceipt,
} from '../types/receipt';
import { logger } from '../utils/logger';
import {
  calculateReceiptMatchConfidence,
  ReceiptMatchMethod,
  statusForConfidence,
} from './receiptMatching';

const RECEIPTS_DIR = path.join(__dirname, '..', 'data', 'receipts');
const DEFAULT_RETENTION_DAYS = 365;

function ensureReceiptsDir(): void {
  if (!fs.existsSync(RECEIPTS_DIR)) {
    fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
  }
}

function userReceiptsPath(userId: string): string {
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(RECEIPTS_DIR, `${safeId}.json`);
}

function hydrateLegacyReceipt(receipt: SavedReceipt): SavedReceipt {
  for (const line of receipt.analysis?.lines ?? []) {
    if (line.matchStatus) continue;
    line.matchStatus = line.matchedProduct ? 'matched' : 'unmatched';
    line.matchConfidence = line.matchedProduct ? 1 : 0;
    line.matchMethod = 'catalog';
  }
  return receipt;
}

function loadUserReceipts(userId: string): SavedReceipt[] {
  ensureReceiptsDir();
  const filePath = userReceiptsPath(userId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    const receipts = (data as SavedReceipt[]).map(hydrateLegacyReceipt);
    const configuredDays = Number(process.env.RECEIPT_RETENTION_DAYS);
    const retentionDays =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? configuredDays
        : DEFAULT_RETENTION_DAYS;
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const retained = receipts.filter((receipt) => {
      const uploadedAt = new Date(receipt.uploadedAt).getTime();
      return !Number.isFinite(uploadedAt) || uploadedAt >= cutoff;
    });
    if (retained.length !== receipts.length) {
      const expiredKeys = receipts
        .filter((receipt) => !retained.includes(receipt))
        .flatMap((receipt) => receipt.aiCacheKeys ?? []);
      removeAiCacheEntries(expiredKeys);
      fs.writeFileSync(filePath, JSON.stringify(retained, null, 2), 'utf-8');
    }
    return retained;
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

async function findProductMatches(
  rawName: string,
  aiContext?: AiRateLimitContext,
  method: ReceiptMatchMethod = 'catalog'
): Promise<{
  best: Product | null;
  alternatives: Product[];
  confidence: number;
  method: ReceiptMatchMethod;
}> {
  let results = searchProducts(rawName, 8);
  let searchName = rawName;
  let matchMethod = method;
  const initialConfidence =
    results.length > 0 ? calculateReceiptMatchConfidence(rawName, results[0]) : 0;
  if (results.length === 0 || initialConfidence < 0.72) {
    const normalized = await normalizeProductWithAI(rawName, aiContext);
    if (normalized?.canonicalName) {
      const normalizedResults = searchProducts(normalized.canonicalName, 8);
      const exactResults = getProductsByCanonicalName(normalized.canonicalName);
      const candidateResults = exactResults.length > 0 ? exactResults : normalizedResults;
      const normalizedConfidence =
        candidateResults.length > 0
          ? calculateReceiptMatchConfidence(normalized.canonicalName, candidateResults[0])
          : 0;
      if (normalizedConfidence > initialConfidence) {
        results = candidateResults;
        searchName = normalized.canonicalName;
        matchMethod = method === 'user_corrected' ? method : 'ai_normalized';
      }
    }
  }

  if (results.length === 0) {
    return { best: null, alternatives: [], confidence: 0, method: matchMethod };
  }

  const confidence = calculateReceiptMatchConfidence(searchName, results[0]);
  const canonical = results[0].canonicalName || results[0].productName;
  const alternatives = getProductsByCanonicalName(canonical);
  const pool = alternatives.length > 0 ? alternatives : results;
  const best = [...pool].sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
  return { best, alternatives: pool, confidence, method: matchMethod };
}

export async function analyzeParsedReceipt(
  parsed: ParsedReceiptData,
  aiContext?: AiRateLimitContext
): Promise<ReceiptAnalysis> {
  const lines: ReceiptLineMatch[] = [];
  const optimizerItems: Array<{
    name: string;
    options: Array<{ store: string; price: number; onSale: boolean; regularPrice?: number }>;
  }> = [];

  for (const item of parsed.items) {
    const { paidLineTotal, paidUnitPrice } = linePaidTotals(item);
    const { best, alternatives, confidence, method } = await findProductMatches(
      item.rawName,
      aiContext
    );
    const matchStatus = statusForConfidence(confidence);
    const confirmedBest = matchStatus === 'matched' ? best : null;
    const cheapestAlternative =
      matchStatus === 'matched' && alternatives.length > 0
        ? [...alternatives].sort((a, b) => a.effectivePrice - b.effectivePrice)[0]
        : confirmedBest;

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
      matchedProduct: confirmedBest,
      alternatives,
      cheapestAlternative,
      lineSavings: Math.round(lineSavings * 100) / 100,
      matchConfidence: confidence,
      matchStatus,
      matchMethod: method,
    });

    if (matchStatus === 'matched' && alternatives.length > 0) {
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
  imageMimeType: string | null,
  aiCacheKeys: string[] = []
): SavedReceipt {
  const receipts = loadUserReceipts(userId);
  const saved: SavedReceipt = {
    id: crypto.randomUUID(),
    userId,
    uploadedAt: new Date().toISOString(),
    imageMimeType,
    analysis,
    aiCacheKeys,
  };
  receipts.unshift(saved);
  const retained = receipts.slice(0, 200);
  removeAiCacheEntries(
    receipts.slice(200).flatMap((receipt) => receipt.aiCacheKeys ?? [])
  );
  saveUserReceipts(userId, retained);
  logger.info('Saved receipt', saved.id, 'for user', userId);
  return saved;
}

export function deleteReceipt(userId: string, receiptId: string): boolean {
  const receipts = loadUserReceipts(userId);
  const removed = receipts.find((receipt) => receipt.id === receiptId);
  const next = receipts.filter((r) => r.id !== receiptId);
  if (next.length === receipts.length) return false;
  saveUserReceipts(userId, next);
  removeAiCacheEntries(removed?.aiCacheKeys ?? []);
  return true;
}

export function clearReceipts(userId: string): number {
  const receipts = loadUserReceipts(userId);
  saveUserReceipts(userId, []);
  removeAiCacheEntries(receipts.flatMap((receipt) => receipt.aiCacheKeys ?? []));
  return receipts.length;
}

function recalculateFromLines(receipt: SavedReceipt): void {
  const lines = receipt.analysis.lines;
  const optimizerItems = lines
    .filter((line) => line.matchStatus === 'matched' && line.alternatives.length > 0)
    .map((line) => ({
      name: line.correctedName || line.rawName,
      options: line.alternatives.map((product) => ({
        store: product.store,
        price: product.effectivePrice,
        onSale: product.promoType != null,
        regularPrice: product.promoType ? product.originalPrice : undefined,
      })),
    }));
  receipt.analysis.actualTotal = Math.round(
    lines.reduce((sum, line) => sum + line.paidLineTotal, 0) * 100
  ) / 100;
  receipt.analysis.cheapestPossibleTotal = Math.round(
    lines.reduce(
      (sum, line) =>
        sum +
        (line.cheapestAlternative
          ? line.cheapestAlternative.effectivePrice * line.quantity
          : line.paidLineTotal),
      0
    ) * 100
  ) / 100;
  receipt.analysis.potentialSavings = Math.round(
    Math.max(0, receipt.analysis.actualTotal - receipt.analysis.cheapestPossibleTotal) * 100
  ) / 100;
  receipt.analysis.shoppingPlan =
    optimizerItems.length > 0 ? optimizeShoppingPlan(optimizerItems) : null;
  receipt.analysis.unmatchedCount = lines.filter(
    (line) => line.matchStatus !== 'matched'
  ).length;
}

export async function correctReceiptLine(
  userId: string,
  receiptId: string,
  lineIndex: number,
  correction: ReceiptLineCorrection,
  aiContext?: AiRateLimitContext
): Promise<SavedReceipt | null> {
  const receipts = loadUserReceipts(userId);
  const receipt = receipts.find((candidate) => candidate.id === receiptId);
  const line = receipt?.analysis.lines[lineIndex];
  if (!receipt || !line) return null;

  if (correction.action === 'unmatched') {
    Object.assign(line, {
      correctedName: null,
      matchedProduct: null,
      cheapestAlternative: null,
      alternatives: [],
      lineSavings: 0,
      matchConfidence: 0,
      matchStatus: 'unmatched' as const,
      matchMethod: 'user_unmatched' as const,
    });
  } else {
    const correctedName = correction.correctedName.trim();
    if (!correctedName) throw new Error('Corrected product name required');
    const result = await findProductMatches(correctedName, aiContext, 'user_corrected');
    const matchStatus = statusForConfidence(result.confidence);
    const cheapestAlternative =
      matchStatus === 'matched' && result.alternatives.length > 0
        ? [...result.alternatives].sort((a, b) => a.effectivePrice - b.effectivePrice)[0]
        : null;
    const lineSavings =
      cheapestAlternative && line.paidUnitPrice > cheapestAlternative.effectivePrice
        ? (line.paidUnitPrice - cheapestAlternative.effectivePrice) * line.quantity
        : 0;
    Object.assign(line, {
      correctedName,
      matchedProduct: matchStatus === 'matched' ? result.best : null,
      alternatives: result.alternatives,
      cheapestAlternative,
      lineSavings: Math.round(lineSavings * 100) / 100,
      matchConfidence: result.confidence,
      matchStatus,
      matchMethod: result.method,
    });
  }

  if (aiContext?.aiCacheKeys) {
    receipt.aiCacheKeys = Array.from(
      new Set([...(receipt.aiCacheKeys ?? []), ...aiContext.aiCacheKeys])
    );
  }
  recalculateFromLines(receipt);
  saveUserReceipts(userId, receipts);
  return receipt;
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
