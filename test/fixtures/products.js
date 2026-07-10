function product(overrides = {}) {
  return {
    id: 'ah-1',
    canonicalName: 'halfvolle melk',
    productName: 'Halfvolle melk',
    brand: 'Testmerk',
    store: 'Albert Heijn',
    packageSize: '1 l',
    weightInGrams: 1000,
    originalPrice: 1.5,
    effectivePrice: 1.5,
    unitPrice: 1.5,
    effectiveUnitPrice: 1.5,
    promoType: null,
    promoValue: null,
    promoValidUntil: null,
    productUrl: 'https://example.test/product',
    scrapedAt: '2026-01-01T00:00:00.000Z',
    category: 'Dairy & Eggs',
    barcode: '8712345678906',
    identityKey: 'ean:8712345678906',
    ...overrides,
  };
}

function catalog(size = 12) {
  return Array.from({ length: size }, (_, index) =>
    product({
      id: `ah-${index + 1}`,
      productName: `Halfvolle melk ${String(index + 1).padStart(2, '0')}`,
      effectivePrice: 1 + index / 10,
      originalPrice: 1 + index / 10,
      barcode: String(8712345678906 + index),
      identityKey: `ean:${8712345678906 + index}`,
    })
  );
}

module.exports = { catalog, product };
