const assert = require('node:assert/strict');
const { beforeEach, describe, it } = require('node:test');

const aiService = require('../src/ai/aiService');
const receiptImage = require('../src/utils/receiptImage');
const receiptService = require('../src/services/receiptService');
const { request, response } = require('./helpers/http');

const originals = {
  parseReceiptImageWithAI: aiService.parseReceiptImageWithAI,
  prepareReceiptImageForVision: receiptImage.prepareReceiptImageForVision,
  analyzeParsedReceipt: receiptService.analyzeParsedReceipt,
  saveReceipt: receiptService.saveReceipt,
  listReceipts: receiptService.listReceipts,
  deleteReceipt: receiptService.deleteReceipt,
};

const controllerPath = require.resolve('../src/controllers/receiptsController');
delete require.cache[controllerPath];
const {
  getReceipts,
  parseReceipt,
  removeReceipt,
} = require('../src/controllers/receiptsController');

const userId = 'test-user-123';
const parsed = {
  store: 'Test Store',
  purchaseDate: '2026-07-01',
  currency: 'EUR',
  items: [{ rawName: 'Melk', quantity: 1, unitPrice: 1.5, lineTotal: 1.5 }],
  receiptTotal: 1.5,
};
const analysis = {
  parsed,
  storeDetected: 'Test Store',
  purchaseDate: '2026-07-01',
  lines: [],
  actualTotal: 1.5,
  cheapestPossibleTotal: 1.2,
  potentialSavings: 0.3,
  shoppingPlan: null,
  unmatchedCount: 0,
};
const savedReceipt = {
  id: 'receipt-1',
  userId,
  uploadedAt: '2026-07-10T12:00:00.000Z',
  imageMimeType: 'image/jpeg',
  analysis,
};

beforeEach(() => {
  Object.assign(aiService, {
    parseReceiptImageWithAI: originals.parseReceiptImageWithAI,
  });
  Object.assign(receiptImage, {
    prepareReceiptImageForVision: originals.prepareReceiptImageForVision,
  });
  Object.assign(receiptService, {
    analyzeParsedReceipt: originals.analyzeParsedReceipt,
    saveReceipt: originals.saveReceipt,
    listReceipts: originals.listReceipts,
    deleteReceipt: originals.deleteReceipt,
  });
});

describe('receipt upload API boundary', () => {
  it('rejects missing identity and unsupported images before invoking AI', async () => {
    let aiCalls = 0;
    aiService.parseReceiptImageWithAI = async () => {
      aiCalls += 1;
      return parsed;
    };

    const missingIdentity = response();
    await parseReceipt(
      request({ file: { buffer: Buffer.from('image'), mimetype: 'image/jpeg' } }),
      missingIdentity
    );
    assert.equal(missingIdentity.statusCode, 400);
    assert.match(missingIdentity.body.error, /user-id/i);

    const unsupported = response();
    await parseReceipt(
      request({
        headers: { 'x-compear-user-id': userId },
        file: { buffer: Buffer.from('pdf'), mimetype: 'application/pdf' },
      }),
      unsupported
    );
    assert.equal(unsupported.statusCode, 400);
    assert.match(unsupported.body.error, /unsupported image/i);
    assert.equal(aiCalls, 0);
  });

  it('returns a saved receipt using deterministic vision and analysis doubles', async () => {
    const observed = {};
    receiptImage.prepareReceiptImageForVision = async (buffer, mimeType) => {
      observed.input = { buffer: buffer.toString(), mimeType };
      return { buffer: Buffer.from('prepared'), mimeType: 'image/jpeg' };
    };
    aiService.parseReceiptImageWithAI = async (base64, mimeType, context) => {
      observed.vision = { base64, mimeType, context };
      return parsed;
    };
    receiptService.analyzeParsedReceipt = async (value, context) => {
      observed.analysis = { value, context };
      return analysis;
    };
    receiptService.saveReceipt = (identity, value, mimeType) => {
      observed.save = { identity, value, mimeType };
      return savedReceipt;
    };

    const res = response();
    await parseReceipt(
      request({
        headers: { 'x-compear-user-id': userId },
        file: { buffer: Buffer.from('raw-image'), mimetype: 'image/png' },
        ip: '192.0.2.4',
      }),
      res
    );

    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.body, savedReceipt);
    assert.deepEqual(observed.input, { buffer: 'raw-image', mimeType: 'image/png' });
    assert.equal(observed.vision.base64, Buffer.from('prepared').toString('base64'));
    assert.equal(observed.vision.context.userId, userId);
    assert.equal(observed.vision.context.ip, '192.0.2.4');
    assert.equal(observed.analysis.value, parsed);
    assert.deepEqual(observed.save, {
      identity: userId,
      value: analysis,
      mimeType: 'image/jpeg',
    });
  });
});

describe('receipt history and delete API boundary', () => {
  it('scopes history to the validated user', () => {
    let observedUser;
    receiptService.listReceipts = (identity) => {
      observedUser = identity;
      return [savedReceipt];
    };
    const res = response();

    getReceipts(request({ headers: { 'x-compear-user-id': userId } }), res);

    assert.equal(observedUser, userId);
    assert.deepEqual(res.body, [savedReceipt]);
  });

  it('returns 204 on scoped deletion and 404 for an unknown receipt', () => {
    const calls = [];
    receiptService.deleteReceipt = (identity, receiptId) => {
      calls.push({ identity, receiptId });
      return receiptId === 'receipt-1';
    };

    const deleted = response();
    removeReceipt(
      request({
        headers: { 'x-compear-user-id': userId },
        params: { id: 'receipt-1' },
      }),
      deleted
    );
    assert.equal(deleted.statusCode, 204);

    const missing = response();
    removeReceipt(
      request({
        headers: { 'x-compear-user-id': userId },
        params: { id: 'missing' },
      }),
      missing
    );
    assert.equal(missing.statusCode, 404);
    assert.deepEqual(calls, [
      { identity: userId, receiptId: 'receipt-1' },
      { identity: userId, receiptId: 'missing' },
    ]);
  });
});
