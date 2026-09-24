/**
 * The browser never talks to Langflow directly and never sees the API key.
 * It calls our own /api/run route, which is:
 *   - in dev      -> Vite middleware (server/local-api-plugin.js)
 *   - on Vercel   -> the serverless function api/run.js
 * Both run server/langflow-service.js.
 */

/**
 * Pull the assistant answer out of the Langflow "run" response.
 * Handles the chat shape we get back from the flow and degrades gracefully
 * instead of throwing when something is missing.
 */
export function extractText(json) {
  const firstRun = json?.outputs?.[0]
  const components = firstRun?.outputs || []

  for (const component of components) {
    const message = component?.results?.message
    const text = message?.text ?? message?.data?.text
    if (typeof text === 'string' && text.trim()) {
      const error = message?.error ?? message?.data?.error
      return error ? `${text}\n\n---\n\n> ⚠️ **Flow warning:** ${error}` : text
    }

    const messages = component?.messages
    if (Array.isArray(messages) && messages.length) {
      const last = messages[messages.length - 1]?.message
      const text2 = last?.text ?? last?.data?.text
      if (typeof text2 === 'string' && text2.trim()) return text2
    }
  }

  // last resort: dig through nested message wrappers
  for (const component of components) {
    const nested = component?.outputs?.message?.message?.text
    if (typeof nested === 'string' && nested.trim()) return nested
  }

  return ''
}

/**
 * POST /api/run -> { text, raw, ms }
 * The route always returns JSON, including for errors: { ok: false, error }.
 */
export async function runFlow(inputValue, sessionId, signal) {
  const started = performance.now()

  const response = await fetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input_value: inputValue, session_id: sessionId }),
    signal,
  })

  const bodyText = await response.text()
  const ms = Math.round(performance.now() - started)

  let json = null
  try {
    json = JSON.parse(bodyText)
  } catch {
    json = null
  }

  if (!json) throw new Error(`Non-JSON response from /api/run (HTTP ${response.status})`)

  if (json.ok === false) throw new Error(json.error || `HTTP ${response.status} ${response.statusText}`)
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

  const text = extractText(json)
  if (!text) throw new Error('The flow returned no message text. Check the flow is built & saved.')

  return { text, raw: json, ms }
}

/** GET /api/health -> { ok, target, flowId, hasApiKey, langflow } */
export async function checkLangflowHealth() {
  const response = await fetch('/api/health', { headers: { Accept: 'application/json' } })
  const data = await response.json().catch(() => null)
  return data || { ok: false, error: `HTTP ${response.status}` }
}
