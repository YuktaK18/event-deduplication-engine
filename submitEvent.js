'use strict';

// POST /events  -  receives one event delivery and answers "new" or "duplicate".

const { getConfig, LIMITS } = require('../lib/config');
const { validateSubmission } = require('../lib/validate');
const { processEvent, safeIncrement } = require('../lib/eventService');
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

      // 2. Validate (event ID, type, payload, timestamp)
      const check = validateSubmission(body, now());
      if (!check.valid) {
        logger.warn('Rejected request: validation failed', { requestId, errors: check.errors });
        emitMetric('InvalidRequests');
        await safeIncrement(getStore(), { invalidRequests: 1 });
        return json(400, errorBody('VALIDATION_ERROR', 'The event is not valid', requestId, check.errors));
      }

      // 3. New or duplicate?
      const result = await processEvent(getStore(), check.value, {
        retentionSeconds: config.retentionSeconds,
        now,
      });

      logger.info(result.duplicate ? 'Duplicate event suppressed' : 'New event processed', {
        requestId,
        eventId: result.eventId,
        type: result.type,
        decision: result.decision,
        deliveryNumber: result.deliveryNumber,
        processingLatency: result.processingLatency,
      });
      emitMetric(result.duplicate ? 'DuplicateEvents' : 'NewEvents');

      // 201 Created = new event, 200 OK = duplicate (the request itself succeeded).
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
