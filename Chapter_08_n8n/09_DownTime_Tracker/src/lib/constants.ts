import type { HealthState } from "@/types";

/**
 * Deterministic "current time" for the bundled mock dataset.
 *
 * The dashboard is seeded against this fixed instant so that the values shown
 * in the UI always match the reference snapshot (10 Sep 2026 • 10:42 AM) and so
 * server-rendered and client-rendered output are identical (no hydration drift).
 * When live n8n data is wired up this constant becomes irrelevant.
 */
export const MOCK_NOW = new Date("2026-09-10T10:42:00+05:30");

export const APP_NAME = "VWO QA Downtime Tracker";
export const APPLICATION = "VWO";

export const ENVIRONMENTS = ["QA", "Staging", "Production"] as const;

/** Default service-level agreement used for thresholds and alerts. */
export const SLA_THRESHOLD_MS = 3000;
export const UPTIME_TARGET_PCT = 99.9;

/** Human readable meaning of every health state, shown in the UI legend. */
export const STATUS_CLASSIFICATION: {
  state: HealthState;
  label: string;
  description: string;
  tone: "healthy" | "degraded" | "down" | "info" | "unknown";
}[] = [
  {
    state: "HEALTHY",
    label: "HEALTHY",
    description: "HTTP status and functional checks passed.",
    tone: "healthy",
  },
  {
    state: "SLOW",
    label: "SLOW",
    description: "Request succeeded but response threshold exceeded.",
    tone: "degraded",
  },
  {
    state: "FUNCTIONAL_FAILURE",
    label: "FUNCTIONAL_FAILURE",
    description: "HTTP succeeded but expected content/functionality failed.",
    tone: "degraded",
  },
  {
    state: "DOWN",
    label: "DOWN",
    description: "Endpoint unavailable or unexpected server response.",
    tone: "down",
  },
  {
    state: "RETRYING",
    label: "RETRYING",
    description: "Health check failed and automatic retries are in progress.",
    tone: "degraded",
  },
  {
    state: "UNKNOWN",
    label: "UNKNOWN",
    description: "No result recorded for this service yet.",
    tone: "unknown",
  },
];

export const CHECK_INTERVAL_OPTIONS = [1, 5, 10, 15] as const;

/**
 * Services drawn on the dashboard's response time chart.
 * Kept here (not in the mock dataset) because the chart is a client component
 * and the data layer is server-only.
 */
export const RESPONSE_TIME_CHART_SERVICES = [
  "VWO Main Application",
  "VWO Login",
  "VWO API",
] as const;

/** Navigation model for the collapsible sidebar. */
export const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: "LayoutDashboard" },
  { label: "Services", href: "/services", icon: "Server" },
  { label: "Health Checks", href: "/checks", icon: "Activity" },
  { label: "Incidents", href: "/incidents", icon: "TriangleAlert" },
  { label: "Response Times", href: "/response-times", icon: "Timer" },
  { label: "Retry History", href: "/retries", icon: "RotateCcw" },
  { label: "Logs", href: "/logs", icon: "ScrollText" },
  { label: "Settings", href: "/settings", icon: "Settings" },
] as const;
