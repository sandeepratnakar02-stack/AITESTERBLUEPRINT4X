import { useMemo, useRef, useState } from 'react'
import { renderMarkdown } from '../lib/markdown.js'
import CostPanel from './CostPanel.jsx'

export default function ChatPanel({ health, collection, messages, busy, error, onSend, onOpenChunk }) {
  const [question, setQuestion] = useState('What are the functional requirements for the authentication system?')
  const [mode, setMode] = useState('hybrid')
  const [topK, setTopK] = useState(health?.config?.top_k ?? 3)
  const listRef = useRef(null)

  const send = () => {
    const trimmed = question.trim()
    if (!trimmed || busy) return
    onSend(trimmed, { mode, topK })
    setQuestion('')
  }

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  // tag (C1, C2 …) -> the chunk it refers to, per assistant message
  const lookups = useMemo(
    () =>
      messages.map((message) => {
        if (!message.generation?.context_blocks || !message.retrieval) return null
        const hits = message.retrieval.modes?.[message.retrieval.mode]?.hits ?? []
        const byChunk = new Map(hits.map((hit) => [hit.chunk_id, hit]))
        const map = new Map()
        for (const block of message.generation.context_blocks) {
          map.set(block.tag, { block, hit: byChunk.get(block.chunk_id) })
        }
        return map
      }),
    [messages],
  )

  const handleCitationClick = (index) => (event) => {
    const button = event.target.closest('button.cite')
    if (!button) return
    const entry = lookups[index]?.get(button.dataset.cite)
    if (entry?.hit) onOpenChunk(entry.hit, null)
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>Chat with the PRD (retrieval → gpt-oss-120b)</h2>
          <span className="small muted mono">
            {health?.config?.groq_model} · collection {collection || '—'}
          </span>
        </div>
        <div className="card-body">
          <div className="chat" ref={listRef}>
            {messages.length === 0 ? (
              <div className="empty">
                Ask something only this document can answer. The question is embedded locally, the top chunks are pulled
                from ChromaDB, and only then does the prompt go to Groq — with citations back to the chunks.
              </div>
            ) : null}

            {messages.map((message, index) => (
              <div className={`msg ${message.role}`} key={index}>
                {message.role === 'user' ? (
                  <div className="bubble">{message.content}</div>
                ) : (
                  <div className="bubble" style={{ maxWidth: '100%', width: '100%' }}>
                    <div onClick={handleCitationClick(index)} dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />

                    {message.generation ? (
                      <div className="stack" style={{ marginTop: 12 }}>
                        <div className="wrap">
                          {message.generation.citations?.length ? (
                            message.generation.citations.map((citation) => (
                              <button
                                key={citation.tag}
                                className="button sm ghost"
                                onClick={() => {
                                  const entry = lookups[index]?.get(citation.tag)
                                  if (entry?.hit) onOpenChunk(entry.hit, null)
                                }}
                              >
                                {citation.tag} → {citation.chunk_id} (p.{citation.page_start})
                              </button>
                            ))
                          ) : (
                            <span className="tiny muted">The answer cited no chunks — treat it with suspicion.</span>
                          )}
                        </div>

                        <details className="math">
                          <summary>Context sent to the model ({message.generation.context_chars} chars)</summary>
                          <div style={{ marginTop: 8 }}>
                            {message.generation.context_blocks.map((block) => {
                              const entry = lookups[index]?.get(block.tag)
                              return (
                                <div className="ctx-block" key={block.tag}>
                                  <div className="h">
                                    <span className="badge">{block.tag}</span>
                                    <span className="mono">{block.chunk_id}</span>
                                    <span className="badge page">
                                      p.{block.page_start}{block.page_end !== block.page_start ? `-${block.page_end}` : ''}
                                    </span>
                                  </div>
                                  <div className="t">{entry?.hit?.text ?? '(text unavailable)'}</div>
                                </div>
                              )
                            })}
                          </div>
                        </details>

                        <details className="math">
                          <summary>Tokens, latency & cost</summary>
                          <div style={{ marginTop: 8 }}>
                            <CostPanel generation={message.generation} retrievalMs={message.generation.retrieval_ms} />
                          </div>
                        </details>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}

            {busy ? (
              <div className="msg">
                <div className="bubble center" style={{ gap: 10 }}>
                  <span className="spinner" />
                  <span className="muted">
                    Embedding the question, retrieving top chunks from ChromaDB, then asking {health?.config?.groq_model}…
                  </span>
                </div>
              </div>
            ) : null}
          </div>

          {error ? <div className="error-box" style={{ marginTop: 12 }}>{error}</div> : null}

          <div className="composer" style={{ marginTop: 14 }}>
            <textarea
              className="grow"
              value={question}
              placeholder="Ask about the PRD… (Enter to send, Shift+Enter for a new line)"
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <label className="field" style={{ width: 132 }}>
              <span className="label">Retriever</span>
              <select value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="hybrid">hybrid (RRF)</option>
                <option value="vector">vector (cosine)</option>
                <option value="keyword">keyword (BM25)</option>
              </select>
            </label>
            <label className="field" style={{ width: 84 }}>
              <span className="label">Top K</span>
              <select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 8, 10].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <button className="button primary" onClick={send} disabled={busy}>
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          <p className="tiny muted" style={{ marginBottom: 0 }}>
            The answer is generated only from the retrieved chunks. Ask something absent from the document — this PRD has no
            “acceptance criteria” section, so that question must be refused — and it has to reply “The document does not
            contain this information.”
          </p>
        </div>
      </div>
    </div>
  )
}
