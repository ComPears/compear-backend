import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('product publication cannot wait on optional location refresh', () => {
  const seed = readFileSync('.github/workflows/seed-backend.yml', 'utf8');
  assert.doesNotMatch(seed, /npm run import-stores|osm_import|needs:/);
  assert.match(seed, /group: backend-product-seed\s+cancel-in-progress: false/);
  assert.match(seed, /git add src\/data\/nl src\/data\/uk src\/data\/de/);
  assert.doesNotMatch(seed, /git add src\/data\/store-locations/);
  assert.match(seed, /npm run test:memory/);
  assert.match(seed, /git pull --rebase origin main/);
  assert.match(seed, /EXPECTED_COMMIT:/);
});

test('optional locations have an independent budget and publish only on success', () => {
  const locations = readFileSync('.github/workflows/refresh-store-locations.yml', 'utf8');
  assert.match(locations, /group: backend-location-refresh/);
  assert.doesNotMatch(locations, /backend-product-seed|needs:|RENDER_DEPLOY_HOOK_URL/);
  assert.match(locations, /id: osm_import\s+timeout-minutes: 30\s+continue-on-error: true/);
  assert.match(locations, /if: github.ref == 'refs\/heads\/main' && steps.osm_import.outcome == 'success'/);
  assert.match(locations, /git add src\/data\/store-locations.json/);
  assert.doesNotMatch(locations, /git add -A|git add src\/data\/nl/);
  assert.match(locations, /if: always\(\) && steps.osm_import.outcome != 'success'/);
});
