import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { productsRouter } from './routes/products';
import { storesRouter } from './routes/stores';
import { dealsRouter } from './routes/deals';
import { scrapeRouter } from './routes/scrape';
import { compareRouter } from './routes/compare';
import { receiptsRouter } from './routes/receipts';
import { listsRouter } from './routes/lists';
import { publicApiRouter } from './routes/publicApi';
import { healthRouter } from './routes/health';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';
import { loadAllProducts, preloadProductCatalogs } from './services/dataService';
import { preloadProductSearchIndexes } from './ai/semanticSearch';
import { preloadBarcodeIndexes } from './services/barcodeService';
import { requestMonitoring, runtimeMonitor } from './monitoring/runtimeMonitor';

// Node 20.12+ loads local development variables without another dependency.
// Render injects production variables directly.
if (process.env.NODE_ENV !== 'production' && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile();
}

const app = express();
const PORT = process.env.PORT || 4000;

app.use(requestMonitoring);

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:8888')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: '1mb' }));

app.use('/health', healthRouter);
app.use('/stores', storesRouter);
app.use('/products', productsRouter);
app.use('/deals', dealsRouter);
app.use('/scrape', scrapeRouter);
app.use('/compare', compareRouter);
app.use('/receipts', receiptsRouter);

app.use('/lists', listsRouter);
app.use('/api/v1', publicApiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

function runStartupPhase(name: string, action: () => void): void {
  const startedAt = performance.now();
  action();
  runtimeMonitor.recordStartupPhase(name, performance.now() - startedAt);
}

runStartupPhase('catalogs', preloadProductCatalogs);
runStartupPhase('searchIndexes', preloadProductSearchIndexes);
runStartupPhase('barcodeIndexes', preloadBarcodeIndexes);

const products = loadAllProducts();
const freshestProductAt = products.reduce<string | null>((freshest, product) => {
  if (!product.scrapedAt || !Number.isFinite(Date.parse(product.scrapedAt))) return freshest;
  if (!freshest || Date.parse(product.scrapedAt) > Date.parse(freshest)) return product.scrapedAt;
  return freshest;
}, null);
runtimeMonitor.markCatalogLoaded(products.length, freshestProductAt);
runtimeMonitor.markStartupComplete();

app.listen(PORT, () => {
  logger.info('backend_started', {
    port: PORT,
    ...runtimeMonitor.getMetrics(),
  });
});
