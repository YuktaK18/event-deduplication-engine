'use strict';

// Every log line is one JSON object. CloudWatch Logs Insights can then search by field,
// e.g.  filter level = "ERROR"   or   filter eventId = "evt-00001".

function write(method, level, message, fields) {
  console[method](JSON.stringify({ level, message, ...fields }));
}

const logger = {
  info: (message, fields = {}) => write('log', 'INFO', message, fields),
  warn: (message, fields = {}) => write('warn', 'WARN', message, fields),
  error: (message, fields = {}) => write('error', 'ERROR', message, fields),
};

// Turns an Error into plain fields that are safe to log.
function errorFields(err) {
  return {
    errorName: err && err.name,
    errorMessage: err && err.message,
    stack: err && err.stack,
  };
}

// Publishes a custom CloudWatch metric by printing a log line in "Embedded Metric Format".
// CloudWatch turns it into a metric automatically - no extra AWS calls needed.
function emitMetric(name, value = 1) {
  console.log(
    JSON.stringify({
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'ExactlyOnce',
            Dimensions: [[]],
            Metrics: [{ Name: name, Unit: 'Count' }],
          },
        ],
      },
      [name]: value,
    })
  );
}

module.exports = { logger, errorFields, emitMetric };
