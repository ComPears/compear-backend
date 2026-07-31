import { Router } from 'express';
import { listProducts, getProduct, getProductBySlug, getSeoIndex } from '../controllers/productsController';

export const productsRouter = Router();
productsRouter.get('/', listProducts);
productsRouter.get('/seo-index', getSeoIndex);
productsRouter.get('/slug/:slug', getProductBySlug);
productsRouter.get('/:id', getProduct);
