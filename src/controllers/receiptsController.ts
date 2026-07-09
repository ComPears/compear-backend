import { Request, Response } from 'express';
import * as crypto from 'crypto';
import {
  parseReceiptImageWithAI,
  AiRateLimitContext,
  isAiRateLimitError,
} from '../ai/aiService';
import {
  analyzeParsedReceipt,
  deleteReceipt,
  getReceiptAnalytics,
  listReceipts,
  saveReceipt,
} from '../services/receiptService';
import { getUserIdFromRequest } from '../utils/userId';

export async function parseReceipt(req: Request, res: Response): Promise<void> {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Receipt image file required (field: receipt)' });
      return;
    }

    const allowed = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
    if (!allowed.has(file.mimetype)) {
      res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG, or WebP.' });
      return;
    }

    const receiptSessionId = crypto.randomUUID();
    const aiContext: AiRateLimitContext = {
      userId,
      ip: req.ip,
      receiptSessionId,
    };

    const imageBase64 = file.buffer.toString('base64');
    const parsed = await parseReceiptImageWithAI(imageBase64, file.mimetype, aiContext);
    if (!parsed) {
      res.status(422).json({
        error: 'Could not read receipt. Check image quality or OPENAI_API_KEY on the server.',
      });
      return;
    }

    const analysis = await analyzeParsedReceipt(parsed, aiContext);
    const saved = saveReceipt(userId, analysis, file.mimetype);
    res.status(201).json(saved);
  } catch (e) {
    if (isAiRateLimitError(e)) {
      const retryAfterSec = Math.ceil(e.retryAfterMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getReceipts(req: Request, res: Response): void {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }
    res.json(listReceipts(userId));
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getAnalytics(req: Request, res: Response): void {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }
    res.json(getReceiptAnalytics(userId));
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function removeReceipt(req: Request, res: Response): void {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }
    const removed = deleteReceipt(userId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
