import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  logger.error('request_failed', {
    error: err,
    method: req.method,
    path: req.path,
    requestId: res.getHeader('X-Request-Id') ?? null,
  });
  res.status(500).json({ error: 'Internal server error' });
}
