/**
 * ============================================================================
 *  Response normalisation — tolerant adapters between n8n and the dashboard
 * ============================================================================
 *
 * The n8n workflows in this chapter were authored independently of the app, so
 * their payloads differ from the TypeScript contract in `src/types/index.ts`:
 *
 *   shape          word used by the workflows        dashboard
 *   ------------   -------------------------------   --------------------------
 *   list wrapper   { count, logs: [...] }            bare LogEntry[]
 *   health state   UP / DEGRADED / FAILED            HEALTHY / SLOW / DOWN
 *   incident id    incidentId                        id
 *   incident state OPEN / RESOLVED                   Open / Resolved
 *   severity       SEV-1 … SEV-4                     Critical … Low
 *   timestamps     "2026-09-10 15:28:49"             ISO 8601
 *   uptime         availabilityPercentage            uptimePct
 *
 * Rather than pin the app to one producer, every value is read tolerantly:
 * aliases are looked up in order, enums are coerced, and missing optional fields
 * fall back to documented defaults. Both the workflow style used here and the
 * shape in `09b_DownTime_Tracker_API` are therefore accepted.
 *
 * Nothing in this file throws: unknown input degrades to empty/safe values so a
 * partially-shaped webhook can never take a page down.
 * ============================================================================
 */

import type {
  Application,
  CheckType,
  DashboardSettings,
  DashboardSummary,
  Environment,
  EnvironmentConfig,
  HealthCheck,
  HealthState,
  HttpMethod,
  Incident,
  IncidentSeverity,
  IncidentStatus,
  LogEntry,
  RetryAttempt,
  ResponseTimeMetric,
  Service,
  TimelineEvent,
  UptimePoint,
} from "@/types";

/* -------------------------------------------------------------------------- */
/*  Primitive coercions                                                        */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

function asRecord(value: unknown): Row {
  return value !== null && typeof value === "object" ? (value as Row) : {};
}

/** First non-empty value among `keys`. */
function pick(row: unknown, keys: string[]): unknown {
  const record = asRecord(row);
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function str(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim();
  return text === "" ? fallback : text;
}

function optionalStr(value: unknown): string | undefined {
  const text = str(value);
  return text === "" ? undefined : text;
}

function num(value: unknown, fallback = 0): number {
  // `Number("") === 0`, so guard empties explicitly or every missing field would
  // silently become 0 instead of the intended default.
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;

  const parsed = Number(String(value).replace(/[^0-9.+-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = num(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null) return fallback;
  return ["true", "1", "yes", "y"].includes(String(value).trim().toLowerCase());
}

/**
 * Parses the timestamps the workflows write.
 * Google Sheets rows carry `"2026-09-10 15:28:49"` (no timezone) while n8n
 * payloads usually carry ISO strings — both are accepted, invalid input yields
 * `null` rather than `Invalid Date`.
 */
export function toIso(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;

  const parsed = new Date(raw.includes(" ") && !raw.includes("T") ? raw.replace(" ", "T") : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Unwraps `{ environment, count, logs: [...] }` and friends into a plain array. */
export function toArray<T = unknown>(payload: unknown, ...preferredKeys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];

  const record = asRecord(payload);
  for (const key of preferredKeys) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  // Last resort: the first array-valued property of the wrapper.
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

function slug(value: string): string {
  return `svc-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/* -------------------------------------------------------------------------- */
/*  Enum coercions                                                             */
/* -------------------------------------------------------------------------- */

const HEALTH_STATE_ALIASES: Record<string, HealthState> = {
  UP: "HEALTHY",
  HEALTHY: "HEALTHY",
  OK: "HEALTHY",
  PASS: "HEALTHY",
  PASSED: "HEALTHY",
  DEGRADED: "SLOW",
  SLOW: "SLOW",
  WARN: "SLOW",
  WARNING: "SLOW",
  DOWN: "DOWN",
  FAILED: "DOWN",
  FAILURE: "DOWN",
  ERROR: "DOWN",
  FUNCTIONAL_FAILURE: "FUNCTIONAL_FAILURE",
  FUNCTIONALFAILURE: "FUNCTIONAL_FAILURE",
  RETRYING: "RETRYING",
  UNKNOWN: "UNKNOWN",
};

export function toHealthState(value: unknown): HealthState {
  return HEALTH_STATE_ALIASES[str(value).toUpperCase()] ?? "UNKNOWN";
}

const INCIDENT_STATUS_ALIASES: Record<string, IncidentStatus> = {
  OPEN: "Open",
  ACTIVE: "Open",
  INVESTIGATING: "Investigating",
  RECOVERED: "Recovered",
  RECOVERY: "Recovered",
  RESOLVED: "Resolved",
  CLOSED: "Resolved",
};

export function toIncidentStatus(value: unknown): IncidentStatus {
  return INCIDENT_STATUS_ALIASES[str(value).toUpperCase()] ?? "Open";
}

const SEVERITY_ALIASES: Record<string, IncidentSeverity> = {
  "SEV-1": "Critical",
  SEV1: "Critical",
  CRITICAL: "Critical",
  "SEV-2": "High",
  SEV2: "High",
  HIGH: "High",
  "SEV-3": "Medium",
  SEV3: "Medium",
  MEDIUM: "Medium",
  "SEV-4": "Low",
  SEV4: "Low",
  LOW: "Low",
};

export function toIncidentSeverity(value: unknown): IncidentSeverity {
  return SEVERITY_ALIASES[str(value).toUpperCase()] ?? "Medium";
}

function toCheckType(value: unknown): CheckType {
  const upper = str(value, "HTTP").toUpperCase();
  return (["HTTP", "API", "FUNCTIONAL"] as const).includes(upper as CheckType)
    ? (upper as CheckType)
    : "HTTP";
}

function toHttpMethod(value: unknown): HttpMethod {
  const upper = str(value, "GET").toUpperCase();
  return (["GET", "POST", "HEAD"] as const).includes(upper as HttpMethod)
    ? (upper as HttpMethod)
    : "GET";
}

function asEnvironment(value: unknown, fallback: Environment): Environment {
  const text = str(value);
  const match = ["QA", "Staging", "Production"].find(
    (env) => env.toLowerCase() === text.toLowerCase(),
  );
  return (match as Environment) ?? fallback;
}

function asApplication(value: unknown): Application {
  return "VWO" as Application;
}

/**
 * Derives a health state when the producer did not supply a usable one.
 *
 * The monitor workflow in this chapter emits `UP`/`DEGRADED`, and its API
 * mapper only maps `UP` to HEALTHY when the functional assertion passed — so
 * services with no `expectedText` come back as `UNKNOWN` even when they are
 * perfectly healthy. Inferring from the evidence on the row avoids showing a
 * wall of grey "Unknown" badges, and is only used when the reported state is
 * missing/UNKNOWN *and* the row carries an HTTP status.
 */
function deriveHealthState(row: unknown, reported: HealthState): HealthState {
  if (reported !== "UNKNOWN") return reported;

  const httpStatus = optionalNumber(pick(row, ["httpStatus", "HTTP Status", "httpCode"]));
  if (httpStatus === null) return "UNKNOWN";
  if (httpStatus >= 400) return "DOWN";

  const threshold = num(pick(row, ["responseTimeThresholdMs", "Response Time Threshold Ms"]), 3000);
  const responseTime = num(pick(row, ["responseTimeMs", "Response Time Ms"]), 0);
  return responseTime > threshold ? "SLOW" : "HEALTHY";
}

/* -------------------------------------------------------------------------- */
/*  Entity normalisers                                                         */
/* -------------------------------------------------------------------------- */

export function normalizeService(raw: unknown, fallbackEnvironment: Environment): Service {
  const row = asRecord(raw);
  const name = str(pick(row, ["name", "serviceName", "Service Name"]), "Unknown Service");
  const environment = asEnvironment(pick(row, ["environment", "Environment"]), fallbackEnvironment);
  const retryPolicy = asRecord(pick(row, ["retryPolicy"]));
  const delays = pick(retryPolicy, ["delaysSeconds"]);

  return {
    id: str(pick(row, ["id"]) || slug(`${environment}-${name}`)),
    name,
    application: asApplication(pick(row, ["application", "Application"])),
    environment,
    checkType: toCheckType(pick(row, ["checkType", "Check Type"])),
    endpoint: str(pick(row, ["endpoint", "Endpoint", "url"])),
    url: str(pick(row, ["url", "endpoint", "Endpoint"])),
    httpMethod: toHttpMethod(pick(row, ["httpMethod", "method"])),
    expectedStatus: num(pick(row, ["expectedStatus"]), 200),
    expectedText: optionalStr(pick(row, ["expectedText"])),
    responseTimeThresholdMs: num(
      pick(row, ["responseTimeThresholdMs", "Response Time Threshold Ms"]),
      3000,
    ),
    critical: bool(pick(row, ["critical", "Critical"])),
    retryPolicy: {
      maxAttempts: num(pick(retryPolicy, ["maxAttempts"]), 3),
      delaysSeconds: Array.isArray(delays)
        ? (delays as unknown[]).map((value) => num(value)).filter((value) => value > 0)
        : [20, 30],
    },
    status: deriveHealthState(
      row,
      toHealthState(pick(row, ["status", "healthStatus", "Health Status"])),
    ),
    httpStatus: optionalNumber(pick(row, ["httpStatus", "HTTP Status", "httpCode"])),
    responseTimeMs: num(pick(row, ["responseTimeMs", "Response Time Ms"]), 0),
    attempts:
      num(pick(row, ["attempts"])) ||
      num(pick(row, ["retryCount", "Retry Count"]), 0) + 1,
    lastCheckedAt:
      toIso(pick(row, ["lastCheckedAt", "checkedAt", "Timestamp", "timestamp"])) ??
      new Date().toISOString(),
    consecutiveSlowChecks: num(pick(row, ["consecutiveSlowChecks"]), 0),
  };
}

export function normalizeSummary(
  raw: unknown,
  services: Service[],
  fallbackEnvironment: Environment,
): DashboardSummary {
  const row = asRecord(raw);
  const down = services.filter(
    (service) => service.status === "DOWN" || service.status === "FUNCTIONAL_FAILURE",
  ).length;

  const reportedOverall = toHealthState(pick(row, ["overallStatus", "status"]));

  return {
    overallStatus: reportedOverall === "UNKNOWN" ? (down > 0 ? "DOWN" : "HEALTHY") : reportedOverall,
    servicesMonitored: num(pick(row, ["servicesMonitored"]), services.length),
    healthyServices: num(pick(row, ["healthyServices"]), services.length - down),
    failedServices: num(pick(row, ["failedServices"]), down),
    activeIncidents: num(pick(row, ["activeIncidents"]), 0),
    averageResponseTimeMs: num(
      pick(row, ["averageResponseTimeMs"]),
      services.length
        ? Math.round(
            services.reduce((sum, service) => sum + service.responseTimeMs, 0) / services.length,
          )
        : 0,
    ),
    uptimePct: num(pick(row, ["uptimePct", "availabilityPct"]), 0),
    lastCheckedAt:
      toIso(pick(row, ["lastCheckedAt", "Timestamp"])) ??
      services.reduce(
        (latest, service) => (service.lastCheckedAt > latest ? service.lastCheckedAt : latest),
        new Date(0).toISOString(),
      ),
  };
}

export function normalizeHealthCheck(raw: unknown, index: number): HealthCheck {
  const row = asRecord(raw);
  const name = str(pick(row, ["serviceName", "Service Name"]), "Unknown Service");
  const status = deriveHealthState(row, toHealthState(pick(row, ["status", "healthStatus", "Health Status"])));
  const errorMessage = str(pick(row, ["errorMessage", "Error Message", "failureReason"]));

  return {
    id: str(pick(row, ["id"]) || `hc-${index + 1}`),
    serviceId: str(pick(row, ["serviceId"]) || slug(name)),
    serviceName: name,
    environment: asEnvironment(pick(row, ["environment", "Environment"]), "QA"),
    attempt: num(pick(row, ["attempt"])) || num(pick(row, ["retryCount", "Retry Count"]), 0) + 1,
    maxAttempts: num(pick(row, ["maxAttempts"]), 3),
    status,
    httpStatus: optionalNumber(pick(row, ["httpStatus", "HTTP Status", "httpCode"])),
    responseTimeMs: num(pick(row, ["responseTimeMs", "Response Time Ms"]), 0),
    expectedTextFound:
      pick(row, ["expectedTextFound"]) === undefined
        ? str(pick(row, ["functionalValidation", "Functional Validation"]))
            .toUpperCase()
            .indexOf("FAIL") === -1
        : bool(pick(row, ["expectedTextFound"])),
    message: str(pick(row, ["message"]), errorMessage || `Check completed with status ${status}`),
    checkedAt:
      toIso(pick(row, ["checkedAt", "timestamp", "Timestamp"])) ?? new Date().toISOString(),
    n8nExecutionId: str(
      pick(row, ["n8nExecutionId", "workflowExecutionId", "Workflow Execution ID"]),
    ),
    failureReason: optionalStr(errorMessage),
  };
}

export function normalizeLogEntry(raw: unknown, index: number): LogEntry {
  const row = asRecord(raw);
  const name = str(pick(row, ["serviceName", "Service Name"]), "Unknown Service");
  const status = deriveHealthState(row, toHealthState(pick(row, ["status", "healthStatus", "Health Status"])));
  const responseTime = num(pick(row, ["responseTimeMs", "Response Time Ms"]), 0);
  const httpCode = optionalNumber(pick(row, ["httpCode", "httpStatus", "HTTP Status"]));

  return {
    id: str(pick(row, ["id"]) || `log-${index + 1}`),
    timestamp: toIso(pick(row, ["timestamp", "checkedAt", "Timestamp"])) ?? new Date().toISOString(),
    serviceId: str(pick(row, ["serviceId"]) || slug(name)),
    serviceName: name,
    environment: asEnvironment(pick(row, ["environment", "Environment"]), "QA"),
    attempt: num(pick(row, ["attempt"])) || num(pick(row, ["retryCount", "Retry Count"]), 0) + 1,
    maxAttempts: num(pick(row, ["maxAttempts"]), 3),
    status,
    httpCode,
    responseTimeMs: responseTime,
    message: str(
      pick(row, ["message"]),
      httpCode === null ? "No response recorded" : `HTTP ${httpCode} in ${responseTime} ms`,
    ),
  };
}

function normalizeTimelineEvent(
  raw: unknown,
  index: number,
  incidentId: string,
  fallbackAt: string,
): TimelineEvent {
  const row = asRecord(raw);
  const type = str(pick(row, ["kind", "type"]), "info").toUpperCase();
  const kind: TimelineEvent["kind"] =
    type.indexOf("START") > -1 || type.indexOf("FAIL") > -1
      ? "failure"
      : type.indexOf("RETRY") > -1
        ? "retry"
        : type.indexOf("SCHEDULE") > -1
          ? "schedule"
          : type.indexOf("RECOVER") > -1 || type.indexOf("RESOLV") > -1
            ? "recovery"
            : type.indexOf("INCIDENT") > -1
              ? "incident"
              : "info";

  const delay = optionalNumber(pick(row, ["delaySeconds"]));

  return {
    id: str(pick(row, ["id"]) || `${incidentId}-te-${index + 1}`),
    label: str(
      pick(row, ["label"]) || pick(row, ["message"]),
      kind === "recovery" ? "Service recovered" : "Event recorded",
    ),
    detail:
      optionalStr(pick(row, ["detail"])) ??
      (delay !== null ? `Wait: ${delay} seconds` : undefined),
    at:
      toIso(pick(row, ["at", "timestamp", "Timestamp"])) ??
      toIso(pick(row, ["incidentStartedAt"])) ??
      // Some producers omit timestamps on retry events; anchoring to the
      // incident start is honest, whereas `Date.now()` would look like it just
      // happened.
      fallbackAt,
    kind,
  };
}

export function normalizeIncident(raw: unknown, index: number): Incident {
  const row = asRecord(raw);
  const name = str(pick(row, ["serviceName", "Service Name"]), "Unknown Service");
  const id = str(pick(row, ["id", "incidentId", "Incident ID"]) || `INC-${index + 1}`);
  const startedAt =
    toIso(pick(row, ["startedAt", "detectedAt", "downtimeStart", "Downtime Start", "Timestamp"])) ??
    new Date().toISOString();
  const recoveredAt = toIso(pick(row, ["recoveredAt", "recoveryTime", "Recovery Time"]));
  const status = toIncidentStatus(pick(row, ["status", "Status"]));
  const retryAttempts =
    num(pick(row, ["retryAttempts"])) || num(pick(row, ["retryCount", "Retry Count"]), 0) || 1;

  const storedSeconds = num(pick(row, ["durationSeconds", "downtimeSeconds", "Downtime Seconds"]));
  const computedSeconds = Math.max(
    0,
    Math.round(
      ((recoveredAt ? new Date(recoveredAt).getTime() : Date.now()) -
        new Date(startedAt).getTime()) /
        1000,
    ),
  );

  const rawTimeline = pick(row, ["timeline"]);
  const timeline = Array.isArray(rawTimeline)
    ? (rawTimeline as unknown[]).map((event, eventIndex) =>
        normalizeTimelineEvent(event, eventIndex, id, startedAt),
      )
    : [];

  if (timeline.length === 0) {
    timeline.push({
      id: `${id}-start`,
      label: "Initial health check failed",
      detail: str(pick(row, ["failureReason", "Failure Reason"]), "Health check failed"),
      at: startedAt,
      kind: "failure",
    });
    if (status === "Recovered" || status === "Resolved") {
      timeline.push({
        id: `${id}-recovery`,
        label: "Service recovered",
        detail: "Availability restored",
        at: recoveredAt ?? startedAt,
        kind: "recovery",
      });
    } else {
      timeline.push({
        id: `${id}-created`,
        label: "Incident created",
        detail: `${id} opened for ${name}`,
        at: recoveredAt ?? startedAt,
        kind: "incident",
      });
    }
  }

  return {
    id,
    serviceId: str(pick(row, ["serviceId"]) || slug(name)),
    serviceName: name,
    application: asApplication(pick(row, ["application", "Application"])),
    environment: asEnvironment(pick(row, ["environment", "Environment"]), "QA"),
    status,
    severity: toIncidentSeverity(pick(row, ["severity", "Severity"])),
    detectedAt: startedAt,
    startedAt,
    recoveredAt,
    durationSeconds: storedSeconds || computedSeconds,
    retryAttempts,
    failureReason: str(pick(row, ["failureReason", "Failure Reason"]), "Health check failed"),
    httpResponse: str(
      pick(row, ["httpResponse", "HTTP Response", "responseSnippet", "Response Snippet"]),
      "No response captured",
    ),
    n8nExecutionId: str(
      pick(row, ["n8nExecutionId", "workflowExecutionId", "Workflow Execution ID"]),
    ),
    timeline,
  };
}

export function normalizeRetryAttempt(raw: unknown, index: number): RetryAttempt {
  const row = asRecord(raw);
  const name = str(pick(row, ["serviceName", "Service Name"]), "Unknown Service");
  const outcome = str(pick(row, ["outcome", "status"]), "failed").toLowerCase();

  return {
    id: str(pick(row, ["id"]) || `rt-${index + 1}`),
    serviceId: str(pick(row, ["serviceId"]) || slug(name)),
    serviceName: name,
    incidentId: optionalStr(pick(row, ["incidentId", "Incident ID"])),
    attempt: num(pick(row, ["attempt"]), 1),
    outcome: (["failed", "succeeded", "scheduled", "info"] as const).includes(
      outcome as RetryAttempt["outcome"],
    )
      ? (outcome as RetryAttempt["outcome"])
      : "info",
    scheduledDelaySeconds:
      optionalNumber(pick(row, ["scheduledDelaySeconds", "delaySeconds"])) ?? undefined,
    at:
      toIso(pick(row, ["at", "timestamp", "incidentStartedAt", "Timestamp"])) ??
      new Date().toISOString(),
    message: str(
      pick(row, ["message"]),
      `Retry attempt ${num(pick(row, ["attempt"]), 1)} recorded`,
    ),
  };
}

export function normalizeResponseTimeMetric(raw: unknown): ResponseTimeMetric {
  const row = asRecord(raw);
  const name = str(pick(row, ["serviceName", "Service Name"]), "Unknown Service");

  return {
    timestamp: toIso(pick(row, ["timestamp", "Timestamp", "checkedAt"])) ?? new Date().toISOString(),
    serviceId: str(pick(row, ["serviceId"]) || slug(name)),
    serviceName: name,
    responseTimeMs: num(pick(row, ["responseTimeMs", "Response Time Ms"]), 0),
    thresholdMs: num(pick(row, ["thresholdMs", "responseTimeThresholdMs"]), 3000),
  };
}

export function normalizeUptimePoint(raw: unknown): UptimePoint {
  const row = asRecord(raw);
  const checks = num(pick(row, ["checks", "totalChecks", "Total Checks"]));
  const failedChecks = num(pick(row, ["failedChecks", "Failed Checks"]));
  const reported = pick(row, ["uptimePct", "availabilityPercentage", "Availability Percentage"]);

  return {
    date: str(pick(row, ["date", "Date"])).slice(0, 10),
    uptimePct: num(reported, checks ? Math.round(((checks - failedChecks) / checks) * 10000) / 100 : 0),
    checks,
    failedChecks,
  };
}

const ENVIRONMENT_LABELS: Environment[] = ["QA", "Staging", "Production"];

export function normalizeSettings(raw: unknown): DashboardSettings {
  // Some producers nest the payload under `settings`.
  const inner = pick(raw, ["settings"]) ?? raw;
  const row = asRecord(inner);

  const rawEnvironments = pick(row, ["environments"]);
  const environments: EnvironmentConfig[] = Array.isArray(rawEnvironments)
    ? (rawEnvironments as unknown[]).map((entry) => {
        if (typeof entry === "string") {
          const environment = asEnvironment(entry, "QA");
          return {
            environment,
            baseUrl: "https://app.vwo.com",
            enabled: environment === "QA",
            criticality: environment === "Production" ? "Critical" : "High",
          };
        }
        const config = asRecord(entry);
        return {
          environment: asEnvironment(pick(config, ["environment"]), "QA"),
          baseUrl: str(pick(config, ["baseUrl"]), ""),
          enabled: bool(pick(config, ["enabled"]), false),
          criticality: (["Critical", "High", "Medium"] as const).includes(
            str(pick(config, ["criticality"])) as EnvironmentConfig["criticality"],
          )
            ? (str(pick(config, ["criticality"])) as EnvironmentConfig["criticality"])
            : "High",
        };
      })
    : ENVIRONMENT_LABELS.map((environment) => ({
        environment,
        baseUrl: "https://app.vwo.com",
        enabled: environment === "QA",
        criticality: environment === "Production" ? "Critical" : "High",
      }));

  const delays = pick(row, ["retryDelaysSeconds", "retryDelays"]);
  let retryDelaysSeconds: number[] = Array.isArray(delays)
    ? (delays as unknown[]).map((value) => num(value)).filter((value) => value > 0)
    : [];

  if (retryDelaysSeconds.length === 0) {
    // The monitor workflow stores a single `retryDelayMs`; approximate the ladder.
    const singleDelayMs = num(pick(row, ["retryDelayMs"]), 0);
    retryDelaysSeconds = singleDelayMs > 0 ? [Math.round(singleDelayMs / 1000)] : [20, 30];
  }

  const retryAttempts = num(pick(row, ["retryAttempts", "retryCount"]), 3);
  const padded = Array.from(
    { length: Math.max(0, retryAttempts - 1) },
    (_, index) => retryDelaysSeconds[index] ?? retryDelaysSeconds[retryDelaysSeconds.length - 1] ?? 30,
  );

  return {
    responseTimeThresholdMs: num(pick(row, ["responseTimeThresholdMs"]), 3000),
    retryAttempts,
    retryDelaysSeconds: padded,
    checkIntervalMinutes: num(pick(row, ["checkIntervalMinutes", "scheduleMinutes"]), 5),
    environments,
  };
}
