import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { USER_ID_PATTERN, parseUserId } from './userId';
import { logger } from './logger';

const DEV_DEFAULT_SECRET = 'dev-receipt-auth-secret-change-me';

let warnedMissingSecret = false;

// Bound untrusted input before trimming, parsing, signing, or allocating buffers.
const MAX_CREDENTIAL_LENGTH = 256;

function boundedUserId(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_CREDENTIAL_LENGTH
    ? parseUserId(value)
    : null;
}

function parseToken(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_CREDENTIAL_LENGTH) return null;
  const token = value.trim();
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function getReceiptAuthSecret(): string {
  const fromEnv = (process.env.RECEIPT_AUTH_SECRET || '').trim();
  if (fromEnv) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    throw new Error('RECEIPT_AUTH_SECRET is required in production');
  }

  if (!warnedMissingSecret) {
    warnedMissingSecret = true;
    console.warn(
      '[receiptAuth] RECEIPT_AUTH_SECRET unset; using insecure development default. Set RECEIPT_AUTH_SECRET before production.'
    );
  }
  return DEV_DEFAULT_SECRET;
}

function signUserId(userId: string, secret: string): string {
  return createHmac('sha256', secret).update(userId).digest('hex');
}

export function issueReceiptCredentials(): { userId: string; token: string } {
  const userId = randomBytes(16).toString('hex');
  if (!USER_ID_PATTERN.test(userId)) {
    throw new Error('Generated userId failed validation');
  }
  const token = signUserId(userId, getReceiptAuthSecret());
  return { userId, token };
}

export function verifyReceiptToken(userId: string, token: string): boolean {
  const provided = parseToken(token);
  if (!boundedUserId(userId) || !provided) {
    return false;
  }
  let secret: string;
  try {
    secret = getReceiptAuthSecret();
  } catch (error) {
    logger.error('Receipt auth secret unavailable', error);
    return false;
  }
  const expected = signUserId(userId, secret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

export interface ReceiptAuthCredentials {
  userId: string;
  token: string;
}

/**
 * Read receipt credentials from `x-compear-user-id` + `x-compear-user-token`,
 * or `Authorization: Bearer userId:token`.
 */
export function getReceiptAuthFromRequest(req: {
  header(name: string): string | undefined;
  body?: { userId?: unknown; token?: unknown };
}): ReceiptAuthCredentials | null {
  const headerUserId = boundedUserId(req.header('x-compear-user-id'));
  const headerToken = parseToken(req.header('x-compear-user-token'));

  if (headerUserId && headerToken) {
    return { userId: headerUserId, token: headerToken };
  }

  const authorization = req.header('authorization') || '';
  // Fixed prefix parsing avoids overlapping regex quantifiers on hostile input.
  if (
    authorization.length <= MAX_CREDENTIAL_LENGTH &&
    authorization.slice(0, 6).toLowerCase() === 'bearer' &&
    (authorization[6] === ' ' || authorization[6] === '\t')
  ) {
    const raw = authorization.slice(7).trim();
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const userId = boundedUserId(raw.slice(0, colon));
      const token = parseToken(raw.slice(colon + 1));
      if (userId && token) {
        return { userId, token };
      }
    }
  }

  if (typeof req.body?.userId === 'string' && typeof req.body?.token === 'string') {
    const userId = boundedUserId(req.body.userId);
    const token = parseToken(req.body.token);
    if (userId && token) {
      return { userId, token };
    }
  }

  return null;
}
