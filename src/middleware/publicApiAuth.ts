import { Request, Response, NextFunction } from 'express';
import { secureCompare } from '../utils/secureCompare';

/**
 * API key for /api/v1 public endpoints.
 * In production, PUBLIC_API_KEY is required (503 when unset).
 * In development, endpoints remain open when unset (stricter rate limits apply).
 */
export function publicApiAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env.PUBLIC_API_KEY || '').trim();

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      res.status(503).json({ error: 'Public API key not configured' });
      return;
    }
    next();
    return;
  }

  const headerKey = req.header('x-api-key');
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = headerKey || bearer;

  if (!provided || !secureCompare(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Provide x-api-key or Authorization: Bearer' });
    return;
  }

  next();
}
