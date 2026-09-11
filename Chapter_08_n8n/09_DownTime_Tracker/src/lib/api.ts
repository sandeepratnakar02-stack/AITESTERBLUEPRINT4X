/**
 * ============================================================================
 *  VWO QA Downtime Tracker — server data layer
 * ============================================================================
 *
 * Every dashboard read goes through this module (server components + the
 * `app/api/*` route handlers). It never runs in the browser, so the n8n webhook
 * URL and API key stay private and there is no CORS to configure.
 *
 * Endpoints called on the n8n workflow:
 *
 *   GET  /health-status        -> { summary, services }
 *   GET  /health-checks        -> HealthCheck[]        (or { healthChecks: [] })
 *   GET  /incidents            -> Incident[]           (or { incidents: [] })
 *   GET  /retry-history        -> RetryAttempt[]       (or { retryHistory: [] })
 *   GET  /response-times       -> ResponseTimeMetric[] (or { responseTimes: [] })
 *   GET  /uptime               -> UptimePoint[]        (or { uptime: [] })
 *   GET  /logs                 -> LogEntry[]           (or { logs: [] })
 *   POST /health-check         -> { ok, triggeredAt, executionId, services }
 *   GET  /settings             -> DashboardSettings    (or { settings: {...} })
 *   POST /settings-write       -> persists settings
 *   POST /incidents-resolve    -> { ok }
 *
 * Responses are passed through `lib/normalize.ts`, which accepts both the plain
 * arrays/field names this app was specified with and the wrapper objects/enum
 * spellings the hand-authored workflows in this chapter produce.
 *
 * With `USE_LIVE_DATA` unset the functions resolve the deterministic mock
 * dataset, so the dashboard runs standalone. With `USE_LIVE_DATA=true` a failed
 * live call rejects rather than quietly substituting sample data, so callers can
 * surface an error or degraded section. `lib/dashboard.ts` aggregates these
 * loaders into the single `/api/dashboard` payload the dashboard page consumes.
 * ============================================================================
 */

import { cache } from "react";
import { USE_LIVE_DATA, n8nFetch, liveOrMock } from "@/lib/n8n";
import {
  normalizeHealthCheck,
  normalizeIncident,
  normalizeLogEntry,
  normalizeResponseTimeMetric,
  normalizeRetryAttempt,
  normalizeService,
  normalizeSettings,
  normalizeSummary,
  normalizeUptimePoint,
  toArray,
  toIso,
} from "@/lib/normalize";
import {
  getMockDashboardSummary,
  getMockHealthChecks,
  getMockIncidentById,
  getMockIncidents,
  getMockLogs,
  getMockResponseTimeHistory,
  getMockRetryHistory,
  getMockServiceById,
  getMockServices,
  getMockSettings,
  getMockUptime,
} from "@/lib/mock-data";
import type {
  DashboardSettings,
  DashboardSummary,
  Environment,
  HealthCheck,
  Incident,
  LogEntry,
  RetryAttempt,
  ResponseTimeMetric,
  Service,
  UptimePoint,
} from "@/types";

export { USE_LIVE_DATA };

const byNewest = (a: string, b: string) => b.localeCompare(a);

/* -------------------------------------------------------------------------- */
/*  Service health                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `GET /health-status` — memoised per render pass so the dashboard can derive
 * both the service list and the summary from a single n8n round trip.
 */
export const getHealthStatus = cache(
  async (environment: Environment): Promise<{ summary: DashboardSummary; services: Service[] }> =>
    liveOrMock(
      "health-status",
      async () => {
        const payload = await n8nFetch<unknown>("/health-status", { query: { environment } });
        const services = toArray<unknown>(payload, "services").map((raw) =>
          normalizeService(raw, environment),
        );
        return {
          services,
          summary: normalizeSummary((payload as Record<string, unknown>)?.summary, services, environment),
        };
      },
      () => ({
        summary: getMockDashboardSummary(environment),
        services: getMockServices(environment),
      }),
    ),
);

/** Latest result for every monitored service. */
export async function getServiceHealth(environment: Environment = "QA"): Promise<Service[]> {
  return (await getHealthStatus(environment)).services;
}

export async function getServiceById(
  serviceId: string,
  environment: Environment = "QA",
): Promise<Service | undefined> {
  return liveOrMock(
    "service-by-id",
    async () => (await getServiceHealth(environment)).find((service) => service.id === serviceId),
    () => getMockServiceById(serviceId, environment),
  );
}

/* -------------------------------------------------------------------------- */
/*  History                                                                    */
/* -------------------------------------------------------------------------- */

/** `GET /health-checks` — raw check-level history. */
export async function getHealthChecks(environment: Environment = "QA"): Promise<HealthCheck[]> {
  return liveOrMock(
    "health-checks",
    async () => {
      const payload = await n8nFetch<unknown>("/health-checks", { query: { environment } });
      return toArray<unknown>(payload, "healthChecks", "checks")
        .map(normalizeHealthCheck)
        .sort((a, b) => byNewest(a.checkedAt, b.checkedAt));
    },
    () => getMockHealthChecks(environment),
  );
}

/** `GET /response-times` — 24h time-series behind the latency chart. */
export async function getResponseTimeHistory(
  environment: Environment = "QA",
): Promise<ResponseTimeMetric[]> {
  return liveOrMock(
    "response-times",
    async () => {
      const payload = await n8nFetch<unknown>("/response-times", {
        query: { environment, window: "24h" },
      });
      return toArray<unknown>(payload, "responseTimes", "metrics")
        .map(normalizeResponseTimeMetric)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },
    () => getMockResponseTimeHistory(environment),
  );
}

/**
 * `GET /uptime` — daily availability for the uptime chart.
 *
 * Memoised per render: the dashboard previously fetched this twice because both
 * the summary and the page requested it independently.
 */
export const getUptimeHistory = cache(
  async (environment: Environment = "QA"): Promise<UptimePoint[]> =>
    liveOrMock(
      "uptime",
      async () => {
        const payload = await n8nFetch<unknown>("/uptime", {
          query: { environment, days: "7" },
        });
        return toArray<unknown>(payload, "uptime", "points")
          .map(normalizeUptimePoint)
          .filter((point) => point.date !== "")
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-14);
      },
      () => getMockUptime(environment),
    ),
);

/** `GET /retry-history` — retry attempts derived from the incident record. */
export async function getRetryHistory(environment: Environment = "QA"): Promise<RetryAttempt[]> {
  return liveOrMock(
    "retry-history",
    async () => {
      const payload = await n8nFetch<unknown>("/retry-history", { query: { environment } });
      return toArray<unknown>(payload, "retryHistory", "retries")
        .map(normalizeRetryAttempt)
        .sort((a, b) => byNewest(a.at, b.at));
    },
    () => getMockRetryHistory(environment),
  );
}

/** `GET /logs` — flat, filterable log stream. */
export async function getLogs(environment: Environment = "QA"): Promise<LogEntry[]> {
  return liveOrMock(
    "logs",
    async () => {
      const payload = await n8nFetch<unknown>("/logs", { query: { environment } });
      return toArray<unknown>(payload, "logs", "entries")
        .map(normalizeLogEntry)
        .sort((a, b) => byNewest(a.timestamp, b.timestamp));
    },
    () => getMockLogs(environment),
  );
}

/* -------------------------------------------------------------------------- */
/*  Incidents                                                                  */
/* -------------------------------------------------------------------------- */

const fetchIncidents = cache(async (environment: Environment): Promise<Incident[]> =>
  liveOrMock(
    "incidents",
    async () => {
      const payload = await n8nFetch<unknown>("/incidents", { query: { environment } });
      return toArray<unknown>(payload, "incidents")
        .map(normalizeIncident)
        .sort((a, b) => byNewest(a.startedAt, b.startedAt));
    },
    () => getMockIncidents(environment),
  ),
);

/** `GET /incidents` — incident list for one environment. */
export async function getIncidents(environment: Environment = "QA"): Promise<Incident[]> {
  return fetchIncidents(environment);
}

/** `GET /incidents?id=...` — single incident incl. timeline + n8n execution id. */
export async function getIncidentById(incidentId: string): Promise<Incident | undefined> {
  return liveOrMock(
    "incident-by-id",
    async () => {
      const payload = await n8nFetch<unknown>("/incidents", { query: { id: incidentId } });
      const [first] = toArray<unknown>(payload, "incidents").map(normalizeIncident);
      if (first) return first;

      // Some producers return the incident object directly rather than an array.
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const direct = normalizeIncident(payload, 0);
        if (direct.id) return direct;
      }
      return undefined;
    },
    () => getMockIncidentById(incidentId),
  );
}

/* -------------------------------------------------------------------------- */
/*  Mutations (exposed to the browser through app/api/*)                       */
/* -------------------------------------------------------------------------- */

/** `POST /health-check` — ask n8n to run the check + retry cycle now. */
export async function runHealthCheck(environment: Environment = "QA"): Promise<{
  ok: boolean;
  triggeredAt: string;
  services: Service[];
  executionId: string;
}> {
  if (USE_LIVE_DATA) {
    const payload = await n8nFetch<Record<string, unknown>>("/health-check", {
      method: "POST",
      body: { environment, application: "VWO" },
      allowEmptyBody: true,
    });

    return {
      ok: payload?.ok !== false,
      triggeredAt: toIso(payload?.triggeredAt) ?? new Date().toISOString(),
      services: toArray<unknown>(payload, "services").map((raw) =>
        normalizeService(raw, environment),
      ),
      executionId: String(payload?.executionId ?? "unknown"),
    };
  }

  return {
    ok: true,
    triggeredAt: new Date().toISOString(),
    services: getMockServices(environment),
    executionId: "exec-mock",
  };
}

/** `POST /incidents-resolve` — mark an incident resolved from the detail page. */
export async function resolveIncident(incidentId: string): Promise<{ ok: boolean }> {
  if (USE_LIVE_DATA) {
    // The live webhook acknowledges with `200` and an empty body, so an empty
    // payload means "the workflow ran", not "the response was malformed".
    const payload = await n8nFetch<Record<string, unknown>>("/incidents-resolve", {
      method: "POST",
      body: { incidentId },
      allowEmptyBody: true,
    });
    return { ok: payload?.success !== false && payload?.ok !== false };
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

/** `GET /settings` — thresholds, retry policy and environment configuration. */
export async function getSettings(): Promise<DashboardSettings> {
  return liveOrMock(
    "settings",
    async () => normalizeSettings(await n8nFetch<unknown>("/settings")),
    () => getMockSettings(),
  );
}

/** `POST /settings-write` — persist the settings form. */
export async function updateSettings(payload: DashboardSettings): Promise<DashboardSettings> {
  if (USE_LIVE_DATA) {
    // The monitor workflow reads flat keys (`retryCount`, `retryDelayMs`), so
    // send both spellings — each producer picks up what it understands.
    await n8nFetch<unknown>("/settings-write", {
      method: "POST",
      allowEmptyBody: true,
      body: {
        ...payload,
        environment: payload.environments.find((entry) => entry.enabled)?.environment ?? "QA",
        retryCount: Math.max(0, payload.retryAttempts - 1),
        retryDelayMs: (payload.retryDelaysSeconds[0] ?? 20) * 1000,
      },
    });
  }
  return payload;
}
