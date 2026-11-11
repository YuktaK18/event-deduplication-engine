'use strict';

// Builds the object API Gateway expects from a Lambda function.
// CORS headers are added by API Gateway itself (see CorsConfiguration in template.yaml).
function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

// Standard error body used by every endpoint, so the frontend only needs one error format.
function errorBody(code, message, requestId, details) {
  const error = { code, message };
  if (details) error.details = details;
  return { ok: false, error, requestId };
}

module.exports = { json, errorBody };
