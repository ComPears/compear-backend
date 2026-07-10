import { Request, Response } from 'express';
import * as crypto from 'crypto';
import {
  parseReceiptImageWithAI,
  AiRateLimitContext,
  isAiRateLimitError,
} from '../ai/aiService';
import {
  analyzeParsedReceipt,
  clearReceipts,
  correctReceiptLine,
  deleteReceipt,
  getReceiptAnalytics,
  listReceipts,
  saveReceipt,
} from '../services/receiptService';
import { ReceiptLineCorrection, SavedReceipt } from '../types/receipt';
import { getUserIdFromRequest } from '../utils/userId';
import {
  prepareReceiptImageForVision,
  ReceiptImageError,
} from '../utils/receiptImage';

function publicReceipt(receipt: SavedReceipt): Omit<SavedReceipt, 'aiCacheKeys'> {
  const { aiCacheKeys: _internalCacheKeys, ...result } = receipt;
  return result;
}

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
      aiCacheKeys: [],
    };

    let visionImage;
    try {
      visionImage = await prepareReceiptImageForVision(file.buffer, file.mimetype);
    } catch (error) {
      if (error instanceof ReceiptImageError) {
        res.status(422).json({ error: error.message });
        return;
      }
      throw error;
    }

    const imageBase64 = visionImage.buffer.toString('base64');
    const parsed = await parseReceiptImageWithAI(
      imageBase64,
      visionImage.mimeType,
      aiContext
    );
    if (!parsed) {
      const missingKey = !process.env.OPENAI_API_KEY;
      res.status(422).json({
        error: missingKey
          ? 'Receipt OCR is not configured on the server (OPENAI_API_KEY missing).'
          : 'Could not read this receipt. Try a clearer, well-lit photo with the full bon visible.',
      });
      return;
    }

    const analysis = await analyzeParsedReceipt(parsed, aiContext);
    const saved = saveReceipt(userId, analysis, visionImage.mimeType, aiContext.aiCacheKeys);
    res.status(201).json(publicReceipt(saved));
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
    res.json(listReceipts(userId).map(publicReceipt));
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

export function removeAllReceipts(req: Request, res: Response): void {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }
    const deletedCount = clearReceipts(userId);
    res.json({ deletedCount });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function correctLine(req: Request, res: Response): Promise<void> {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      res.status(400).json({ error: 'Valid x-compear-user-id header required' });
      return;
    }
    const lineIndex = Number(req.params.lineIndex);
    if (!Number.isInteger(lineIndex) || lineIndex < 0) {
      res.status(400).json({ error: 'Valid receipt line index required' });
      return;
    }
    const correction = req.body as Partial<ReceiptLineCorrection>;
    if (
      correction.action !== 'unmatched' &&
      (correction.action !== 'rematch' ||
        typeof correction.correctedName !== 'string' ||
        !correction.correctedName.trim())
    ) {
      res.status(400).json({
        error: 'Use action "unmatched" or "rematch" with a correctedName',
      });
      return;
    }
    const aiContext: AiRateLimitContext = {
      userId,
      ip: req.ip,
      receiptSessionId: crypto.randomUUID(),
      aiCacheKeys: [],
    };
    const receipt = await correctReceiptLine(
      userId,
      req.params.id,
      lineIndex,
      correction as ReceiptLineCorrection,
      aiContext
    );
    if (!receipt) {
      res.status(404).json({ error: 'Receipt or line not found' });
      return;
    }
    res.json(publicReceipt(receipt));
  } catch (e) {
    if (isAiRateLimitError(e)) {
      res.status(429).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  }
}
