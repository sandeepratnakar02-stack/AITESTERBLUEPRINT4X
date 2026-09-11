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

/**
 * Optional per-endpoint URL overrides, keyed by webhook path.
 *
 * When one is set it wins over the `N8N_BASE_URL` + `N8N_WEBHOOK_PATH` scheme,
 * so a workflow can expose a ready-made URL (query string included) without the
 * rest of the config having to change. Missing overrides fall back silently.
 */
const ENDPOINT_URL_OVERRIDES: Record<string, string | undefined> = {
  incidents: process.env.N8N_INCIDENTS_URL,
  "incidents-resolve": process.env.N8N_RESOLVE_INCIDENT_URL,
};

export class N8nError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "N8nError";
  }
}

/**
 * Builds the URL for a webhook path (server-side only).
 *
 * Uses the per-endpoint override when configured, otherwise
 * `https://n8n.example.com/webhook/<path>`. Query parameters are merged into
 * whatever the resulting URL already carries, so an override such as
 * `.../incidents?environment=QA` keeps working.
 */
export function n8nWebhookUrl(path: string, query?: Record<string, string | undefined>): string {
  const clean = path.replace(/^\//, "");
  const override = ENDPOINT_URL_OVERRIDES[clean]?.trim();
  const target = override ? override : `${N8N_BASE_URL}/${N8N_WEBHOOK_PATH}/${clean}`;

  return appendQuery(target, query);
}

/** Merges query parameters into a URL, tolerating non-absolute values. */
function appendQuery(url: string, query?: Record<string, string | undefined>): string {
  const entries = Object.entries(query ?? {}).filter(
    ([, value]) => value !== undefined && value !== "",
  );
  if (entries.length === 0) return url;

  try {
    const parsed = new URL(url);
    for (const [key, value] of entries) parsed.searchParams.set(key, String(value));
    return parsed.toString();
  } catch {
    // Not an absolute URL — fall back to manual concatenation.
    const search = new URLSearchParams();
    for (const [key, value] of entries) search.set(key, String(value));
    return `${url}${url.includes("?") ? "&" : "?"}${search.toString()}`;
  }
}

interface N8nRequestOptions {
  method?: "GET" | "POST";
  query?: Record<string, string | undefined>;
  body?: unknown;
}

/** Transient-failure tolerance: one retry after a short backoff. */
const RETRY_DELAY_MS = 750;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls an n8n webhook and parses the JSON response.
 * Throws `N8nError` for transport/HTTP failures so callers can decide whether
 * to fall back to the bundled mock dataset.
 *
 * A single retry is applied to GETs that fail at the network level (DNS hiccup,
 * cold-start connection reset). Writes are never retried — re-sending a
 * `health-check` or `incidents-resolve` could double-trigger the workflow — and
 * HTTP error responses are not retried either, since they will not improve.
 */
export async function n8nFetch<T>(path: string, options: N8nRequestOptions = {}): Promise<T> {
  const { method = "GET" } = options;
  const maxAttempts = method === "GET" ? 2 : 1;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await requestOnce<T>(path, options);
    } catch (error) {
      const retryable = error instanceof N8nError && error.status === undefined;
      if (attempt >= maxAttempts || !retryable) throw error;

      console.warn(`[vwo-qa] retrying "${path}" after transient failure: ${(error as Error).message}`);
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
}

/** One HTTP round trip. */
async function requestOnce<T>(path: string, options: N8nRequestOptions): Promise<T> {
  const { method = "GET", query, body } = options;
  const target = n8nWebhookUrl(path, query);

  if (!/^https?:\/\//i.test(target)) {
    throw new N8nError(
      `No n8n URL configured for "${path}" (set N8N_BASE_URL or a per-endpoint override)`,
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target, {
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
