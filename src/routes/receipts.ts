import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  getAnalytics,
  getReceipts,
  parseReceipt,
  removeReceipt,
} from '../controllers/receiptsController';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

const receiptParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many receipt uploads. Try again later.' },
});

export const receiptsRouter = Router();

receiptsRouter.post('/parse', receiptParseLimiter, upload.single('receipt'), parseReceipt);
receiptsRouter.get('/', getReceipts);
receiptsRouter.get('/analytics', getAnalytics);
receiptsRouter.delete('/:id', removeReceipt);
