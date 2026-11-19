# Exactly-Once Event De-duplication Engine: AWS backend

A complete serverless backend for your React frontend, built with **AWS SAM**.

Services used: **Amazon API Gateway**, **AWS Lambda**, **Amazon DynamoDB**, **Amazon CloudWatch**.
Architecture explanation for your report: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

---

## 1. What is in this folder

```
exactly-once-backend/
├── template.yaml                 The whole AWS setup, described as code (SAM template)
├── package.json                  npm shortcuts: test, local, check:api, check:concurrency
├── src/                          Code that is uploaded to AWS Lambda
│   ├── package.json              Marks the folder as a Node.js project (no dependencies needed)
│   ├── handlers/                 One file per API endpoint (thin: read request, call logic, answer)
│   │   ├── submitEvent.js        POST /events          new or duplicate?
│   │   ├── getStats.js           GET  /stats           counters
│   │   └── getEvent.js           GET  /events/{id}     look up one stored event
│   └── lib/                      Shared building blocks
│       ├── config.js             Allowed event types, size limits, environment settings
│       ├── validate.js           Event ID / type / payload / timestamp validation
│       ├── eventService.js       The business logic (new vs duplicate, statistics, lookup)
│       ├── store.js              The ONLY file that talks to DynamoDB (conditional write lives here)
│       ├── logger.js             JSON logging + custom CloudWatch metrics
│       └── response.js           Builds HTTP responses in one consistent format
├── tests/                        Automated tests (run on your laptop, no AWS needed)
│   ├── validate.test.js          Validation rules
│   ├── eventService.test.js      New / duplicate / concurrency / retention / statistics
│   ├── handlers.test.js          The three endpoints, including error cases
│   └── helpers/memoryStore.js    A fake in-memory DynamoDB used by the tests
├── scripts/
│   ├── local-server.js           Runs the API on http://localhost:3001 with no AWS (in-memory data)
│   ├── api-check.js              Automatic end-to-end check of a running API
│   └── concurrency-check.js      Fires many simultaneous requests to prove duplicate protection
├── events/                       Sample inputs for "sam local invoke" (optional)
├── frontend-integration/         Files to copy into your React project (see section 7)
└── docs/ARCHITECTURE.md          Explanation for your report / presentation
```

### What `template.yaml` creates

| Resource | Service | Purpose |
|----------|---------|---------|
| `EventsTable` | DynamoDB | Stores event IDs + counters; TTL on `expiresAt` |
| `EventsHttpApi` | API Gateway | Public URL, CORS, throttling, access logs |
| `SubmitEventFunction`, `GetStatsFunction`, `GetEventFunction` | Lambda | Run the three handlers; each can only access this one table |
| `*LogGroup` (4) | CloudWatch | Log storage, kept for 30 days |
| `InternalErrorAlarm` | CloudWatch | Turns red when the code reports an internal error |
| `MonitoringDashboard` | CloudWatch | Graphs: new vs duplicate, API errors, Lambda duration, DynamoDB usage, recent errors |

Parameters you can change at deploy time: `AllowedOrigin` (which website may call the API, default `*`) and `RetentionHours` (default 24).

---

## 2. API reference

Base URL = the `ApiBaseUrl` output of `sam deploy`, e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com/prod`

### `POST /events`: submit an event

```json
{ "eventId": "evt-00001", "type": "payment", "payload": "$29.99", "timestamp": "2026-11-11T10:00:00Z" }
```

| Field | Required | Rules |
|-------|----------|-------|
| `eventId` | yes | 1-128 characters: letters, digits, `.` `_` `:` `-`; must start with a letter or digit |
| `type` | yes | `payment`, `order`, `inventory`, `notification` or `transfer` (same as the frontend) |
| `payload` | no | text, up to 1024 characters |
| `timestamp` | no | ISO date string or epoch milliseconds (year 2000 to 24 h in the future) |

**New event: HTTP 201**
```json
{
  "ok": true, "eventId": "evt-00001", "type": "payment",
  "status": "Processed", "decision": "Processed",
  "duplicate": false, "businessEffectApplied": true, "deliveryNumber": 1,
  "reason": "New event evt-00001 recorded in DynamoDB - business effect applied once",
  "firstSeenAt": "2026-11-11T10:00:01.120Z", "processedAt": "2026-11-11T10:00:01.131Z",
  "expiresAt": "2026-11-12T10:00:01.000Z", "processingLatency": 11, "requestId": "..."
}
```

**Duplicate event: HTTP 200**
```json
{
  "ok": true, "eventId": "evt-00001", "type": "payment",
  "status": "Duplicate", "decision": "Duplicate Suppressed",
  "duplicate": true, "businessEffectApplied": false, "deliveryNumber": 2,
  "reason": "Event evt-00001 was already processed at 2026-11-11T10:00:01.120Z - duplicate suppressed (delivery #2)",
  "firstSeenAt": "2026-11-11T10:00:01.120Z", "processedAt": "2026-11-11T10:00:05.502Z",
  "expiresAt": "2026-11-12T10:00:01.000Z", "processingLatency": 9, "requestId": "..."
}
```

`status` and `decision` use exactly the words of the frontend's `DeliveryStatus` and `ProcessingDecision` types, so the existing UI components can display the answers unchanged.

**Errors** always look like this (400, 404, 413, 500):
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "The event is not valid",
  "details": [{ "field": "eventId", "message": "eventId may only contain ..." }] }, "requestId": "..." }
```

### `GET /stats`: statistics (HTTP 200)
```json
{ "ok": true, "generatedAt": "...", "requestId": "...",
  "stats": { "totalDeliveryAttempts": 62, "uniqueLogicalEvents": 32, "processedLogicalEvents": 32,
             "duplicatesSuppressed": 30, "businessEffects": 32, "failedAttempts": 0, "invalidRequests": 3,
             "averageLatency": 4.7, "duplicateRate": 48.4, "retentionHours": 24 } }
```
Field names match the frontend's `SimulationMetrics` type where possible.

### `GET /events/{eventId}`: look up one event
HTTP 200 with `{ "ok": true, "event": { eventId, type, payload, eventTimestamp, firstSeenAt, duplicateCount, lastDuplicateAt, expiresAt } }`, or 404 if unknown or expired.

---

## 3. Try it on your computer first (no AWS needed)

You need **Node.js 20 or newer** ([nodejs.org](https://nodejs.org), LTS version).

```bash
cd exactly-once-backend
npm test
```
Runs 31 automated tests. Expected end of output: `# pass 31` and `# fail 0`.

Start a local copy of the API (uses the same handler code with an in-memory fake database):
```bash
npm run local
```
Leave that window open. In a **second** window:
```bash
node scripts/api-check.js http://localhost:3001
node scripts/concurrency-check.js http://localhost:3001 30
```
You can also point your frontend at `http://localhost:3001` while developing (section 7).

---

## 4. Deploy to AWS from Windows

### 4.1 Install the tools (once)

1. **AWS CLI v2**: install the Windows MSI from AWS's "Install or update the AWS CLI" page.
2. **AWS SAM CLI**: install the 64-bit Windows MSI from AWS's "Install the AWS SAM CLI" page. Use the latest version.
3. **Node.js LTS** from nodejs.org.
4. Docker is **not** needed for this project.

Close and reopen your terminal, then check:
```powershell
aws --version
sam --version
node --version
```

### 4.2 Connect the AWS CLI to your AWS account (once)

```powershell
aws configure
```
Enter your access key ID, secret access key, a default region (for example `ap-south-1` for Mumbai), and `json` as output format. Use an account that is allowed to create AWS resources (an administrator-level user is simplest for a learning project). Check it works:
```powershell
aws sts get-caller-identity
```
It should print your account number.

### 4.3 Build and deploy

```powershell
cd exactly-once-backend
npm test
sam validate --lint
sam build
sam deploy --guided
```

Answer the questions like this:

| Question | Answer |
|----------|--------|
| Stack Name | `exactly-once-dedup` |
| AWS Region | same region as above, e.g. `ap-south-1` |
| Parameter AllowedOrigin | press Enter (`*`) for now; you will tighten it in section 7 |
| Parameter RetentionHours | press Enter (24) |
| Confirm changes before deploy | `N` |
| Allow SAM CLI to create the roles the functions need | `Y` (required, otherwise Lambda cannot run) |
| Disable rollback | `N` |
| *"... has no authentication. Is this okay?"* (asked for each of the three functions) | `y` (this is a public lab API) |
| Save arguments to configuration file | `Y` (accept defaults) |

After 2-5 minutes you will see **Outputs**. Copy the value of **`ApiBaseUrl`**. To see the outputs again at any time:
```powershell
sam list stack-outputs --stack-name exactly-once-dedup
```

### 4.4 Update after changing code
```powershell
sam build
sam deploy
```
(`sam deploy` now reuses your saved answers.)

---

## 5. Test the deployed API

Put your URL into a variable (PowerShell). Replace the example with your `ApiBaseUrl`:
```powershell
$api = "https://abc123.execute-api.ap-south-1.amazonaws.com/prod"
```

### 5.1 Automatic full check (easiest)
```powershell
node scripts/api-check.js $api
```
Expected: `Result: 18 passed, 0 failed`.

### 5.2 Test a NEW event
```powershell
$r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$api/events" -ContentType "application/json" `
     -Body '{"eventId":"demo-001","type":"payment","payload":"$29.99"}'
$r.StatusCode
$r.Content
```
Expected: status **201**, `"decision":"Processed"`, `"duplicate":false`.

### 5.3 Test a DUPLICATE event
Run the **exact same command again**. Expected: status **200**, `"decision":"Duplicate Suppressed"`, `"duplicate":true`, `"deliveryNumber":2`. Run it a third time and `deliveryNumber` becomes 3.

To see what DynamoDB stored:
```powershell
Invoke-RestMethod "$api/events/demo-001"
```

### 5.4 Test INVALID input
```powershell
try { Invoke-RestMethod -Method Post -Uri "$api/events" -ContentType "application/json" -Body '{"eventId":"bad id!","type":"payment"}' }
catch { $_.ErrorDetails.Message }
```
Expected: `VALIDATION_ERROR` explaining the event ID problem.

### 5.5 Test CONCURRENT duplicates
```powershell
node scripts/concurrency-check.js $api 20 same
```
This sends 20 identical requests at the same moment. Expected output:
```
201 new event        : 1
200 duplicate        : 19
PASS - exactly 1 new event(s), as expected.
```
Try bigger numbers (`50`, `100`) and the opposite test:
```powershell
node scripts/concurrency-check.js $api 20 unique
```
Expected: 20 new events and 0 duplicates.

### 5.6 Statistics
```powershell
(Invoke-RestMethod "$api/stats").stats
```

> If you use Command Prompt instead of PowerShell, use the Node scripts above. They work everywhere.

---

## 6. Watch it in CloudWatch

Open the **`DashboardUrl`** output in your browser, or in the AWS console go to **CloudWatch -> Dashboards -> exactly-once-dedup-monitoring**. Send some events and you will see the graphs move (metrics can lag about a minute).

Live log tail:
```powershell
aws logs tail "/aws/lambda/exactly-once-dedup/submit-event" --follow
```
(If you used a different stack name, replace `exactly-once-dedup` in that path.)

Useful **Logs Insights** queries (CloudWatch -> Logs Insights, select the log group `/aws/lambda/exactly-once-dedup/submit-event`):
```
fields @timestamp, message, eventId, decision, deliveryNumber
| filter message = "Duplicate event suppressed"
| sort @timestamp desc
| limit 20
```
```
filter ispresent(decision)
| stats count() by decision
```
```
fields @timestamp, message, errorMessage
| filter level = "ERROR"
| sort @timestamp desc
```
The alarm **InternalErrorAlarm** (CloudWatch -> Alarms) turns red if the code reports an unexpected error. API-level request logs are in the log group `/aws/vendedlogs/exactly-once-dedup/api-access`.

To see the stored data: **DynamoDB -> Tables -> (your table, name in the `DynamoDBTableName` output) -> Explore table items**. You will see one `EVENT#...` item per event ID and one `STATS#global` item.

---

## 7. Connect your React frontend (and Netlify)

The simulator is untouched. The integration **adds** one page, "Cloud Backend", to the sidebar.

### 7.1 Copy the files into your React project

| From `frontend-integration/` | To your project | Action |
|---|---|---|
| `src/api/cloudApi.ts` | `src/api/cloudApi.ts` | new file |
| `src/components/CloudBackendPage.tsx` | `src/components/CloudBackendPage.tsx` | new file |
| `src/components/Sidebar.tsx` | `src/components/Sidebar.tsx` | replace (adds `'cloud'` to `PageId` and one menu item) |
| `src/App.tsx` | `src/App.tsx` | replace (adds one import and one `{currentPage === 'cloud' && ...}` line) |
| `.env.example` | `.env.local` | copy, then edit the URL |

The only changes to your two existing files are 3 added lines in each. Compare them with your originals if you want to be sure. No other existing file is modified, and the new page reuses your existing `MetricsPanel` and `EventTraceTable` components, so it looks like the rest of the app.

### 7.2 Try it locally
Edit `.env.local`:
```
VITE_API_BASE_URL=https://abc123.execute-api.ap-south-1.amazonaws.com/prod
```
(or `http://localhost:3001` while `npm run local` is running in the backend folder), then in the frontend folder:
```powershell
npm run dev
```
Open the **Cloud Backend** page:
* **Send event** twice with the same ID -> first row *Processed*, second row *Duplicate Suppressed*.
* **Fire!** with 25 simultaneous requests -> "1 processed, 24 suppressed".

### 7.3 Publish on Netlify
Vite bakes `VITE_` variables into the site **when it is built**, so set the variable before building.

**If Netlify builds from Git:**
1. Netlify -> your site -> **Site configuration -> Environment variables -> Add a variable**.
2. Key `VITE_API_BASE_URL`, value = your `ApiBaseUrl` (no trailing slash).
3. **Deploys -> Trigger deploy -> Clear cache and deploy site**.

**If you upload the `dist` folder by hand:** make sure `.env.local` contains the URL, run `npm run build`, then upload the new `dist` folder.

### 7.4 Lock the API to your Netlify site (recommended)
Browsers only allow your site to call the API if CORS permits it. Once everything works, restrict it to your site's address (exact `https://...`, no trailing slash, no path):
```powershell
sam deploy --parameter-overrides AllowedOrigin=https://your-site.netlify.app RetentionHours=24
```
After this, `http://localhost:5173` can no longer call the deployed API. To develop locally, use `npm run local` or redeploy with `AllowedOrigin=*`. If you add a custom domain later, redeploy with that domain.

---

## 8. Clean up (stop all AWS resources)

```powershell
sam delete --stack-name exactly-once-dedup
```
This removes the API, functions, table (and its data), logs, alarm and dashboard. For a lab-sized workload the usage should be small, but check AWS's current pricing and free tier for your account.

---

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| `npm : File ... cannot be loaded because running scripts is disabled` (PowerShell) | Use Command Prompt, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once. |
| `sam validate` complains about the runtime `nodejs24.x` | Update the SAM CLI, or change `Runtime: nodejs24.x` to `nodejs22.x` in `template.yaml` (one line near the top). |
| Browser console: *blocked by CORS policy* | `AllowedOrigin` does not match your site exactly. Redeploy with the exact origin (7.4) or `*`. |
| Cloud Backend page says "No API URL configured" | `VITE_API_BASE_URL` missing. On Netlify, redeploy **after** adding it. |
| Page shows "Could not reach the cloud backend" | Wrong URL (it must end with `/prod`, no trailing slash), or no internet. Test the URL with `node scripts/api-check.js <url>`. |
| 500 `INTERNAL_ERROR` | Open CloudWatch Logs for `submit-event` and filter `level = "ERROR"`. The log line has the real reason. |
| Stack shows `ROLLBACK_COMPLETE` after a failed first deploy | `sam delete --stack-name exactly-once-dedup`, fix the problem, deploy again. |
| `sam deploy` fails creating the API access log group | Your account user needs permission to create CloudWatch log resources; use an administrator-level user for this project. |
| `Unable to locate credentials` | Run `aws configure` again (section 4.2). |
| A duplicate is reported for an ID you "never sent" | Event IDs are remembered for `RetentionHours`. Use a new ID, or look it up with `GET /events/{id}`. |
