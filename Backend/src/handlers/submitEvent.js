'use strict';

// POST /events and POST /events/burst
// Receives event delivery (single or burst stream) and answers "new", "duplicate", or "late rejected".

const { getConfig, LIMITS } = require('../lib/config');
const { validateSubmission, validateBurstSubmission } = require('../lib/validate');
const { processEvent, processBurst, safeIncrement } = require('../lib/eventService');
const { json, errorBody } = require('../lib/response');
const { logger, errorFields, emitMetric } = require('../lib/logger');

// "Factory" so tests can plug in a fake store. In AWS the real DynamoDB store is created on first use.
function createHandler({ store, config = getConfig(), now = Date.now } = {}) {
  let activeStore = store;
  const getStore = () => {
    if (!activeStore) activeStore = require('../lib/store').createStore(config.tableName);
    return activeStore;
  };

  return async function handler(event) {
    const requestId = (event && event.requestContext && event.requestContext.requestId) || 'local';

    try {
      // 1. Read the body
      let raw = event && event.body;
      if (raw && event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
      if (!raw) {
        return json(400, errorBody('INVALID_JSON', 'Request body is required', requestId));
      }
      if (Buffer.byteLength(raw, 'utf8') > LIMITS.bodyMaxBytes) {
        return json(413, errorBody('PAYLOAD_TOO_LARGE', `Request body must be under ${LIMITS.bodyMaxBytes} bytes`, requestId));
      }

      let body;
      try {
        body = JSON.parse(raw);
      } catch (parseError) {
        logger.warn('Rejected request: body is not valid JSON', { requestId });
        emitMetric('InvalidRequests');
        await safeIncrement(getStore(), { invalidRequests: 1 });
        return json(400, errorBody('INVALID_JSON', 'Request body is not valid JSON', requestId));
      }

      // Check whether this is a burst request (array, { events: [...] }, or /events/burst path)
      const rawPath = (event && (event.rawPath || event.path)) || '';
      const isBurstRequest =
        Array.isArray(body) ||
        (body && typeof body === 'object' && Array.isArray(body.events)) ||
        rawPath.endsWith('/burst');

      if (isBurstRequest) {
        const check = validateBurstSubmission(body, now());
        if (!check.valid) {
          logger.warn('Rejected burst request: validation failed', { requestId, errors: check.errors });
          emitMetric('InvalidRequests');
          await safeIncrement(getStore(), { invalidRequests: 1 });
          return json(400, errorBody('VALIDATION_ERROR', 'The burst request is not valid', requestId, check.errors));
        }

        const result = await processBurst(getStore(), check.value, {
          retentionSeconds: config.retentionSeconds,
          now,
        });

        logger.info('Burst stream processed', {
          requestId,
          burstId: result.burstId,
          received: result.receivedEvents,
          processed: result.processedEvents,
          duplicates: result.duplicatesSuppressed,
          lateRejected: result.lateRejected,
          throughput: result.throughputEventsPerSec,
        });

        emitMetric('BurstStreams');
        return json(200, { ...result, requestId });
      }

      // 2. Single Event Validation (event ID, type, payload, timestamp, allowed lateness, burst flag)
      const check = validateSubmission(body, now());
      if (!check.valid) {
        logger.warn('Rejected request: validation failed', { requestId, errors: check.errors });
        emitMetric('InvalidRequests');
        await safeIncrement(getStore(), { invalidRequests: 1 });
        return json(400, errorBody('VALIDATION_ERROR', 'The event is not valid', requestId, check.errors));
      }

      // 3. Process event through de-duplication and lateness check
      const result = await processEvent(getStore(), check.value, {
        retentionSeconds: config.retentionSeconds,
        now,
      });

      if (result.decision === 'Late Rejected') {
        logger.warn('Late event rejected by watermark policy', {
          requestId,
          eventId: result.eventId,
          type: result.type,
          decision: result.decision,
          latenessSeconds: result.latenessSeconds,
        });
        emitMetric('LateRejectedEvents');
        return json(200, { ...result, requestId });
      }

      logger.info(result.duplicate ? 'Duplicate event suppressed' : 'New event processed', {
        requestId,
        eventId: result.eventId,
        type: result.type,
        decision: result.decision,
        deliveryNumber: result.deliveryNumber,
        processingLatency: result.processingLatency,
        isLate: result.isLate,
        isBurst: result.isBurst,
      });

      emitMetric(result.duplicate ? 'DuplicateEvents' : 'NewEvents');
      if (result.isLate) {
        emitMetric(result.duplicate ? 'LateDuplicates' : 'LateEvents');
      }
      if (result.isBurst) {
        emitMetric('BurstEvents');
      }

      // 201 Created = new event, 200 OK = duplicate or processed outcome
      return json(result.duplicate ? 200 : 201, { ...result, requestId });
    } catch (err) {
      logger.error('Unexpected error while processing event', { requestId, ...errorFields(err) });
      emitMetric('InternalErrors');
      try {
        await safeIncrement(getStore(), { failedAttempts: 1 });
      } catch (counterError) {
        // Nothing more we can do - the error above is already logged.
      }
      return json(500, errorBody('INTERNAL_ERROR', 'Something went wrong on the server. Please try again.', requestId));
    }
  };
}

module.exports = { createHandler, handler: createHandler() };
