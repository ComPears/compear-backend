import assert from 'node:assert/strict';
import test from 'node:test';
import {
  issueReceiptCredentials,
  verifyReceiptToken,
  getReceiptAuthFromRequest,
} from '../src/utils/receiptAuth';
import { detectImageMime } from '../src/utils/receiptImage';
import { estimateCostUsd, assertAiBudgetAvailable, getAiSpendStatus } from '../src/ai/aiCostTracker';
import { AiRateLimitError } from '../src/ai/aiRateLimiter';
import {
  createSharedList,
  getSharedList,
  toPublicSharedList,
  verifyListEditToken,
} from '../src/services/listService';
import { secureCompare } from '../src/utils/secureCompare';
import { publicApiAuth } from '../src/middleware/publicApiAuth';
import { apiKeyAuth } from '../src/middleware/apiKeyAuth';
import { patchList } from '../src/controllers/listsController';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

test('receiptAuth issues credentials that verify and rejects forgeries', () => {
  const { userId, token } = issueReceiptCredentials();
  assert.equal(verifyReceiptToken(userId, token), true);
  assert.equal(verifyReceiptToken(userId, '0'.repeat(token.length)), false);
  assert.equal(verifyReceiptToken(userId, token.slice(0, -1) + 'a'), false);
  assert.equal(verifyReceiptToken('other-user-id-xx', token), false);
});

test('getReceiptAuthFromRequest reads headers and bearer', () => {
  const { userId, token } = issueReceiptCredentials();
  const fromHeaders = getReceiptAuthFromRequest({
    header(name: string) {
      if (name === 'x-compear-user-id') return userId;
      if (name === 'x-compear-user-token') return token;
      return undefined;
    },
  });
  assert.deepEqual(fromHeaders, { userId, token });

  const fromBearer = getReceiptAuthFromRequest({
    header(name: string) {
      if (name.toLowerCase() === 'authorization') return `Bearer ${userId}:${token}`;
      return undefined;
    },
  });
  assert.deepEqual(fromBearer, { userId, token });
});

test('detectImageMime identifies JPEG PNG WEBP HEIC and rejects junk', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  assert.equal(detectImageMime(jpeg), 'image/jpeg');

  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  ]);
  assert.equal(detectImageMime(png), 'image/png');

  const webp = Buffer.alloc(12);
  webp.write('RIFF', 0);
  webp.writeUInt32LE(4, 4);
  webp.write('WEBP', 8);
  assert.equal(detectImageMime(webp), 'image/webp');

  // Minimal ftyp/heic brand box
  const heic = Buffer.alloc(20);
  heic.writeUInt32BE(20, 0);
  heic.write('ftyp', 4);
  heic.write('heic', 8);
  heic.write('mif1', 16);
  assert.equal(detectImageMime(heic), 'image/heic');

  assert.equal(detectImageMime(Buffer.from('%PDF-1.4 junk!!')), null);
  assert.equal(detectImageMime(Buffer.from('short')), null);
});

test('estimateCostUsd uses approximate model pricing', () => {
  const cost4o = estimateCostUsd('gpt-4o', 1_000_000, 1_000_000);
  assert.equal(cost4o, 12.5); // 2.5 + 10

  const cost55 = estimateCostUsd('gpt-5.5', 1_000_000, 0);
  assert.equal(cost55, 1.25);

  const tiny = estimateCostUsd('gpt-4o', 1000, 500);
  assert.ok(tiny > 0 && tiny < 0.01);
});

test('assertAiBudgetAvailable throws when budget is zero', () => {
  const prev = process.env.AI_MONTHLY_BUDGET_USD;
  process.env.AI_MONTHLY_BUDGET_USD = '0';
  try {
    assert.throws(() => assertAiBudgetAvailable(), (err: unknown) => {
      assert.ok(err instanceof AiRateLimitError);
      assert.match(err.message, /budget/i);
      return true;
    });
    const status = getAiSpendStatus();
    assert.equal(status.budgetUsd, 0);
    assert.equal(status.remainingUsd, 0);
  } finally {
    if (prev === undefined) delete process.env.AI_MONTHLY_BUDGET_USD;
    else process.env.AI_MONTHLY_BUDGET_USD = prev;
  }
});

test('shared list strips editToken on public GET and requires it for patch', () => {
  const list = createSharedList('Test', [
    {
      productId: 'p1',
      productName: 'Melk',
      store: 'Albert Heijn',
      quantity: 1,
      effectivePrice: 1.29,
    },
  ]);
  assert.ok(list.editToken.length > 10);

  const publicList = toPublicSharedList(list);
  assert.equal('editToken' in publicList, false);
  assert.equal(publicList.claimable, undefined);

  const loaded = getSharedList(list.id);
  assert.ok(loaded);
  assert.equal(verifyListEditToken(loaded!, 'wrong-token-xxxxxxxxxxxx'), false);
  assert.equal(verifyListEditToken(loaded!, list.editToken), true);

  let status = 0;
  let body: { error?: string } = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: { error?: string }) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  patchList(
    {
      params: { id: list.id },
      header() {
        return undefined;
      },
      body: {
        name: 'Updated',
        items: list.items,
      },
    } as unknown as Request,
    res
  );
  assert.equal(status, 403);
  assert.match(body.error || '', /edit token/i);

  status = 0;
  patchList(
    {
      params: { id: list.id },
      header(name: string) {
        if (name === 'x-list-edit-token') return list.editToken;
        return undefined;
      },
      body: {
        name: 'Updated',
        items: list.items,
      },
    } as unknown as Request,
    res
  );
  assert.equal(status, 0); // res.json without prior status defaults; Express would be 200
  assert.equal((body as { name?: string }).name, 'Updated');
  assert.equal((body as { editToken?: string }).editToken, list.editToken);

  const file = path.join(__dirname, '../src/data/lists', `${list.id}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
});

test('secureCompare and api key auth reject mismatches safely', () => {
  assert.equal(secureCompare('abc', 'abc'), true);
  assert.equal(secureCompare('abc', 'abd'), false);
  assert.equal(secureCompare('abc', 'abcd'), false);

  const prevScrape = process.env.SCRAPE_API_KEY;
  const prevAdmin = process.env.ADMIN_API_KEY;
  process.env.SCRAPE_API_KEY = 'test-scrape-key-value';
  delete process.env.ADMIN_API_KEY;

  let status = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  let nextCalled = false;
  apiKeyAuth(
    {
      header(name: string) {
        if (name === 'x-api-key') return 'wrong-key';
        return undefined;
      },
    } as Request,
    res,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(status, 401);
  assert.equal(nextCalled, false);

  status = 0;
  nextCalled = false;
  apiKeyAuth(
    {
      header(name: string) {
        if (name === 'x-api-key') return 'test-scrape-key-value';
        return undefined;
      },
    } as Request,
    res,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);

  // Both ADMIN and SCRAPE are accepted when both are configured.
  process.env.ADMIN_API_KEY = 'test-admin-key-value';
  nextCalled = false;
  apiKeyAuth(
    {
      header(name: string) {
        if (name === 'x-api-key') return 'test-scrape-key-value';
        return undefined;
      },
    } as Request,
    res,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);

  nextCalled = false;
  apiKeyAuth(
    {
      header(name: string) {
        if (name === 'x-api-key') return 'test-admin-key-value';
        return undefined;
      },
    } as Request,
    res,
    () => {
      nextCalled = true;
    }
  );
  assert.equal(nextCalled, true);

  if (prevScrape === undefined) delete process.env.SCRAPE_API_KEY;
  else process.env.SCRAPE_API_KEY = prevScrape;
  if (prevAdmin === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prevAdmin;
});

test('legacy shared lists can be claimed on first PATCH', () => {
  const list = createSharedList('Legacy', [
    {
      productId: 'p1',
      productName: 'Melk',
      store: 'Albert Heijn',
      quantity: 1,
      effectivePrice: 1.29,
    },
  ]);
  const file = path.join(__dirname, '../src/data/lists', `${list.id}.json`);
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as { editToken?: string };
  delete onDisk.editToken;
  fs.writeFileSync(file, JSON.stringify(onDisk, null, 2));

  const loaded = getSharedList(list.id);
  assert.ok(loaded);
  assert.equal(loaded!.editToken, '');
  assert.equal(verifyListEditToken(loaded!, null), true);
  assert.equal(toPublicSharedList(loaded!).claimable, true);

  let status = 0;
  let body: { editToken?: string; name?: string } = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: { editToken?: string; name?: string }) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  patchList(
    {
      params: { id: list.id },
      header() {
        return undefined;
      },
      body: {
        name: 'Claimed',
        items: list.items,
      },
    } as unknown as Request,
    res
  );
  assert.equal(status, 0);
  assert.equal(body.name, 'Claimed');
  assert.ok(body.editToken && body.editToken.length > 10);

  const after = getSharedList(list.id);
  assert.ok(after);
  assert.equal(verifyListEditToken(after!, 'wrong-token-xxxxxxxxxxxx'), false);
  assert.equal(verifyListEditToken(after!, body.editToken!), true);

  if (fs.existsSync(file)) fs.unlinkSync(file);
});

test('publicApiAuth returns 503 in production when PUBLIC_API_KEY unset', () => {
  const prevKey = process.env.PUBLIC_API_KEY;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.PUBLIC_API_KEY;
  process.env.NODE_ENV = 'production';

  let status = 0;
  let body: { error?: string } = {};
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: { error?: string }) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  let nextCalled = false;
  publicApiAuth({ header() { return undefined; } } as unknown as Request, res, () => {
    nextCalled = true;
  });
  assert.equal(status, 503);
  assert.match(body.error || '', /not configured/i);
  assert.equal(nextCalled, false);

  if (prevKey === undefined) delete process.env.PUBLIC_API_KEY;
  else process.env.PUBLIC_API_KEY = prevKey;
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});
