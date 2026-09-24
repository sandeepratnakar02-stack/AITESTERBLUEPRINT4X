import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { localApi } from './server/local-api-plugin.js'

// Dev and production share the same routes (/api/run, /api/health):
//  - dev: the `localApi()` middleware runs server/langflow-service.js in-process
//  - prod on Vercel: api/run.js + api/health.js run the same module as functions
// Nothing secret is exposed to the browser through VITE_* variables.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['LANGFLOW_URL', 'LANGFLOW_API_KEY', 'LANGFLOW_FLOW_ID']) {
    if (!process.env[key] && env[key]) process.env[key] = env[key]
  }

  return {
    plugins: [react(), localApi()],
    server: {
      port: 5180,
      strictPort: true,
    },
  }
})
