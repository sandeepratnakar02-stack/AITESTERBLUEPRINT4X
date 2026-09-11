import { MOCK_NOW, SLA_THRESHOLD_MS, UPTIME_TARGET_PCT } from "@/lib/constants";
import type {
  CheckType,
  DashboardSettings,
  DashboardSummary,
  Environment,
  HealthCheck,
  HealthState,
  HttpMethod,
  Incident,
  LogEntry,
  RetryAttempt,
  RetryPolicy,
  ResponseTimeMetric,
  Service,
  TimelineEvent,
  UptimePoint,
} from "@/types";

/* -------------------------------------------------------------------------- */
/*  Deterministic helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Small LCG so the mock series is identical on the server and the client. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const secondsAgo = (seconds: number) => new Date(MOCK_NOW.getTime() - seconds * 1000).toISOString();
const istTime = (date: string, time: string) => new Date(`${date}T${time}+05:30`).toISOString();

/** Timestamp of the failed VWO Editor run that produced INC-1042. */
const OUTAGE = {
  detected: secondsAgo(356), // 10:36:04
  retry1Failed: secondsAgo(334), // 10:36:26
  retry2Failed: secondsAgo(301), // 10:36:59
  incidentCreated: secondsAgo(300), // 10:37:00
};

const DEFAULT_RETRY_POLICY: RetryPolicy = { maxAttempts: 3, delaysSeconds: [20, 30] };

/* -------------------------------------------------------------------------- */
/*  Service seeds                                                              */
/* -------------------------------------------------------------------------- */

interface Snapshot {
  status: HealthState;
  httpStatus: number | null;
  responseTimeMs: number;
  attempts: number;
  secondsAgo: number;
  consecutiveSlowChecks?: number;
}

interface ServiceSeed {
  id: string;
  name: string;
  checkType: CheckType;
  endpoint: string;
  url: string;
  httpMethod: HttpMethod;
  expectedStatus: number;
  expectedText?: string;
  critical: boolean;
  retryPolicy: RetryPolicy;
  /** Baseline response time, used to synthesise the 24h history. */
  baselineMs: number;
  noise: number;
  snapshot: Record<Environment, Snapshot>;
}

/**
 * The five monitored VWO QA services. QA values mirror the reference snapshot
 * (10 Sep 2026 • 10:42 AM); Staging/Production are plausible variants so the
 * environment selector has something meaningful to switch between.
 */
const SERVICE_SEEDS: ServiceSeed[] = [
  {
    id: "svc-vwo-main",
    name: "VWO Main Application",
    checkType: "HTTP",
    endpoint: "https://app.vwo.com/",
    url: "https://app.vwo.com/",
    httpMethod: "GET",
    expectedStatus: 200,
    critical: true,
    retryPolicy: DEFAULT_RETRY_POLICY,
    baselineMs: 700,
    noise: 90,
    snapshot: {
      QA: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 724, attempts: 1, secondsAgo: 30 },
      Staging: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 640, attempts: 1, secondsAgo: 55 },
      Production: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 512, attempts: 1, secondsAgo: 40 },
    },
  },
  {
    id: "svc-vwo-login",
    name: "VWO Login",
    checkType: "FUNCTIONAL",
    endpoint: "/login",
    url: "https://app.vwo.com/login",
    httpMethod: "GET",
    expectedStatus: 200,
    expectedText: "Sign in",
    critical: true,
    retryPolicy: DEFAULT_RETRY_POLICY,
    baselineMs: 880,
    noise: 110,
    snapshot: {
      QA: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 910, attempts: 1, secondsAgo: 45 },
      Staging: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 780, attempts: 1, secondsAgo: 70 },
      Production: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 640, attempts: 1, secondsAgo: 50 },
    },
  },
  {
    id: "svc-vwo-campaigns",
    name: "VWO Campaign Dashboard",
    checkType: "FUNCTIONAL",
    endpoint: "/dashboard",
    url: "https://app.vwo.com/dashboard",
    httpMethod: "GET",
    expectedStatus: 200,
    expectedText: "Campaigns",
    critical: false,
    retryPolicy: DEFAULT_RETRY_POLICY,
    baselineMs: 1150,
    noise: 220,
    snapshot: {
      QA: {
        status: "SLOW",
        httpStatus: 200,
        responseTimeMs: 3400,
        attempts: 2,
        secondsAgo: 22,
        consecutiveSlowChecks: 2,
      },
      Staging: { status: "SLOW", httpStatus: 200, responseTimeMs: 3150, attempts: 1, secondsAgo: 90 },
      Production: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 1180, attempts: 1, secondsAgo: 35 },
    },
  },
  {
    id: "svc-vwo-api",
    name: "VWO API",
    checkType: "HTTP",
    endpoint: "/api",
    url: "https://app.vwo.com/api",
    httpMethod: "GET",
    expectedStatus: 200,
    critical: true,
    retryPolicy: DEFAULT_RETRY_POLICY,
    baselineMs: 400,
    noise: 60,
    snapshot: {
      QA: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 412, attempts: 1, secondsAgo: 38 },
      Staging: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 380, attempts: 1, secondsAgo: 60 },
      Production: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 285, attempts: 1, secondsAgo: 28 },
    },
  },
  {
    id: "svc-vwo-editor",
    name: "VWO Editor",
    checkType: "FUNCTIONAL",
    endpoint: "/editor",
    url: "https://app.vwo.com/editor",
    httpMethod: "GET",
    expectedStatus: 200,
    expectedText: "Visual Editor",
    critical: true,
    retryPolicy: DEFAULT_RETRY_POLICY,
    baselineMs: 950,
    noise: 140,
    snapshot: {
      QA: { status: "DOWN", httpStatus: 500, responseTimeMs: 5800, attempts: 3, secondsAgo: 66 },
      Staging: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 890, attempts: 1, secondsAgo: 120 },
      Production: { status: "HEALTHY", httpStatus: 200, responseTimeMs: 940, attempts: 1, secondsAgo: 44 },
    },
  },
];

/* -------------------------------------------------------------------------- */
/*  Services                                                                   */
/* -------------------------------------------------------------------------- */

const servicesCache = new Map<Environment, Service[]>();

export function getMockServices(environment: Environment = "QA"): Service[] {
  const cached = servicesCache.get(environment);
  if (cached) return cached;

  const list: Service[] = SERVICE_SEEDS.map((seed) => {
    const snap = seed.snapshot[environment];
    return {
      id: seed.id,
      name: seed.name,
      application: "VWO",
      environment,
      checkType: seed.checkType,
      endpoint: seed.endpoint,
      url: seed.url,
      httpMethod: seed.httpMethod,
      expectedStatus: seed.expectedStatus,
      expectedText: seed.expectedText,
      responseTimeThresholdMs: SLA_THRESHOLD_MS,
      critical: seed.critical,
      retryPolicy: seed.retryPolicy,
      status: snap.status,
      httpStatus: snap.httpStatus,
      responseTimeMs: snap.responseTimeMs,
      attempts: snap.attempts,
      lastCheckedAt: secondsAgo(snap.secondsAgo),
      consecutiveSlowChecks: snap.consecutiveSlowChecks ?? 0,
    };
  });

  servicesCache.set(environment, list);
  return list;
}

export function getMockServiceById(id: string, environment: Environment = "QA"): Service | undefined {
  return getMockServices(environment).find((service) => service.id === id);
}

/* -------------------------------------------------------------------------- */
/*  Dashboard summary                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Snapshot-level KPIs.
 *
 * `overallStatus` is derived from platform availability against the 99.9% SLA
 * target (a single degraded/failed non-blocking service does not take the whole
 * application below SLA). In live mode n8n returns this field directly.
 */
const UPTIME_BY_ENV: Record<Environment, number> = {
  QA: 99.96,
  Staging: 99.98,
  Production: 99.99,
};

const AVG_RESPONSE_BY_ENV: Record<Environment, number> = {
  QA: 842,
  Staging: 706,
  Production: 512,
};

const ACTIVE_INCIDENTS_BY_ENV: Record<Environment, number> = {
  QA: 1,
  Staging: 0,
  Production: 0,
};

export function getMockDashboardSummary(environment: Environment = "QA"): DashboardSummary {
  const services = getMockServices(environment);
  const failed = services.filter((s) => s.status === "DOWN" || s.status === "FUNCTIONAL_FAILURE");
  const healthy = services.filter(
    (s) => s.status === "HEALTHY" || s.status === "SLOW" || s.status === "RETRYING",
  );
  const uptimePct = UPTIME_BY_ENV[environment];

  return {
    overallStatus:
      uptimePct >= UPTIME_TARGET_PCT ? "HEALTHY" : uptimePct >= 95 ? "SLOW" : "DOWN",
    servicesMonitored: services.length,
    healthyServices: healthy.length,
    failedServices: failed.length,
    activeIncidents: ACTIVE_INCIDENTS_BY_ENV[environment],
    averageResponseTimeMs: AVG_RESPONSE_BY_ENV[environment],
    uptimePct,
    lastCheckedAt: secondsAgo(18),
  };
}

/* -------------------------------------------------------------------------- */
/*  Incidents                                                                  */
/* -------------------------------------------------------------------------- */

function editorIncidentTimeline(): TimelineEvent[] {
  return [
    {
      id: "tl-1",
      label: "Initial health check failed",
      detail: "HTTP 500 from GET /editor",
      at: OUTAGE.detected,
      kind: "failure",
    },
    {
      id: "tl-2",
      label: "Retry #1 scheduled",
      detail: "Wait: 20 seconds",
      at: secondsAgo(355),
      kind: "schedule",
    },
    {
      id: "tl-3",
      label: "Retry #2 failed",
      detail: "HTTP 500 · 5 812 ms",
      at: OUTAGE.retry1Failed,
      kind: "retry",
    },
    {
      id: "tl-4",
      label: "Retry #3 scheduled",
      detail: "Wait: 30 seconds",
      at: secondsAgo(333),
      kind: "schedule",
    },
    {
      id: "tl-5",
      label: "Final check failed",
      detail: "HTTP 500 · 5 800 ms",
      at: OUTAGE.retry2Failed,
      kind: "retry",
    },
    {
      id: "tl-6",
      label: "Incident created",
      detail: "INC-1042 opened and escalated (Critical)",
      at: OUTAGE.incidentCreated,
      kind: "incident",
    },
  ];
}

function campaignIncidentTimeline(startedAt: string): TimelineEvent[] {
  const t = (offset: number) => new Date(new Date(startedAt).getTime() + offset * 1000).toISOString();
  return [
    { id: "tl-c1", label: "Response time threshold exceeded", detail: "3 480 ms > 3 000 ms", at: startedAt, kind: "failure" },
    { id: "tl-c2", label: "Retry #1 scheduled", detail: "Wait: 20 seconds", at: t(2), kind: "schedule" },
    { id: "tl-c3", label: "Retry #1 failed", detail: "3 410 ms > 3 000 ms", at: t(22), kind: "retry" },
    { id: "tl-c4", label: "Retry #2 scheduled", detail: "Wait: 30 seconds", at: t(24), kind: "schedule" },
    { id: "tl-c5", label: "Final check failed", detail: "3 395 ms > 3 000 ms", at: t(54), kind: "retry" },
    { id: "tl-c6", label: "Incident created", detail: "INC-1041 opened", at: t(56), kind: "incident" },
    { id: "tl-c7", label: "Service recovered", detail: "Response time back within threshold", at: t(134), kind: "recovery" },
  ];
}

const INCIDENTS: Incident[] = [
  {
    id: "INC-1042",
    serviceId: "svc-vwo-editor",
    serviceName: "VWO Editor",
    application: "VWO",
    environment: "QA",
    status: "Open",
    severity: "Critical",
    detectedAt: OUTAGE.detected,
    startedAt: OUTAGE.detected,
    recoveredAt: null,
    durationSeconds: 381,
    retryAttempts: 3,
    failureReason: "Endpoint returned HTTP 500 on 3 consecutive attempts (Visual Editor failed to render).",
    httpResponse:
      'HTTP/1.1 500 Internal Server Error\ncontent-type: application/json\n\n{"error":"EDITOR_RENDER_FAILED","requestId":"9f2c41ab"}',
    n8nExecutionId: "exec-2841",
    timeline: editorIncidentTimeline(),
  },
  {
    id: "INC-1041",
    serviceId: "svc-vwo-campaigns",
    serviceName: "VWO Campaign Dashboard",
    application: "VWO",
    environment: "QA",
    status: "Recovered",
    severity: "High",
    detectedAt: istTime("2026-09-09", "15:12:40"),
    startedAt: istTime("2026-09-09", "15:12:40"),
    recoveredAt: istTime("2026-09-09", "15:14:54"),
    durationSeconds: 134,
    retryAttempts: 2,
    failureReason: "Response time exceeded the 3 000 ms threshold on 3 consecutive checks.",
    httpResponse: "HTTP/1.1 200 OK\ncontent-type: text/html\n\n<200, 3 480 ms>",
    n8nExecutionId: "exec-2836",
    timeline: campaignIncidentTimeline(istTime("2026-09-09", "15:12:40")),
  },
  {
    id: "INC-1040",
    serviceId: "svc-vwo-api",
    serviceName: "VWO API",
    application: "VWO",
    environment: "QA",
    status: "Resolved",
    severity: "Medium",
    detectedAt: istTime("2026-09-08", "11:04:12"),
    startedAt: istTime("2026-09-08", "11:04:12"),
    recoveredAt: istTime("2026-09-08", "11:06:02"),
    durationSeconds: 110,
    retryAttempts: 2,
    failureReason: "Transient 502 from the API gateway during a deploy window.",
    httpResponse: "HTTP/1.1 502 Bad Gateway\n\ntext/html; charset=utf-8",
    n8nExecutionId: "exec-2802",
    timeline: [
      {
        id: "tl-a1",
        label: "Initial health check failed",
        detail: "HTTP 502 from GET /api",
        at: istTime("2026-09-08", "11:04:12"),
        kind: "failure",
      },
      {
        id: "tl-a2",
        label: "Retry #1 scheduled",
        detail: "Wait: 20 seconds",
        at: istTime("2026-09-08", "11:04:14"),
        kind: "schedule",
      },
      {
        id: "tl-a3",
        label: "Retry #1 failed",
        detail: "HTTP 502 · 4 120 ms",
        at: istTime("2026-09-08", "11:04:34"),
        kind: "retry",
      },
      {
        id: "tl-a4",
        label: "Incident created",
        detail: "INC-1040 opened",
        at: istTime("2026-09-08", "11:04:36"),
        kind: "incident",
      },
      {
        id: "tl-a5",
        label: "Incident resolved",
        detail: "Marked resolved after gateway recovery",
        at: istTime("2026-09-08", "11:06:02"),
        kind: "recovery",
      },
    ],
  },
  {
    id: "INC-1039",
    serviceId: "svc-vwo-login",
    serviceName: "VWO Login",
    application: "VWO",
    environment: "Staging",
    status: "Resolved",
    severity: "High",
    detectedAt: istTime("2026-09-07", "09:22:51"),
    startedAt: istTime("2026-09-07", "09:22:51"),
    recoveredAt: istTime("2026-09-07", "09:26:18"),
    durationSeconds: 207,
    retryAttempts: 3,
    failureReason: 'Expected text "Sign in" was not found in the response body.',
    httpResponse: "HTTP/1.1 200 OK\n\n<!doctype html><title>Maintenance</title>",
    n8nExecutionId: "exec-2778",
    timeline: [
      {
        id: "tl-b1",
        label: "Initial health check failed",
        detail: "FUNCTIONAL_FAILURE — expected text missing",
        at: istTime("2026-09-07", "09:22:51"),
        kind: "failure",
      },
      {
        id: "tl-b2",
        label: "Retry #1 scheduled",
        detail: "Wait: 20 seconds",
        at: istTime("2026-09-07", "09:22:53"),
        kind: "schedule",
      },
      {
        id: "tl-b3",
        label: "Retry #2 failed",
        detail: "FUNCTIONAL_FAILURE — expected text missing",
        at: istTime("2026-09-07", "09:23:14"),
        kind: "retry",
      },
      {
        id: "tl-b4",
        label: "Final check failed",
        detail: "FUNCTIONAL_FAILURE — expected text missing",
        at: istTime("2026-09-07", "09:23:47"),
        kind: "retry",
      },
      {
        id: "tl-b5",
        label: "Incident created",
        detail: "INC-1039 opened",
        at: istTime("2026-09-07", "09:23:49"),
        kind: "incident",
      },
      {
        id: "tl-b6",
        label: "Service recovered",
        detail: "Login page rendered correctly again",
        at: istTime("2026-09-07", "09:26:18"),
        kind: "recovery",
      },
    ],
  },
  {
    id: "INC-1038",
    serviceId: "svc-vwo-main",
    serviceName: "VWO Main Application",
    application: "VWO",
    environment: "Production",
    status: "Resolved",
    severity: "Critical",
    detectedAt: istTime("2026-09-05", "18:41:07"),
    startedAt: istTime("2026-09-05", "18:41:07"),
    recoveredAt: istTime("2026-09-05", "18:44:52"),
    durationSeconds: 225,
    retryAttempts: 3,
    failureReason: "Connection timed out after 10 000 ms (CDN edge node unavailable).",
    httpResponse: "ETIMEDOUT: request to https://app.vwo.com/ timed out after 10 000 ms",
    n8nExecutionId: "exec-2711",
    timeline: [
      {
        id: "tl-d1",
        label: "Initial health check failed",
        detail: "Request timeout (10 000 ms)",
        at: istTime("2026-09-05", "18:41:07"),
        kind: "failure",
      },
      {
        id: "tl-d2",
        label: "Retry #1 scheduled",
        detail: "Wait: 20 seconds",
        at: istTime("2026-09-05", "18:41:09"),
        kind: "schedule",
      },
      {
        id: "tl-d3",
        label: "Retry #2 failed",
        detail: "Request timeout (10 000 ms)",
        at: istTime("2026-09-05", "18:41:30"),
        kind: "retry",
      },
      {
        id: "tl-d4",
        label: "Final check failed",
        detail: "Request timeout (10 000 ms)",
        at: istTime("2026-09-05", "18:42:04"),
        kind: "retry",
      },
      {
        id: "tl-d5",
        label: "Incident created",
        detail: "INC-1038 opened and escalated (Critical)",
        at: istTime("2026-09-05", "18:42:06"),
        kind: "incident",
      },
      {
        id: "tl-d6",
        label: "Service recovered",
        detail: "Edge node healthy again",
        at: istTime("2026-09-05", "18:44:52"),
        kind: "recovery",
      },
    ],
  },
];

export function getMockIncidents(environment?: Environment): Incident[] {
  const list = environment
    ? INCIDENTS.filter((incident) => incident.environment === environment)
    : INCIDENTS;
  return [...list].sort(
    (a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime(),
  );
}

export function getMockIncidentById(id: string): Incident | undefined {
  return INCIDENTS.find((incident) => incident.id.toUpperCase() === id.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/*  Retry history                                                              */
/* -------------------------------------------------------------------------- */

export function getMockRetryHistory(environment?: Environment): RetryAttempt[] {
  const attempts: RetryAttempt[] = [
    {
      id: "rt-1042-1",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 1,
      outcome: "failed",
      at: OUTAGE.detected,
      message: "Initial health check failed — HTTP 500",
    },
    {
      id: "rt-1042-2",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 2,
      outcome: "scheduled",
      scheduledDelaySeconds: 20,
      at: secondsAgo(355),
      message: "Retry #1 scheduled",
    },
    {
      id: "rt-1042-3",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 2,
      outcome: "failed",
      at: OUTAGE.retry1Failed,
      message: "Retry #2 failed — HTTP 500",
    },
    {
      id: "rt-1042-4",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 3,
      outcome: "scheduled",
      scheduledDelaySeconds: 30,
      at: secondsAgo(333),
      message: "Retry #3 scheduled",
    },
    {
      id: "rt-1042-5",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 3,
      outcome: "failed",
      at: OUTAGE.retry2Failed,
      message: "Final check failed — retries exhausted",
    },
    {
      id: "rt-1042-6",
      serviceId: "svc-vwo-editor",
      serviceName: "VWO Editor",
      incidentId: "INC-1042",
      attempt: 3,
      outcome: "info",
      at: OUTAGE.incidentCreated,
      message: "Incident INC-1042 created",
    },
    {
      id: "rt-1041-1",
      serviceId: "svc-vwo-campaigns",
      serviceName: "VWO Campaign Dashboard",
      incidentId: "INC-1041",
      attempt: 1,
      outcome: "failed",
      at: istTime("2026-09-09", "15:12:40"),
      message: "Response time 3 480 ms exceeded 3 000 ms threshold",
    },
    {
      id: "rt-1041-2",
      serviceId: "svc-vwo-campaigns",
      serviceName: "VWO Campaign Dashboard",
      incidentId: "INC-1041",
      attempt: 2,
      outcome: "failed",
      at: istTime("2026-09-09", "15:13:02"),
      message: "Retry #1 failed — 3 410 ms",
    },
    {
      id: "rt-1041-3",
      serviceId: "svc-vwo-campaigns",
      serviceName: "VWO Campaign Dashboard",
      incidentId: "INC-1041",
      attempt: 3,
      outcome: "succeeded",
      at: istTime("2026-09-09", "15:14:54"),
      message: "Retry #2 succeeded — 2 640 ms",
    },
    {
      id: "rt-1040-1",
      serviceId: "svc-vwo-api",
      serviceName: "VWO API",
      incidentId: "INC-1040",
      attempt: 1,
      outcome: "failed",
      at: istTime("2026-09-08", "11:04:12"),
      message: "HTTP 502 from API gateway",
    },
    {
      id: "rt-1040-2",
      serviceId: "svc-vwo-api",
      serviceName: "VWO API",
      incidentId: "INC-1040",
      attempt: 2,
      outcome: "succeeded",
      at: istTime("2026-09-08", "11:04:36"),
      message: "Retry #1 succeeded — 420 ms",
    },
  ];

  if (!environment) return attempts;
  const serviceIds = new Set(getMockServices(environment).map((service) => service.id));
  return attempts.filter((attempt) => serviceIds.has(attempt.serviceId) || environment === "QA");
}

/* -------------------------------------------------------------------------- */
/*  Response time history (24 hours)                                           */
/* -------------------------------------------------------------------------- */

const SERIES_SEEDS: { serviceId: string; serviceName: string; baselineMs: number; noise: number; seed: number }[] = [
  { serviceId: "svc-vwo-main", serviceName: "VWO Main Application", baselineMs: 700, noise: 90, seed: 11 },
  { serviceId: "svc-vwo-login", serviceName: "VWO Login", baselineMs: 880, noise: 110, seed: 23 },
  { serviceId: "svc-vwo-api", serviceName: "VWO API", baselineMs: 400, noise: 60, seed: 37 },
  { serviceId: "svc-vwo-campaigns", serviceName: "VWO Campaign Dashboard", baselineMs: 1150, noise: 220, seed: 51 },
  { serviceId: "svc-vwo-editor", serviceName: "VWO Editor", baselineMs: 950, noise: 140, seed: 67 },
];

const POINTS = 49; // 48 half-hour buckets + the current sample
const STEP_SECONDS = 1800;

const responseTimeCache = new Map<Environment, ResponseTimeMetric[]>();

export function getMockResponseTimeHistory(environment: Environment = "QA"): ResponseTimeMetric[] {
  const cached = responseTimeCache.get(environment);
  if (cached) return cached;

  const isQa = environment === "QA";
  const scale = environment === "Production" ? 0.72 : environment === "Staging" ? 0.9 : 1;
  const snapshotById = new Map(getMockServices(environment).map((service) => [service.id, service]));

  const series: ResponseTimeMetric[] = [];

  for (const seed of SERIES_SEEDS) {
    const rand = prng(seed.seed);
    for (let i = 0; i < POINTS; i += 1) {
      const ago = (POINTS - 1 - i) * STEP_SECONDS;
      const timestamp = secondsAgo(ago);
      const snapshot = snapshotById.get(seed.serviceId);
      let value = (seed.baselineMs + (rand() - 0.5) * 2 * seed.noise) * scale;

      if (isQa && seed.serviceId === "svc-vwo-editor" && i === POINTS - 1 && snapshot) {
        // Current outage sample.
        value = snapshot.responseTimeMs;
      }
      if (isQa && seed.serviceId === "svc-vwo-campaigns" && i >= POINTS - 3) {
        // Dashboard has been drifting above the threshold for the last 1.5h.
        value = 3150 + rand() * 260;
      }

      series.push({
        timestamp,
        serviceId: seed.serviceId,
        serviceName: seed.serviceName,
        responseTimeMs: Math.round(value),
        thresholdMs: SLA_THRESHOLD_MS,
      });
    }
  }

  responseTimeCache.set(environment, series);
  return series;
}

/* -------------------------------------------------------------------------- */
/*  Uptime (last 7 days)                                                       */
/* -------------------------------------------------------------------------- */

const UPTIME_SEED: Record<Environment, number[]> = {
  QA: [99.98, 100.0, 99.99, 99.94, 100.0, 99.87, 99.96],
  Staging: [100.0, 99.99, 100.0, 99.98, 100.0, 99.99, 99.98],
  Production: [100.0, 100.0, 99.99, 100.0, 99.98, 100.0, 99.99],
};

const DAYS = 7;
const CHECKS_PER_DAY = 1440; // 5 services × 12 checks/hour × 24h simplified

export function getMockUptime(environment: Environment = "QA"): UptimePoint[] {
  const values = UPTIME_SEED[environment];
  return Array.from({ length: DAYS }, (_, index) => {
    const dayOffset = DAYS - 1 - index;
    const date = new Date(MOCK_NOW.getTime() - dayOffset * 86400000);
    const uptimePct = values[index];
    return {
      date: date.toISOString().slice(0, 10),
      uptimePct,
      checks: CHECKS_PER_DAY,
      failedChecks: Math.round((CHECKS_PER_DAY * (100 - uptimePct)) / 100),
    };
  });
}

/* -------------------------------------------------------------------------- */
/*  Health check history + logs                                                */
/* -------------------------------------------------------------------------- */

const LOG_MESSAGES: Record<HealthState, string> = {
  HEALTHY: "Check passed — HTTP status and functional assertions OK",
  SLOW: "Request succeeded but exceeded the response time threshold",
  FUNCTIONAL_FAILURE: "Expected content missing from the response body",
  DOWN: "Endpoint returned an unexpected server response",
  RETRYING: "Check failed — automatic retry in progress",
  UNKNOWN: "No result recorded",
};

const healthCheckCache = new Map<Environment, HealthCheck[]>();
const logCache = new Map<Environment, LogEntry[]>();

/** States in which the expected content assertion did not pass. */
const FUNCTIONAL_FAILURE_STATES: HealthState[] = ["FUNCTIONAL_FAILURE"];

function buildHistory(environment: Environment) {
  const services = getMockServices(environment);
  const rand = prng(environment === "QA" ? 1337 : environment === "Staging" ? 4242 : 9001);
  const checks: HealthCheck[] = [];
  const logs: LogEntry[] = [];

  const buckets = 48; // every 30 min over 24h

  for (let bucket = buckets; bucket >= 0; bucket -= 1) {
    const ago = bucket * STEP_SECONDS;

    for (const service of services) {
      let status: HealthState = "HEALTHY";
      let httpStatus: number | null = 200;
      let responseTimeMs = Math.round(service.responseTimeMs * (0.85 + rand() * 0.3));
      let message = LOG_MESSAGES.HEALTHY;
      let attempt = 1;

      const isCurrentOutage =
        environment === "QA" && service.id === "svc-vwo-editor" && bucket === 0;
      const isCampaignDrift =
        environment === "QA" && service.id === "svc-vwo-campaigns" && bucket <= 0;

      if (isCurrentOutage) {
        status = "DOWN";
        httpStatus = 500;
        responseTimeMs = service.responseTimeMs;
        message = LOG_MESSAGES.DOWN;
        attempt = 3;
      } else if (isCampaignDrift) {
        status = "SLOW";
        httpStatus = 200;
        responseTimeMs = 3400;
        message = LOG_MESSAGES.SLOW;
        attempt = 2;
      } else if (environment === "QA" && service.id === "svc-vwo-editor" && bucket === 1) {
        responseTimeMs = 5820;
        status = "SLOW";
        message = LOG_MESSAGES.SLOW;
      } else if (rand() > 0.965) {
        status = "SLOW";
        responseTimeMs = service.responseTimeThresholdMs + Math.round(rand() * 900);
        message = LOG_MESSAGES.SLOW;
      }

      const checkedAt = secondsAgo(ago);
      const n8nExecutionId = `exec-${2800 + bucket}`;
      // Widen back to the full union so the functional-assertion flag can be derived.
      const resolvedStatus: HealthState = status;

      checks.push({
        id: `hc-${service.id}-${bucket}`,
        serviceId: service.id,
        serviceName: service.name,
        environment,
        attempt,
        maxAttempts: service.retryPolicy.maxAttempts,
        status: resolvedStatus,
        httpStatus,
        responseTimeMs,
        expectedTextFound: service.expectedText ? !FUNCTIONAL_FAILURE_STATES.includes(resolvedStatus) : null,
        message,
        checkedAt,
        n8nExecutionId,
      });

      logs.push({
        id: `log-${service.id}-${bucket}`,
        timestamp: checkedAt,
        serviceId: service.id,
        serviceName: service.name,
        environment,
        attempt,
        maxAttempts: service.retryPolicy.maxAttempts,
        status,
        httpCode: httpStatus,
        responseTimeMs,
        message,
      });
    }
  }

  return { checks, logs };
}

export function getMockHealthChecks(environment: Environment = "QA"): HealthCheck[] {
  const cached = healthCheckCache.get(environment);
  if (cached) return cached;
  const { checks } = buildHistory(environment);
  const sorted = checks.sort(
    (a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime(),
  );
  healthCheckCache.set(environment, sorted);
  return sorted;
}

export function getMockLogs(environment: Environment = "QA"): LogEntry[] {
  const cached = logCache.get(environment);
  if (cached) return cached;
  const { logs } = buildHistory(environment);
  const sorted = logs.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  logCache.set(environment, sorted);
  return sorted;
}

/* -------------------------------------------------------------------------- */
/*  Settings                                                                   */
/* -------------------------------------------------------------------------- */

export function getMockSettings(): DashboardSettings {
  return {
    responseTimeThresholdMs: SLA_THRESHOLD_MS,
    retryAttempts: 3,
    retryDelaysSeconds: [20, 30],
    checkIntervalMinutes: 5,
    environments: [
      { environment: "QA", baseUrl: "https://app.vwo.com", enabled: true, criticality: "Critical" },
      { environment: "Staging", baseUrl: "https://staging.vwo.com", enabled: true, criticality: "High" },
      {
        environment: "Production",
        baseUrl: "https://app.vwo.com",
        enabled: false,
        criticality: "Critical",
      },
    ],
  };
}
