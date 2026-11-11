'use strict';

// End-to-end check of a RUNNING API (deployed on AWS, or started with "npm run local").
//
//   node scripts/api-check.js https://abc123.execute-api.ap-south-1.amazonaws.com/prod
//   node scripts/api-check.js http://localhost:3001
//
// You can also set the API_BASE_URL environment variable instead of passing the URL.
// Needs Node.js 18 or newer (for the built-in fetch).

const baseUrl = (process.argv[2] || process.env.API_BASE_URL || '').replace(/\/+$/, '');
if (!baseUrl) {
  console.error('Usage: node scripts/api-check.js <API base URL>');
  process.exit(2);
}

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
}

async function call(method, path, body, rawBody) {
  const options = { method, headers: {} };
  if (rawBody !== undefined) {
    options.body = rawBody;
    options.headers['Content-Type'] = 'application/json';
  } else if (body !== undefined) {
    options.body = JSON.stringify(body);
    options.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(baseUrl + path, options);
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    /* leave json as null */
  }
  return { status: response.status, json, text };
}

async function main() {
  console.log(`Testing ${baseUrl}\n`);
  const eventId = `check-${Date.now()}`;

  console.log('1. Statistics before');
  const before = await call('GET', '/stats');
  check('GET /stats returns 200', before.status === 200, before.text);
  const b = (before.json && before.json.stats) || {};

  console.log('\n2. New event');
  const first = await call('POST', '/events', { eventId, type: 'payment', payload: '$29.99' });
  check('first delivery returns 201', first.status === 201, first.text);
  check('decision is "Processed"', first.json && first.json.decision === 'Processed');
  check('duplicate is false', first.json && first.json.duplicate === false);

  console.log('\n3. Duplicate event (same ID)');
  const second = await call('POST', '/events', { eventId, type: 'payment', payload: '$29.99' });
  check('second delivery returns 200', second.status === 200, second.text);
  check('decision is "Duplicate Suppressed"', second.json && second.json.decision === 'Duplicate Suppressed');
  check('duplicate is true', second.json && second.json.duplicate === true);
  check('deliveryNumber is 2', second.json && second.json.deliveryNumber === 2);
  check('firstSeenAt matches the original', first.json && second.json && first.json.firstSeenAt === second.json.firstSeenAt);

  console.log('\n4. Invalid requests');
  const badId = await call('POST', '/events', { eventId: 'bad id!', type: 'payment' });
  check('invalid event ID returns 400 VALIDATION_ERROR', badId.status === 400 && badId.json.error.code === 'VALIDATION_ERROR', badId.text);
  const badType = await call('POST', '/events', { eventId: 'ok-id', type: 'banana' });
  check('invalid type returns 400', badType.status === 400, badType.text);
  const badJson = await call('POST', '/events', undefined, '{oops');
  check('broken JSON returns 400 INVALID_JSON', badJson.status === 400 && badJson.json.error.code === 'INVALID_JSON', badJson.text);

  console.log('\n5. Look up the stored event');
  const lookup = await call('GET', `/events/${eventId}`);
  check('GET /events/{id} returns 200', lookup.status === 200, lookup.text);
  check('duplicateCount is 1', lookup.json && lookup.json.event && lookup.json.event.duplicateCount === 1);
  const missing = await call('GET', '/events/does-not-exist-12345');
  check('unknown ID returns 404', missing.status === 404, missing.text);

  console.log('\n6. Statistics after');
  const after = await call('GET', '/stats');
  const a = (after.json && after.json.stats) || {};
  check('delivery attempts grew by at least 2', a.totalDeliveryAttempts - (b.totalDeliveryAttempts || 0) >= 2, JSON.stringify(a));
  check('unique events grew by at least 1', a.uniqueLogicalEvents - (b.uniqueLogicalEvents || 0) >= 1);
  check('duplicates suppressed grew by at least 1', a.duplicatesSuppressed - (b.duplicatesSuppressed || 0) >= 1);

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nCould not reach the API:', err.message);
  process.exit(2);
});
