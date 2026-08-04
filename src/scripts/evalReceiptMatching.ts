import fs from 'node:fs';
import path from 'node:path';
import { Product } from '../types';
import {
  matchReceiptLine,
  ReceiptMatchStatus,
} from '../services/receiptMatching';

export interface ReceiptMatchingEvalCase {
  id: string;
  rawName: string;
  expectedStatus: ReceiptMatchStatus;
  aiNormalizedName?: string | null;
  expectedCanonicalContains?: string;
  expectedStoreContains?: string;
  notes?: string;
}

export interface ReceiptMatchingCaseResult {
  id: string;
  rawName: string;
  expectedStatus: ReceiptMatchStatus;
  predictedStatus: ReceiptMatchStatus;
  matchConfidence: number;
  statusCorrect: boolean;
  expectedMatched: boolean;
  predictedMatched: boolean;
  falseAutoMatch: boolean;
  covered: boolean;
  canonicalOk: boolean | null;
  storeOk: boolean | null;
  matchedCanonical: string | null;
  matchedStore: string | null;
}

export interface ReceiptMatchingMetrics {
  total: number;
  statusAccuracy: number;
  autoMatchPrecision: number;
  autoMatchRecall: number;
  falseAutoMatchRate: number;
  coverage: number;
  canonicalAccuracy: number | null;
  storeAccuracy: number | null;
}

export interface ReceiptMatchingEvalReport {
  metrics: ReceiptMatchingMetrics;
  cases: ReceiptMatchingCaseResult[];
  passed: boolean;
  failures: string[];
}

export const DEFAULT_STATUS_ACCURACY_MIN = 0.75;
export const DEFAULT_FALSE_AUTO_MATCH_MAX = 0.05;

const FIXTURES_DIR = path.resolve(
  __dirname,
  '../../test/fixtures/receipt-matching'
);

export function defaultFixturesDir(): string {
  return FIXTURES_DIR;
}

export function loadMiniCatalog(fixturesDir = FIXTURES_DIR): Product[] {
  const filePath = path.join(fixturesDir, 'mini-catalog.json');
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Product[];
}

export function loadEvalCases(
  fixturesDir = FIXTURES_DIR,
  caseIds?: string[]
): ReceiptMatchingEvalCase[] {
  const filePath = path.join(fixturesDir, 'nl-cases.json');
  const cases = JSON.parse(
    fs.readFileSync(filePath, 'utf8')
  ) as ReceiptMatchingEvalCase[];
  if (!caseIds || caseIds.length === 0) return cases;
  const allow = new Set(caseIds);
  return cases.filter((item) => allow.has(item.id));
}

function containsIgnoreCase(haystack: string | null | undefined, needle: string): boolean {
  return (haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

export function evaluateReceiptMatchingCases(
  cases: ReceiptMatchingEvalCase[],
  catalog: Product[]
): ReceiptMatchingCaseResult[] {
  return cases.map((item) => {
    const result = matchReceiptLine(item.rawName, catalog, {
      aiNormalizedName: item.aiNormalizedName,
    });
    const expectedMatched = item.expectedStatus === 'matched';
    const predictedMatched = result.matchStatus === 'matched';
    const matchedCanonical =
      result.matchedProduct?.canonicalName ??
      result.alternatives[0]?.canonicalName ??
      null;
    const matchedStore =
      result.matchedProduct?.store ?? result.alternatives[0]?.store ?? null;

    let canonicalOk: boolean | null = null;
    if (item.expectedCanonicalContains) {
      canonicalOk = containsIgnoreCase(
        matchedCanonical,
        item.expectedCanonicalContains
      );
    }

    let storeOk: boolean | null = null;
    if (item.expectedStoreContains) {
      storeOk = containsIgnoreCase(matchedStore, item.expectedStoreContains);
    }

    return {
      id: item.id,
      rawName: item.rawName,
      expectedStatus: item.expectedStatus,
      predictedStatus: result.matchStatus,
      matchConfidence: result.matchConfidence,
      statusCorrect: result.matchStatus === item.expectedStatus,
      expectedMatched,
      predictedMatched,
      falseAutoMatch: predictedMatched && !expectedMatched,
      covered: result.matchConfidence > 0,
      canonicalOk,
      storeOk,
      matchedCanonical,
      matchedStore,
    };
  });
}

export function computeReceiptMatchingMetrics(
  results: ReceiptMatchingCaseResult[]
): ReceiptMatchingMetrics {
  const total = results.length;
  const statusCorrect = results.filter((item) => item.statusCorrect).length;
  const expectedMatched = results.filter((item) => item.expectedMatched);
  const predictedMatched = results.filter((item) => item.predictedMatched);
  const truePositives = results.filter(
    (item) => item.expectedMatched && item.predictedMatched
  ).length;
  const falseAutoMatches = results.filter((item) => item.falseAutoMatch).length;
  const covered = results.filter((item) => item.covered).length;

  const canonicalChecks = results.filter((item) => item.canonicalOk !== null);
  const storeChecks = results.filter((item) => item.storeOk !== null);

  return {
    total,
    statusAccuracy: total === 0 ? 0 : statusCorrect / total,
    autoMatchPrecision:
      predictedMatched.length === 0 ? 1 : truePositives / predictedMatched.length,
    autoMatchRecall:
      expectedMatched.length === 0 ? 1 : truePositives / expectedMatched.length,
    falseAutoMatchRate: total === 0 ? 0 : falseAutoMatches / total,
    coverage: total === 0 ? 0 : covered / total,
    canonicalAccuracy:
      canonicalChecks.length === 0
        ? null
        : canonicalChecks.filter((item) => item.canonicalOk).length /
          canonicalChecks.length,
    storeAccuracy:
      storeChecks.length === 0
        ? null
        : storeChecks.filter((item) => item.storeOk).length / storeChecks.length,
  };
}

export function runReceiptMatchingEval(options?: {
  fixturesDir?: string;
  caseIds?: string[];
  statusAccuracyMin?: number;
  falseAutoMatchMax?: number;
}): ReceiptMatchingEvalReport {
  const fixturesDir = options?.fixturesDir ?? FIXTURES_DIR;
  const statusAccuracyMin =
    options?.statusAccuracyMin ?? DEFAULT_STATUS_ACCURACY_MIN;
  const falseAutoMatchMax =
    options?.falseAutoMatchMax ?? DEFAULT_FALSE_AUTO_MATCH_MAX;

  const catalog = loadMiniCatalog(fixturesDir);
  const cases = loadEvalCases(fixturesDir, options?.caseIds);
  const caseResults = evaluateReceiptMatchingCases(cases, catalog);
  const metrics = computeReceiptMatchingMetrics(caseResults);

  const failures: string[] = [];
  if (metrics.falseAutoMatchRate > falseAutoMatchMax) {
    failures.push(
      `falseAutoMatchRate ${metrics.falseAutoMatchRate.toFixed(4)} > ${falseAutoMatchMax}`
    );
  }
  if (metrics.statusAccuracy < statusAccuracyMin) {
    failures.push(
      `statusAccuracy ${metrics.statusAccuracy.toFixed(4)} < ${statusAccuracyMin}`
    );
  }

  for (const item of caseResults) {
    if (item.canonicalOk === false) {
      failures.push(
        `${item.id}: canonical expected to contain label value, got ${item.matchedCanonical}`
      );
    }
    if (item.storeOk === false) {
      failures.push(
        `${item.id}: store expected to contain label value, got ${item.matchedStore}`
      );
    }
  }

  return {
    metrics,
    cases: caseResults,
    passed: failures.length === 0,
    failures,
  };
}

function main(): void {
  const report = runReceiptMatchingEval();
  const payload = {
    ...report.metrics,
    passed: report.passed,
    failures: report.failures,
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}