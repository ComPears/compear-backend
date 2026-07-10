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
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

// Node 20.12+ loads local development variables without another dependency.
// Render injects production variables directly.
if (process.env.NODE_ENV !== 'production' && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile();
}

const app = express();
const PORT = process.env.PORT || 4000;

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

app.use((req, _res, next) => {
  logger.info(req.method, req.path);
  next();
});

app.use('/stores', storesRouter);
app.use('/products', productsRouter);
app.use('/deals', dealsRouter);
app.use('/scrape', scrapeRouter);
app.use('/compare', compareRouter);
app.use('/receipts', receiptsRouter);

app.use('/lists', listsRouter);
app.use('/api/v1', publicApiRouter);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => {
  logger.info('Backend listening on port', PORT);
});
