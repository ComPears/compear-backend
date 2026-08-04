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

const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'hevc',
  'hevx',
  'heim',
  'heis',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
  'heif',
]);

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

export type DetectedImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'image/heif';

/**
 * Detect image type from magic bytes. Returns null when the buffer is not an allowed image.
 * HEIC/HEIF are identified via ISO BMFF `ftyp` brands.
 */
export function detectImageMime(buffer: Buffer): DetectedImageMime | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WEBP: RIFF....WEBP
  if (
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }

  // HEIC/HEIF: ISO BMFF with ftyp box and known brands
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const majorBrand = buffer.toString('ascii', 8, 12).replace(/\0/g, '');
    const brands = new Set<string>([majorBrand]);
    for (let offset = 16; offset + 4 <= buffer.length && offset < 64; offset += 4) {
      brands.add(buffer.toString('ascii', offset, offset + 4).replace(/\0/g, ''));
    }
    for (const brand of brands) {
      if (HEIC_BRANDS.has(brand)) {
        return brand.startsWith('hei') || brand === 'heif' ? 'image/heic' : 'image/heif';
      }
    }
  }

  return null;
}

export async function prepareReceiptImageForVision(
  buffer: Buffer,
  mimeType?: string
): Promise<PreparedReceiptImage> {
  const detected = detectImageMime(buffer);
  if (!detected) {
    throw new ReceiptImageError('Unsupported image type. Use JPEG, PNG, or WebP.');
  }

  // Prefer magic-byte detection over client-declared MIME.
  const normalized = detected;
  if (mimeType && mimeType.toLowerCase() !== normalized) {
    logger.info('Receipt image MIME mismatch; using magic-byte type', {
      declared: mimeType,
      detected: normalized,
    });
  }

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
