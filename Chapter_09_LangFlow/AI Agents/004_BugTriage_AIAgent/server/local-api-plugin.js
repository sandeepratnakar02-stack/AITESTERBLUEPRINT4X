import { getHealth, runFlow } from './langflow-service.js'

function sendJson(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Dev-only Vite middleware that serves the same /api/run and /api/health routes
 * the Vercel serverless functions provide in production.
 */
export function localApi() {
  return {
    name: 'local-langflow-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0]
        if (path !== '/api/run' && path !== '/api/health') return next()

        try {
          if (path === '/api/health') {
            const { status, body } = await getHealth()
            return sendJson(res, status, body)
          }

          if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST')
            return sendJson(res, 405, { ok: false, error: 'Method not allowed' })
          }

          const { status, body } = await runFlow(parseJson(await readBody(req)))
          return sendJson(res, status, body)
        } catch (error) {
          return sendJson(res, 500, { ok: false, error: error?.message || String(error) })
        }
      })
    },
  }
}
