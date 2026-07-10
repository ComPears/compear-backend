import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

interface TimingSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

interface CatalogState {
  loaded: boolean;
  productCount: number;
  freshestProductAt: string | null;
  loadedAt: string | null;
}

interface ReadinessOptions {
  maxCatalogAgeHours?: number;
  maxRssMb?: number;
}

const round = (value: number): number => Math.round(value * 10) / 10;

function memorySnapshot() {
  const usage = process.memoryUsage();
  const toMb = (bytes: number) => round(bytes / 1024 / 1024);
  return {
    rssMb: toMb(usage.rss),
    heapUsedMb: toMb(usage.heapUsed),
    heapTotalMb: toMb(usage.heapTotal),
    externalMb: toMb(usage.external),
  };
}

function timingSnapshot(timing: TimingSummary) {
  return {
    count: timing.count,
    averageMs: timing.count ? round(timing.totalMs / timing.count) : 0,
    maxMs: round(timing.maxMs),
  };
}

export class RuntimeMonitor {
  private readonly startedAt = new Date();
  private readonly startedHr = performance.now();
  private readonly requests: TimingSummary = { count: 0, totalMs: 0, maxMs: 0 };
  private readonly searches: TimingSummary = { count: 0, totalMs: 0, maxMs: 0 };
  private readonly statuses: Record<string, number> = {};
  private readonly methods: Record<string, number> = {};
  private readonly startupPhases: Record<string, number> = {};
  private startupDurationMs: number | null = null;
  private inFlight = 0;
  private catalog: CatalogState = {
    loaded: false,
    productCount: 0,
    freshestProductAt: null,
    loadedAt: null,
  };

  recordStartupPhase(name: string, durationMs: number): void {
    this.startupPhases[name] = round(durationMs);
  }

  markStartupComplete(): void {
    this.startupDurationMs = round(performance.now() - this.startedHr);
  }

  markCatalogLoaded(productCount: number, freshestProductAt: string | null): void {
    this.catalog = {
      loaded: true,
      productCount,
      freshestProductAt,
      loadedAt: new Date().toISOString(),
    };
  }

  beginRequest(): void {
    this.inFlight += 1;
  }

  recordRequest(method: string, statusCode: number, durationMs: number, isSearch: boolean): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.requests.count += 1;
    this.requests.totalMs += durationMs;
    this.requests.maxMs = Math.max(this.requests.maxMs, durationMs);

    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    this.statuses[statusClass] = (this.statuses[statusClass] ?? 0) + 1;
    this.methods[method] = (this.methods[method] ?? 0) + 1;

    if (isSearch) {
      this.searches.count += 1;
      this.searches.totalMs += durationMs;
      this.searches.maxMs = Math.max(this.searches.maxMs, durationMs);
    }
  }

  getMetrics() {
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: round((performance.now() - this.startedHr) / 1000),
      startup: {
        totalMs: this.startupDurationMs,
        phasesMs: { ...this.startupPhases },
      },
      memory: memorySnapshot(),
      catalog: { ...this.catalog },
      requests: {
        ...timingSnapshot(this.requests),
        inFlight: this.inFlight,
        byStatusClass: { ...this.statuses },
        byMethod: { ...this.methods },
      },
      searches: timingSnapshot(this.searches),
    };
  }

  getReadiness(options: ReadinessOptions = {}) {
    const maxCatalogAgeHours = options.maxCatalogAgeHours ?? 192;
    const maxRssMb = options.maxRssMb ?? 0;
    const memory = memorySnapshot();
    const checks: Record<string, { ok: boolean; detail: string }> = {
      catalogLoaded: {
        ok: this.catalog.loaded && this.catalog.productCount > 0,
        detail: `${this.catalog.productCount} products`,
      },
    };

    const freshestMs = this.catalog.freshestProductAt
      ? Date.parse(this.catalog.freshestProductAt)
      : Number.NaN;
    const ageHours = Number.isFinite(freshestMs)
      ? (Date.now() - freshestMs) / (60 * 60 * 1000)
      : Number.POSITIVE_INFINITY;
    checks.catalogFreshness = {
      ok: ageHours <= maxCatalogAgeHours,
      detail: Number.isFinite(ageHours)
        ? `${round(ageHours)}h old (limit ${maxCatalogAgeHours}h)`
        : 'no valid product timestamp',
    };

    checks.memory = {
      ok: maxRssMb <= 0 || memory.rssMb <= maxRssMb,
      detail: maxRssMb > 0 ? `${memory.rssMb}MB RSS (limit ${maxRssMb}MB)` : `${memory.rssMb}MB RSS`,
    };

    return {
      status: Object.values(checks).every((check) => check.ok) ? 'ready' : 'not_ready',
      checks,
      memory,
      timestamp: new Date().toISOString(),
    };
  }
}

export const runtimeMonitor = new RuntimeMonitor();

export function requestMonitoring(req: Request, res: Response, next: NextFunction): void {
  const startedAt = performance.now();
  const requestId = req.header('x-request-id') || randomUUID();
  const isSearch = req.path === '/products' && typeof req.query.search === 'string';
  runtimeMonitor.beginRequest();
  res.setHeader('X-Request-Id', requestId);

  res.once('finish', () => {
    const durationMs = performance.now() - startedAt;
    runtimeMonitor.recordRequest(req.method, res.statusCode, durationMs, isSearch);
    logger.info('request_completed', {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: round(durationMs),
      search: isSearch,
    });
  });

  next();
}
