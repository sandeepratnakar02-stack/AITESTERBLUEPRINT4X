import { cache } from "react";
import type {
  DashboardSnapshot,
  DashboardSource,
  Environment,
  HealthState,
  Incident,
  ResponseTimeMetric,
  RetryAttempt,
  Service,
  UptimePoint,
} from "@/types";
import {
  USE_LIVE_DATA,
  getHealthStatus,
  getIncidents,
  getResponseTimeHistory,
  getRetryHistory,
  getUptimeHistory,
} from "@/lib/api";
import { createLimiter, withDeadline } from "@/lib/concurrency";
import { N8N_REQUEST_TIMEOUT_MS } from "@/lib/n8n";

/* -------------------------------------------------------------------------- */
/*  Tunables                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How many n8n webhooks may be in flight at once.
 *
 * Deliberately bounded: an unrestricted `Promise.all` over all five endpoints
 * issued a burst the n8n instance sometimes refused, taking the whole dashboard
 * down with it. Measured on the live QA instance (5 webhooks, production build):
 *
 *   1 -> median 6.11 s | 2 -> median 3.50 s | 3 -> median 2.73 s | 5 -> median 2.32 s
 *
 * 3 is the default: close to the fully parallel time, still short of firing
 * every endpoint at once. Raise to 5 via `DASHBOARD_CONCURRENCY` if your plan
 * handles bursts, or drop to 1 for the gentlest possible setting.
 */
const CONCURRENCY = Math.max(1, Number(process.env.DASHBOARD_CONCURRENCY ?? 3));

/**
 * Per-source deadline. Slightly above the transport's own timeout so the more
 * specific error (timeout vs unreachable) usually wins.
 */
const SOURCE_DEADLINE_MS = N8N_REQUEST_TIMEOUT_MS + 5_000;

const EMPTY_SERVICES: Service[] = [];
const EMPTY_INCIDENTS: Incident[] = [];
const EMPTY_RESPONSE_TIMES: ResponseTimeMetric[] = [];
const EMPTY_UPTIME: UptimePoint[] = [];
const EMPTY_RETRY_HISTORY: RetryAttempt[] = [];

/* -------------------------------------------------------------------------- */
/*  Source settling                                                            */
/* -------------------------------------------------------------------------- */

interface SourceResult<T> {
  label: string;
  ok: boolean;
  data?: T;
  error?: string;
}

/**
 * Wraps a loader so a failure yields a recorded warning instead of aborting the
 * whole snapshot — "if incidents fail but health-status succeeds, still return
 * the health data".
 */
async function settle<T>(label: string, load: () => Promise<T>): Promise<SourceResult<T>> {
  try {
    return { label, ok: true, data: await withDeadline(load(), SOURCE_DEADLINE_MS, label) };
  } catch (error) {
    return {
      label,
      ok: false,
      error: `Cannot load ${label}: ${(error as Error).message}`,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Derivation                                                                 */
/* -------------------------------------------------------------------------- */

/** Used only when the workflow did not report an overall status itself. */
function statusFromServices(services: Service[]): HealthState {
  if (services.length === 0) return "UNKNOWN";

  const failed = services.filter(
    (service) => service.status === "DOWN" || service.status === "FUNCTIONAL_FAILURE",
  );
  if (failed.some((service) => service.critical)) return "DOWN";
  if (failed.length > 0) return "SLOW";

  return services.some((service) => service.status === "SLOW") ? "SLOW" : "HEALTHY";
}

function countFailed(services: Service[]) {
  return services.filter(
    (service) => service.status === "DOWN" || service.status === "FUNCTIONAL_FAILURE",
  ).length;
}

function countActiveIncidents(incidents: Incident[]) {
  return incidents.filter(
    (incident) => incident.status === "Open" || incident.status === "Investigating",
  ).length;
}

/* -------------------------------------------------------------------------- */
/*  Snapshot                                                                   */
/* -------------------------------------------------------------------------- */

async function buildSnapshot(environment: Environment): Promise<DashboardSnapshot> {
  const startedAt = Date.now();

  // One bounded pass over every source: capped concurrency (never an
  // unrestricted `Promise.all`), a per-source deadline, and failures isolated to
  // their own slice of the payload so a single bad upstream leaf degrades only
  // its own section.
  const limit = createLimiter(CONCURRENCY);

  const [health, incidents, responseTimes, uptime, retryHistory] = await Promise.all([
    settle("service health", () => limit(() => getHealthStatus(environment))),
    settle("incidents", () => limit(() => getIncidents(environment))),
    settle("response times", () => limit(() => getResponseTimeHistory(environment))),
    settle("uptime", () => limit(() => getUptimeHistory(environment))),
    settle("retry history", () => limit(() => getRetryHistory(environment))),
  ]);

  const services = health.data?.services ?? EMPTY_SERVICES;
  const incidentList = incidents.data ?? EMPTY_INCIDENTS;
  const uptimePoints = uptime.data ?? EMPTY_UPTIME;
  const reported = health.data?.summary;

  const failures = countFailed(services);
  const latestUptime = uptimePoints.length > 0 ? uptimePoints[uptimePoints.length - 1].uptimePct : 0;

  const sources: DashboardSource[] = [health, incidents, responseTimes, uptime, retryHistory].map(
    (result) => ({ label: result.label, ok: result.ok, error: result.error }),
  );

  const warnings = sources
    .map((source) => source.error)
    .filter((message): message is string => Boolean(message));

  /**
   * An environment the workflow knows nothing about reports `HEALTHY` with zero
   * services (`/health-status` synthesises a summary for any `environment=`), so
   * "nothing monitored" must not be rendered as a green all-clear.
   */
  const servicesMonitored = reported?.servicesMonitored || services.length;
  const noMonitoringData = servicesMonitored === 0;

  const lastCheckedAt =
    reported?.lastCheckedAt ||
    services.reduce(
      (latest, service) => (service.lastCheckedAt > latest ? service.lastCheckedAt : latest),
      "",
    );

  return {
    environment,
    source: USE_LIVE_DATA ? "live" : "mock",
    ok: warnings.length === 0,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,

    // Requested top-level metrics.
    // `UNKNOWN` (never `HEALTHY`) when there is nothing to report on.
    overallStatus: noMonitoringData
      ? "UNKNOWN"
      : (reported?.overallStatus ?? statusFromServices(services)),
    servicesMonitored,
    healthyServices: noMonitoringData ? 0 : (reported?.healthyServices ?? Math.max(0, services.length - failures)),
    failedServices: noMonitoringData ? 0 : (reported?.failedServices ?? failures),
    activeIncidents: countActiveIncidents(incidentList),
    averageResponseTimeMs:
      reported?.averageResponseTimeMs ||
      (services.length > 0
        ? Math.round(
            services.reduce((sum, service) => sum + service.responseTimeMs, 0) / services.length,
          )
        : 0),
    uptimePercent: noMonitoringData ? 0 : latestUptime || reported?.uptimePct || 0,

    // Collections.
    services,
    incidents: incidentList,
    responseTimes: responseTimes.data ?? EMPTY_RESPONSE_TIMES,
    retryHistory: retryHistory.data ?? EMPTY_RETRY_HISTORY,

    // Extras the UI needs.
    uptime: uptimePoints,
    lastCheckedAt,

    sources,
    warnings,
  };
}

/**
 * Aggregated dashboard payload, memoised per render so calling it from both the
 * page and the API route costs one round of upstream work.
 */
export const getDashboardSnapshot = cache(buildSnapshot);
