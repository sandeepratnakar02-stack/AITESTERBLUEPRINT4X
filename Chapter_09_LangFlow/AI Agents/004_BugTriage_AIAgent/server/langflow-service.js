// Shared server-side Langflow client.
// Used by BOTH the Vercel serverless functions (api/*.js) and the local Vite dev
// middleware (server/local-api-plugin.js), so dev and production behave identically.

export const DEFAULT_FLOW_ID = '056be0de-ed00-42f9-ba2e-657683e9dc98'
const DEFAULT_BASE_URL = 'http://127.0.0.1:7860'
const RUN_TIMEOUT_MS = 120_000
const HEALTH_TIMEOUT_MS = 8_000

export function baseUrl() {
  return (process.env.LANGFLOW_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
}

export function flowId() {
  return process.env.LANGFLOW_FLOW_ID || DEFAULT_FLOW_ID
}

export function config() {
  return { target: baseUrl(), flowId: flowId(), hasApiKey: Boolean(process.env.LANGFLOW_API_KEY) }
}

function errorDetail(json, fallbackText) {
  const detail = json?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((d) => d?.msg || JSON.stringify(d)).join('; ')
  return json?.message || fallbackText.slice(0, 500)
}

/** GET <LANGFLOW_URL>/health -> { ok, target, flowId, langflow } */
export async function getHealth() {
  try {
    const response = await fetch(`${baseUrl()}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    const langflow = await response.json().catch(() => null)
    const ok = response.ok && langflow?.status === 'ok'
    return {
      status: ok ? 200 : 503,
      body: { ok, ...config(), langflow },
    }
  } catch (error) {
    return {
      status: 503,
      body: { ok: false, ...config(), error: error?.message || String(error) },
    }
  }
}

/** POST <LANGFLOW_URL>/api/v1/run/<flowId>?stream=false -> the raw Langflow payload */
export async function runFlow(input) {
  const inputValue = String(input?.input_value ?? '').trim()
  if (!inputValue) {
    return { status: 400, body: { ok: false, error: 'input_value is required' } }
  }

  const url = `${baseUrl()}/api/v1/run/${flowId()}?stream=false`
  const headers = { 'Content-Type': 'application/json' }
  if (process.env.LANGFLOW_API_KEY) headers['x-api-key'] = process.env.LANGFLOW_API_KEY

  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        output_type: 'chat',
        input_type: 'chat',
        input_value: inputValue,
        session_id: input?.session_id || 'ui',
      }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    })
  } catch (error) {
    return {
      status: 502,
      body: {
        ok: false,
        error: `Cannot reach Langflow at ${baseUrl()} — ${error?.message || String(error)}`,
        ...config(),
      },
    }
  }

  const text = await response.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }

  if (!response.ok) {
    return {
      status: response.status,
      body: { ok: false, error: errorDetail(json, text), ...config() },
    }
  }

  if (!json) {
    return { status: 502, body: { ok: false, error: `Non-JSON response: ${text.slice(0, 300)}` } }
  }

  // Spread the Langflow payload through untouched - the UI reads `outputs[...]`.
  return { status: 200, body: { ok: true, ...json } }
}
