'use strict';

// Fires many requests AT THE SAME TIME to prove the atomic DynamoDB write works.
//
//   node scripts/concurrency-check.js <API base URL> [count] [mode]
//
//   count  how many parallel requests (default 20, max 200)
//   mode   "same"   -> every request carries the SAME event ID. Expected: exactly 1 new, the rest duplicates.
//          "unique" -> every request carries a DIFFERENT event ID. Expected: all new, no duplicates.
//
// Examples:
//   node scripts/concurrency-check.js https://abc123.execute-api.ap-south-1.amazonaws.com/prod 20
//   node scripts/concurrency-check.js http://localhost:3001 50 unique

const baseUrl = (process.argv[2] || process.env.API_BASE_URL || '').replace(/\/+$/, '');
const count = Math.min(Math.max(parseInt(process.argv[3] || '20', 10) || 20, 2), 200);
const mode = (process.argv[4] || 'same').toLowerCase();

if (!baseUrl || !['same', 'unique'].includes(mode)) {
  console.error('Usage: node scripts/concurrency-check.js <API base URL> [count] [same|unique]');
  process.exit(2);
}

async function send(eventId) {
  try {
    const response = await fetch(`${baseUrl}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId, type: 'payment', payload: '$100.00' }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (err) {
    return { status: 0, body: { error: err.message } };
  }
}

async function main() {
  const runId = Date.now();
  const sharedId = `race-${runId}`;
  console.log(`Sending ${count} requests at the same time (mode: ${mode}) to ${baseUrl}/events ...\n`);

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: count }, (_, i) => send(mode === 'same' ? sharedId : `race-${runId}-${i}`))
  );
  const elapsed = Date.now() - started;

  const created = results.filter((r) => r.status === 201).length;
  const duplicates = results.filter((r) => r.status === 200).length;
  const errors = results.filter((r) => r.status !== 200 && r.status !== 201);

  console.log(`  201 new event        : ${created}`);
  console.log(`  200 duplicate        : ${duplicates}`);
  console.log(`  errors               : ${errors.length}`);
  console.log(`  total time           : ${elapsed} ms`);
  if (errors.length > 0) console.log('  first error          :', JSON.stringify(errors[0]));

  const expectedNew = mode === 'same' ? 1 : count;
  const ok = created === expectedNew && errors.length === 0;
  console.log(
    ok
      ? `\nPASS - exactly ${expectedNew} new event(s), as expected.`
      : `\nFAIL - expected ${expectedNew} new event(s) and no errors.`
  );
  process.exit(ok ? 0 : 1);
}

main();
