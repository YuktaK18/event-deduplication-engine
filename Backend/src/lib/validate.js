'use strict';

const { ALLOWED_EVENT_TYPES, LIMITS } = require('./config');

// Letters, digits and . _ : -  (must start with a letter or digit). Max 128 characters.
// Examples that pass:  evt-00001   order:2026-11-11:42   9f1c2a7e
const EVENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

// Returns an error message, or null when the event ID is fine.
function checkEventId(eventId) {
  if (typeof eventId !== 'string' || eventId.length === 0) {
    return 'eventId is required and must be a non-empty string';
  }
  if (eventId.length > LIMITS.eventIdMaxLength) {
    return `eventId must be at most ${LIMITS.eventIdMaxLength} characters`;
  }
  if (!EVENT_ID_PATTERN.test(eventId)) {
    return 'eventId may only contain letters, digits, ".", "_", ":" and "-", and must start with a letter or digit';
  }
  return null;
}

// Accepts an ISO date string or a number of milliseconds since 1970. Returns an ISO string or null.
function normaliseTimestamp(value, nowMs) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const date = new Date(value);
  const ms = date.getTime();
  if (Number.isNaN(ms)) return null;
  if (ms < Date.UTC(2000, 0, 1)) return null; // implausibly old
  if (ms > nowMs + 24 * 60 * 60 * 1000) return null; // more than a day in the future
  return date.toISOString();
}

// Checks the JSON body sent to POST /events.
// Returns { valid: true, value } or { valid: false, errors: [{ field, message }] }.
function validateSubmission(body, nowMs = Date.now()) {
  const errors = [];

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object' }] };
  }

  const idError = checkEventId(body.eventId);
  if (idError) errors.push({ field: 'eventId', message: idError });

  if (typeof body.type !== 'string' || !ALLOWED_EVENT_TYPES.includes(body.type)) {
    errors.push({ field: 'type', message: `type must be one of: ${ALLOWED_EVENT_TYPES.join(', ')}` });
  }

  let payload = '';
  if (body.payload !== undefined && body.payload !== null) {
    if (typeof body.payload !== 'string') {
      errors.push({ field: 'payload', message: 'payload must be a string' });
    } else if (body.payload.length > LIMITS.payloadMaxLength) {
      errors.push({ field: 'payload', message: `payload must be at most ${LIMITS.payloadMaxLength} characters` });
    } else {
      payload = body.payload;
    }
  }

  let eventTimestamp = null;
  if (body.timestamp !== undefined && body.timestamp !== null) {
    eventTimestamp = normaliseTimestamp(body.timestamp, nowMs);
    if (!eventTimestamp) {
      errors.push({
        field: 'timestamp',
        message: 'timestamp must be an ISO date string or epoch milliseconds, not older than year 2000 or more than 24 hours ahead',
      });
    }
  }

  if (errors.length > 0) return { valid: false, errors };

  const value = { eventId: body.eventId, type: body.type, payload, eventTimestamp };

  if (body.allowedLatenessSeconds !== undefined && body.allowedLatenessSeconds !== null) {
    const lat = Number(body.allowedLatenessSeconds);
    if (!Number.isNaN(lat) && lat >= 0) {
      value.allowedLatenessSeconds = lat;
    }
  }

  if (body.watermark !== undefined && body.watermark !== null) {
    const wm = typeof body.watermark === 'number' ? body.watermark : Date.parse(body.watermark);
    if (!Number.isNaN(wm)) {
      value.watermark = wm;
    }
  }

  if (body.isBurst !== undefined) {
    value.isBurst = Boolean(body.isBurst);
  }

  return { valid: true, value };
}

// Checks a batch / burst stream of events sent to POST /events or POST /events/burst.
// Body can be an array of event objects or { burstId, events: [...] }.
function validateBurstSubmission(body, nowMs = Date.now()) {
  if (!body || typeof body !== 'object') {
    return { valid: false, errors: [{ field: 'body', message: 'Request body must be a JSON object or array' }] };
  }

  const rawEvents = Array.isArray(body) ? body : body.events;
  if (!Array.isArray(rawEvents)) {
    return { valid: false, errors: [{ field: 'events', message: 'events must be an array of event objects' }] };
  }

  if (rawEvents.length === 0) {
    return { valid: false, errors: [{ field: 'events', message: 'Burst stream must contain at least 1 event' }] };
  }

  if (rawEvents.length > 200) {
    return { valid: false, errors: [{ field: 'events', message: 'Burst stream cannot exceed 200 events per batch' }] };
  }

  const validatedEvents = [];
  const errors = [];

  for (let i = 0; i < rawEvents.length; i++) {
    const item = rawEvents[i];
    const check = validateSubmission(item, nowMs);
    if (!check.valid) {
      errors.push({
        field: `events[${i}]`,
        message: check.errors.map((e) => `${e.field}: ${e.message}`).join(', '),
      });
    } else {
      validatedEvents.push({ ...check.value, isBurst: true });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    value: {
      burstId: typeof body.burstId === 'string' && body.burstId.trim() ? body.burstId.trim() : `burst-${nowMs}`,
      events: validatedEvents,
    },
  };
}

module.exports = { checkEventId, validateSubmission, validateBurstSubmission, EVENT_ID_PATTERN };
