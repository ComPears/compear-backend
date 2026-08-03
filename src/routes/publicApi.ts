import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { publicApiAuth } from '../middleware/publicApiAuth';
import { listProducts, getProduct } from '../controllers/productsController';
import { listStores } from '../controllers/storesController';
import { listStoreLocations } from '../controllers/locationsController';
import { listDeals, getDealsDigest } from '../controllers/dealsController';
import { compareByCanonicalName } from '../controllers/compareController';
import { DIETARY_LABELS } from '../utils/dietaryLabels';

const publicApiLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.PUBLIC_API_KEY ? 600 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

export const publicApiRouter = Router();

publicApiRouter.use(publicApiLimit);

// Unauthenticated discovery endpoints (still rate-limited).
publicApiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1', timestamp: new Date().toISOString() });
});

publicApiRouter.get('/docs', (_req, res) => {
  const keyRequired =
    process.env.NODE_ENV === 'production' || Boolean((process.env.PUBLIC_API_KEY || '').trim());
  res.json({
    version: '1',
    description: 'ComPear public read-only API for product prices and store data',
    authentication: keyRequired
      ? 'Required for data endpoints: x-api-key header or Authorization: Bearer <key>. /health and /docs are open.'
      : 'Optional in development: set PUBLIC_API_KEY to require authentication on data endpoints (required in production). /health and /docs stay open.',
    surfaces: {
      partnerApi: '/api/v1/* — keyed in production for third-party clients',
      consumerApi:
        '/products, /stores, /deals, /compare — intentionally unauthenticated for the ComPear SPA; protected by CORS allowlist + rate limits',
    },
    rateLimit: process.env.PUBLIC_API_KEY ? '600 requests / 15 min' : '120 requests / 15 min',
    endpoints: [
      { method: 'GET', path: '/api/v1/health', description: 'Health check (no API key)' },
      { method: 'GET', path: '/api/v1/docs', description: 'This document (no API key)' },
      { method: 'GET', path: '/api/v1/products', query: 'search, store, category, barcode, labels (comma-separated)' },
      { method: 'GET', path: '/api/v1/products/:id', description: 'Single product' },
      { method: 'GET', path: '/api/v1/stores', description: 'List stores with product counts' },
      { method: 'GET', path: '/api/v1/stores/locations', query: 'chain, city, lat, lng, radius (km), limit' },
      { method: 'GET', path: '/api/v1/deals', description: 'Paginated deals (?limit,&offset)' },
      { method: 'GET', path: '/api/v1/deals/digest', description: 'Weekly deals summary' },
      { method: 'GET', path: '/api/v1/compare/:canonicalName', query: 'identityKey (optional)' },
    ],
    dietaryLabels: DIETARY_LABELS,
    exampleLabels: 'labels=vegan,gluten-free',
  });
});

// Data endpoints require PUBLIC_API_KEY when configured / in production.
publicApiRouter.use(publicApiAuth);

publicApiRouter.get('/products', listProducts);
publicApiRouter.get('/products/:id', getProduct);
publicApiRouter.get('/stores/locations', listStoreLocations);
publicApiRouter.get('/stores', listStores);
publicApiRouter.get('/deals/digest', getDealsDigest);
publicApiRouter.get('/deals', listDeals);
publicApiRouter.get('/compare/:canonicalName', compareByCanonicalName);
