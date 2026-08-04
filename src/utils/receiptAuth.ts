import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { USER_ID_PATTERN, parseUserId } from './userId';
import { logger } from './logger';

const DEV_DEFAULT_SECRET = 'dev-receipt-auth-secret-change-me';

let warnedMissingSecret = false;

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
  if (!parseUserId(userId) || typeof token !== 'string' || !token) {
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
  const provided = token.trim();
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
  const headerUserId = parseUserId(req.header('x-compear-user-id'));
  const headerToken = (req.header('x-compear-user-token') || '').trim();

  if (headerUserId && headerToken) {
    return { userId: headerUserId, token: headerToken };
  }

  const authorization = req.header('authorization') || '';
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch) {
    const raw = bearerMatch[1].trim();
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const userId = parseUserId(raw.slice(0, colon));
      const token = raw.slice(colon + 1).trim();
      if (userId && token) {
        return { userId, token };
      }
    }
  }

  if (typeof req.body?.userId === 'string' && typeof req.body?.token === 'string') {
    const userId = parseUserId(req.body.userId);
    const token = req.body.token.trim();
    if (userId && token) {
      return { userId, token };
    }
  }

  return null;
}
