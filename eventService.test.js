'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { processEvent, getStatsSummary, lookupEvent } = require('../src/lib/eventService');
const { createMemoryStore, sleep } = require('./helpers/memoryStore');

const OPTIONS = { retentionSeconds: 3600 };
const evt = (eventId) => ({ eventId, type: 'payment', payload: '$10', eventTimestamp: null });

test('first delivery is processed as NEW', async () => {
  const store = createMemoryStore();
  const result = await processEvent(store, evt('evt-1'), OPTIONS);
  assert.equal(result.duplicate, false);
  assert.equal(result.decision, 'Processed');
  assert.equal(result.status, 'Processed');
  assert.equal(result.businessEffectApplied, true);
  assert.equal(result.deliveryNumber, 1);
});

test('second delivery of the same ID is a DUPLICATE and counts up', async () => {
  const store = createMemoryStore();
  await processEvent(store, evt('evt-1'), OPTIONS);
  const second = await processEvent(store, evt('evt-1'), OPTIONS);
  const third = await processEvent(store, evt('evt-1'), OPTIONS);
  assert.equal(second.duplicate, true);
  assert.equal(second.decision, 'Duplicate Suppressed');
  assert.equal(second.status, 'Duplicate');
  assert.equal(second.businessEffectApplied, false);
  assert.equal(second.deliveryNumber, 2);
  assert.equal(third.deliveryNumber, 3);
});

test('different IDs are all NEW', async () => {
  const store = createMemoryStore();
  const results = await Promise.all(['a', 'b', 'c', 'd'].map((id) => processEvent(store, evt(id), OPTIONS)));
  assert.ok(results.every((r) => r.duplicate === false));
});

test('CONCURRENCY: 50 simultaneous identical requests -> exactly one NEW', async () => {
  const store = createMemoryStore();
  const results = await Promise.all(Array.from({ length: 50 }, () => processEvent(store, evt('race-1'), OPTIONS)));
  assert.equal(results.filter((r) => !r.duplicate).length, 1);
  assert.equal(results.filter((r) => r.duplicate).length, 49);
  assert.equal(store.events.get('race-1').duplicateCount, 49);
});

test('WHY the conditional write matters: a naive "read, then write" lets duplicates through', async () => {
  const store = createMemoryStore();
  // Naive version: look first, write later. All 20 requests look before any of them writes.
  async function naive(eventId) {
    const seen = await store.getEvent(eventId);
    if (seen) return 'duplicate';
    await sleep(5);
    store.events.set(eventId, { eventId, expiresAt: Infinity, duplicateCount: 0 });
    return 'new';
  }
  const results = await Promise.all(Array.from({ length: 20 }, () => naive('naive-1')));
  assert.ok(results.filter((r) => r === 'new').length > 1, 'the naive approach processes the event more than once');
});

test('retention: an expired record is treated as new again', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 60, now: () => clock };

  assert.equal((await processEvent(store, evt('old-1'), options)).duplicate, false);
  clock += 30 * 1000; // 30 s later: still remembered
  assert.equal((await processEvent(store, evt('old-1'), options)).duplicate, true);
  clock += 120 * 1000; // 2.5 min after the first delivery: expired
  const again = await processEvent(store, evt('old-1'), options);
  assert.equal(again.duplicate, false);
  assert.equal(again.deliveryNumber, 1);
});

test('expiresAt is stored in epoch seconds, retentionSeconds after first sight', async () => {
  const store = createMemoryStore();
  const clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  await processEvent(store, evt('ttl-1'), { retentionSeconds: 7200, now: () => clock });
  assert.equal(store.events.get('ttl-1').expiresAt, Math.floor(clock / 1000) + 7200);
});

test('statistics add up', async () => {
  const store = createMemoryStore();
  await processEvent(store, evt('s1'), OPTIONS);
  await processEvent(store, evt('s1'), OPTIONS);
  await processEvent(store, evt('s2'), OPTIONS);
  await processEvent(store, evt('s1'), OPTIONS);
  const stats = await getStatsSummary(store, { retentionHours: 24 });
  assert.equal(stats.totalDeliveryAttempts, 4);
  assert.equal(stats.uniqueLogicalEvents, 2);
  assert.equal(stats.duplicatesSuppressed, 2);
  assert.equal(stats.businessEffects, 2);
  assert.equal(stats.duplicateRate, 50);
  assert.equal(stats.retentionHours, 24);
});

test('statistics are all zero before any event', async () => {
  const stats = await getStatsSummary(createMemoryStore(), { retentionHours: 24 });
  assert.equal(stats.totalDeliveryAttempts, 0);
  assert.equal(stats.averageLatency, 0);
  assert.equal(stats.duplicateRate, 0);
});

test('a failing statistics counter does not break event processing', async () => {
  const store = createMemoryStore();
  store.incrementStats = async () => {
    throw new Error('counter table hiccup');
  };
  const result = await processEvent(store, evt('x1'), OPTIONS);
  assert.equal(result.duplicate, false);
});

test('lookupEvent returns stored data, and null for unknown or expired IDs', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 60, now: () => clock };
  await processEvent(store, evt('look-1'), options);
  await processEvent(store, evt('look-1'), options);

  const found = await lookupEvent(store, 'look-1', clock);
  assert.equal(found.duplicateCount, 1);
  assert.equal(found.type, 'payment');
  assert.equal(await lookupEvent(store, 'nope', clock), null);
  assert.equal(await lookupEvent(store, 'look-1', clock + 120000), null);
});
