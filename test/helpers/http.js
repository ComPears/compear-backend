const assert = require('node:assert/strict');

function request({ query = {}, params = {}, headers = {}, body, file, ip = '127.0.0.1' } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    query,
    params,
    body,
    file,
    ip,
    header(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };
}

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    sent: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      this.sent = true;
      return this;
    },
    send(value) {
      this.body = value;
      this.sent = true;
      return this;
    },
  };
}

function assertHeader(res, name, expected) {
  assert.equal(res.headers[name.toLowerCase()], String(expected));
}

module.exports = { assertHeader, request, response };
