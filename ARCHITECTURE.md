# Architecture explanation (for your report or presentation)

## The four AWS services

| # | Service | Role in this project |
|---|---------|----------------------|
| 1 | **Amazon API Gateway** | The public HTTPS entry point. Receives `POST /events`, `GET /stats` and `GET /events/{eventId}` from the React frontend, applies CORS and throttling, and forwards each request to Lambda. |
| 2 | **AWS Lambda** | Runs the code. Three small Node.js functions validate the event ID, decide *new* or *duplicate*, and return a JSON answer. Lambda scales automatically, so many requests can run in parallel. |
| 3 | **Amazon DynamoDB** | The de-duplication registry. Each event ID is stored as one item; a conditional write guarantees only the first request can create it. It also holds atomic statistics counters and expires old IDs with Time To Live (TTL). |
| 4 | **Amazon CloudWatch** | Observability. Collects Lambda and API Gateway logs, publishes custom metrics (new, duplicate, invalid, internal errors), shows a dashboard, and raises an alarm on internal errors. |

## Request flow

```
 React frontend (Netlify)
        |  HTTPS  POST /events  { eventId, type, payload }
        v
 Amazon API Gateway  ---- access logs ---------------------+
        |                                                   |
        v                                                   |
 AWS Lambda  (submitEvent)                                  |
   1. parse + validate the event                            |
   2. PutItem with condition "event ID must not exist"      |
        |                    |                              |
        |  success           |  condition failed            |
        |  = NEW event       |  = DUPLICATE                 |
        |                    |  -> bump duplicateCount      |
        v                    v                              |
 Amazon DynamoDB  <---- atomic counters (statistics) -----  |
        |                                                   |
        v                                                   v
 JSON answer: 201 "Processed"  or  200 "Duplicate Suppressed"
 Logs, metrics, alarm, dashboard  ------------------>  Amazon CloudWatch
```

## How duplicate detection works (the important part)

The naive approach is "look the event up; if it is not there, save it." With concurrent requests this fails:
two requests can both look, both find nothing, and both save, so the business effect happens twice.
The test `WHY the conditional write matters` in `tests/eventService.test.js` demonstrates this.

This backend instead uses one **atomic conditional write**:

```
PutItem  pk = "EVENT#<eventId>"
ConditionExpression:  attribute_not_exists(pk)  OR  expiresAt <= :now
```

DynamoDB evaluates the condition and performs the write as a single indivisible operation:

* **Condition true** -> this request created the record -> it is the one **new** event (HTTP 201).
* **Condition false** (`ConditionalCheckFailedException`) -> the ID is already stored -> **duplicate** (HTTP 200). The code then atomically increments `duplicateCount`.

If 50 identical requests arrive at the same instant, exactly one gets 201 and 49 get 200.

## Retention (timestamp-based expiry)

* Every record stores `expiresAt` = first-seen time + `RetentionHours` (default 24 h), in epoch **seconds**.
* DynamoDB TTL deletes expired items in the background. TTL is not instant (it can lag by many hours), so the condition above also treats an item whose `expiresAt` has passed as "not there". An expired ID can therefore be accepted again immediately, exactly as the retention policy says.
* The sender may include an optional `timestamp` (ISO string or epoch ms). It is validated and stored as `eventTimestamp`, but retention always uses the **server** clock, so a client cannot extend or shorten retention.
* The statistics item has no `expiresAt`, so counters are permanent.

## Statistics

One extra item (`pk = "STATS#global"`) holds counters updated with DynamoDB `ADD` (atomic increments): total delivery attempts, unique events, duplicates suppressed, invalid requests, failed attempts, and total latency. `GET /stats` reads that one item, so it stays fast no matter how many events exist.
The counters are updated *after* the new/duplicate decision is saved. If a counter update ever fails, the event is still handled correctly and the failure is logged; only the statistics could be off by one.

## Error handling and monitoring

| Situation | HTTP status | `error.code` | Logged as |
|-----------|-------------|--------------|-----------|
| Body missing or not JSON | 400 | `INVALID_JSON` | WARN + metric `InvalidRequests` |
| Event ID / type / payload / timestamp invalid | 400 | `VALIDATION_ERROR` | WARN + metric `InvalidRequests` |
| Body larger than 8 KB | 413 | `PAYLOAD_TOO_LARGE` | - |
| Event not found (`GET /events/{id}`) | 404 | `NOT_FOUND` | - |
| Anything unexpected (e.g. DynamoDB unreachable) | 500 | `INTERNAL_ERROR` | ERROR with stack trace + metric `InternalErrors` (alarm) |

500 responses never leak internal details to the browser; the details go to CloudWatch Logs only.
Every response carries a `requestId` that also appears in the logs, so you can find the log lines for any request.

## Design choices a reviewer may ask about

* **HTTP API (not REST API)** in API Gateway: simpler, cheaper, built-in CORS.
* **One table, two item kinds**: keeps the project small and easy to explain.
* **JSON logs + Embedded Metric Format**: searchable logs and custom metrics without extra services or SDK calls.
* **Plain JavaScript, no dependencies**: the AWS SDK is part of the Lambda runtime, so there is no build step or `node_modules`.

## Honest limitations (good to state in a viva)

* This gives **idempotent processing within the retention window**, commonly called "effectively-once". True exactly-once also needs the real side effect (charging a card, sending an email) to be atomic with the registry write or itself idempotent. In this lab the "business effect" is simulated by the record itself.
* An ID older than the retention window is treated as new again.
* The API has no login. Throttling limits abuse, and event IDs/payloads are visible to anyone who has the URL, so do not send real personal data.
* The statistics count unique events ever recorded, not only those still within retention.
