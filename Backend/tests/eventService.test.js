'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { processEvent, processBurst, getStatsSummary, lookupEvent } = require('../src/lib/eventService');
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

test('late event within allowed lateness is processed and marked isLate', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 30); // 30 seconds later
  const eventTimestamp = new Date(Date.UTC(2026, 10, 11, 12, 0, 0)).toISOString();
  const options = { retentionSeconds: 60, now: () => clock };

  const res = await processEvent(
    store,
    { eventId: 'late-001', type: 'payment', payload: '$50', eventTimestamp, allowedLatenessSeconds: 60 },
    options
  );

  assert.equal(res.status, 'Processed');
  assert.equal(res.decision, 'Processed');
  assert.equal(res.isLate, true);
  assert.equal(res.latenessSeconds, 30);
  assert.equal(res.duplicate, false);
});

test('late event exceeding allowed lateness is rejected by watermark policy', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 2, 0); // 120 seconds later
  const eventTimestamp = new Date(Date.UTC(2026, 10, 11, 12, 0, 0)).toISOString();
  const options = { retentionSeconds: 60, now: () => clock };

  const res = await processEvent(
    store,
    { eventId: 'late-too-old', type: 'payment', payload: '$50', eventTimestamp, allowedLatenessSeconds: 30 },
    options
  );

  assert.equal(res.status, 'Late Rejected');
  assert.equal(res.decision, 'Late Rejected');
  assert.equal(res.businessEffectApplied, false);
  assert.equal(res.isLateRejected, true);
});

test('late duplicate event is correctly suppressed by dedup engine', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 10);
  const eventTimestamp = new Date(Date.UTC(2026, 10, 11, 12, 0, 0)).toISOString();
  const options = { retentionSeconds: 60, now: () => clock };

  const res1 = await processEvent(
    store,
    { eventId: 'late-dup-1', type: 'payment', payload: '$50', eventTimestamp, allowedLatenessSeconds: 60 },
    options
  );
  assert.equal(res1.decision, 'Processed');

  clock += 15000; // 15s later redelivery
  const res2 = await processEvent(
    store,
    { eventId: 'late-dup-1', type: 'payment', payload: '$50', eventTimestamp, allowedLatenessSeconds: 60 },
    options
  );
  assert.equal(res2.decision, 'Duplicate Suppressed');
  assert.equal(res2.duplicate, true);
  assert.equal(res2.businessEffectApplied, false);
});

test('burst event preserves isBurst flag throughout processing', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 60, now: () => clock };

  const res = await processEvent(
    store,
    { eventId: 'burst-001', type: 'order', payload: 'SKU-A100', isBurst: true },
    options
  );

  assert.equal(res.decision, 'Processed');
  assert.equal(res.isBurst, true);
});

test('LATE DUPLICATE: duplicate arriving after watermark policy threshold is suppressed as DUPLICATE, NOT late rejected', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 3600, now: () => clock };
  const eventTimestamp = new Date(Date.UTC(2026, 10, 11, 12, 0, 0)).toISOString();

  // Initial delivery at T=0
  const first = await processEvent(
    store,
    { eventId: 'late-dup-race', type: 'payment', payload: '$100', eventTimestamp, allowedLatenessSeconds: 10 },
    options
  );
  assert.equal(first.decision, 'Processed');
  assert.equal(first.businessEffectApplied, true);

  // Time advances by 300 seconds (far past allowed lateness of 10s and watermark)
  clock += 300 * 1000;

  // Redelivery of the SAME event ID
  const redelivery = await processEvent(
    store,
    { eventId: 'late-dup-race', type: 'payment', payload: '$100', eventTimestamp, allowedLatenessSeconds: 10 },
    options
  );

  // CRITICAL CHECK: must be identified as Duplicate Suppressed, NOT Late Rejected
  assert.equal(redelivery.decision, 'Duplicate Suppressed');
  assert.equal(redelivery.status, 'Duplicate');
  assert.equal(redelivery.duplicate, true);
  assert.equal(redelivery.businessEffectApplied, false);
  assert.equal(redelivery.deliveryNumber, 2);
  assert.equal(redelivery.isLate, true);
});

test('WATERMARK ADVANCEMENT: observing newer event advances watermark and rejects subsequent older events', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 3600, now: () => clock };

  // First event at 12:05:00
  const t1 = new Date(Date.UTC(2026, 10, 11, 12, 5, 0)).toISOString();
  const res1 = await processEvent(
    store,
    { eventId: 'stream-1', type: 'order', payload: 'item-1', eventTimestamp: t1, allowedLatenessSeconds: 30 },
    options
  );
  assert.equal(res1.decision, 'Processed');

  // Verify watermark advanced: maxEventTime is 12:05:00, watermark is 12:04:30
  const stats = await store.getStats();
  assert.equal(stats.maxEventTimeMs, Date.parse(t1));

  // Second event at 12:04:45 (lateness within 30s watermark window: 12:04:45 >= 12:04:30) -> ACCEPTED
  const t2 = new Date(Date.UTC(2026, 10, 11, 12, 4, 45)).toISOString();
  const res2 = await processEvent(
    store,
    { eventId: 'stream-2', type: 'order', payload: 'item-2', eventTimestamp: t2, allowedLatenessSeconds: 30 },
    options
  );
  assert.equal(res2.decision, 'Processed');

  // Third event at 12:02:00 (eventTime 12:02:00 < watermark 12:04:30) -> REJECTED by watermark policy
  const t3 = new Date(Date.UTC(2026, 10, 11, 12, 2, 0)).toISOString();
  const res3 = await processEvent(
    store,
    { eventId: 'stream-3', type: 'order', payload: 'item-3', eventTimestamp: t3, allowedLatenessSeconds: 30 },
    options
  );
  assert.equal(res3.decision, 'Late Rejected');
  assert.equal(res3.businessEffectApplied, false);
});

test('BURST STREAM: processBurst processes all unique events and computes throughput', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 3600, now: () => clock };

  const burstItems = [
    { eventId: 'burst-u1', type: 'payment', payload: '$10' },
    { eventId: 'burst-u2', type: 'order', payload: 'book' },
    { eventId: 'burst-u3', type: 'transfer', payload: '$50' },
    { eventId: 'burst-u4', type: 'notification', payload: 'alert' },
  ];

  const burstResult = await processBurst(store, { burstId: 'b-test-1', events: burstItems }, options);

  assert.equal(burstResult.ok, true);
  assert.equal(burstResult.receivedEvents, 4);
  assert.equal(burstResult.processedEvents, 4);
  assert.equal(burstResult.duplicatesSuppressed, 0);
  assert.equal(burstResult.failedEvents, 0);
  assert.ok(burstResult.throughputEventsPerSec > 0);
  assert.ok(burstResult.results.every((r) => r.decision === 'Processed' && r.businessEffectApplied === true));
});

test('BURST STREAM: duplicate IDs within the same burst are suppressed with exactly-once effect', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 3600, now: () => clock };

  // Batch contains duplicate ID 'dup-id' repeated 3 times
  const burstWithDups = [
    { eventId: 'dup-id', type: 'payment', payload: '$100' },
    { eventId: 'other-1', type: 'order', payload: 'shoes' },
    { eventId: 'dup-id', type: 'payment', payload: '$100' },
    { eventId: 'other-2', type: 'order', payload: 'hat' },
    { eventId: 'dup-id', type: 'payment', payload: '$100' },
  ];

  const burstResult = await processBurst(store, { burstId: 'b-dup-batch', events: burstWithDups }, options);

  assert.equal(burstResult.receivedEvents, 5);
  assert.equal(burstResult.processedEvents, 3); // dup-id once, other-1 once, other-2 once
  assert.equal(burstResult.duplicatesSuppressed, 2); // 2 repeats of dup-id suppressed
  assert.equal(burstResult.failedEvents, 0);

  // Check individual decisions in results
  assert.equal(burstResult.results[0].decision, 'Processed');
  assert.equal(burstResult.results[0].businessEffectApplied, true);
  assert.equal(burstResult.results[2].decision, 'Duplicate Suppressed');
  assert.equal(burstResult.results[2].businessEffectApplied, false);
  assert.equal(burstResult.results[4].decision, 'Duplicate Suppressed');
  assert.equal(burstResult.results[4].businessEffectApplied, false);
});

test('BURST STREAM: concurrent bursts safely de-duplicate overlapping IDs across batches', async () => {
  const store = createMemoryStore();
  let clock = Date.UTC(2026, 10, 11, 12, 0, 0);
  const options = { retentionSeconds: 3600, now: () => clock };

  const batchA = [
    { eventId: 'shared-1', type: 'payment', payload: '$10' },
    { eventId: 'batch-a-only', type: 'order', payload: 'item-a' },
  ];

  const batchB = [
    { eventId: 'shared-1', type: 'payment', payload: '$10' },
    { eventId: 'batch-b-only', type: 'transfer', payload: 'item-b' },
  ];

  const [resA, resB] = await Promise.all([
    processBurst(store, { burstId: 'burst-A', events: batchA }, options),
    processBurst(store, { burstId: 'burst-B', events: batchB }, options),
  ]);

  const totalProcessed = resA.processedEvents + resB.processedEvents;
  const totalDuplicates = resA.duplicatesSuppressed + resB.duplicatesSuppressed;

  // Across both batches: shared-1, batch-a-only, batch-b-only -> exactly 3 unique processed, 1 duplicate suppressed
  assert.equal(totalProcessed, 3);
  assert.equal(totalDuplicates, 1);
});
