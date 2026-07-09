import { Router } from 'express';
import { listStores } from '../controllers/storesController';
import { listStoreLocations } from '../controllers/locationsController';

export const storesRouter = Router();
storesRouter.get('/locations', listStoreLocations);
storesRouter.get('/', listStores);
