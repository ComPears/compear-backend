import { Router } from 'express';
import { listDeals, getDealsDigest } from '../controllers/dealsController';

export const dealsRouter = Router();
dealsRouter.get('/digest', getDealsDigest);
dealsRouter.get('/', listDeals);
