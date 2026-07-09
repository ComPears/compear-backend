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
publicApiRouter.use(publicApiAuth);

publicApiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: '1', timestamp: new Date().toISOString() });
});

publicApiRouter.get('/docs', (_req, res) => {
  res.json({
    version: '1',
    description: 'ComPear public read-only API for product prices and store data',
    authentication: process.env.PUBLIC_API_KEY
      ? 'Required: x-api-key header or Authorization: Bearer <key>'
      : 'Optional: set PUBLIC_API_KEY on server to require authentication',
    rateLimit: process.env.PUBLIC_API_KEY ? '600 requests / 15 min' : '120 requests / 15 min',
    endpoints: [
      { method: 'GET', path: '/api/v1/health', description: 'Health check' },
      { method: 'GET', path: '/api/v1/docs', description: 'This document' },
      { method: 'GET', path: '/api/v1/products', query: 'search, store, category, barcode, labels (comma-separated)' },
      { method: 'GET', path: '/api/v1/products/:id', description: 'Single product' },
      { method: 'GET', path: '/api/v1/stores', description: 'List stores with product counts' },
      { method: 'GET', path: '/api/v1/stores/locations', query: 'chain, city, lat, lng, radius (km), limit' },
      { method: 'GET', path: '/api/v1/deals', description: 'Products with active promotions' },
      { method: 'GET', path: '/api/v1/deals/digest', description: 'Weekly deals summary' },
      { method: 'GET', path: '/api/v1/compare/:canonicalName', query: 'identityKey (optional)' },
    ],
    dietaryLabels: DIETARY_LABELS,
    exampleLabels: 'labels=vegan,gluten-free',
  });
});

publicApiRouter.get('/products', listProducts);
publicApiRouter.get('/products/:id', getProduct);
publicApiRouter.get('/stores/locations', listStoreLocations);
publicApiRouter.get('/stores', listStores);
publicApiRouter.get('/deals/digest', getDealsDigest);
publicApiRouter.get('/deals', listDeals);
publicApiRouter.get('/compare/:canonicalName', compareByCanonicalName);
