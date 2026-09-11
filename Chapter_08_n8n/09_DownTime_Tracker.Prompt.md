# 09 — VWO QA Downtime Tracker · Prompt Pack

The prompts used to generate the dashboard in [`09_DownTime_Tracker/`](./09_DownTime_Tracker/).

| | |
|---|---|
| **Output** | `09_DownTime_Tracker/` (Next.js 15 app) + `09_DownTime_Tracker/n8n/` (workflows) |
| **Backend** | n8n — `n8n/09_DownTime_Tracker.json` (monitor) + `n8n/09_DownTime_Tracker.API.json` (read API) |
| **Docs produced** | [`09_DownTime_Tracker/README.md`](./09_DownTime_Tracker/README.md), [`DEPLOYMENT.md`](./09_DownTime_Tracker/DEPLOYMENT.md) |

---

## Prompt 1 — full specification (verbatim)

```text
Use the below prompt and replace the Json under 09_DownTime_Tracker for n8n


Build a modern personal QA monitoring dashboard called:

"VWO QA Downtime Tracker"

Purpose:
This application is a personal QA engineering dashboard used to monitor the
availability, functional health, and response time of VWO QA services.

The backend automation is handled by n8n. The UI should be built as a clean
frontend that can later consume n8n webhook/API responses.

TECH STACK

Use:
- Next.js 15+
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide icons
- Recharts for charts

Do not create a backend database yet.
Use realistic mock data and structure the code so APIs can be connected later.

DESIGN

LIGHT MODE ONLY.

Create a premium, minimal engineering dashboard inspired by:
- Vercel
- Linear
- Datadog
- Grafana

But keep the UI lighter and simpler.

Background:
#FFFFFF / very light gray

Cards:
White with subtle gray borders and very soft shadows.

Typography:
Modern sans-serif typography.

Use restrained colors:
- Green = healthy
- Red = down
- Amber = degraded/retrying
- Blue = informational

Avoid excessive gradients.
Avoid dark mode.
Avoid flashy animations.

The dashboard should feel like an internal QA engineering tool.

---------------------------------

SIDEBAR

Create a collapsible left navigation sidebar.

At the top display:

VWO
QA Downtime Tracker

Navigation:

Dashboard
Services
Health Checks
Incidents
Response Times
Retry History
Logs
Settings

At the bottom:

QA Environment
User profile

---------------------------------

TOP BAR

Add:

Environment selector:
QA
Staging
Production

Application selector:
VWO

Refresh button

"Run Health Check" button

Last Checked:
10 Sep 2026 • 10:42 AM

Auto Refresh:
ON

---------------------------------

DASHBOARD PAGE

Create a heading:

VWO Service Health

Subheading:

Real-time availability and functional monitoring for VWO QA services.

Create summary cards:

Overall Status
Healthy

Services Monitored
5

Healthy Services
4

Failed Services
1

Active Incidents
1

Average Response Time
842 ms

Uptime
99.96%

---------------------------------

SERVICE HEALTH SECTION

Create a table/card titled:

Service Health

Columns:

Service
Environment
Check Type
Endpoint
Status
HTTP Status
Response Time
Attempts
Last Checked
Action

Example services:

VWO Main Application
QA
HTTP
https://app.vwo.com/
Healthy
200
724 ms
1
10:42 AM

VWO Login
QA
Functional
/login
Healthy
200
910 ms
1

VWO Campaign Dashboard
QA
Functional
/dashboard
Degraded
200
3.4 sec
2

VWO API
QA
HTTP
/api
Healthy
200
412 ms
1

VWO Editor
QA
Functional
/editor
Down
500
5.8 sec
3

Status should use badges:

Healthy - green
Down - red
Degraded - amber
Retrying - amber with small spinner
Unknown - gray

---------------------------------

RESPONSE TIME CHART

Create a line chart titled:

Response Time - Last 24 Hours

Y axis:
milliseconds

X axis:
time

Show:
VWO Main Application
VWO Login
VWO API

Include an SLA threshold line at:

3000 ms

---------------------------------

UPTIME CHART

Create another card:

Uptime - Last 7 Days

Show percentage values per day.

Target:
99.9%

---------------------------------

INCIDENTS SECTION

Create:

Recent Incidents

Columns:

Incident
Service
Environment
Started
Duration
Retry Attempts
Status

Examples:

INC-1042
VWO Editor
QA
10:36 AM
6m 21s
3
Open

INC-1041
Campaign Dashboard
QA
Yesterday
2m 14s
2
Recovered

---------------------------------

RETRY MONITOR

Create a dedicated panel:

Retry Activity

Show timeline:

Initial health check failed
10:36:04

Retry #1 scheduled
Wait: 20 seconds

Retry #2 failed
10:36:26

Retry #3 scheduled
Wait: 30 seconds

Final check failed
10:36:59

Incident created
10:37:00

Use a vertical timeline.

---------------------------------

HEALTH CHECK DETAILS

When clicking a service, open a drawer or modal.

Show:

Service Name
VWO Main Application

Application
VWO

Environment
QA

Check Type
HTTP

URL
https://app.vwo.com/

HTTP Method
GET

Expected Status
200

Actual Status
200

Expected Text
optional

Response Time Threshold
3000 ms

Actual Response Time
724 ms

Critical
Yes

Retry Policy

Maximum Attempts
3

Retry #2 Delay
20 seconds

Retry #3 Delay
30 seconds

---------------------------------

STATUS CLASSIFICATION

Display the health states clearly:

HEALTHY
HTTP status and functional checks passed.

SLOW
Request succeeded but response threshold exceeded.

FUNCTIONAL_FAILURE
HTTP succeeded but expected content/functionality failed.

DOWN
Endpoint unavailable or unexpected server response.

RETRYING
Health check failed and automatic retries are in progress.

---------------------------------

LOG VIEWER

Create a Logs page.

Use a clean developer-style log viewer.

Columns:

Timestamp
Service
Attempt
Status
HTTP Code
Response Time
Message

Allow filtering by:

Environment
Service
Status
Time

Search input:

Search logs...

---------------------------------

INCIDENT DETAIL PAGE

When clicking an incident, show:

Incident ID
Status
Severity
Affected Service
Environment

Detection Time
Recovery Time
Downtime Duration

Failure Reason

HTTP response

Retry attempts

Timeline

n8n Execution ID

Include buttons:

Open n8n Execution

Re-run Check

Resolve Incident

---------------------------------

SETTINGS

Create settings for:

Response Time Threshold

Default:
3000 ms

Retry Attempts:
3

Retry Delays:

Attempt 2:
20 seconds

Attempt 3:
30 seconds

Check Interval:

1 minute
5 minutes
10 minutes
15 minutes

Environment configuration.

---------------------------------

N8N INTEGRATION

Create an API service layer with placeholder functions:

getServiceHealth()

getHealthChecks()

getIncidents()

getIncidentById()

runHealthCheck()

getResponseTimeHistory()

getRetryHistory()

The implementation can initially use mock data.

Add comments showing where an n8n webhook URL can later be connected.

For example:

NEXT_PUBLIC_N8N_WEBHOOK_URL

POST /health-check
GET /health-status
GET /incidents

---------------------------------

RESPONSIVENESS

The dashboard must work well on:

Desktop
Laptop
Tablet

Desktop is the primary target.

---------------------------------

QUALITY

Use reusable React components.

Suggested components:

StatusBadge
MetricCard
ServiceHealthTable
ResponseTimeChart
UptimeChart
IncidentTable
RetryTimeline
EnvironmentSelector
HealthCheckDrawer
LogViewer

Use TypeScript interfaces for:

Service
HealthCheck
Incident
RetryAttempt
ResponseTimeMetric

Do not put everything into one component.

Generate production-quality frontend code.

The final result should look like a polished personal QA observability platform,
not a generic admin template.
```

---

## Prompt 2 — home screen layout reference (verbatim)

Sent as a follow-up to pin down the Dashboard composition:

```text
I have added the "chat.byokUtilityModelDefault": "mainAgent" , proceed now with below eaxmple of home screen
┌──────────────────────────────────────────────────────────────────┐
│ VWO QA Downtime Tracker       QA ▼        ↻ Run Health Check    │
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│ Dashboard    │ VWO Service Health                               │
│ Services     │ Real-time QA application monitoring              │
│ Checks       │                                                   │
│ Incidents    │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│ Response     │ │Healthy │ │Uptime  │ │Resp.   │ │Incident│     │
│ Retries      │ │  4/5   │ │99.96% │ │842 ms  │ │   1    │     │
│ Logs         │ └────────┘ └────────┘ └────────┘ └────────┘     │
│ Settings     │                                                   │
│              │ Service Health                                   │
│              │ ┌─────────────────────────────────────────────┐   │
│              │ │ VWO Main App    ● Healthy        724 ms   │   │
│              │ │ VWO Login       ● Healthy        910 ms   │   │
│              │ │ Campaign        ● Degraded       3.4 sec  │   │
│              │ │ VWO Editor      ● Down           5.8 sec  │   │
│              │ └─────────────────────────────────────────────┘   │
│              │                                                   │
│              │ Response Time - 24 Hours                          │
│              │ ┌─────────────────────────────────────────────┐   │
│              │ │              ╱╲      ╱╲                    │   │
│              │ │     ╱╲    ╱    ╲╱╲╱   ╲                   │   │
│              │ └─────────────────────────────────────────────┘   │
└──────────────┴───────────────────────────────────────────────────┘
```

---

## Follow-up requests (summarised, not verbatim)

1. **"is this can be run using n8n 09_DownTime_Tracker.json and can be publish on vercel"** —
   answered: the workflow is schedule-only (no webhook), so a read API was added; Vercel caveats
   listed (public n8n URL, CORS, build-time env vars, auth).
2. **"yes"** — approve the three-point plan, which produced:
   - `n8n/09_DownTime_Tracker.API.json` (45 nodes, 11 webhook endpoints) + `build-api-workflow.mjs`
   - `app/api/*` same-origin route handlers + server-only `lib/n8n.ts`
   - server-only env vars and `DEPLOYMENT.md`

---

## Reusing this prompt

To regenerate the app from scratch, paste **Prompt 1**, then **Prompt 2** for the Dashboard layout.

Deviations worth knowing when reusing it:

- **shadcn/ui** is implemented as hand-written primitives in `src/components/ui/` (Card, Button,
  Badge, Table, Sheet, Switch, Tabs, Input/Select/Label) rather than via the shadcn CLI — same API
  shape, no Radix dependency.
- The spec's `NEXT_PUBLIC_N8N_WEBHOOK_URL` placeholder became **server-only** `N8N_BASE_URL` plus
  `NEXT_PUBLIC_N8N_UI_URL` for deep links, so credentials never reach the browser.
- `Inter` is referenced first in the font stack but not fetched over the network, so builds work
  offline.
