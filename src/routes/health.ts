import { Router } from 'express';
import { liveness, metrics, readiness, recordWebVital } from '../controllers/healthController';
import { apiKeyAuth } from '../middleware/apiKeyAuth';

export const healthRouter = Router();

healthRouter.get('/', liveness);
healthRouter.get('/live', liveness);
healthRouter.get('/ready', readiness);
healthRouter.get('/metrics', apiKeyAuth, metrics);
healthRouter.post('/vitals', recordWebVital);
