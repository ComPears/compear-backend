const EAN_CANDIDATE = /(?<!\d)(0?87\d{11}|\d{13}|\d{8})(?!\d)/g;

function checksumEan13(digits: string): boolean {
  if (digits.length !== 13 || !/^\d+$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = parseInt(digits[i], 10);
    total += n * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (total % 10)) % 10;
  return check === parseInt(digits[12], 10);
}

function checksumEan8(digits: string): boolean {
  if (digits.length !== 8 || !/^\d+$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const n = parseInt(digits[i], 10);
    total += n * (i % 2 === 0 ? 3 : 1);
  }
  const check = (10 - (total % 10)) % 10;
  return check === parseInt(digits[7], 10);
}

export function normalizeBarcode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.length === 12) digits = `0${digits}`;
  if (digits.length === 13 && checksumEan13(digits)) return digits;
  if (digits.length === 8 && checksumEan8(digits)) return digits;
  return null;
}

export function extractBarcodeFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  for (const match of text.matchAll(EAN_CANDIDATE)) {
    const normalized = normalizeBarcode(match[1]);
    if (normalized) return normalized;
  }
  return null;
}
