import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
