import { Router } from 'express';
import { liveness, metrics, readiness, recordWebVital } from '../controllers/healthController';

export const healthRouter = Router();

healthRouter.get('/', liveness);
healthRouter.get('/live', liveness);
healthRouter.get('/ready', readiness);
healthRouter.get('/metrics', metrics);
healthRouter.post('/vitals', recordWebVital);
