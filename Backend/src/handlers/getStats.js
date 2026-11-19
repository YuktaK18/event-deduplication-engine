'use strict';

// GET /stats  -  returns the de-duplication counters.

const { getConfig } = require('../lib/config');
const { getStatsSummary } = require('../lib/eventService');
const { json, errorBody } = require('../lib/response');
const { logger, errorFields, emitMetric } = require('../lib/logger');

function createHandler({ store, config = getConfig() } = {}) {
  let activeStore = store;
  const getStore = () => {
    if (!activeStore) activeStore = require('../lib/store').createStore(config.tableName);
    return activeStore;
  };

  return async function handler(event) {
    const requestId = (event && event.requestContext && event.requestContext.requestId) || 'local';
    try {
      const stats = await getStatsSummary(getStore(), config);
      logger.info('Statistics requested', { requestId });
      return json(200, { ok: true, stats, generatedAt: new Date().toISOString(), requestId });
    } catch (err) {
      logger.error('Unexpected error while reading statistics', { requestId, ...errorFields(err) });
      emitMetric('InternalErrors');
      return json(500, errorBody('INTERNAL_ERROR', 'Could not read statistics. Please try again.', requestId));
    }
  };
}

module.exports = { createHandler, handler: createHandler() };
