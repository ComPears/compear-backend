import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import {
  getAnalytics,
  getReceipts,
  parseReceipt,
  removeReceipt,
} from '../controllers/receiptsController';
import { getUserIdFromRequest } from '../utils/userId';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
});

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const receiptParseLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: envInt('AI_MAX_VISION_PER_USER_HOUR', 5),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const userId = getUserIdFromRequest(req);
    if (userId) return `receipt:user:${userId}`;
    return `receipt:ip:${req.ip}`;
  },
  message: {
    error: 'Te veel bon-uploads. Je kunt een paar bonnen per uur uploaden — probeer het later opnieuw.',
  },
});

export const receiptsRouter = Router();

receiptsRouter.post('/parse', receiptParseLimiter, upload.single('receipt'), parseReceipt);
receiptsRouter.get('/', getReceipts);
receiptsRouter.get('/analytics', getAnalytics);
receiptsRouter.delete('/:id', removeReceipt);
