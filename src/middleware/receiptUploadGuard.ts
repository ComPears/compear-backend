import { RequestHandler } from 'express';
import { parseReceipt, requireVerifiedReceiptUser } from '../controllers/receiptsController';

/** Authenticate headers before multipart parsing allocates any file buffers. */
export const authenticateReceiptUpload: RequestHandler = (req, res, next) => {
  const userId = requireVerifiedReceiptUser(req, res);
  if (!userId) return;
  res.locals.receiptUserId = userId;
  next();
};

/** Bound aggregate upload/decoder/AI memory, not just the size of each file. */
export function createReceiptUploadGuard(maxConcurrent = 2): RequestHandler {
  let active = 0;
  return (_req, res, next) => {
    if (active >= maxConcurrent) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({ error: 'Receipt processing is busy. Please retry shortly.' });
      return;
    }
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    const slot = { processing: false, release };
    res.locals.receiptUploadSlot = slot;
    res.once('finish', release);
    // Disconnecting must not free a slot while decoding/AI is still running.
    res.once('close', () => { if (!slot.processing) release(); });
    next();
  };
}

export const processReceiptUpload: RequestHandler = async (req, res) => {
  const slot = res.locals.receiptUploadSlot;
  try {
    if (res.destroyed) return;
    if (slot) slot.processing = true;
    await parseReceipt(req, res);
  } finally {
    slot?.release();
  }
};
