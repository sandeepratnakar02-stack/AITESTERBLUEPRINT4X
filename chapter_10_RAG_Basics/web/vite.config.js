import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ---------------------------------------------------------------------------------------------
// Local development
//   The FastAPI server on :8011 owns the Groq key and the vector store, so the dev server proxies
//   /api/* to it. The browser never sees a secret and there is no CORS/preflight work to do.
//
// Production (Vercel)
//   `vite build` ignores `server.proxy` entirely. src/lib/api.js only ever calls relative paths
//   (/api/health, /api/search, /api/chat), which resolve to the FastAPI function on the same
//   domain. So there is no proxy, no absolute URL, and no hard-coded production domain to change.
// ---------------------------------------------------------------------------------------------
const API_TARGET = process.env.RAG_API_URL || 'http://127.0.0.1:8011'
const apiProxy = { '/api': { target: API_TARGET, changeOrigin: true } }

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5190,
    strictPort: true,
    proxy: apiProxy,
  },
  // `npm run preview` serves the production bundle locally; proxy there too so a built UI can be
  // smoke-tested against the local API.
  preview: {
    port: 5191,
    proxy: apiProxy,
  },
})
