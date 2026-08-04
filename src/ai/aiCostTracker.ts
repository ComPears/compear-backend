import * as fs from 'fs';
import * as path from 'path';
import { AiRateLimitError } from './aiRateLimiter';
import { logger } from '../utils/logger';

const SPEND_PATH = path.join(__dirname, '..', 'data', 'ai-spend.json');

/** Approximate USD per 1M tokens. Override via env; estimates only. */
const DEFAULT_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10 },
  'gpt-5.5': { inputPer1M: 1.25, outputPer1M: 10 },
};

export interface AiSpendMonth {
  month: string;
  spendUsd: number;
  calls: number;
  updatedAt: string;
}

export interface AiSpendStatus {
  month: string;
  spendUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  calls: number;
  updatedAt: string | null;
}

type SpendFile = Record<string, AiSpendMonth>;

function currentMonthKey(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function getBudgetUsd(): number {
  const raw = process.env.AI_MONTHLY_BUDGET_USD;
  if (raw == null || raw === '') return 10;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 10;
}

function pricingForModel(model: string): { inputPer1M: number; outputPer1M: number } {
  const key = model.toLowerCase();
  const envInput = Number(process.env.AI_PRICE_INPUT_PER_1M);
  const envOutput = Number(process.env.AI_PRICE_OUTPUT_PER_1M);
  if (Number.isFinite(envInput) && Number.isFinite(envOutput) && envInput >= 0 && envOutput >= 0) {
    return { inputPer1M: envInput, outputPer1M: envOutput };
  }
  for (const [name, prices] of Object.entries(DEFAULT_PRICING)) {
    if (key === name || key.startsWith(`${name}-`) || key.startsWith(name)) {
      return prices;
    }
  }
  // Conservative fallback for unknown models
  return DEFAULT_PRICING['gpt-4o'];
}

/** Estimate USD cost from token usage. Approximate — not billing-accurate. */
export function estimateCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const pricing = pricingForModel(model);
  const input = Math.max(0, promptTokens) / 1_000_000 * pricing.inputPer1M;
  const output = Math.max(0, completionTokens) / 1_000_000 * pricing.outputPer1M;
  return Math.round((input + output) * 1_000_000) / 1_000_000;
}

function ensureSpendFile(): void {
  const dir = path.dirname(SPEND_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SPEND_PATH)) {
    fs.writeFileSync(SPEND_PATH, '{}', 'utf-8');
  }
}

function loadSpend(): SpendFile {
  ensureSpendFile();
  try {
    return JSON.parse(fs.readFileSync(SPEND_PATH, 'utf-8')) as SpendFile;
  } catch {
    return {};
  }
}

function saveSpend(data: SpendFile): void {
  ensureSpendFile();
  fs.writeFileSync(SPEND_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function readMonth(month = currentMonthKey()): AiSpendMonth {
  const data = loadSpend();
  const existing = data[month];
  if (existing) return existing;
  return { month, spendUsd: 0, calls: 0, updatedAt: new Date().toISOString() };
}

export function getAiSpendStatus(): AiSpendStatus {
  const month = currentMonthKey();
  const record = loadSpend()[month];
  const budgetUsd = getBudgetUsd();
  const spendUsd = record?.spendUsd ?? 0;
  return {
    month,
    spendUsd: Math.round(spendUsd * 1_000_000) / 1_000_000,
    budgetUsd,
    remainingUsd: Math.max(0, Math.round((budgetUsd - spendUsd) * 1_000_000) / 1_000_000),
    calls: record?.calls ?? 0,
    updatedAt: record?.updatedAt ?? null,
  };
}

/**
 * Throw AiRateLimitError (maps to HTTP 429) when monthly AI budget is exhausted.
 */
export function assertAiBudgetAvailable(): void {
  const status = getAiSpendStatus();
  if (status.spendUsd >= status.budgetUsd) {
    throw new AiRateLimitError(
      `Monthly AI budget of $${status.budgetUsd} USD has been reached. Remaining: $${status.remainingUsd}.`,
      60 * 60 * 1000
    );
  }
}

export function recordAiUsage(params: {
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const cost = estimateCostUsd(params.model, params.promptTokens, params.completionTokens);
  const month = currentMonthKey();
  const data = loadSpend();
  const current = data[month] ?? {
    month,
    spendUsd: 0,
    calls: 0,
    updatedAt: new Date().toISOString(),
  };
  current.spendUsd = Math.round((current.spendUsd + cost) * 1_000_000) / 1_000_000;
  current.calls += 1;
  current.updatedAt = new Date().toISOString();
  data[month] = current;
  saveSpend(data);
  logger.info('AI usage recorded', {
    model: params.model,
    costUsd: cost,
    month,
    spendUsd: current.spendUsd,
  });
  return cost;
}
