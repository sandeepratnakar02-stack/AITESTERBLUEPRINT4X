# n8n workflows for the VWO QA Downtime Tracker

| File | Workflow | Role |
| --- | --- | --- |
| `09_DownTime_Tracker.json` | `09_DownTime_Tracker` | **Monitoring engine.** Schedule trigger (every 5 min) → HTTP/functional checks → retry policy (3 attempts, 20 s / 30 s) → health classification → Google Sheets + Slack + Groq incident summary. Has **no webhook**, so it cannot be called by the dashboard directly. |
| `09_DownTime_Tracker.API.json` | `09b_DownTime_Tracker_API` | **Read API.** 11 webhook endpoints over the sheets written by the monitor, shaped to the TypeScript contract in `../src/types/index.ts`. This is what the dashboard consumes. |
| `build-api-workflow.mjs` | – | Generator for the API workflow. Mapper code lives here (readable JS) instead of inside a 60 KB JSON blob. Run `node build-api-workflow.mjs` after editing. |
| `patch-workflows.mjs` | – | One-time patch that fixed the defects in the hand-authored export above. Backs the originals up to `before-patch/` and asserts every edit anchor matches exactly once. |
| `verify-workflow-logic.mjs` | – | Executes the patched Code-node bodies against sample sheet rows and asserts the behaviour (20 checks). Run after any change to a mapper. |

## Setup

Full walkthrough: [`../DEPLOYMENT.md`](../DEPLOYMENT.md). In short:

1. Import both workflows into n8n.
2. In the API workflow replace `REPLACE_WITH_SPREADSHEET_ID` in every Google Sheets node (10) and
   `REPLACE_WITH_MONITOR_WORKFLOW_ID` in `API 08c - Run Monitoring Workflow`.
3. Attach your Google Sheets credential to those nodes.
4. **Activate** the workflow — webhooks only respond while it is active.
5. Set `N8N_BASE_URL` + `USE_LIVE_DATA=true` in the app.

## Endpoints

| Endpoint | Sheet / action |
| --- | --- |
| `GET /health-status` | `Health_Check_History` → `{ summary, services }` |
| `GET /health-checks` | `Health_Check_History` → `HealthCheck[]` |
| `GET /logs` | `Health_Check_History` → `LogEntry[]` |
| `GET /response-times` | `Health_Check_History` → `ResponseTimeMetric[]` |
| `GET /uptime` | `Daily_Availability` → `UptimePoint[]` |
| `GET /incidents` | `Downtime_Incidents` → `Incident[]` (`?id=`, `?environment=`) |
| `GET /retry-history` | `Downtime_Incidents` → `RetryAttempt[]` (derived) |
| `POST /health-check` | acknowledges, then runs the monitor workflow |
| `GET /settings`, `POST /settings-write` | `Settings` (Key/Value rows) |
| `POST /incidents-resolve` | sets `Status = RESOLVED` on an incident row |

All endpoints accept `?environment=QA|Staging|Production`.

## Using the hand-authored export (`01_VWO_Downtime_Monitor` + `02_VWO_Downtime_Tracker_API`)

Those two files are an independent implementation of the same idea, and the dashboard supports
them **as-is** — `src/lib/normalize.ts` looks up field aliases, unwraps response envelopes and
coerces enums, so both vocabularies work:

| Difference | Their export | App's default contract | Handling |
| --- | --- | --- | --- |
| List envelope | `{ count, logs: [...] }` | bare `LogEntry[]` | `toArray(payload, "logs", …)` |
| Health state | `UP` / `DEGRADED` / `FAILED` | `HEALTHY` / `SLOW` / `DOWN` | `toHealthState()` |
| Incident id | `incidentId` | `id` | alias list |
| Incident status | `OPEN` / `RESOLVED` | `Open` / `Resolved` | `toIncidentStatus()` |
| Severity | `SEV-1 … SEV-4` | `Critical … Low` | `toIncidentSeverity()` |
| Timestamps | `"2026-09-10 15:28:49"` | ISO 8601 | `toIso()` |
| Uptime | `availabilityPercentage`, `totalChecks` | `uptimePct`, `checks` | alias list |
| Settings | `{ settings: {…} }`, `environments: string[]` | flat object, `EnvironmentConfig[]` | `normalizeSettings()` |

Verified end-to-end against a stub that reproduces their exact payloads
(`node scripts/stub-n8n-api.mjs`, see the app README §9): all 9 pages render and all 11 endpoints
are called correctly.

### Defects found in that export — patched

Fixed by `node patch-workflows.mjs`, which backs the originals up to `before-patch/` and aborts
unless every edit anchor matches exactly once. Behaviour is verified by
`node verify-workflow-logic.mjs` (20 assertions executing the real Code-node bodies):

```
$ node verify-workflow-logic.mjs
✓ monitor/11A: a healthy (UP) check is no longer dropped
✓ monitor/11A: Timestamp column is written
✓ monitor/22: availability is 75% for 3/4 healthy checks
✓ api/01b: UP now maps to HEALTHY (was UNKNOWN)
✓ api/01b: uptimePct is window-based, not service-ratio
✓ api/01b: a non-critical failure degrades instead of going DOWN
✓ api/06b: retry events now carry a timestamp
✓ api/09b: retryCount is translated to retryAttempts
✓ api/10a: dashboard settings are persisted (not silently dropped)
… 20/20 checks passed
```

Ordered by impact — the first three changed what the dashboard displayed.

| # | Where | Problem | Status |
| --- | --- | --- | --- |
| 1 | `11A - Prepare Sheet Row` (monitor) | Returned nothing unless the status was `DOWN`/`FUNCTIONAL_FAILURE`, so **`Health_Check_History` only ever received failures** — no healthy series for latency charts, and daily availability computed from failures only (≈0 %). It also omitted the `Timestamp` column entirely. | ✅ Filters removed (every check is logged) and `Timestamp` added. |
| 2 | `API 01b` → `mapStatus()` | `HEALTHY` required `healthStatus === 'UP' && functionalValidation === 'PASS'`, but the monitor writes `NOT_APPLICABLE` when `expectedText` is empty — i.e. all five services. It also tested for `'SLOW'` while the monitor emits `'DEGRADED'`. Result: **everything showed as `UNKNOWN`**. | ✅ Functional failure wins first, then `DOWN`, then `DEGRADED`/`SLOW` → `SLOW`, then `UP`/`HEALTHY` → `HEALTHY`. |
| 3 | `API 01b` summary | `uptimePct = healthyServices / services` (read `0.00 %` once #2 was in play), and `overallStatus` went `DOWN` when any single non-critical service failed. | ✅ Availability is now computed across the window; `DOWN` is reserved for critical failures, otherwise `DEGRADED`. |
| 4 | `01 - Scheduled Monitor` | `rule.interval` was `{"field":"minutes"}` with **no `minutesInterval`** — no usable period. | ✅ Set to every 5 minutes. |
| 5 | `06` / `09` Wait nodes | Both read `retryDelayMs`, so the "20 s" and "30 s" waits were identical. | ✅ Final wait now uses `retryDelayMs2` (default 30 s). Set `retryDelayMs=20000` in the `Settings` sheet to match the first node's name. |
| 6 | `22 - Aggregate Daily Availability` | Compared `Timestamp.slice(0,10)` (server-local) with a UTC date, so buckets disagreed either side of midnight on a UTC+5:30 host. | ✅ Day key is built in the same local time as the rows. |
| 7 | `02B - Read Runtime Settings` | No error tolerance — a missing/renamed `Settings` tab failed the **entire** monitor run. | ✅ `onError: continueRegularOutput` + `alwaysOutputData`. |
| 8 | `21 - Read Health History` | No `alwaysOutputData`, so an empty sheet stopped the daily branch. | ✅ Enabled. |
| 9 | `API 09b` / monitor `03` | Settings key names differed (`retryAttempts`/`retryDelaysSeconds` vs `retryCount`/`retryDelayMs`), so saving from the dashboard only affected one side. | ✅ `GET /settings` understands both; `POST /settings-write` accepts and stores both. |
| 10 | `API 06b` timeline | `RETRY` events had no timestamp, so the dashboard had to anchor them to the incident start. | ✅ Derived from the incident start + the retry delay (22 s / 54 s). |

**Left as recommendations** (deliberate — both change behaviour you may want to keep):

- **Service endpoints.** All five services check `https://app.vwo.com/` with `expectedText: ''`, so
  `/login`, `/dashboard`, `/api` and `/editor` are never validated and the `FUNCTIONAL` check type is
  unused. Pointing them at real endpoints is a decision, not a bug fix — it will start producing real
  functional failures.
- **Duplicate sheet headers.** `15 - Append Downtime Incident` references both `Retry Count` and
  ` Retry Count` (leading space), same for `HTTP Response` and `Workflow Execution ID`.
  `autoMapInputData` writes by exact key so the clean columns win, but the stray headers should be
  deleted in Google Sheets.



Taken from the monitoring workflow itself, so the two workflows stay aligned:

**`Health_Check_History`** (node `18a - Build Health History Rows`)
`Timestamp`, `Application`, `Environment`, `Service Name`, `Endpoint`, `Check Type`, `HTTP Status`,
`Response Time Ms`, `Health Status`, `Functional Validation`, `Retry Count`, `Error Category`,
`Error Message`, `Workflow Execution ID`

**`Downtime_Incidents`** (nodes `16c - Keep Only New Incidents` / `20b - Build Resolution Row`)
`Incident ID`, `Application`, `Environment`, `Service Name`, `Service Type`, `Endpoint`, `Severity`,
`Failure Category`, `Failure Reason`, `Downtime Start`, `Recovery Time`, `Downtime Seconds`,
`Downtime Minutes`, `Status`, `HTTP Status`

**`Daily_Availability`** (node `24 - Aggregate Overall VWO Health`)
`Date`, `Environment`, `Service Name`, `Total Checks`, `Successful Checks`, `Failed Checks`,
`Degraded Checks`, `Functional Failures`, `Downtime Incidents`, `Total Downtime Minutes`,
`Availability Percentage`, `Average Response Time Ms`, `Maximum Response Time Ms`
(the `OVERALL` / `ALL_SERVICES` row feeds the uptime chart)

**`Settings`** (new, optional) — `Key`, `Value`

## Sheet schemas the mappers expect

Taken from the monitoring workflow itself, so the two workflows stay aligned:

**`Health_Check_History`** (node `18a - Build Health History Rows`)
`Timestamp`, `Application`, `Environment`, `Service Name`, `Endpoint`, `Check Type`, `HTTP Status`,
`Response Time Ms`, `Health Status`, `Functional Validation`, `Retry Count`, `Error Category`,
`Error Message`, `Workflow Execution ID`

**`Downtime_Incidents`** (nodes `16c - Keep Only New Incidents` / `20b - Build Resolution Row`)
`Incident ID`, `Application`, `Environment`, `Service Name`, `Service Type`, `Endpoint`, `Severity`,
`Failure Category`, `Failure Reason`, `Downtime Start`, `Recovery Time`, `Downtime Seconds`,
`Downtime Minutes`, `Status`, `HTTP Status`

**`Daily_Availability`** (node `24 - Aggregate Overall VWO Health`)
`Date`, `Environment`, `Service Name`, `Total Checks`, `Successful Checks`, `Failed Checks`,
`Degraded Checks`, `Functional Failures`, `Downtime Incidents`, `Total Downtime Minutes`,
`Availability Percentage`, `Average Response Time Ms`, `Maximum Response Time Ms`
(the `OVERALL` / `ALL_SERVICES` row feeds the uptime chart)

**`Settings`** (new, optional) — `Key`, `Value`

## Status vocabulary

The monitor emits `UP` / `DOWN` / `DEGRADED` / `FUNCTIONAL_FAILURE`. The API mappers normalise these to
the dashboard's `HEALTHY` / `DOWN` / `SLOW` / `FUNCTIONAL_FAILURE`. Severity `SEV-1…SEV-4` maps to
`Critical` / `High` / `Medium` / `Low`.

## Known limitations

- **Retry history is derived**, not recorded: `Downtime_Incidents` stores the run outcome, so the
  API rebuilds the attempt sequence from the fixed 20 s / 30 s policy.
- **Per-service thresholds are not in the history sheet**, so `health-status` falls back to a
  documented 3 000 ms default (and marks `Main` / `Login` / `API` services critical).
- **Security must be added by you**: an unauthenticated, publicly reachable webhook exposes your
  service health. Add a Header Auth credential to the Webhook nodes and set `N8N_API_KEY`.
- **No rate limiting.** The endpoints are read-only and cheap, but they are open by default.
