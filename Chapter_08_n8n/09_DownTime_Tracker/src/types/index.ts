/**
 * Shared domain types for the VWO QA Downtime Tracker.
 *
 * These interfaces intentionally mirror the payload shapes emitted by the
 * `09_DownTime_Tracker` n8n workflow so the mock data can be swapped for live
 * webhook responses without touching the UI layer.
 */

export type Environment = "QA" | "Staging" | "Production";

export type Application = "VWO";

/** Canonical health states (see STATUS_CLASSIFICATION in `lib/constants.ts`). */
export type HealthState =
  | "HEALTHY"
  | "SLOW"
  | "FUNCTIONAL_FAILURE"
  | "DOWN"
  | "RETRYING"
  | "UNKNOWN";

export type CheckType = "HTTP" | "API" | "FUNCTIONAL";

export type HttpMethod = "GET" | "POST" | "HEAD";

export type IncidentStatus = "Open" | "Investigating" | "Recovered" | "Resolved";

export type IncidentSeverity = "Critical" | "High" | "Medium" | "Low";

export type RetryOutcome = "failed" | "succeeded" | "scheduled" | "info";

/** Retry policy mirrored from the n8n `Load VWO Service Configuration` node. */
export interface RetryPolicy {
  /** 1 initial attempt + N-1 retries. */
  maxAttempts: number;
  /** Delay applied *before* attempt #2, #3, ... in seconds. */
  delaysSeconds: number[];
}

export interface Service {
  id: string;
  name: string;
  application: Application;
  environment: Environment;
  checkType: CheckType;
  /** Path or label shown in tables, e.g. `/login`. */
  endpoint: string;
  /** Fully qualified URL the n8n workflow calls. */
  url: string;
  httpMethod: HttpMethod;
  expectedStatus: number;
  expectedText?: string;
  expectedJsonField?: string;
  responseTimeThresholdMs: number;
  critical: boolean;
  retryPolicy: RetryPolicy;

  /* ---- latest observed result ---- */
  status: HealthState;
  httpStatus: number | null;
  responseTimeMs: number;
  attempts: number;
  lastCheckedAt: string;
  consecutiveSlowChecks?: number;
}

export interface HealthCheck {
  id: string;
  serviceId: string;
  serviceName: string;
  environment: Environment;
  attempt: number;
  maxAttempts: number;
  status: HealthState;
  httpStatus: number | null;
  responseTimeMs: number;
  expectedTextFound: boolean | null;
  message: string;
  checkedAt: string;
  n8nExecutionId: string;
  failureReason?: string;
  httpResponseSnippet?: string;
}

export interface RetryAttempt {
  id: string;
  serviceId: string;
  serviceName: string;
  incidentId?: string;
  /** 1 = initial health check, 2 = retry #1, 3 = retry #2. */
  attempt: number;
  outcome: RetryOutcome;
  scheduledDelaySeconds?: number;
  at: string;
  message: string;
}

export interface TimelineEvent {
  id: string;
  label: string;
  detail?: string;
  at: string;
  kind: "failure" | "schedule" | "retry" | "incident" | "recovery" | "info";
}

export interface Incident {
  id: string;
  serviceId: string;
  serviceName: string;
  application: Application;
  environment: Environment;
  status: IncidentStatus;
  severity: IncidentSeverity;
  detectedAt: string;
  startedAt: string;
  recoveredAt?: string | null;
  durationSeconds: number;
  retryAttempts: number;
  failureReason: string;
  httpResponse: string;
  n8nExecutionId: string;
  timeline: TimelineEvent[];
}

export interface ResponseTimeMetric {
  /** ISO timestamp of the sample. */
  timestamp: string;
  serviceId: string;
  serviceName: string;
  responseTimeMs: number;
  thresholdMs: number;
}

export interface UptimePoint {
  /** ISO date (yyyy-mm-dd). */
  date: string;
  uptimePct: number;
  checks: number;
  failedChecks: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  serviceId: string;
  serviceName: string;
  environment: Environment;
  attempt: number;
  maxAttempts: number;
  status: HealthState;
  httpCode: number | null;
  responseTimeMs: number;
  message: string;
}

export interface DashboardSummary {
  overallStatus: HealthState;
  servicesMonitored: number;
  healthyServices: number;
  failedServices: number;
  activeIncidents: number;
  averageResponseTimeMs: number;
  uptimePct: number;
  lastCheckedAt: string;
}

export interface EnvironmentConfig {
  environment: Environment;
  baseUrl: string;
  enabled: boolean;
  criticality: "Critical" | "High" | "Medium";
}

export interface DashboardSettings {
  responseTimeThresholdMs: number;
  retryAttempts: number;
  retryDelaysSeconds: number[];
  checkIntervalMinutes: number;
  environments: EnvironmentConfig[];
}
