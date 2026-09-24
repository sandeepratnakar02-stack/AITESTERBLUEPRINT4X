import { runFlow } from '../server/langflow-service.js'

// The Bug Triage flow can take ~15-30s, well past the 10s default.
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  // Vercel parses application/json bodies; tolerate a raw string just in case.
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {}

  const { status, body: payload } = await runFlow(body)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(payload)
}

function safeParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}
