export default function StatusBar({ health, onRefresh, refreshing }) {
  if (!health) {
    return (
      <div className="card">
        <div className="card-body center" style={{ gap: 10 }}>
          <span className="spinner" /> <span className="muted">Contacting the RAG API…</span>
        </div>
      </div>
    )
  }

  const { ollama, groq, chroma, pdf } = health
  const collections = chroma?.collections ?? []
  const rows = collections.reduce((sum, c) => sum + (c.count || 0), 0)

  return (
    <div className="card">
      <div className="card-head">
        <h2>Environment</h2>
        <div className="wrap">
          <button className="button sm ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      <div className="card-body">
        <div className="wrap">
          <span className="pill" title={ollama?.url || undefined}>
            <i className={`dot ${ollama?.ok ? 'ok' : 'bad'}`} />
            {health.embedding_provider === 'qdrant' ? 'Qdrant Inference' : 'Ollama'}
            <b className="mono">{ollama?.model}</b>
            {ollama?.dims ? <span className="muted small">{ollama.dims}d</span> : null}
          </span>

          <span className="pill" title={groq?.url}>
            <i className={`dot ${groq?.key_present && groq?.model_available !== false ? 'ok' : 'warn'}`} />
            Groq
            <b className="mono">{groq?.model}</b>
            <span className="muted small">{groq?.key_present ? 'key present' : 'no key'}</span>
          </span>

          <span className="pill">
            <i className={`dot ${chroma?.ok ? 'ok' : 'bad'}`} />
            {health.vector_store === 'qdrant' ? 'Qdrant' : 'Chroma'}
            <b className="mono">{collections.length}</b>
            <span className="muted small">collection{collections.length === 1 ? '' : 's'} · {rows} rows</span>
          </span>

          <span className="pill">
            <i className={`dot ${pdf?.exists ? 'ok' : 'bad'}`} />
            PDF
            <span className="muted small">{pdf?.exists ? pdf.name : 'not found'}</span>
          </span>

          {health.active_collection ? (
            <span className="pill">
              <i className="dot ok" />
              Active
              <b className="mono">{health.active_collection}</b>
            </span>
          ) : null}
        </div>

        {health.warnings?.length ? (
          <div className="warnings">
            {health.warnings.map((warning, index) => (
              <div className="warning" key={index}>
                <span>⚠</span>
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
