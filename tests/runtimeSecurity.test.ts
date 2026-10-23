import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deployment runtimes include the October 2026 Node security release', () => {
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.equal(major, 22);
  assert.ok(minor > 23 || (minor === 23 && patch >= 4));
  assert.equal(readFileSync('.nvmrc', 'utf8').trim(), '22.23.4');
  assert.equal(JSON.parse(readFileSync('package.json', 'utf8')).engines.node, '>=22.23.4 <23');
  assert.match(readFileSync('.npmrc', 'utf8'), /engine-strict=true/);
  const docker = readFileSync('Dockerfile', 'utf8');
  assert.equal((docker.match(/FROM node:22\.23\.4-alpine/g) || []).length, 2);
  assert.match(readFileSync('render.yaml', 'utf8'), /key: NODE_VERSION\s+value: "22\.23\.4"/);
  for (const name of ['ci.yml', 'seed-backend.yml']) {
    assert.match(readFileSync(`.github/workflows/${name}`, 'utf8'), /node-version-file: .nvmrc/);
  }
});
