const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const express = require('express');
const { receiptsRouter } = require('../dist/routes/receipts');
const { errorHandler } = require('../dist/middleware/errorHandler');
const { createReceiptUploadGuard } = require('../dist/middleware/receiptUploadGuard');
const { issueReceiptCredentials } = require('../dist/utils/receiptAuth');
const { response } = require('./helpers/http');

test('upload slots reject excess work and release exactly once on finish/close', () => {
  const guard = createReceiptUploadGuard(1);
  const first = Object.assign(new EventEmitter(), response(), { locals: {} });
  let admitted = 0;
  guard({}, first, () => admitted++);
  const rejected = response();
  guard({}, rejected, () => admitted++);
  assert.equal(admitted, 1);
  assert.equal(rejected.statusCode, 503);
  assert.equal(rejected.headers['retry-after'], '5');
  first.emit('close');
  first.emit('finish');
  const second = Object.assign(new EventEmitter(), response(), { locals: {} });
  guard({}, second, () => admitted++);
  guard({}, response(), () => admitted++);
  assert.equal(admitted, 2);
  second.locals.receiptUploadSlot.processing = true;
  second.emit('close');
  guard({}, response(), () => admitted++);
  assert.equal(admitted, 2); // disconnected, but its processing is still active
  second.locals.receiptUploadSlot.release();
  second.emit('finish');
  guard({}, Object.assign(new EventEmitter(), response(), { locals: {} }), () => admitted++);
  assert.equal(admitted, 3);
});

test('real receipt router authenticates before parsing and bounds multipart metadata', async (t) => {
  const app = express();
  app.use('/receipts', receiptsRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/receipts/parse`;
  const credentials = issueReceiptCredentials();
  const headers = { 'x-compear-user-id': credentials.userId, 'x-compear-user-token': credentials.token };

  // Invalid multipart would throw before authentication with the old ordering.
  for (const auth of [{}, { ...headers, 'x-compear-user-token': '0'.repeat(64) }]) {
    const denied = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'multipart/form-data' }, body: 'invalid multipart' });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('cache-control'), 'private, no-store');
  }
  const tooManyFields = new FormData();
  for (let i = 0; i < 5; i++) tooManyFields.append(`field${i}`, 'small');
  assert.equal((await fetch(url, { method: 'POST', headers, body: tooManyFields })).status, 400);
  const hugeField = new FormData();
  hugeField.append('metadata', 'x'.repeat(4097));
  assert.equal((await fetch(url, { method: 'POST', headers, body: hugeField })).status, 400);
  const hugeFile = new FormData();
  hugeFile.append('receipt', new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]), 'receipt.png');
  assert.equal((await fetch(url, { method: 'POST', headers, body: hugeFile })).status, 413);
  // A valid session reaches image validation (no AI or paid API is called).
  const ordinary = new FormData();
  ordinary.append('receipt', new Blob(['not an image']), 'receipt.png');
  const validated = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${credentials.userId}:${credentials.token}` }, body: ordinary });
  assert.equal(validated.status, 400);
  assert.match((await validated.json()).error, /Unsupported image/);
  const history = await fetch(url.replace('/parse', ''), { headers });
  assert.equal(history.status, 200);
  assert.equal(history.headers.get('cache-control'), 'private, no-store');
});
