'use strict';

// Event types accepted by the API. They match the EventType list in the frontend (src/sim/types.ts).
const ALLOWED_EVENT_TYPES = ['payment', 'order', 'inventory', 'notification', 'transfer'];

// Limits used by validation.
const LIMITS = {
  eventIdMaxLength: 128,
  payloadMaxLength: 1024,
  bodyMaxBytes: 8192,
};

// Reads settings from environment variables (set in template.yaml).
function getConfig(env = process.env) {
  const hours = Number(env.RETENTION_HOURS);
  const retentionHours = Number.isFinite(hours) && hours > 0 ? hours : 24;
  return {
    tableName: env.TABLE_NAME,
    retentionHours,
    retentionSeconds: Math.round(retentionHours * 3600),
  };
}

module.exports = { ALLOWED_EVENT_TYPES, LIMITS, getConfig };
