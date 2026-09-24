import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { checkLangflowHealth, runFlow } from './lib/langflow.js'
import { renderMarkdown } from './lib/markdown.js'

const newSessionId = () => `ui-${Math.random().toString(36).slice(2, 10)}`

// localhost => we can tell the user to start the server; elsewhere => env vars.
const IS_LOCAL_HOST =
  typeof window === 'undefined' || ['localhost', '127.0.0.1'].includes(window.location.hostname)

const WELCOME = {
  role: 'system',
  text:
    'Ready. Type a ticket key (e.g. **QA-8**) or paste a bug description, then hit **Run**.\n\n' +
    'The agent calls the Langflow flow and answers here as formatted Markdown.',
}

export default function App() {
  const [messages, setMessages] = useState([WELCOME])
  const [input, setInput] = useState('QA-8')
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState(newSessionId)
  const [health, setHealth] = useState('checking') // checking | ok | down
  const [config, setConfig] = useState(null)
  const [error, setError] = useState('')

  const abortRef = useRef(null)
  const listRef = useRef(null)

  // Is Langflow reachable? /api/health is served by the Vite middleware in dev
  // and by api/health.js on Vercel.
  const checkHealth = useCallback(async () => {
    setHealth('checking')
    try {
      const data = await checkLangflowHealth()
      setConfig(data)
      setHealth(data?.ok ? 'ok' : 'down')
    } catch {
      setHealth('down')
    }
  }, [])

  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  // keep the newest message in view
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const canRun = useMemo(() => !busy && input.trim().length > 0, [busy, input])

  async function run() {
    const value = input.trim()
    if (!value || busy) return

    setError('')
    setInput('')
    setBusy(true)
    setMessages((prev) => [...prev, { role: 'user', text: value }])

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const { text, raw, ms } = await runFlow(value, sessionId, controller.signal)
      const component = raw?.outputs?.[0]?.outputs?.[0]?.component_display_name
      setMessages((prev) => [...prev, { role: 'agent', text, raw, ms, component, input: value }])
    } catch (err) {
      if (err?.name === 'AbortError') {
        setMessages((prev) => [...prev, { role: 'system', text: '_Cancelled._' }])
      } else {
        setError(err?.message || String(err))
      }
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      run()
    }
  }

  function reset() {
    cancel()
    setMessages([WELCOME])
    setError('')
    setSessionId(newSessionId())
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">🐞</span>
          <div>
            <h1>Bug Triage AI Agent</h1>
            <p className="sub">
              flow <code>{config?.flowId ? `${config.flowId.slice(0, 8)}…` : '—'}</code> · session{' '}
              <code>{sessionId}</code>
            </p>
          </div>
        </div>

        <div className="topbar-actions">
          <button
            className={`status status-${health}`}
            onClick={checkHealth}
            title={`Re-check Langflow at ${config?.target || 'the configured URL'}`}
          >
            <span className="dot" />
            {health === 'ok' ? 'Langflow online' : health === 'down' ? 'Langflow offline' : 'Checking…'}
          </button>
          <button className="ghost" onClick={reset} disabled={busy}>
            New session
          </button>
        </div>
      </header>

      <main className="chat" ref={listRef}>
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <UserBubble key={index} text={message.text} />
          ) : (
            <AgentBubble key={index} message={message} />
          ),
        )}

        {busy && (
          <div className="row row-agent">
            <div className="bubble bubble-agent typing">
              <span className="tick" />
              <span className="tick" />
              <span className="tick" />
              <em>Triaging…</em>
              <button className="ghost tiny" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="error">
            <strong>Request failed</strong>
            <p>{error}</p>
            {IS_LOCAL_HOST ? (
              <p className="hint">
                Start Langflow first:{' '}
                <code>./.venv/Scripts/langflow.exe run --host 127.0.0.1 --port 7860</code>
              </p>
            ) : (
              <p className="hint">
                This deployment is front-end only, so it needs a reachable Langflow. Set{' '}
                <code>LANGFLOW_URL</code> and <code>LANGFLOW_API_KEY</code> in your Vercel project
                settings (currently pointing at <code>{config?.target || 'nothing'}</code>) — no
                redeploy needed.
              </p>
            )}
          </div>
        )}
      </main>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          placeholder="Enter a ticket key or paste the bug report… (Enter to run, Shift+Enter for a new line)"
          disabled={busy}
        />
        <button className="run" onClick={run} disabled={!canRun}>
          {busy ? 'Running…' : '▶ Run'}
        </button>
      </footer>
    </div>
  )
}

function UserBubble({ text }) {
  return (
    <div className="row row-user">
      <div className="bubble bubble-user">{text}</div>
    </div>
  )
}

function AgentBubble({ message }) {
  const [showRaw, setShowRaw] = useState(false)
  const [copied, setCopied] = useState(false)

  const html = useMemo(() => renderMarkdown(message.text), [message.text])
  const isWelcome = message.role === 'system'

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked - ignore */
    }
  }

  return (
    <div className={`row ${isWelcome ? 'row-system' : 'row-agent'}`}>
      <div className={`bubble ${isWelcome ? 'bubble-system' : 'bubble-agent'}`}>
        <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />

        {message.raw && (
          <>
            <div className="bubble-actions">
              <button className="ghost tiny" onClick={copy}>
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
              <button className="ghost tiny" onClick={() => setShowRaw((value) => !value)}>
                {showRaw ? 'Hide JSON' : 'View JSON'}
              </button>
              {message.component && <span className="meta">{message.component}</span>}
              {typeof message.ms === 'number' && <span className="meta">{message.ms} ms</span>}
            </div>
            {showRaw && (
              <pre className="raw">{JSON.stringify(message.raw, null, 2)}</pre>
            )}
          </>
        )}
      </div>
    </div>
  )
}
