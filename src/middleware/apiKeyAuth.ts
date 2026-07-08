import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.SCRAPE_API_KEY;
  if (!expected) {
    res.status(503).json({ error: 'Scrape endpoint is not configured' });
    return;
  }

  const headerKey = req.header('x-api-key');
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = headerKey || bearer;

  if (!provided || provided !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
