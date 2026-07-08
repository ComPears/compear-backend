import { Request, Response } from 'express';
import { parseReceiptImageWithAI } from '../ai/aiService';
import {
  analyzeParsedReceipt,
  deleteReceipt,
  getReceiptAnalytics,
  listReceipts,
  saveReceipt,
} from '../services/receiptService';

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

function getUserId(req: Request): string | null {
  const header = req.header('x-compear-user-id');
  const body = typeof req.body?.userId === 'string' ? req.body.userId : null;
  const candidate = (header || body || '').trim();
  return USER_ID_PATTERN.test(candidate) ? candidate : null;
}

export async function parseReceipt(req: Request, res: Response): Promise<void> {
  try {
    const userId = getUserId(req);
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

    const imageBase64 = file.buffer.toString('base64');
    const parsed = await parseReceiptImageWithAI(imageBase64, file.mimetype);
    if (!parsed) {
      res.status(422).json({
        error: 'Could not read receipt. Check image quality or OPENAI_API_KEY on the server.',
      });
      return;
    }

    const analysis = await analyzeParsedReceipt(parsed);
    const saved = saveReceipt(userId, analysis, file.mimetype);
    res.status(201).json(saved);
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

export function getReceipts(req: Request, res: Response): void {
  try {
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
    const userId = getUserId(req);
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
