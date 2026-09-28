import { Router } from 'express';
import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  correctLine,
  createReceiptSession,
  getAnalytics,
  getReceipts,
  removeAllReceipts,
  removeReceipt,
} from '../controllers/receiptsController';
import { authenticateReceiptUpload, createReceiptUploadGuard, processReceiptUpload } from '../middleware/receiptUploadGuard';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 4, fieldSize: 4096, parts: 5 },
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
  keyGenerator: (req, res) => {
    const userId = res.locals.receiptUserId;
    if (userId) return `receipt:user:${userId}`;
    return `receipt:ip:${ipKeyGenerator(req.ip ?? '')}`;
  },
  message: {
    error: 'Te veel bon-uploads. Je kunt een paar bonnen per uur uploaden — probeer het later opnieuw.',
  },
});

const receiptSessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `receipt-session:ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: {
    error: 'Too many receipt session requests. Try again later.',
  },
});

export const receiptsRouter = Router();

// Receipt responses and session credentials must not be retained by caches.
receiptsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
});

receiptsRouter.post('/session', receiptSessionLimiter, createReceiptSession);
receiptsRouter.post('/parse', authenticateReceiptUpload, receiptParseLimiter,
  createReceiptUploadGuard(), upload.single('receipt'), processReceiptUpload);
receiptsRouter.get('/', getReceipts);
receiptsRouter.get('/analytics', getAnalytics);
receiptsRouter.patch('/:id/lines/:lineIndex', correctLine);
receiptsRouter.delete('/', removeAllReceipts);
receiptsRouter.delete('/:id', removeReceipt);
