'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const submit = require('../src/handlers/submitEvent');
const stats = require('../src/handlers/getStats');
const getEvent = require('../src/handlers/getEvent');
const { createMemoryStore } = require('./helpers/memoryStore');

const CONFIG = { tableName: 'test', retentionHours: 24, retentionSeconds: 86400 };

// Builds the event object API Gateway (HTTP API, payload v2) would pass to Lambda.
const post = (body, extra = {}) => ({
  requestContext: { requestId: 'req-123' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
  isBase64Encoded: false,
  ...extra,
});
const parse = (res) => JSON.parse(res.body);

// Silence the JSON log lines while testing.
const realLog = console.log;
const realWarn = console.warn;
const realError = console.error;
test.before(() => {
  console.log = console.warn = console.error = () => {};
});
test.after(() => {
  console.log = realLog;
  console.warn = realWarn;
  console.error = realError;
});

test('POST /events: new event -> 201 with the frontend-friendly fields', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const res = await handler(post({ eventId: 'evt-00001', type: 'payment', payload: '$29.99' }));
  const body = parse(res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.headers['Content-Type'], 'application/json');
  assert.equal(body.ok, true);
  assert.equal(body.decision, 'Processed');
  assert.equal(body.status, 'Processed');
  assert.equal(body.duplicate, false);
  assert.equal(body.requestId, 'req-123');
  assert.ok(body.firstSeenAt && body.processedAt && body.expiresAt);
});

test('POST /events: same ID again -> 200 duplicate', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  await handler(post({ eventId: 'evt-00001', type: 'payment' }));
  const res = await handler(post({ eventId: 'evt-00001', type: 'payment' }));
  const body = parse(res);
  assert.equal(res.statusCode, 200);
  assert.equal(body.decision, 'Duplicate Suppressed');
  assert.equal(body.status, 'Duplicate');
  assert.equal(body.duplicate, true);
  assert.equal(body.deliveryNumber, 2);
});

test('POST /events: 20 concurrent identical requests -> exactly one 201', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const responses = await Promise.all(
    Array.from({ length: 20 }, () => handler(post({ eventId: 'race', type: 'order' })))
  );
  assert.equal(responses.filter((r) => r.statusCode === 201).length, 1);
  assert.equal(responses.filter((r) => r.statusCode === 200).length, 19);
});

test('POST /events: base64 encoded body is understood', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const encoded = Buffer.from(JSON.stringify({ eventId: 'b64', type: 'order' })).toString('base64');
  const res = await handler(post(encoded, { isBase64Encoded: true }));
  assert.equal(res.statusCode, 201);
});

test('POST /events: bad JSON -> 400 INVALID_JSON', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const res = await handler(post('{not json'));
  assert.equal(res.statusCode, 400);
  assert.equal(parse(res).error.code, 'INVALID_JSON');
});

test('POST /events: missing body -> 400', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const res = await handler({ requestContext: { requestId: 'r' } });
  assert.equal(res.statusCode, 400);
});

test('POST /events: validation problems -> 400 with details', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const res = await handler(post({ eventId: 'bad id!', type: 'banana' }));
  const body = parse(res);
  assert.equal(res.statusCode, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.equal(body.error.details.length, 2);
});

test('POST /events: oversized body -> 413', async () => {
  const handler = submit.createHandler({ store: createMemoryStore(), config: CONFIG });
  const res = await handler(post({ eventId: 'big', type: 'order', payload: 'x'.repeat(9000) }));
  assert.equal(res.statusCode, 413);
});

test('POST /events: database failure -> 500 with a safe message (no internals leaked)', async () => {
  const store = createMemoryStore();
  store.putEventIfNew = async () => {
    throw new Error('secret table detail');
  };
  const handler = submit.createHandler({ store, config: CONFIG });
  const res = await handler(post({ eventId: 'x', type: 'order' }));
  const body = parse(res);
  assert.equal(res.statusCode, 500);
  assert.equal(body.error.code, 'INTERNAL_ERROR');
  assert.ok(!res.body.includes('secret table detail'));
});

test('GET /stats: returns counters', async () => {
  const store = createMemoryStore();
  const submitHandler = submit.createHandler({ store, config: CONFIG });
  await submitHandler(post({ eventId: 'a', type: 'order' }));
  await submitHandler(post({ eventId: 'a', type: 'order' }));
  await submitHandler(post({ eventId: 'bad id', type: 'order' }));

  const res = await stats.createHandler({ store, config: CONFIG })({ requestContext: { requestId: 'r' } });
  const body = parse(res);
  assert.equal(res.statusCode, 200);
  assert.equal(body.stats.totalDeliveryAttempts, 2);
  assert.equal(body.stats.uniqueLogicalEvents, 1);
  assert.equal(body.stats.duplicatesSuppressed, 1);
  assert.equal(body.stats.invalidRequests, 1);
});

test('GET /events/{eventId}: 200 for known, 404 for unknown, 400 for invalid', async () => {
  const store = createMemoryStore();
  await submit.createHandler({ store, config: CONFIG })(post({ eventId: 'known-1', type: 'inventory' }));
  const handler = getEvent.createHandler({ store, config: CONFIG });

  const ok = await handler({ pathParameters: { eventId: 'known-1' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(parse(ok).event.type, 'inventory');

  const missing = await handler({ pathParameters: { eventId: 'unknown-1' } });
  assert.equal(missing.statusCode, 404);
  assert.equal(parse(missing).error.code, 'NOT_FOUND');

  const invalid = await handler({ pathParameters: { eventId: 'bad id' } });
  assert.equal(invalid.statusCode, 400);
});
