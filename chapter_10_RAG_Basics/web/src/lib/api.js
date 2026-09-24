// All server calls go through /api, which Vite proxies to the FastAPI process (http://127.0.0.1:8011).

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { error: text }
    }
  }

  if (!response.ok) {
    const detail = payload?.error || payload?.detail || response.statusText
    const stage = payload?.stage ? ` (stage: ${payload.stage})` : ''
    throw new Error(`${detail}${stage}`)
  }
  return payload
}

export const api = {
  health: () => request('/api/health'),
  documents: () => request('/api/documents'),
  config: () => request('/api/config'),

  ingest: (body) =>
    request('/api/ingest', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Multipart upload — used in production, where the confidential PDF is deliberately not deployed.
  // The browser sets the multipart boundary itself, so Content-Type must NOT be set here.
  ingestFile: (file, fields = {}) => {
    const form = new FormData()
    form.append('file', file)
    Object.entries(fields).forEach(([key, value]) => {
      if (value !== undefined && value !== null) form.append(key, String(value))
    })
    return request('/api/ingest', { method: 'POST', body: form, headers: {} })
  },

  chunks: (collection) => request(`/api/chunks/${encodeURIComponent(collection)}`),
  vector: (collection, chunkId) =>
    request(`/api/chunks/${encodeURIComponent(collection)}/${encodeURIComponent(chunkId)}/vector`),

  search: (body) =>
    request('/api/search', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  chat: (body) =>
    request('/api/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteCollection: (name) =>
    request(`/api/collections/${encodeURIComponent(name)}`, { method: 'DELETE' }),
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

export function formatMs(ms) {
  if (ms === null || ms === undefined) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
}
