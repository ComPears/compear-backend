import { Router } from 'express';
import { listProducts, getProduct } from '../controllers/productsController';

export const productsRouter = Router();
productsRouter.get('/', listProducts);
productsRouter.get('/:id', getProduct);
