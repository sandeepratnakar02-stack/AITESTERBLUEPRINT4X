# Deployment guide — VWO QA Downtime Tracker

How to wire the dashboard to n8n and publish it on Vercel.

---

## 1. How data flows

```
 Browser ──▶ Next.js on Vercel ──▶ n8n webhooks ──▶ Google Sheets
             (server only)         09b_..._API      ▲
                                                    │ writes
                            09_DownTime_Tracker (schedule trigger) ──▶ Slack
```

Three properties follow from this:

- The browser **never** talks to n8n. Server components and the `app/api/*` route
  handlers do, so **no CORS configuration is needed** on the n8n side.
- `N8N_BASE_URL` and `N8N_API_KEY` are **server-only** — they never reach the JS bundle.
  Only `NEXT_PUBLIC_N8N_UI_URL` is public, and it is used purely for deep links.
- If n8n is unreachable, pages fall back to the bundled mock dataset and log the reason
  (see §7), so a demo deploy never shows a 500.

---

## 2. Quickstart — n8n Cloud + Vercel

The condensed happy path. An example instance `https://<your-instance>.app.n8n.cloud`
is used throughout; substitute your own.

### 2.1 Import the two workflows into n8n Cloud

Yes — n8n imports workflow JSON by **copy-paste**: open the editor canvas, press `Ctrl`/`Cmd` + `V`,
and the pasted JSON is added as a new workflow (equivalently: **Workflows → ⋯ → Import from File**).

Paste both files:

| File | Why |
| --- | --- |
| `n8n/09_DownTime_Tracker.json` | The monitoring engine. Without it nothing writes to the sheets. |
| `n8n/09_DownTime_Tracker.API.json` | The webhook read API the dashboard calls. |

> Pasting the JSON is enough to *load* the workflow. It will not run until you replace the
> placeholders and attach a credential (§3.2), because the Google Sheets nodes still point at
> `REPLACE_WITH_SPREADSHEET_ID`.

### 2.2 Create the Google Sheets workbook

Create one spreadsheet with these tabs (names must match exactly):

| Tab | Columns |
| --- | --- |
| `Health_Check_History` | `Timestamp`, `Application`, `Environment`, `Service Name`, `Endpoint`, `Check Type`, `HTTP Status`, `Response Time Ms`, `Health Status`, `Functional Validation`, `Retry Count`, `Error Category`, `Error Message`, `Workflow Execution ID` |
| `Downtime_Incidents` | `Incident ID`, `Application`, `Environment`, `Service Name`, `Service Type`, `Endpoint`, `Severity`, `Failure Category`, `Failure Reason`, `Downtime Start`, `Recovery Time`, `Downtime Seconds`, `Downtime Minutes`, `Status`, `HTTP Status` |
| `Daily_Availability` | `Date`, `Environment`, `Service Name`, `Total Checks`, `Successful Checks`, `Failed Checks`, `Degraded Checks`, `Functional Failures`, `Downtime Incidents`, `Total Downtime Minutes`, `Availability Percentage`, `Average Response Time Ms`, `Maximum Response Time Ms` |
| `Settings` *(optional)* | `Key`, `Value` — omit it and `GET /settings` returns documented defaults |

Copy the spreadsheet id from its URL: `docs.google.com/spreadsheets/d/**<THIS_PART>**/edit`.

### 2.3 Replace the placeholders

- `REPLACE_WITH_SPREADSHEET_ID` → **11 Google Sheets nodes** across both workflows
  (10 in the API workflow, 1 in the monitor).
- `REPLACE_WITH_MONITOR_WORKFLOW_ID` → node `API 08c - Run Monitoring Workflow`.
  Open the monitor workflow and copy the id from its URL (`.../workflow/<THIS_PART>`).

### 2.4 Attach credentials and activate

1. Select your Google Sheets credential on every Sheets node (OAuth2 — sign in to Google when
   n8n Cloud prompts).
2. **Activate both workflows.** A webhook only answers while its workflow is active.

### 2.5 Smoke-test the webhooks

```bash
BASE=https://<your-instance>.app.n8n.cloud/webhook

curl -s "$BASE/health-status?environment=QA" | head -c 400
curl -s "$BASE/incidents?environment=QA"     | head -c 400
curl -s "$BASE/uptime?environment=QA"        | head -c 400
curl -s "$BASE/settings"
curl -s -X POST "$BASE/health-check" -H 'Content-Type: application/json' -d '{"environment":"QA"}'
```

While testing in the editor, switch the URL prefix to `webhook-test` and click **Execute workflow**
first — test URLs only listen for one call after you press Execute.

### 2.6 Deploy the dashboard to Vercel

Either connect a Git repo (**Project → Add New → Import Git Repository**, then set
**Root Directory** to `Chapter_08_n8n/09_DownTime_Tracker`) or deploy straight from the folder:

```bash
cd Chapter_08_n8n/09_DownTime_Tracker
npx vercel login
npx vercel --prod        # run from this folder = this folder is the project root
```

Then add the environment variables in **Project → Settings → Environment Variables**
(values for an n8n Cloud instance):

| Name | Value |
| --- | --- |
| `N8N_BASE_URL` | `https://<your-instance>.app.n8n.cloud` |
| `N8N_WEBHOOK_PATH` | `webhook` |
| `N8N_API_KEY` | *(leave empty unless you add Header Auth to the Webhook nodes)* |
| `N8N_TIMEOUT_MS` | `10000` |
| `USE_LIVE_DATA` | `true` |
| `N8N_FALLBACK_TO_MOCK` | `true` |
| `NEXT_PUBLIC_N8N_UI_URL` | `https://<your-instance>.app.n8n.cloud` |

Apply them to **Production, Preview and Development**, then **redeploy** — `NEXT_PUBLIC_*` values are
baked in at build time. Without `USE_LIVE_DATA=true` the deployed site will look healthy but display
mock data.

### 2.7 Verify

- Open the deployment → the summary cards should show your real services.
- **Run Health Check** → should report an execution id (check *Executions* in n8n).
- If you see mock values, read the function logs — every fallback prints
  `[vwo-qa] <label> fell back to mock data: <reason>`.

---

## 3. Step 1 — n8n side

The monitoring workflow (`n8n/09_DownTime_Tracker.json`) is **schedule-driven and has no HTTP
interface**, so it cannot be called by the dashboard on its own. The read API lives in a second
workflow: `n8n/09_DownTime_Tracker.API.json`.

1. **Import both workflows** into n8n (see §2.1).
2. **Fix the placeholders** — listed per node in the API workflow's sticky note, or:
   `node -e "…"` — simply search the JSON for `REPLACE_WITH_` (11 hits).
3. **Attach credentials** — select your Google Sheets credential on each Sheets node.
4. **Create the `Settings` sheet** (optional). Add a tab named `Settings` with `Key` / `Value`
   columns. When it is missing, node `API 09a` continues on error and `GET /settings` returns
   documented defaults — so the dashboard works either way.
5. **Activate the API workflow.** Webhooks only respond while the workflow is *active*.
6. **Smoke-test each endpoint** (§2.5).
7. **(Recommended) Protect the webhooks.** Add a *Header Auth* credential to each Webhook node
   (Name: `x-api-key`, Value: a random secret) and set the same value as `N8N_API_KEY` on the app side.

Regenerate the API workflow after editing its mappers:

```bash
cd n8n && node build-api-workflow.mjs
```

### Field mapping notes

The mappers normalise the workflow's own vocabulary to the dashboard's contract:

| Monitoring workflow | Dashboard |
| --- | --- |
| `healthStatus = UP` | `HEALTHY` |
| `healthStatus = DEGRADED` | `SLOW` |
| `Severity = SEV-1…SEV-4` | `Critical` / `High` / `Medium` / `Low` |
| `Status = OPEN / RESOLVED` | `Open` / `Resolved` |
| Incident id `VWO-DOWN-20260910-103604` | used verbatim as the incident id |

Two endpoints are **derived**, because the sheets do not store the data per-attempt:

- `retry-history` — rebuilt from each incident using the workflow's fixed policy
  (3 attempts, 20 s then 30 s waits).
- `Response Time Threshold` / `critical` per service — not stored in
  `Health_Check_History`, so they are taken from documented defaults. The authoritative
  definitions live in the monitoring workflow's `02 - Load VWO Service Configuration` node.

If you want the dashboard to show real per-service thresholds, add `Response Time Threshold Ms`
to the `18a - Build Health History Rows` row — the mapper already reads that column.

---

## 4. Step 2 — run locally against n8n

```bash
cd Chapter_08_n8n/09_DownTime_Tracker
cp .env.local.example .env.local     # then edit it
npm install
npm run dev
```

```env
N8N_BASE_URL=https://<your-instance>.app.n8n.cloud
N8N_WEBHOOK_PATH=webhook
N8N_API_KEY=
USE_LIVE_DATA=true
N8N_FALLBACK_TO_MOCK=true
NEXT_PUBLIC_N8N_UI_URL=https://<your-instance>.app.n8n.cloud
```

`USE_LIVE_DATA=false` (or unset) keeps the dashboard on mock data — useful for UI work.

---

## 5. Step 3 — deploy to Vercel

1. **Push the repo** (or use the `vercel` CLI — see §2.6) and **import the project** in Vercel.
2. **Set Root Directory** to `Chapter_08_n8n/09_DownTime_Tracker` (Project → Settings → General).
   Framework preset is auto-detected as **Next.js** — no `vercel.json` is needed.
3. **Do not** add `output: 'export'` to `next.config.mjs`. The app needs server rendering
   (`force-dynamic` + `cache: "no-store"`); a static export cannot read live n8n data.
4. **Add environment variables** (Project → Settings → Environment Variables) for
   *Production*, *Preview* and *Development* — see the table in §2.6.
5. **Deploy.** `NEXT_PUBLIC_*` values are inlined at build time — after changing one you must
   **redeploy** for it to take effect. Server-only values are read at runtime.
6. **Optional:** set the function region (Project → Settings → Functions) close to your n8n
   instance to cut latency.

### n8n must be publicly reachable

`N8N_BASE_URL` is called *from Vercel*, so `http://localhost:5678` cannot work. Options:

| Option | Notes |
| --- | --- |
| n8n Cloud | Simplest. Note the region for latency. |
| Self-hosted on a VPS / Railway / Render | Give it a public HTTPS domain (Caddy, Traefik, nginx + Let's Encrypt). |
| Cloudflare Tunnel / ngrok | Fine for a demo; not stable for long-term use. |

---

## 6. Security checklist

- **Protect the deployment.** The dashboard exposes your service health and a working
  "Run Health Check" button. Enable Vercel **Deployment Protection** (password / SSO) or put
  an auth layer in front of it.
- **Keep the API key server-side.** `N8N_API_KEY` has no `NEXT_PUBLIC_` prefix precisely so it
  stays out of the bundle. Never rename it.
- **Scope the n8n credential.** The Google Sheets credential used by the API workflow only needs
  read access to the tracker workbook (plus write access on `Downtime_Incidents` and `Settings`
  for the resolve/settings endpoints).
- **`N8N_FALLBACK_TO_MOCK=false` once proven.** Otherwise a broken integration looks like a
  healthy (mock) dashboard. With it `false`, n8n failures surface as errors instead.
- **n8n Cloud is public.** Anyone who learns a webhook path can read your health data, so the
  Header Auth step (§3.7) matters more on Cloud than on a private instance.

---

## 7. Operations

- **Fallback visibility.** Every degraded call is logged server-side as
  `[vwo-qa] <label> fell back to mock data: <reason>` — check Vercel → Deployments → Functions logs.
- **Timeouts.** `N8N_TIMEOUT_MS` (default 10 s) bounds each outbound call so a hung n8n does not
  hit the Vercel function limit.
- **Auto refresh.** The top bar re-renders the current route once a minute while "Auto Refresh"
  is ON, so each open tab costs roughly one server render per minute.
- **Mutations never fall back.** `POST /api/health-check`, `POST /api/incidents/resolve` and
  `POST /api/settings` return `502` when n8n is unreachable, and the UI shows the reason.

### Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Dashboard shows mock data with `USE_LIVE_DATA=true` | Called failed — check the function logs for the fallback reason. |
| `502` from `/api/health-check` | `N8N_BASE_URL` wrong, or the API workflow is not **active**. |
| n8n returns `404` for every path | Wrong `N8N_WEBHOOK_PATH` (`webhook` vs `webhook-test`), or the workflow is inactive. |
| `401` / `403` from n8n | Header Auth enabled on the Webhook node but `N8N_API_KEY` not set (or mismatched). |
| `403` from Google in n8n | The Sheets credential is not attached, or the spreadsheet was not shared with that Google account. |
| `Unable to parse range` in n8n | A tab name is missing/misspelled — see the table in §2.2. |
| All services show the same threshold | Expected — see *Field mapping notes* in §3. |
| Empty incident list | `Downtime_Incidents` has no rows yet for that environment, or the spreadsheet id placeholder was not replaced. |
| Paste into the canvas does nothing | Click the canvas first (the paste target must be the workflow editor). |
