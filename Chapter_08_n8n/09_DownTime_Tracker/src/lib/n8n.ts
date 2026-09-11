import "server-only";

/**
 * ============================================================================
 *  Server-only n8n transport
 * ============================================================================
 *
 * Everything that talks to n8n lives here and is never shipped to the browser.
 * That keeps the webhook URL + shared secret out of the client bundle and
 * removes CORS from the picture entirely (the browser only ever talks to this
 * app's own origins).
 *
 * Configuration (see `.env.local.example` / `DEPLOYMENT.md`):
 *   N8N_BASE_URL       e.g. https://n8n.example.com      (server-only)
 *   N8N_WEBHOOK_PATH   "webhook" (prod) | "webhook-test" (editor testing)
 *   N8N_API_KEY        optional, sent as the `x-api-key` header
 *   USE_LIVE_DATA      "true" to read from n8n instead of the mock dataset
 *   N8N_FALLBACK_TO_MOCK  "false" to surface n8n errors instead of falling back
 * ============================================================================
 */

export const USE_LIVE_DATA = process.env.USE_LIVE_DATA === "true";

/** When n8n is unreachable the dashboard stays usable on mock data unless disabled. */
export const FALLBACK_TO_MOCK = process.env.N8N_FALLBACK_TO_MOCK !== "false";

const N8N_BASE_URL = (process.env.N8N_BASE_URL ?? "").replace(/\/+$/, "");
const N8N_WEBHOOK_PATH = (process.env.N8N_WEBHOOK_PATH ?? "webhook").replace(/^\/+|\/+$/g, "");
const N8N_API_KEY = process.env.N8N_API_KEY ?? "";
const REQUEST_TIMEOUT_MS = Number(process.env.N8N_TIMEOUT_MS ?? 10_000);

export class N8nError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "N8nError";
  }
}

/** Builds `https://n8n.example.com/webhook/<path>?<query>` (server-side only). */
export function n8nWebhookUrl(path: string, query?: Record<string, string | undefined>): string {
  const clean = path.replace(/^\//, "");
  const base = `${N8N_BASE_URL}/${N8N_WEBHOOK_PATH}`;
  const search = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `${base}/${clean}?${qs}` : `${base}/${clean}`;
}

interface N8nRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/**
 * Calls an n8n webhook and parses the JSON response.
 * Throws `N8nError` for transport/HTTP failures so callers can decide whether
 * to fall back to the bundled mock dataset.
 */
export async function n8nFetch<T>(path: string, options: N8nRequestOptions = {}): Promise<T> {
  const { method = "GET", query, body } = options;

  if (!N8N_BASE_URL) {
    throw new N8nError("N8N_BASE_URL is not configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(n8nWebhookUrl(path, query), {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(N8N_API_KEY ? { "x-api-key": N8N_API_KEY } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new N8nError(`n8n webhook "${path}" responded ${response.status}`, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof N8nError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new N8nError(`n8n webhook "${path}" timed out after ${REQUEST_TIMEOUT_MS} ms`);
    }
    throw new N8nError(`n8n webhook "${path}" unreachable: ${String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs a live call and degrades to the mock dataset on failure.
 * `label` is logged server-side so a broken webhook is visible in the Vercel
 * function logs instead of failing silently.
 */
export async function withFallback<T>(
  label: string,
  live: () => Promise<T>,
  mock: () => T,
): Promise<T> {
  if (!USE_LIVE_DATA) return mock();

  try {
    return await live();
  } catch (error) {
    if (!FALLBACK_TO_MOCK) throw error;
    console.error(`[vwo-qa] ${label} fell back to mock data:`, (error as Error).message);
    return mock();
  }
}
