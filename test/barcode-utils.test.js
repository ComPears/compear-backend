const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const path = require('node:path');
const {
  extractBarcodeFromJumboUrl,
  normalizeBarcode,
} = require('../dist/utils/barcode.js');

describe('barcode utils', () => {
  it('normalizes valid EAN-13', () => {
    assert.equal(normalizeBarcode('8718452709458'), '8718452709458');
    assert.equal(normalizeBarcode(null), null);
  });

  it('mines underscore-bounded Jumbo DAM EANs and prefers 87…', () => {
    const url =
      'https://www.jumbo.com/dam-images/fit-in/360x360/Products/18092023_1695061234816_1695061248872_8718452709458_9.png';
    assert.equal(extractBarcodeFromJumboUrl(url), '8718452709458');
  });

  it('does not mine AH/PLUS-style CDN hashes or bare timestamps', () => {
    assert.equal(
      extractBarcodeFromJumboUrl(
        'https://static.ah.nl/dam/product/AHI_434d5032343335343936_1.png'
      ),
      null
    );
    assert.equal(
      extractBarcodeFromJumboUrl('https://cdn.example/_1695061234816_x.png'),
      null
    );
  });
});
