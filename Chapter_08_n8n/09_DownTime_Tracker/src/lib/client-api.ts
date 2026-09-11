import type { DashboardSettings, Environment } from "@/types";

/**
 * Browser-side helpers.
 *
 * Client components never talk to n8n directly — they call these same-origin
 * route handlers, which own the credentials. That removes the need for CORS on
 * the n8n side and keeps the webhook URL + API key out of the JS bundle.
 */

export interface HealthCheckTriggerResponse {
  ok: boolean;
  triggeredAt: string;
  executionId: string;
  message?: string;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request to ${url} failed (${response.status})`);
  }

  return payload as T;
}

/** `POST /api/health-check` — queue a run of the monitoring workflow. */
export function triggerHealthCheck(environment: Environment): Promise<HealthCheckTriggerResponse> {
  return requestJson<HealthCheckTriggerResponse>("/api/health-check", {
    method: "POST",
    body: JSON.stringify({ environment }),
  });
}

/** `POST /api/incidents/resolve` — mark an incident resolved. */
export function resolveIncidentRequest(incidentId: string): Promise<{ ok: boolean }> {
  return requestJson<{ ok: boolean }>("/api/incidents/resolve", {
    method: "POST",
    body: JSON.stringify({ incidentId }),
  });
}

/** `GET /api/settings` */
export function fetchSettings(): Promise<DashboardSettings> {
  return requestJson<DashboardSettings>("/api/settings");
}

/** `POST /api/settings` */
export function saveSettings(payload: DashboardSettings): Promise<DashboardSettings> {
  return requestJson<DashboardSettings>("/api/settings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
