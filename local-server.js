'use strict';

// Runs the SAME Lambda handler code on your own computer, without AWS and without Docker.
// Data is kept in memory (a fake DynamoDB), so it is forgotten when you stop the server.
// Perfect for trying the frontend before you deploy:   npm run local
//
// Then use  http://localhost:3001  as the API base URL.

const http = require('node:http');
const { createMemoryStore } = require('../tests/helpers/memoryStore');
const { getConfig } = require('../src/lib/config');
const submitEvent = require('../src/handlers/submitEvent');
const getStats = require('../src/handlers/getStats');
const getEvent = require('../src/handlers/getEvent');

const PORT = Number(process.env.PORT) || 3001;
const config = { ...getConfig({}), tableName: 'local-memory' };
const store = createMemoryStore({ latencyMs: 2 });

const handlers = {
  submit: submitEvent.createHandler({ store, config }),
  stats: getStats.createHandler({ store, config }),
  event: getEvent.createHandler({ store, config }),
};

// Mimics the CORS headers that API Gateway adds in the cloud.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

let counter = 0;

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', async () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const path = url.pathname.replace(/^\/prod/, '').replace(/\/+$/, '') || '/';

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      return res.end();
    }

    // Build an object shaped like the one API Gateway sends to Lambda.
    const event = {
      requestContext: { requestId: `local-${++counter}` },
      body: chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined,
      isBase64Encoded: false,
    };

    let handler = null;
    const eventMatch = path.match(/^\/events\/([^/]+)$/);
    if (req.method === 'POST' && path === '/events') handler = handlers.submit;
    else if (req.method === 'GET' && path === '/stats') handler = handlers.stats;
    else if (req.method === 'GET' && eventMatch) {
      handler = handlers.event;
      event.pathParameters = { eventId: eventMatch[1] };
    }

    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'application/json', ...CORS });
      return res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown route' } }));
    }

    const result = await handler(event);
    res.writeHead(result.statusCode, { ...result.headers, ...CORS });
    res.end(result.body);
  });
});

server.listen(PORT, () => {
  console.log(`Local API running at http://localhost:${PORT}  (in-memory data, no AWS needed)`);
  console.log('Routes: POST /events   GET /stats   GET /events/{eventId}');
  console.log('Stop with Ctrl+C.');
});
