// Real server + committed catalogs under a Render-sized heap. No production traffic.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const { randomBytes } = require('node:crypto');

async function main() {
  const child = spawn(process.execPath, ['--max-old-space-size=256', '--max-semi-space-size=1', 'dist/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env, NODE_ENV: 'production', PORT: '0', NODE_OPTIONS: '',
      RECEIPT_AUTH_SECRET: randomBytes(32).toString('hex'),
      // Catalog freshness is tested elsewhere; this check isolates memory.
      CATALOG_MAX_AGE_HOURS: '100000', READINESS_MAX_RSS_MB: '480',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8000); });
  const lines = createInterface({ input: child.stdout });
  const startup = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => reject(new Error(`Server exited before ready (${code}/${signal}): ${stderr}`)));
    lines.on('line', (line) => {
      try {
        const entry = JSON.parse(line);
        if (entry.message === 'backend_started') resolve(entry.data);
      } catch { /* ignore non-JSON startup messages */ }
    });
  });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 120_000);
  try {
    const started = await startup;
    const base = `http://127.0.0.1:${started.port}`;
    let maxHeapMb = started.memory.heapUsedMb;
    let maxRssMb = started.memory.rssMb;
    const consume = async (route, headers) => {
      const result = await fetch(base + route, { headers, signal: AbortSignal.timeout(20_000) });
      assert.equal(result.status, 200, route);
      const body = await result.json();
      return { result, body };
    };
    for (const country of ['nl', 'uk', 'de']) {
      const full = await consume(`/products/seo-index?country=${country}`);
      const paged = [];
      let offset = 0;
      do {
        const { result, body } = await consume(`/products/seo-index?country=${country}&limit=250&offset=${offset}`);
        assert.ok(body.length <= 250);
        paged.push(...body);
        offset += body.length;
        if (offset >= Number(result.headers.get('X-Total-Count'))) break;
        assert.ok(body.length, 'pagination must advance');
      } while (true);
      assert.deepEqual(paged, full.body, `${country}: pagination must preserve every offer`);
      const conditional = await fetch(`${base}/products/seo-index?country=${country}`, {
        // Undici otherwise injects no-cache for a conditional fetch, which
        // deliberately asks Express for a full 200 instead of a fresh 304.
        headers: { 'If-None-Match': full.result.headers.get('ETag'), 'Cache-Control': 'max-age=0' },
      });
      assert.equal(conditional.status, 304);
      await conditional.arrayBuffer();
    }
    for (let round = 0; round < 20; round++) {
      await Promise.all(['nl', 'uk', 'de'].flatMap((country) => [
        consume(`/products/seo-index?country=${country}`),
        consume(`/products?country=${country}&search=${round % 2 ? 'milk' : 'bread'}&limit=100`),
      ]));
      const { body } = await consume('/health/ready');
      maxHeapMb = Math.max(maxHeapMb, body.memory.heapUsedMb);
      maxRssMb = Math.max(maxRssMb, body.memory.rssMb);
    }
    assert.ok(maxHeapMb < 230, `Insufficient heap headroom: peak ${maxHeapMb} MB`);
    assert.ok(maxRssMb < 480, `RSS budget exceeded: ${maxRssMb} MB`);
    console.log(JSON.stringify({ startup: started, rounds: 20, concurrency: 6, maxHeapMb, maxRssMb }));
  } finally {
    clearTimeout(deadline);
    child.kill('SIGTERM');
    await exited;
    lines.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
