'use strict';

// The business logic. It never imports the AWS SDK: it talks to a "store" object
// (see store.js), which makes it easy to test on your laptop with a fake store.

const { logger, errorFields } = require('./logger');

const MAX_ATTEMPTS = 3;

const toIso = (ms) => new Date(ms).toISOString();

// Updates the statistics counters but never lets a counter problem break the request.
// (The new/duplicate decision has already been saved safely by the time this runs.)
async function safeIncrement(store, delta) {
  try {
    await store.incrementStats(delta);
  } catch (err) {
    logger.error('Could not update statistics counters', { delta, ...errorFields(err) });
  }
}

// Decides whether an event is NEW or a DUPLICATE and records the outcome.
//   submission = { eventId, type, payload, eventTimestamp }   (already validated)
//   options    = { retentionSeconds, now }                    (now() returns milliseconds)
async function processEvent(store, submission, options) {
  const { retentionSeconds, now = Date.now } = options;
  const startedAt = now();
  let outcome = null;

  // Normally the loop runs once. It repeats only in the rare case that a stored event
  // expired in the tiny gap between the two database calls.
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !outcome; attempt++) {
    const nowMs = now();
    const nowSeconds = Math.floor(nowMs / 1000);
    const record = {
      eventId: submission.eventId,
      type: submission.type,
      payload: submission.payload,
      eventTimestamp: submission.eventTimestamp, // time claimed by the sender (optional)
      firstSeenAt: toIso(nowMs), // time the server first saw this ID
      duplicateCount: 0,
      expiresAt: nowSeconds + retentionSeconds, // epoch SECONDS - DynamoDB TTL requires seconds
    };

    // Step 1: try to claim the event ID with an atomic conditional write.
    const created = await store.putEventIfNew(record, nowSeconds);
    if (created) {
      outcome = { duplicate: false, record };
      break;
    }

    // Step 2: somebody already claimed it, so this is a duplicate. Count it and read the original.
    const existing = await store.recordDuplicate(submission.eventId, toIso(nowMs), nowSeconds);
    if (existing) outcome = { duplicate: true, record: existing };
  }

  if (!outcome) {
    throw new Error(`Could not settle the state of event ${submission.eventId} after ${MAX_ATTEMPTS} attempts`);
  }

  const processingLatency = Math.max(0, now() - startedAt);
  const processedAt = toIso(now());

  await safeIncrement(store, {
    totalDeliveryAttempts: 1,
    uniqueLogicalEvents: outcome.duplicate ? 0 : 1,
    duplicatesSuppressed: outcome.duplicate ? 1 : 0,
    totalLatencyMs: processingLatency,
  });

  // These field names intentionally match the frontend's DeliveryAttempt / ProcessingDecision types.
  if (!outcome.duplicate) {
    return {
      ok: true,
      eventId: outcome.record.eventId,
      type: outcome.record.type,
      status: 'Processed',
      decision: 'Processed',
      duplicate: false,
      businessEffectApplied: true,
      deliveryNumber: 1,
      reason: `New event ${outcome.record.eventId} recorded in DynamoDB - business effect applied once`,
      firstSeenAt: outcome.record.firstSeenAt,
      processedAt,
      expiresAt: toIso(outcome.record.expiresAt * 1000),
      processingLatency,
    };
  }

  const deliveryNumber = (Number(outcome.record.duplicateCount) || 0) + 1;
  return {
    ok: true,
    eventId: outcome.record.eventId,
    type: outcome.record.type,
    status: 'Duplicate',
    decision: 'Duplicate Suppressed',
    duplicate: true,
    businessEffectApplied: false,
    deliveryNumber,
    reason: `Event ${outcome.record.eventId} was already processed at ${outcome.record.firstSeenAt} - duplicate suppressed (delivery #${deliveryNumber})`,
    firstSeenAt: outcome.record.firstSeenAt,
    processedAt,
    expiresAt: toIso(outcome.record.expiresAt * 1000),
    processingLatency,
  };
}

// Builds the statistics object. Field names match the frontend's SimulationMetrics where possible.
async function getStatsSummary(store, config) {
  const raw = (await store.getStats()) || {};
  const attempts = Number(raw.totalDeliveryAttempts) || 0;
  const unique = Number(raw.uniqueLogicalEvents) || 0;
  const duplicates = Number(raw.duplicatesSuppressed) || 0;
  const latencyTotal = Number(raw.totalLatencyMs) || 0;

  return {
    totalDeliveryAttempts: attempts,
    uniqueLogicalEvents: unique,
    processedLogicalEvents: unique,
    duplicatesSuppressed: duplicates,
    businessEffects: unique, // each unique event applies its effect exactly once
    failedAttempts: Number(raw.failedAttempts) || 0,
    invalidRequests: Number(raw.invalidRequests) || 0,
    averageLatency: attempts > 0 ? Math.round((latencyTotal / attempts) * 10) / 10 : 0,
    duplicateRate: attempts > 0 ? Math.round((duplicates / attempts) * 1000) / 10 : 0,
    retentionHours: config.retentionHours,
  };
}

// Looks up one stored event. Returns null if it is unknown or already expired.
async function lookupEvent(store, eventId, nowMs = Date.now()) {
  const item = await store.getEvent(eventId);
  if (!item) return null;
  if (Number(item.expiresAt) <= Math.floor(nowMs / 1000)) return null; // expired, waiting for TTL cleanup

  return {
    eventId: item.eventId,
    type: item.type,
    payload: item.payload,
    eventTimestamp: item.eventTimestamp || null,
    firstSeenAt: item.firstSeenAt,
    duplicateCount: Number(item.duplicateCount) || 0,
    lastDuplicateAt: item.lastDuplicateAt || null,
    expiresAt: toIso(Number(item.expiresAt) * 1000),
  };
}

module.exports = { processEvent, getStatsSummary, lookupEvent, safeIncrement };
