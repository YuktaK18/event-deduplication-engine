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

// Decides whether an event is NEW or a DUPLICATE, applies Watermark Policy, and records the outcome.
//   submission = { eventId, type, payload, eventTimestamp, allowedLatenessSeconds, watermark, isBurst }
//   options    = { retentionSeconds, now } (now() returns milliseconds)
async function processEvent(store, submission, options) {
  const { retentionSeconds, now = Date.now } = options;
  const startedAt = now();
  const nowSeconds = Math.floor(startedAt / 1000);

  // Compute lateness if eventTimestamp was provided
  let latenessSeconds = 0;
  let isLate = false;
  let eventTimeMs = null;
  if (submission.eventTimestamp) {
    eventTimeMs = Date.parse(submission.eventTimestamp);
    if (!Number.isNaN(eventTimeMs)) {
      latenessSeconds = Math.max(0, Math.floor((startedAt - eventTimeMs) / 1000));
      isLate = latenessSeconds > 0;
    }
  }

  // -------------------------------------------------------------------------
  // STEP 1: Duplicate Detection FIRST
  // If this event was already processed and stored, identify it as a DUPLICATE immediately.
  // This ensures late duplicate redeliveries are recognized as duplicates, not falsely late-rejected.
  // -------------------------------------------------------------------------
  const existing = await store.getEvent(submission.eventId);
  if (existing && Number(existing.expiresAt) > nowSeconds) {
    const updated = await store.recordDuplicate(submission.eventId, toIso(startedAt), nowSeconds);
    const rec = updated || existing;
    const deliveryNumber = (Number(rec.duplicateCount) || 0) + 1;
    const processingLatency = Math.max(0, now() - startedAt);

    await safeIncrement(store, {
      totalDeliveryAttempts: 1,
      duplicatesSuppressed: 1,
      totalLatencyMs: processingLatency,
      ...(isLate ? { lateDuplicates: 1, totalLateEvents: 1 } : {}),
      ...(submission.isBurst ? { totalBurstEvents: 1 } : {}),
    });

    return {
      ok: true,
      eventId: rec.eventId,
      type: rec.type,
      status: 'Duplicate',
      decision: 'Duplicate Suppressed',
      duplicate: true,
      businessEffectApplied: false,
      deliveryNumber,
      latenessSeconds,
      isLate,
      isBurst: Boolean(submission.isBurst),
      reason: isLate
        ? `Event ${rec.eventId} (late arrival, lateness ${latenessSeconds}s) was already processed at ${rec.firstSeenAt} - duplicate suppressed (delivery #${deliveryNumber})`
        : `Event ${rec.eventId} was already processed at ${rec.firstSeenAt} - duplicate suppressed (delivery #${deliveryNumber})`,
      firstSeenAt: rec.firstSeenAt,
      processedAt: toIso(now()),
      expiresAt: toIso(Number(rec.expiresAt) * 1000),
      processingLatency,
    };
  }

  // -------------------------------------------------------------------------
  // STEP 2: Watermark & Allowed Lateness Policy for NEW events
  // Watermark = Maximum Event Time Observed - Allowed Lateness.
  // If an event's eventTime is strictly older than the watermark, reject it.
  // -------------------------------------------------------------------------
  let isRejectedByWatermark = false;
  let watermarkMs = 0;

  if (
    eventTimeMs !== null &&
    !Number.isNaN(eventTimeMs) &&
    submission.allowedLatenessSeconds !== null &&
    submission.allowedLatenessSeconds !== undefined
  ) {
    const currentStats = await store.getStats();
    const maxObserved = (currentStats && Number(currentStats.maxEventTimeMs)) || 0;
    const clientWatermark = typeof submission.watermark === 'number'
      ? submission.watermark
      : (submission.watermark ? Date.parse(submission.watermark) : 0);
    const effectiveMax = Math.max(maxObserved, clientWatermark, startedAt);

    if (effectiveMax > 0) {
      watermarkMs = effectiveMax - submission.allowedLatenessSeconds * 1000;
      if (eventTimeMs < watermarkMs) {
        isRejectedByWatermark = true;
      }
    }
  }

  if (isRejectedByWatermark) {
    const processingLatency = Math.max(0, now() - startedAt);
    await safeIncrement(store, {
      totalDeliveryAttempts: 1,
      totalLateEvents: 1,
      rejectedLateEvents: 1,
      totalLatencyMs: processingLatency,
      ...(submission.isBurst ? { totalBurstEvents: 1 } : {}),
    });

    return {
      ok: true,
      eventId: submission.eventId,
      type: submission.type,
      status: 'Late Rejected',
      decision: 'Late Rejected',
      duplicate: false,
      businessEffectApplied: false,
      deliveryNumber: 1,
      latenessSeconds,
      isLate: true,
      isLateRejected: true,
      watermark: toIso(watermarkMs),
      isBurst: Boolean(submission.isBurst),
      reason: `Late event ${submission.eventId} (eventTime: ${submission.eventTimestamp}) arrived past watermark ${toIso(watermarkMs)} (allowed lateness: ${submission.allowedLatenessSeconds}s) — rejected by watermark policy`,
      firstSeenAt: toIso(startedAt),
      processedAt: toIso(now()),
      expiresAt: toIso((Math.floor(startedAt / 1000) + retentionSeconds) * 1000),
      processingLatency,
    };
  }

  // -------------------------------------------------------------------------
  // STEP 3: Atomic conditional write (putEventIfNew)
  // Ensures concurrency safety: if multiple identical requests race at the same instant,
  // exactly one gets through and the rest are caught by ConditionExpression.
  // -------------------------------------------------------------------------
  let outcome = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !outcome; attempt++) {
    const nowMs = now();
    const sec = Math.floor(nowMs / 1000);
    const record = {
      eventId: submission.eventId,
      type: submission.type,
      payload: submission.payload,
      eventTimestamp: submission.eventTimestamp,
      firstSeenAt: toIso(nowMs),
      duplicateCount: 0,
      expiresAt: sec + retentionSeconds,
    };

    const created = await store.putEventIfNew(record, sec);
    if (created) {
      outcome = { duplicate: false, record };
      break;
    }

    const concurrentExisting = await store.recordDuplicate(submission.eventId, toIso(nowMs), sec);
    if (concurrentExisting) outcome = { duplicate: true, record: concurrentExisting };
  }

  if (!outcome) {
    throw new Error(`Could not settle the state of event ${submission.eventId} after ${MAX_ATTEMPTS} attempts`);
  }

  const processingLatency = Math.max(0, now() - startedAt);
  const processedAt = toIso(now());

  if (!outcome.duplicate) {
    // If this event has a newer timestamp, advance the observed watermark max
    if (eventTimeMs !== null && !Number.isNaN(eventTimeMs) && typeof store.updateMaxEventTime === 'function') {
      try {
        await store.updateMaxEventTime(eventTimeMs);
      } catch (err) {
        // Safe: non-blocking
      }
    }

    await safeIncrement(store, {
      totalDeliveryAttempts: 1,
      uniqueLogicalEvents: 1,
      totalLatencyMs: processingLatency,
      ...(isLate ? { totalLateEvents: 1, acceptedLateEvents: 1 } : {}),
      ...(submission.isBurst ? { totalBurstEvents: 1 } : {}),
    });

    return {
      ok: true,
      eventId: outcome.record.eventId,
      type: outcome.record.type,
      status: 'Processed',
      decision: 'Processed',
      duplicate: false,
      businessEffectApplied: true,
      deliveryNumber: 1,
      latenessSeconds,
      isLate,
      isBurst: Boolean(submission.isBurst),
      reason: isLate
        ? `Late event ${outcome.record.eventId} (lateness ${latenessSeconds}s) within watermark policy accepted and recorded in DynamoDB - business effect applied once`
        : `New event ${outcome.record.eventId} recorded in DynamoDB - business effect applied once`,
      firstSeenAt: outcome.record.firstSeenAt,
      processedAt,
      expiresAt: toIso(outcome.record.expiresAt * 1000),
      processingLatency,
    };
  }

  const deliveryNumber = (Number(outcome.record.duplicateCount) || 0) + 1;
  await safeIncrement(store, {
    totalDeliveryAttempts: 1,
    duplicatesSuppressed: 1,
    totalLatencyMs: processingLatency,
    ...(isLate ? { lateDuplicates: 1, totalLateEvents: 1 } : {}),
    ...(submission.isBurst ? { totalBurstEvents: 1 } : {}),
  });

  return {
    ok: true,
    eventId: outcome.record.eventId,
    type: outcome.record.type,
    status: 'Duplicate',
    decision: 'Duplicate Suppressed',
    duplicate: true,
    businessEffectApplied: false,
    deliveryNumber,
    latenessSeconds,
    isLate,
    isBurst: Boolean(submission.isBurst),
    reason: isLate
      ? `Event ${outcome.record.eventId} (late arrival, lateness ${latenessSeconds}s) was already processed at ${outcome.record.firstSeenAt} - duplicate suppressed (delivery #${deliveryNumber})`
      : `Event ${outcome.record.eventId} was already processed at ${outcome.record.firstSeenAt} - duplicate suppressed (delivery #${deliveryNumber})`,
    firstSeenAt: outcome.record.firstSeenAt,
    processedAt,
    expiresAt: toIso(outcome.record.expiresAt * 1000),
    processingLatency,
  };
}

// Processes a burst/batch of events, calculating actual throughput, latency, duplicates suppressed,
// and preserving exactly-once semantics per eventId across the entire batch.
async function processBurst(store, burstSubmission, options) {
  const { now = Date.now } = options;
  const startedAt = now();
  const burstId = burstSubmission.burstId || `burst-${startedAt}`;
  const rawEvents = Array.isArray(burstSubmission) ? burstSubmission : burstSubmission.events;

  const results = [];
  let processedCount = 0;
  let duplicatesCount = 0;
  let lateRejectedCount = 0;
  let failedCount = 0;
  let totalLatency = 0;

  for (const item of rawEvents) {
    try {
      const eventSubmission = { ...item, isBurst: true };
      const res = await processEvent(store, eventSubmission, options);
      results.push(res);
      totalLatency += res.processingLatency || 0;
      if (res.decision === 'Processed') processedCount++;
      else if (res.decision === 'Duplicate Suppressed') duplicatesCount++;
      else if (res.decision === 'Late Rejected') lateRejectedCount++;
      else failedCount++;
    } catch (err) {
      failedCount++;
      results.push({
        ok: false,
        eventId: item.eventId,
        type: item.type,
        status: 'Failed',
        decision: 'Failed',
        reason: err.message,
        isBurst: true,
      });
    }
  }

  const elapsedMs = Math.max(1, now() - startedAt);
  const throughput = Math.round((results.length / (elapsedMs / 1000)) * 10) / 10;
  const avgLatency = results.length > 0 ? Math.round((totalLatency / results.length) * 10) / 10 : 0;

  return {
    ok: true,
    burstId,
    receivedEvents: results.length,
    processedEvents: processedCount,
    duplicatesSuppressed: duplicatesCount,
    lateRejected: lateRejectedCount,
    failedEvents: failedCount,
    totalLatencyMs: totalLatency,
    averageLatencyMs: avgLatency,
    throughputEventsPerSec: throughput,
    elapsedMs,
    results,
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
    totalLateEvents: Number(raw.totalLateEvents) || 0,
    acceptedLateEvents: Number(raw.acceptedLateEvents) || 0,
    rejectedLateEvents: Number(raw.rejectedLateEvents) || 0,
    lateDuplicates: Number(raw.lateDuplicates) || 0,
    totalBurstEvents: Number(raw.totalBurstEvents) || 0,
    maxEventTimeMs: Number(raw.maxEventTimeMs) || 0,
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

module.exports = { processEvent, processBurst, getStatsSummary, lookupEvent, safeIncrement };
