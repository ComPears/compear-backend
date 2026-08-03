import { Request, Response, NextFunction } from 'express';
import { secureCompare } from '../utils/secureCompare';

/** Ops keys that unlock scrape + metrics. ADMIN and SCRAPE are both accepted when set. */
function expectedOpsApiKeys(): string[] {
  const keys = [
    (process.env.ADMIN_API_KEY || '').trim(),
    (process.env.SCRAPE_API_KEY || '').trim(),
  ].filter(Boolean);
  return [...new Set(keys)];
}

function providedApiKey(req: Request): string | undefined {
  const headerKey = req.header('x-api-key');
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  return headerKey || bearer || undefined;
}

/** Protect scrape / metrics ops routes. Accepts ADMIN_API_KEY and/or SCRAPE_API_KEY. */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedOpsApiKeys();
  if (expected.length === 0) {
    res.status(503).json({ error: 'Scrape endpoint is not configured' });
    return;
  }

  const provided = providedApiKey(req);
  if (!provided || !expected.some((key) => secureCompare(provided, key))) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
