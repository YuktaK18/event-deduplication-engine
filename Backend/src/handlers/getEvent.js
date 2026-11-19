'use strict';

// GET /events/{eventId}  -  shows what is stored for one event ID (handy for testing).

const { getConfig } = require('../lib/config');
const { checkEventId } = require('../lib/validate');
const { lookupEvent } = require('../lib/eventService');
const { json, errorBody } = require('../lib/response');
const { logger, errorFields, emitMetric } = require('../lib/logger');

function createHandler({ store, config = getConfig(), now = Date.now } = {}) {
  let activeStore = store;
  const getStore = () => {
    if (!activeStore) activeStore = require('../lib/store').createStore(config.tableName);
    return activeStore;
  };

  return async function handler(event) {
    const requestId = (event && event.requestContext && event.requestContext.requestId) || 'local';
    try {
      let eventId = event && event.pathParameters && event.pathParameters.eventId;
      try {
        eventId = decodeURIComponent(eventId || '');
      } catch (decodeError) {
        eventId = '';
      }

      const problem = checkEventId(eventId);
      if (problem) {
        return json(400, errorBody('VALIDATION_ERROR', problem, requestId, [{ field: 'eventId', message: problem }]));
      }

      const found = await lookupEvent(getStore(), eventId, now());
      if (!found) {
        return json(404, errorBody('NOT_FOUND', `No stored event with ID ${eventId} (it may never have been sent, or it has expired)`, requestId));
      }

      logger.info('Event looked up', { requestId, eventId });
      return json(200, { ok: true, event: found, requestId });
    } catch (err) {
      logger.error('Unexpected error while looking up event', { requestId, ...errorFields(err) });
      emitMetric('InternalErrors');
      return json(500, errorBody('INTERNAL_ERROR', 'Could not look up the event. Please try again.', requestId));
    }
  };
}

module.exports = { createHandler, handler: createHandler() };
