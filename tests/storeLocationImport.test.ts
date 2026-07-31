import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fetchOsmElements,
  overpassBackoffMs,
} from '../src/services/storeLocationImport';

describe('overpassBackoffMs', () => {
  it('grows then caps', () => {
    assert.equal(overpassBackoffMs(1), 2000);
    assert.equal(overpassBackoffMs(2), 4000);
    assert.equal(overpassBackoffMs(3), 8000);
    assert.equal(overpassBackoffMs(10), 30000);
  });
});

describe('fetchOsmElements', () => {
  it('retries retryable Overpass errors across mirrors then succeeds', async () => {
    const calls: string[] = [];
    const endpoints = [
      'https://mirror-a.example/interpreter',
      'https://mirror-b.example/interpreter',
    ];
    const sleepCalls: number[] = [];

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (calls.length < 3) {
        return new Response('gateway timeout', { status: 504 });
      }
      return new Response(JSON.stringify({ elements: [{ type: 'node', id: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const elements = await fetchOsmElements({
      endpoints,
      fetchImpl,
      maxAttempts: 4,
      sleepImpl: async (ms) => {
        sleepCalls.push(ms);
      },
    });

    assert.equal(elements.length, 1);
    assert.deepEqual(calls, [
      endpoints[0],
      endpoints[1],
      endpoints[0],
    ]);
    assert.deepEqual(sleepCalls, [2000, 4000]);
  });

  it('does not retry non-retryable HTTP errors', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response('bad query', { status: 400 });
    }) as typeof fetch;

    await assert.rejects(
      () =>
        fetchOsmElements({
          endpoints: ['https://mirror-a.example/interpreter'],
          fetchImpl,
          maxAttempts: 4,
          sleepImpl: async () => undefined,
        }),
      /Overpass API error 400/
    );
    assert.equal(calls, 1);
  });
});
