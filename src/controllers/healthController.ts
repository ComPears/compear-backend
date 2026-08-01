import { Request, Response } from 'express';
import { runtimeMonitor } from '../monitoring/runtimeMonitor';
import { getDeploymentMetadata } from '../monitoring/deploymentMetadata';
import { logger } from '../utils/logger';

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function liveness(_req: Request, res: Response): void {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime() * 10) / 10,
    deployment: getDeploymentMetadata(),
    timestamp: new Date().toISOString(),
  });
}

export function readiness(_req: Request, res: Response): void {
  const result = runtimeMonitor.getReadiness({
    maxCatalogAgeHours: envNumber('CATALOG_MAX_AGE_HOURS', 192),
    maxRssMb: envNumber('READINESS_MAX_RSS_MB', 0),
  });
  res.status(result.status === 'ready' ? 200 : 503).json({
    ...result,
    deployment: getDeploymentMetadata(),
  });
}

export function metrics(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ...runtimeMonitor.getMetrics(),
    deployment: getDeploymentMetadata(),
  });
}

const WEB_VITALS = new Set(['CLS', 'FID', 'FCP', 'INP', 'LCP', 'TTFB']);

export function recordWebVital(req: Request, res: Response): void {
  const name = String(req.body?.name ?? '').toUpperCase();
  const value = Number(req.body?.value);
  const rating = String(req.body?.rating ?? '').slice(0, 32);
  const path = String(req.body?.path ?? '').slice(0, 240);
  if (!WEB_VITALS.has(name) || !Number.isFinite(value) || value < 0) {
    res.status(400).json({ error: 'Invalid web vital' });
    return;
  }
  logger.info('web_vital', { name, value: Math.round(value * 1000) / 1000, rating, path });
  res.status(204).send();
}
