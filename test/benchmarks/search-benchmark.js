const { performance } = require('node:perf_hooks');
const { searchProducts } = require('../../src/ai/semanticSearch');

const PRODUCT_COUNT = Number(process.env.SEARCH_BENCH_PRODUCTS || 20_000);
const ITERATIONS = Number(process.env.SEARCH_BENCH_ITERATIONS || 250);
const BUILD_BUDGET_MS = Number(process.env.SEARCH_BENCH_BUILD_BUDGET_MS || 2_000);
const P95_BUDGET_MS = Number(process.env.SEARCH_BENCH_P95_BUDGET_MS || 75);
const enforce = process.env.SEARCH_BENCH_ENFORCE === '1';

const terms = ['halfvolle melk', 'volkoren pasta', 'arabica koffie', 'groene thee'];
const products = Array.from({ length: PRODUCT_COUNT }, (_, index) => {
  const term = terms[index % terms.length];
  return {
    id: `bench-${index}`,
    canonicalName: term,
    productName: `${term} ${index}`,
    brand: `Merk ${index % 100}`,
    store: index % 2 ? 'Albert Heijn' : 'Jumbo',
    packageSize: `${250 + (index % 8) * 250} g`,
    weightInGrams: 250 + (index % 8) * 250,
    originalPrice: 1 + (index % 500) / 100,
    effectivePrice: 1 + (index % 500) / 100,
    unitPrice: 1,
    effectiveUnitPrice: 1,
    promoType: null,
    promoValue: null,
    promoValidUntil: null,
    productUrl: null,
    scrapedAt: '2026-01-01T00:00:00.000Z',
    category: 'Other',
    barcode: null,
    identityKey: `tok:${index}`,
  };
});

const buildStarted = performance.now();
searchProducts('halfvolle melk', 50, products);
const buildMs = performance.now() - buildStarted;

const samples = [];
for (let index = 0; index < ITERATIONS; index += 1) {
  const started = performance.now();
  const results = searchProducts(terms[index % terms.length], 50, products);
  if (results.length !== 50) throw new Error(`Unexpected result count: ${results.length}`);
  samples.push(performance.now() - started);
}

samples.sort((a, b) => a - b);
const percentile = (value) => samples[Math.min(samples.length - 1, Math.ceil(samples.length * value) - 1)];
const report = {
  mode: enforce ? 'budget-enforced' : 'baseline-only',
  products: PRODUCT_COUNT,
  iterations: ITERATIONS,
  buildMs: Number(buildMs.toFixed(2)),
  medianQueryMs: Number(percentile(0.5).toFixed(2)),
  p95QueryMs: Number(percentile(0.95).toFixed(2)),
  budgetsMs: {
    build: BUILD_BUDGET_MS,
    p95Query: P95_BUDGET_MS,
  },
};

console.log(JSON.stringify(report, null, 2));

if (enforce && (buildMs > BUILD_BUDGET_MS || percentile(0.95) > P95_BUDGET_MS)) {
  process.exitCode = 1;
}
