import ScoreMath from './ScoreMath.jsx'

/** Highlight query terms inside a snippet (only meaningful for the keyword retriever). */
function highlight(text, terms) {
  if (!terms?.length) return text
  const escaped = terms
    .filter((term) => term.length > 2)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (!escaped.length) return text
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(pattern)
  return parts.map((part, index) =>
    pattern.test(part) ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>,
  )
}

export default function ResultCard({ hit, mode, max, onOpen }) {
  const pageLabel = hit.page_start === hit.page_end ? `p.${hit.page_start}` : `p.${hit.page_start}-${hit.page_end}`
  const width = max > 0 ? Math.max(2, (Math.abs(hit.score) / max) * 100) : 0

  return (
    <div className={`result${hit.rank === 1 ? ' rank-1' : ''}`}>
      <div className="result-head">
        <div className="wrap">
          <span className="rank-badge">{hit.rank}</span>
          <span className="badge page">{pageLabel}</span>
          <span className="badge">#{hit.index}</span>
          <span className="tiny muted">{hit.chars} chars</span>
        </div>
        <span className="mono small" title="raw score for this retriever">
          {mode === 'hybrid' ? hit.score.toFixed(6) : hit.score.toFixed(4)}
        </span>
      </div>

      <div className="score-bar">
        <i style={{ width: `${width}%` }} />
      </div>

      <div className="result-text">{highlight(hit.text, mode === 'keyword' ? hit.matched_terms : null)}</div>

      <div className="between" style={{ marginTop: 8 }}>
        <span className="tiny muted mono">{hit.chunk_id}</span>
        <button className="button sm ghost" onClick={() => onOpen(hit)}>
          Inspect chunk + vector
        </button>
      </div>

      <details className="math">
        <summary>Why this score</summary>
        <ScoreMath hit={hit} mode={mode} />
      </details>
    </div>
  )
}
