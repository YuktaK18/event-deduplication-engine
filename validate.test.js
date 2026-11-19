'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSubmission, checkEventId } = require('../src/lib/validate');

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

test('accepts a normal event', () => {
  const result = validateSubmission({ eventId: 'evt-00001', type: 'payment', payload: '$29.99' }, NOW);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { eventId: 'evt-00001', type: 'payment', payload: '$29.99', eventTimestamp: null });
});

test('payload and timestamp are optional', () => {
  const result = validateSubmission({ eventId: 'a1', type: 'order' }, NOW);
  assert.equal(result.valid, true);
  assert.equal(result.value.payload, '');
});

test('rejects a missing event ID', () => {
  const result = validateSubmission({ type: 'payment' }, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, 'eventId');
});

test('rejects event IDs with bad characters, spaces or wrong length', () => {
  assert.ok(checkEventId('has space'));
  assert.ok(checkEventId('slash/not/allowed'));
  assert.ok(checkEventId('-starts-with-dash'));
  assert.ok(checkEventId(''));
  assert.ok(checkEventId(12345));
  assert.ok(checkEventId('x'.repeat(129)));
  assert.equal(checkEventId('x'.repeat(128)), null);
  assert.equal(checkEventId('order:2026-11-11_42.v1'), null);
});

test('rejects an unknown event type', () => {
  const result = validateSubmission({ eventId: 'a1', type: 'banana' }, NOW);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].field, 'type');
});

test('rejects a payload that is too long or not a string', () => {
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', payload: 'x'.repeat(1025) }, NOW).valid, false);
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', payload: { a: 1 } }, NOW).valid, false);
});

test('timestamp: accepts ISO and epoch milliseconds, rejects nonsense', () => {
  const iso = validateSubmission({ eventId: 'a1', type: 'order', timestamp: '2026-11-11T10:00:00Z' }, NOW);
  assert.equal(iso.value.eventTimestamp, '2026-11-11T10:00:00.000Z');
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', timestamp: NOW - 1000 }, NOW).valid, true);
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', timestamp: 'not a date' }, NOW).valid, false);
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', timestamp: '1990-01-01' }, NOW).valid, false);
  assert.equal(validateSubmission({ eventId: 'a1', type: 'order', timestamp: NOW + 3 * 86400000 }, NOW).valid, false);
});

test('rejects bodies that are not JSON objects', () => {
  assert.equal(validateSubmission(null, NOW).valid, false);
  assert.equal(validateSubmission([], NOW).valid, false);
  assert.equal(validateSubmission('text', NOW).valid, false);
});

test('reports every problem at once', () => {
  const result = validateSubmission({ eventId: '', type: 'nope', payload: 5 }, NOW);
  assert.equal(result.errors.length, 3);
});
