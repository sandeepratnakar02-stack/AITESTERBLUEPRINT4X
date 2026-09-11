# VWO QA Downtime Tracker

A personal QA observability dashboard for monitoring the **availability, functional health and
response time of VWO QA services**. The automation backend is an **n8n** workflow
(`./n8n/09_DownTime_Tracker.json`); this app is the front end that consumes its webhook responses.

![stack](https://img.shields.io/badge/Next.js-15-black) ![stack](https://img.shields.io/badge/TypeScript-5-blue) ![stack](https://img.shields.io/badge/Tailwind-3-38bdf8) ![stack](https://img.shields.io/badge/Recharts-2-22c55e)

---

## 1. Tech stack

| Concern      | Choice                                        |
| ------------ | --------------------------------------------- |
| Framework    | Next.js 15 (App Router, React Server Components) |
| Language     | TypeScript (strict)                           |
| Styling      | Tailwind CSS 3 + shadcn/ui-style primitives   |
| Icons        | lucide-react                                  |
| Charts       | Recharts                                      |
| Fonts        | system sans stack (no network fetch required) |

Light mode only. No database — the data layer is a **mock-first service layer** designed so n8n
webhooks can be plugged in without touching a single component.

---

## 2. Getting started

```bash
cd Chapter_08_n8n/09_DownTime_Tracker
npm install
npm run dev            # http://localhost:3000
```

Other scripts:

```bash
npm run build          # production build
npm run start          # serve the production build
npm run typecheck      # tsc --noEmit
```

The dashboard boots **standalone with realistic mock data** anchored to the reference snapshot
`10 Sep 2026 • 10:42 AM`, so the UI matches the QA spec out of the box.

---

## 3. Pages

| Route                 | Purpose                                                                                   |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `/`                   | **Dashboard** — summary KPIs, service health grid, response-time + uptime charts, recent incidents, retry monitor, status classification |
| `/services`           | Monitored services, check definitions (URL, method, assertions, threshold, retry policy)  |
| `/checks`             | Raw health check history including every retry attempt                                    |
| `/incidents`          | Incident list with severity, duration and retry counts                                    |
| `/incidents/[id]`     | Incident drill-down: timing, failure reason, raw HTTP response, timeline, n8n execution ID |
| `/response-times`     | 24h latency trends for all services + p95/max/breach summary                              |
| `/retries`            | Retry timelines and the retry attempt log with wait times                                 |
| `/logs`               | Developer log viewer with environment / service / status / time filters and search        |
| `/settings`           | Response-time threshold, retry policy, check interval, environment configuration          |

The selected environment (`QA` / `Staging` / `Production`) lives in the `?env=` query parameter, so
every page is deep-linkable and server-rendered with the matching data set.

---

## 4. Architecture

```
src/
├─ app/                         # routes (server components)
│  ├─ layout.tsx                # AppShell: sidebar + top bar
│  ├─ page.tsx                  # Dashboard
│  ├─ services|checks|incidents|response-times|retries|logs|settings/page.tsx
│  ├─ incidents/[id]/page.tsx   # incident drill-down
│  └─ api/                      # same-origin proxies for browser actions
│     ├─ health-check/route.ts  # POST -> n8n POST /health-check
│     ├─ incidents/resolve/     # POST -> n8n POST /incidents-resolve
│     └─ settings/route.ts      # GET/POST -> n8n GET /settings + POST /settings-write
├─ components/
│  ├─ layout/                   # AppShell, Sidebar, TopBar, EnvironmentSelector
│  ├─ dashboard/                # StatusBadge, MetricCard, ServiceHealthTable, ResponseTimeChart,
│  │                            # UptimeChart, IncidentTable, RetryTimeline, HealthCheckDrawer,
│  │                            # LogViewer, SettingsForm, StatusClassification, IncidentActions
│  └─ ui/                       # button, card, badge, input/select/label, table, sheet, switch, tabs
├─ lib/
│  ├─ api.ts                    # ⬅ server data layer (mock ⟷ n8n)
│  ├─ n8n.ts                    # server-only n8n transport + fallback policy
│  ├─ n8n-ui.ts                 # public n8n deep links (editor URLs)
│  ├─ client-api.ts             # browser → same-origin /api/* helpers
│  ├─ mock-data.ts              # deterministic fixture data
│  ├─ constants.ts              # thresholds, SLA, status classification, navigation
│  ├─ format.ts                 # time / duration / latency formatters
│  └─ environment.ts            # ?env= parsing
└─ types/index.ts               # Service, HealthCheck, Incident, RetryAttempt, ResponseTimeMetric…
```

**Data flow:** `page.tsx` (server) → `lib/api.ts` → `lib/n8n.ts` → n8n webhook → props → presentational
components. Browser-initiated actions call `lib/client-api.ts` → `/api/*` route handlers → n8n, so the
browser never talks to n8n directly (no CORS, no credentials in the bundle). Interactive pieces
(drawer, filters, charts, settings form) are the only client components.

---

## 5. Status classification

| State                | Badge      | Meaning                                                     |
| -------------------- | ---------- | ----------------------------------------------------------- |
| `HEALTHY`            | Healthy ●  | HTTP status and functional checks passed.                    |
| `SLOW`               | Degraded ● | Request succeeded but the response threshold was exceeded.   |
| `FUNCTIONAL_FAILURE` | Degraded ● | HTTP succeeded but expected content/functionality failed.    |
| `DOWN`               | Down ●     | Endpoint unavailable or unexpected server response.          |
| `RETRYING`           | Retrying ◌ | Health check failed and automatic retries are in progress.   |
| `UNKNOWN`            | Unknown ●  | No result recorded yet.                                      |

---

## 6. Connecting n8n

Two n8n workflows are involved:

| Workflow | File | Role |
| --- | --- | --- |
| `09_DownTime_Tracker` | `n8n/09_DownTime_Tracker.json` | Schedule trigger → checks → retries → Sheets + Slack. **No HTTP surface.** |
| `09b_DownTime_Tracker_API` | `n8n/09_DownTime_Tracker.API.json` | Webhook read API over the same sheets. **This is what the dashboard calls.** |

Because the monitoring workflow only *pushes* to Google Sheets, the API workflow is what makes the
dashboard possible. Regenerate it after editing the mappers:

```bash
cd n8n && node build-api-workflow.mjs
```

**Full setup walkthrough: [`DEPLOYMENT.md`](DEPLOYMENT.md).** Summary:

```bash
cp .env.local.example .env.local
```

```env
N8N_BASE_URL=https://your-n8n.example.com   # server-only
N8N_WEBHOOK_PATH=webhook                    # "webhook-test" while editing in n8n
N8N_API_KEY=                                # optional x-api-key shared secret
USE_LIVE_DATA=true                          # ⬅ go live
NEXT_PUBLIC_N8N_UI_URL=https://your-n8n.example.com   # deep links only
```

### Endpoints consumed by the app

| Function in `lib/api.ts` | Endpoint | Source |
| --- | --- | --- |
| `getServiceHealth()` / `getDashboardSummary()` | `GET /health-status` | `Health_Check_History` |
| `getHealthChecks()` | `GET /health-checks` | `Health_Check_History` |
| `getIncidents()` | `GET /incidents` | `Downtime_Incidents` |
| `getIncidentById()` | `GET /incidents?id=…` | `Downtime_Incidents` |
| `getRetryHistory()` | `GET /retry-history` | `Downtime_Incidents` (derived) |
| `getResponseTimeHistory()` | `GET /response-times` | `Health_Check_History` |
| `getUptimeHistory()` | `GET /uptime` | `Daily_Availability` |
| `getLogs()` | `GET /logs` | `Health_Check_History` |
| `runHealthCheck()` | `POST /health-check` | triggers the monitor workflow |
| `getSettings()` / `updateSettings()` | `GET /settings`, `POST /settings-write` | `Settings` |
| `resolveIncident()` | `POST /incidents-resolve` | `Downtime_Incidents` |

Every call is server-side and forwards the environment as `?environment=QA`. Browser-triggered
actions go through `/api/health-check`, `/api/incidents/resolve` and `/api/settings` instead.

**Behaviour notes**

- n8n emits `UP / DOWN / DEGRADED / FUNCTIONAL_FAILURE`; the mappers normalise this to the
  dashboard's `HEALTHY / DOWN / SLOW / FUNCTIONAL_FAILURE`.
- `retry-history` and the per-service latency threshold are **derived** — see
  *Field mapping notes* in `DEPLOYMENT.md`.
- When a live call fails, the page falls back to mock data and logs
  `[vwo-qa] … fell back to mock data`. Set `N8N_FALLBACK_TO_MOCK=false` to surface errors instead.

---

## 7. Design notes

- **Light mode only.** Canvas `#F7F8FA`, cards white with `border-slate-200`-equivalent borders and a
  very soft shadow (`shadow-card`).
- **Restrained colour semantics:** green = healthy, red = down, amber = degraded/retrying, blue =
  informational. No gradients, no dark mode, no flashy animation (only a 150–200 ms drawer transition
  and a slow pulse on skeleton loaders).
- **Responsive:** desktop-first, verified with zero horizontal overflow at 1440 / 1180 / 900 / 768 /
  700 px. The sidebar auto-collapses below 1180 px and hides below 768 px (mobile shows a toggle).
- **Token system:** all colours live in `src/app/globals.css` (CSS variables) + `tailwind.config.ts`,
  including the `status.*` palette used by the badges and charts.

---

## 8. Roadmap

1. Follow [`DEPLOYMENT.md`](DEPLOYMENT.md) to point the dashboard at your n8n instance and publish
   it on Vercel.
2. Add `Response Time Threshold Ms` to the monitoring workflow's `Health Check History` row so
   per-service thresholds come from the workflow instead of the mapper default.
3. Persist per-attempt retry records if you want `retry-history` to be recorded rather than derived.
4. Point `02 - Load VWO Service Configuration` at the `Settings` sheet so the Settings page changes
   what the monitor actually checks.

---

## 9. Verifying without n8n

`scripts/stub-n8n-api.mjs` is a zero-dependency HTTP server that reproduces the **exact** payloads
of the hand-authored workflows in this chapter (wrapper objects, Google-Sheets timestamp format,
`UP`/`DEGRADED` states, `incidentId`, `SEV-*`, the `{ settings: {…} }` envelope). Use it to prove
the dashboard end-to-end before n8n is reachable:

```bash
node scripts/stub-n8n-api.mjs      # terminal 1 → http://127.0.0.1:5999/webhook

USE_LIVE_DATA=true \
N8N_BASE_URL=http://127.0.0.1:5999 \
N8N_FALLBACK_TO_MOCK=false \
npm run dev                        # terminal 2
```

`N8N_FALLBACK_TO_MOCK=false` is important: it turns any contract mismatch into a visible error
instead of silently serving mock data. The stub logs every request, so you can see exactly which
endpoints the dashboard called.

### Response compatibility

`src/lib/normalize.ts` makes the data layer tolerant of both producer styles — aliases are looked
up in order, response envelopes are unwrapped, enums are coerced (`UP → HEALTHY`,
`SEV-1 → Critical`, `OPEN → Open`) and sheet timestamps are converted to ISO. It never throws, so a
partially-shaped webhook degrades to empty/safe values instead of taking a page down.

Reads are tolerant; **writes return `502` if n8n fails**, so a failed action is never reported as
success.
