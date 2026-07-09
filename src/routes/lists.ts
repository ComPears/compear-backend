import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { createList, getList, patchList } from '../controllers/listsController';

const listWriteLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

export const listsRouter = Router();
listsRouter.post('/', listWriteLimit, createList);
listsRouter.get('/:id', getList);
listsRouter.patch('/:id', listWriteLimit, patchList);
