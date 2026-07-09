import { logger } from '../utils/logger';

export class AiRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'AiRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export type AiTaskKind = 'vision' | 'text';

export interface AiRateLimitContext {
  userId?: string;
  ip?: string;
  /** Groups text AI calls for one receipt analysis session. */
  receiptSessionId?: string;
}

interface WindowBucket {
  count: number;
  resetAt: number;
}

interface ReceiptSession {
  textCalls: number;
  expiresAt: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const hourBuckets = new Map<string, WindowBucket>();
const dayBuckets = new Map<string, WindowBucket>();
const receiptSessions = new Map<string, ReceiptSession>();

let lastApiCallAt = 0;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getLimits() {
  return {
    visionPerUserHour: envInt('AI_MAX_VISION_PER_USER_HOUR', 5),
    visionPerUserDay: envInt('AI_MAX_VISION_PER_USER_DAY', 20),
    visionPerIpHour: envInt('AI_MAX_VISION_PER_IP_HOUR', 10),
    textPerUserHour: envInt('AI_MAX_TEXT_PER_USER_HOUR', 40),
    textPerReceipt: envInt('AI_MAX_TEXT_PER_RECEIPT', 15),
    globalHour: envInt('AI_MAX_GLOBAL_HOUR', 120),
    globalDay: envInt('AI_MAX_GLOBAL_DAY', 600),
    minIntervalMs: envInt('AI_MIN_INTERVAL_MS', 500),
  };
}

function pruneExpired(map: Map<string, WindowBucket>, now: number): void {
  for (const [key, bucket] of map.entries()) {
    if (bucket.resetAt <= now) {
      map.delete(key);
    }
  }
}

function pruneReceiptSessions(now: number): void {
  for (const [key, session] of receiptSessions.entries()) {
    if (session.expiresAt <= now) {
      receiptSessions.delete(key);
    }
  }
}

function checkWindow(
  map: Map<string, WindowBucket>,
  key: string,
  windowMs: number,
  max: number,
  now: number
): { ok: true } | { ok: false; retryAfterMs: number } {
  if (max <= 0) {
    return { ok: false, retryAfterMs: windowMs };
  }

  const bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { ok: true };
  }
  if (bucket.count < max) {
    return { ok: true };
  }
  return { ok: false, retryAfterMs: Math.max(1, bucket.resetAt - now) };
}

function consumeWindow(
  map: Map<string, WindowBucket>,
  key: string,
  windowMs: number,
  now: number
): void {
  const bucket = map.get(key);
  if (!bucket || bucket.resetAt <= now) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
}

function assertLimit(
  checks: Array<{ key: string; map: Map<string, WindowBucket>; windowMs: number; max: number }>,
  now: number
): void {
  for (const check of checks) {
    if (check.max <= 0) {
      throw new AiRateLimitError('AI-functies zijn uitgeschakeld op deze server.', DAY_MS);
    }
    const result = checkWindow(check.map, check.key, check.windowMs, check.max, now);
    if (!result.ok) {
      throw new AiRateLimitError('AI-limiet bereikt. Probeer het later opnieuw.', result.retryAfterMs);
    }
  }
}

function consumeLimits(
  checks: Array<{ key: string; map: Map<string, WindowBucket>; windowMs: number }>,
  now: number
): void {
  for (const check of checks) {
    consumeWindow(check.map, check.key, check.windowMs, now);
  }
}

/**
 * Reserve a slot before a paid OpenAI call. Cache hits should skip this.
 */
export async function acquireAiSlot(
  kind: AiTaskKind,
  context?: AiRateLimitContext
): Promise<void> {
  const limits = getLimits();
  const now = Date.now();

  pruneExpired(hourBuckets, now);
  pruneExpired(dayBuckets, now);
  pruneReceiptSessions(now);

  const elapsed = now - lastApiCallAt;
  if (elapsed < limits.minIntervalMs) {
    await new Promise((resolve) => setTimeout(resolve, limits.minIntervalMs - elapsed));
  }

  const checks: Array<{ key: string; map: Map<string, WindowBucket>; windowMs: number; max: number }> =
    [
      { key: 'global', map: hourBuckets, windowMs: HOUR_MS, max: limits.globalHour },
      { key: 'global', map: dayBuckets, windowMs: DAY_MS, max: limits.globalDay },
    ];

  if (kind === 'vision') {
    if (context?.userId) {
      checks.push(
        {
          key: `vision:user:${context.userId}`,
          map: hourBuckets,
          windowMs: HOUR_MS,
          max: limits.visionPerUserHour,
        },
        {
          key: `vision:user:${context.userId}`,
          map: dayBuckets,
          windowMs: DAY_MS,
          max: limits.visionPerUserDay,
        }
      );
    }
    if (context?.ip) {
      checks.push({
        key: `vision:ip:${context.ip}`,
        map: hourBuckets,
        windowMs: HOUR_MS,
        max: limits.visionPerIpHour,
      });
    }
  }

  if (kind === 'text') {
    if (context?.receiptSessionId) {
      const session = receiptSessions.get(context.receiptSessionId);
      if (session && session.textCalls >= limits.textPerReceipt) {
        throw new AiRateLimitError(
          'Te veel AI-zoekopdrachten voor deze bon. Sommige productnamen zijn mogelijk niet herkend.',
          HOUR_MS
        );
      }
    }
    if (context?.userId) {
      checks.push({
        key: `text:user:${context.userId}`,
        map: hourBuckets,
        windowMs: HOUR_MS,
        max: limits.textPerUserHour,
      });
    }
  }

  assertLimit(checks, now);

  const consume: Array<{ key: string; map: Map<string, WindowBucket>; windowMs: number }> = checks.map(
    ({ key, map, windowMs }) => ({ key, map, windowMs })
  );
  consumeLimits(consume, now);

  if (kind === 'text' && context?.receiptSessionId) {
    const session = receiptSessions.get(context.receiptSessionId);
    if (!session || session.expiresAt <= now) {
      receiptSessions.set(context.receiptSessionId, {
        textCalls: 1,
        expiresAt: now + HOUR_MS,
      });
    } else {
      session.textCalls += 1;
    }
  }

  lastApiCallAt = Date.now();
  logger.info('AI slot acquired', kind, context?.userId ?? context?.ip ?? 'anonymous');
}

export function isAiRateLimitError(error: unknown): error is AiRateLimitError {
  return error instanceof AiRateLimitError;
}
