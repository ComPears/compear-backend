import { Request, Response, NextFunction } from 'express';

/** Optional API key for /api/v1 public endpoints. When unset, endpoints remain open with stricter rate limits. */
export function publicApiAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.PUBLIC_API_KEY;
  if (!expected) {
    next();
    return;
  }

  const headerKey = req.header('x-api-key');
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = headerKey || bearer;

  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized', hint: 'Provide x-api-key or Authorization: Bearer' });
    return;
  }

  next();
}
