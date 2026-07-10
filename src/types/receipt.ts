import { Product } from './product';
import { ShoppingPlan } from '../utils/shoppingOptimizer';
import { ReceiptMatchMethod, ReceiptMatchStatus } from '../services/receiptMatching';

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

export interface ReceiptLineMatch {
  rawName: string;
  correctedName?: string | null;
  quantity: number;
  paidUnitPrice: number;
  paidLineTotal: number;
  matchedProduct: Product | null;
  alternatives: Product[];
  cheapestAlternative: Product | null;
  lineSavings: number;
  matchConfidence: number;
  matchStatus: ReceiptMatchStatus;
  matchMethod: ReceiptMatchMethod;
}

export interface ReceiptAnalysis {
  parsed: ParsedReceiptData;
  storeDetected: string | null;
  purchaseDate: string | null;
  lines: ReceiptLineMatch[];
  actualTotal: number;
  cheapestPossibleTotal: number;
  potentialSavings: number;
  shoppingPlan: ShoppingPlan | null;
  unmatchedCount: number;
}

export interface SavedReceipt {
  id: string;
  userId: string;
  uploadedAt: string;
  imageMimeType: string | null;
  analysis: ReceiptAnalysis;
  /** Internal references used to erase receipt-associated AI cache records. */
  aiCacheKeys?: string[];
}

export type ReceiptLineCorrection =
  | { action: 'rematch'; correctedName: string }
  | { action: 'unmatched' };

export interface ReceiptStoreStats {
  store: string;
  receiptCount: number;
  totalSpent: number;
  totalCouldHaveSaved: number;
}

export interface ReceiptMonthStats {
  month: string;
  totalSpent: number;
  totalCouldHaveSaved: number;
  receiptCount: number;
}

export interface ReceiptItemStats {
  name: string;
  purchaseCount: number;
  totalSpent: number;
  totalCouldHaveSaved: number;
}

export interface ReceiptAnalytics {
  receiptCount: number;
  totalSpent: number;
  totalCouldHaveSaved: number;
  averageSavingsPerReceipt: number;
  byStore: ReceiptStoreStats[];
  byMonth: ReceiptMonthStats[];
  topItems: ReceiptItemStats[];
}
