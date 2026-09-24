# 004 — Bug Triage AI Agent (React UI)

A tiny, dependency-light React chat UI to run the Langflow **Bug Triage AI Agent** flow.

It replicates this curl:

```bash
curl --location 'http://localhost:7860/api/v1/run/056be0de-ed00-42f9-ba2e-657683e9dc98?stream=false' \
--header 'Content-Type: application/json' \
--header 'x-api-key: sk-...' \
--data '{
    "output_type": "chat",
    "input_type": "chat",
    "input_value": "QA-8",
    "session_id": "abc"
  }'
```

## Run it

```bash
# 1. Langflow must be up first (repo root of this chapter)
cd ../..
./.venv/Scripts/langflow.exe run --host 127.0.0.1 --port 7860

# 2. Then the UI
cd "AI Agents/004_BugTriage_AIAgent"
npm install
npm run dev          # http://localhost:5180
```

Type a ticket key (e.g. `QA-8`) and press **Run** (or just `Enter`).

## How it works

| Piece | Detail |
| --- | --- |
| `src/lib/langflow.js` | POSTs to `/lf/api/v1/run/<flowId>?stream=false`, extracts the answer text from `outputs[0].outputs[0].results.message.text` |
| Vite dev proxy (`vite.config.js`) | `/lf/*` → `http://127.0.0.1:7860/*` and injects the `x-api-key` header server-side |
| `src/lib/markdown.js` | `marked` + `DOMPurify` — the agent replies in Markdown (headings, tables, blockquotes), so it is rendered properly |
| `src/App.jsx` | chat log, Run button, typing indicator, cancel, copy, per-message JSON viewer, latency, Langflow health check |

## Config (`.env.local`)

```
LANGFLOW_URL=http://127.0.0.1:7860   # proxied target
VITE_FLOW_ID=056be0de-...            # which flow to run
LANGFLOW_API_KEY=sk-...              # proxy-only, never in the browser bundle
```

## Notes

- The API key is added by the dev-server proxy, so it is **not** shipped to the browser
  and there is no CORS/preflight issue.
- `npm run build` + `npm run preview` has no proxy. For a production build, host the
  calls behind your own server route that injects the key.
