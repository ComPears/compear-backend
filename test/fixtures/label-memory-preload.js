// Memory-test-only facts. Never written to catalogs or used by a deployed server.
const { preloadProductCatalogs, loadAllProducts } = require('../../dist/services/dataService');
preloadProductCatalogs();
let remaining = 5000;
for (const country of ['nl', 'uk', 'de']) {
  for (const product of loadAllProducts(country)) {
    if (!remaining || !product.productUrl?.startsWith('https://')) continue;
    product.labelEvidence = JSON.parse(JSON.stringify({
      version: 1, method: 'retailer_api', sourceUrl: product.productUrl,
      observedAt: new Date().toISOString(), claims: ['vegetarian'],
      ingredients: `${product.id}: ${'Fixture-only ingredient statement; '.repeat(30)}`,
      nutrients: { basis: '100g', servingSize: '100 g', proteinG: 10, sugarG: 0, fiberG: 4 },
    }));
    remaining--;
  }
}
if (remaining) throw new Error('Not enough listing-bound products for the 5000-label memory fixture');
