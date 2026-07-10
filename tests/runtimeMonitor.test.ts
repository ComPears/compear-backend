import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeMonitor } from '../src/monitoring/runtimeMonitor';

test('readiness requires a loaded, fresh, non-empty catalog', () => {
  const monitor = new RuntimeMonitor();

  assert.equal(monitor.getReadiness().status, 'not_ready');

  monitor.markCatalogLoaded(42, new Date().toISOString());
  const ready = monitor.getReadiness({ maxCatalogAgeHours: 1 });

  assert.equal(ready.status, 'ready');
  assert.equal(ready.checks.catalogLoaded.ok, true);
  assert.equal(ready.checks.catalogFreshness.ok, true);
});

test('readiness rejects stale catalog timestamps and exceeded memory limits', () => {
  const monitor = new RuntimeMonitor();
  monitor.markCatalogLoaded(42, new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString());

  const stale = monitor.getReadiness({ maxCatalogAgeHours: 2 });
  assert.equal(stale.status, 'not_ready');
  assert.equal(stale.checks.catalogFreshness.ok, false);

  const constrained = monitor.getReadiness({
    maxCatalogAgeHours: 4,
    maxRssMb: 0.001,
  });
  assert.equal(constrained.status, 'not_ready');
  assert.equal(constrained.checks.memory.ok, false);
});

test('metrics aggregate request, search, status, startup, and memory visibility', () => {
  const monitor = new RuntimeMonitor();
  monitor.recordStartupPhase('catalogs', 12.34);
  monitor.markStartupComplete();
  monitor.beginRequest();
  monitor.recordRequest('GET', 200, 10, true);
  monitor.beginRequest();
  monitor.recordRequest('POST', 503, 30, false);

  const metrics = monitor.getMetrics();
  assert.equal(metrics.requests.count, 2);
  assert.equal(metrics.requests.averageMs, 20);
  assert.equal(metrics.requests.byStatusClass['2xx'], 1);
  assert.equal(metrics.requests.byStatusClass['5xx'], 1);
  assert.equal(metrics.searches.count, 1);
  assert.equal(metrics.searches.averageMs, 10);
  assert.equal(metrics.startup.phasesMs.catalogs, 12.3);
  assert.equal(typeof metrics.memory.rssMb, 'number');
});
