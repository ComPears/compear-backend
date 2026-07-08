import { Router } from 'express';
import { listStores } from '../controllers/storesController';

export const storesRouter = Router();
storesRouter.get('/', listStores);
