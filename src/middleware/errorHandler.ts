import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { MulterError } from 'multer';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof MulterError) {
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Receipt image exceeds 8 MiB' : 'Invalid receipt upload',
    });
    return;
  }
  logger.error('request_failed', {
    error: err,
    method: req.method,
    path: req.path,
    requestId: res.getHeader('X-Request-Id') ?? null,
  });
  res.status(500).json({ error: 'Internal server error' });
}
