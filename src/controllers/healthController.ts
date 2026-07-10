import { Request, Response } from 'express';
import { runtimeMonitor } from '../monitoring/runtimeMonitor';

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function liveness(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime() * 10) / 10,
    timestamp: new Date().toISOString(),
  });
}

export function readiness(_req: Request, res: Response): void {
  const result = runtimeMonitor.getReadiness({
    maxCatalogAgeHours: envNumber('CATALOG_MAX_AGE_HOURS', 192),
    maxRssMb: envNumber('READINESS_MAX_RSS_MB', 0),
  });
  res.status(result.status === 'ready' ? 200 : 503).json(result);
}

export function metrics(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json(runtimeMonitor.getMetrics());
}
