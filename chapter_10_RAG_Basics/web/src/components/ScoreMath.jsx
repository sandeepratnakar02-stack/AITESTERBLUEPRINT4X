const number = (value, digits = 4) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))

/** The arithmetic behind one hit — BM25 term weights, cosine components, or RRF contributions. */
export default function ScoreMath({ hit, mode }) {
  const breakdown = hit.breakdown || {}

  if (mode === 'keyword') {
    return (
      <>
        <div className="formula">{breakdown.formula}</div>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          k1={breakdown.k1} · b={breakdown.b} · chunk length {breakdown.doc_len} tokens · avg {breakdown.avg_doc_len} tokens ·
          term coverage {breakdown.coverage} ({breakdown.matched_unique_terms}/{breakdown.query_terms?.length ?? 0} query terms present)
        </div>
        <table>
          <thead>
            <tr><th>Term</th><th>tf</th><th>df</th><th>idf</th><th>tf weight</th><th>contribution</th></tr>
          </thead>
          <tbody>
            {(breakdown.terms || []).map((term) => (
              <tr key={term.term}>
                <td className="mono">{term.term}</td>
                <td className="mono">{term.tf}</td>
                <td className="mono">{term.df}</td>
                <td className="mono">{term.idf}</td>
                <td className="mono">{term.tf_weight}</td>
                <td className="mono"><b>{term.contribution}</b></td>
              </tr>
            ))}
            {!breakdown.terms?.length ? (
              <tr><td colSpan={6} className="muted">No query term appears in this chunk.</td></tr>
            ) : null}
          </tbody>
        </table>
      </>
    )
  }

  if (mode === 'vector') {
    // Production: Qdrant Cloud Inference embedded the query and returned the cosine score, so the
    // dot-product/norm breakdown is not available (the raw query vector stays inside the cluster).
    if (breakdown.server_side) {
      return (
        <>
          <div className="formula">{breakdown.formula}</div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            model <span className="mono">{breakdown.model}</span> · cosine similarity{' '}
            <b className="mono">{number(breakdown.cosine, 6)}</b> · distance 1 − s ={' '}
            <b className="mono">{number(breakdown.distance, 6)}</b>
          </div>
          <div className="tiny muted">{breakdown.note}</div>
        </>
      )
    }

    return (
      <>
        <div className="formula">{breakdown.formula}</div>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          q · d = {number(breakdown.dot_product)} · ‖q‖ = {number(breakdown.query_norm)} · ‖d‖ = {number(breakdown.doc_norm)} → cos θ ={' '}
          <b className="mono">{number(breakdown.cosine, 6)}</b>
        </div>
        <div className="tiny muted" style={{ marginBottom: 6 }}>
          Chroma stored distance {number(breakdown.chroma_distance, 6)} → similarity 1 − d ={' '}
          <b className="mono">{number(breakdown.similarity_from_distance, 6)}</b>{' '}
          {breakdown.chroma_distance !== null && breakdown.chroma_distance !== undefined ? '(matches our own computation)' : '(not returned for this row)'}
        </div>
        <table>
          <thead>
            <tr><th>Dim</th><th>query</th><th>chunk</th><th>product</th></tr>
          </thead>
          <tbody>
            {(breakdown.top_dimensions || []).map((row) => (
              <tr key={row.dim}>
                <td className="mono">{row.dim}</td>
                <td className="mono">{number(row.query, 5)}</td>
                <td className="mono">{number(row.doc, 5)}</td>
                <td className="mono"><b>{number(row.product, 6)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="tiny muted" style={{ marginTop: 6 }}>Top 5 dimensions by |query × chunk| — the dimensions pushing these two vectors together.</div>
      </>
    )
  }

  return (
    <>
      <div className="formula">{breakdown.formula}</div>
      <table>
        <thead>
          <tr><th>Retriever</th><th>Rank</th><th>1 / (k + rank)</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>BM25 keyword</td>
            <td className="mono">{breakdown.keyword_rank ?? '—'}</td>
            <td className="mono">{number(breakdown.keyword_rrf, 6)}</td>
          </tr>
          <tr>
            <td>Cosine vector</td>
            <td className="mono">{breakdown.vector_rank ?? '—'}</td>
            <td className="mono">{number(breakdown.vector_rrf, 6)}</td>
          </tr>
          <tr>
            <td><b>RRF total</b></td>
            <td colSpan={2} className="mono"><b>{number(breakdown.total_rrf, 6)}</b></td>
          </tr>
        </tbody>
      </table>
      <div className="tiny muted" style={{ marginTop: 6 }}>
        k = {breakdown.k} — a chunk that is #1 in both lists scores {number(2 / (breakdown.k + 1), 6)}.
      </div>
    </>
  )
}
