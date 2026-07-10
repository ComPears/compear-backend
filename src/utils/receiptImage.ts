import { logger } from './logger';

type HeicConvert = (options: {
  buffer: Buffer;
  format: 'JPEG' | 'PNG';
  quality?: number;
}) => Promise<ArrayBuffer>;

// CommonJS package; typed require avoids ts-node ambient .d.ts discovery issues.
const convert = require('heic-convert') as HeicConvert;

const VISION_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const HEIC_MIMES = new Set(['image/heic', 'image/heif']);

export class ReceiptImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptImageError';
  }
}

export interface PreparedReceiptImage {
  buffer: Buffer;
  mimeType: string;
}

export async function prepareReceiptImageForVision(
  buffer: Buffer,
  mimeType: string
): Promise<PreparedReceiptImage> {
  const normalized = mimeType.toLowerCase();

  if (VISION_MIMES.has(normalized)) {
    return { buffer, mimeType: normalized };
  }

  if (HEIC_MIMES.has(normalized)) {
    try {
      const converted = await convert({
        buffer,
        format: 'JPEG',
        quality: 0.92,
      });
      const jpegBuffer = Buffer.from(converted);
      logger.info('Converted HEIC/HEIF receipt image to JPEG', {
        inputBytes: buffer.length,
        outputBytes: jpegBuffer.length,
      });
      return { buffer: jpegBuffer, mimeType: 'image/jpeg' };
    } catch (error) {
      logger.error('HEIC receipt conversion failed', error);
      throw new ReceiptImageError(
        'Could not process this iPhone photo. Save the receipt as JPEG or PNG and try again.'
      );
    }
  }

  throw new ReceiptImageError('Unsupported image type. Use JPEG, PNG, or WebP.');
}
