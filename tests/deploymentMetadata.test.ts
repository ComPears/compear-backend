import assert from 'node:assert/strict';
import test from 'node:test';
import { getDeploymentMetadata } from '../src/monitoring/deploymentMetadata';

test('deployment metadata prefers the Render revision', () => {
  const metadata = getDeploymentMetadata({
    RENDER_GIT_COMMIT: 'render-sha',
    GITHUB_SHA: 'github-sha',
    RENDER_SERVICE_NAME: 'compear-backend',
    NODE_ENV: 'production',
  });

  assert.deepEqual(metadata, {
    commit: 'render-sha',
    service: 'compear-backend',
    environment: 'production',
  });
});

test('deployment metadata has safe local defaults', () => {
  assert.deepEqual(getDeploymentMetadata({}), {
    commit: null,
    service: null,
    environment: 'development',
  });
});
