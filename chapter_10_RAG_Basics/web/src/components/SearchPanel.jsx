import { useState } from 'react'
import { formatMs } from '../lib/api.js'
import ResultCard from './ResultCard.jsx'
import VectorHeatmap from './VectorHeatmap.jsx'

const MODE_BLURB = {
  keyword: 'Exact term overlap (BM25). Great for IDs and acronyms, blind to paraphrases.',
  vector: 'Cosine similarity in embedding space. Finds meaning, can miss rare identifiers.',
  hybrid: 'Reciprocal Rank Fusion of both lists. The default for the chat.',
}

export default function SearchPanel({ health, result, busy, error, onSearch, onOpenChunk }) {
  const config = health?.config
  const [query, setQuery] = useState('What are the security specifications for authentication?')
  const [topK, setTopK] = useState(config?.top_k ?? 3)
  const [usePrefixes, setUsePrefixes] = useState(config?.use_prefixes_default ?? true)

  const submit = (event) => {
    event?.preventDefault()
    if (!query.trim() || busy) return
    onSearch({ query: query.trim(), top_k: topK, use_prefixes: usePrefixes })
  }

  const modes = result?.modes
  // Cloud Inference keeps the query vector inside the cluster, so there is nothing to visualise.
  const queryVectorOrNull = result?.query_vector?.vector?.length ? result.query_vector.vector : null
  const serverSide = Boolean(result?.embedding_mode?.includes('server-side'))

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <h2>Search the document</h2>
          {result ? (
            <span className="small muted mono">
              {result.indexed_chunks} chunks indexed ·{' '}
              {serverSide
                ? `${result.embedding_model} (server-side)`
                : `embed query ${formatMs(result.timings.embed_query_ms)}`}{' '}
              · search {formatMs(result.timings.chroma_query_ms)}
            </span>
          ) : null}
        </div>
        <div className="card-body stack">
          <form className="wrap" onSubmit={submit} style={{ gap: 10 }}>
            <input
              className="grow"
              type="search"
              value={query}
              placeholder="e.g. enterprise SSO requirements"
              onChange={(event) => setQuery(event.target.value)}
              style={{ minWidth: 280, flex: '1 1 320px' }}
            />
            <label className="field" style={{ width: 110 }}>
              <span className="label">Top K</span>
              <select value={topK} onChange={(event) => setTopK(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 8, 10].map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </label>
            <button className="button primary" type="submit" disabled={busy}>
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>

          {config?.embedding_provider === 'qdrant' ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              Qdrant Cloud Inference applies this model's own query/passage prefixes automatically, so the
              nomic-specific <span className="mono">search_document:</span> / <span className="mono">search_query:</span>{' '}
              prefixes do not apply here.
            </p>
          ) : (
            <label className="checkbox">
              <input type="checkbox" checked={usePrefixes} onChange={(event) => setUsePrefixes(event.target.checked)} />
              Embed the query as <span className="mono">search_query: …</span> (must match how the chunks were embedded)
            </label>
          )}

          {error ? <div className="error-box">{error}</div> : null}
        </div>
      </div>

      {result && !queryVectorOrNull ? (
        <div className="card">
          <div className="card-head">
            <h2>Query embedding — server-side</h2>
            <span className="small muted mono">{result.embedding_model}</span>
          </div>
          <div className="card-body">
            <p className="small muted" style={{ marginTop: 0 }}>{result.query_vector_unavailable_reason}</p>
            {result.prefix_note ? <p className="tiny muted" style={{ marginBottom: 0 }}>{result.prefix_note}</p> : null}
            <p className="tiny muted" style={{ marginBottom: 0 }}>
              Everything else still works: BM25 runs locally over the stored chunk text, the cosine scores come from
              the cluster, and RRF fuses the two with the same formula. Open any chunk to inspect the vector Qdrant
              stored for it.
            </p>
          </div>
        </div>
      ) : null}

      {result?.query_vector ? (
        <div className="card">
          <div className="card-head">
            <h2>Query embedding — the “weights” your question became</h2>
            <span className="small muted">
              {result.query_vector.dims} dims · {result.query_vector.endpoint} · prefixes {result.use_prefixes ? 'on' : 'off'}
            </span>
          </div>
          <div className="card-body stack">
            <div className="stat-grid">
              <div className="stat"><div className="k">L2 norm</div><div className="v">{result.query_vector.stats.norm}</div></div>
              <div className="stat"><div className="k">Mean</div><div className="v">{result.query_vector.stats.mean}</div></div>
              <div className="stat"><div className="k">Std</div><div className="v">{result.query_vector.stats.std}</div></div>
              <div className="stat"><div className="k">Non-zero</div><div className="v">{result.query_vector.stats.nonzero}</div></div>
              <div className="stat">
                <div className="k">Min / Max</div>
                <div className="v sm">{result.query_vector.stats.min} / {result.query_vector.stats.max}</div>
              </div>
            </div>
            <VectorHeatmap vector={result.query_vector.vector} dims={result.query_vector.dims} height={150} />
            <p className="tiny muted" style={{ margin: 0 }}>
              The query is embedded by the same local model as the chunks — no text ever leaves the machine for the
              embedding step. Only the final prompt goes to Groq.
            </p>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="grid-3">
          {['keyword', 'vector', 'hybrid'].map((mode) => {
            const outcome = modes[mode]
            const max = outcome?.hits?.[0]?.score ?? 0
            return (
              <div className="card" key={mode}>
                <div className="card-head">
                  <div>
                    <h2>{mode}</h2>
                    <div className="tiny muted" style={{ marginTop: 3 }}>{MODE_BLURB[mode]}</div>
                  </div>
                  <span className="badge mode">{formatMs(outcome?.ms)}</span>
                </div>
                <div className="card-body">
                  <div className="tiny muted" style={{ marginBottom: 10 }}>{outcome?.meta?.algorithm}</div>

                  {mode === 'keyword' && outcome?.meta ? (
                    <div className="tiny muted" style={{ marginBottom: 10 }}>
                      query terms: <span className="mono">{outcome.meta.query_terms?.join(', ') || '—'}</span>
                      {outcome.meta.terms_not_in_corpus?.length ? (
                        <>
                          {' '}· not in document:{' '}
                          <span className="mono">{outcome.meta.terms_not_in_corpus.join(', ')}</span>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  {mode === 'vector' && outcome?.meta ? (
                    <div className="tiny muted" style={{ marginBottom: 10 }}>{outcome.meta.score_range}</div>
                  ) : null}

                  {mode === 'hybrid' && outcome?.meta ? (
                    <div className="tiny muted" style={{ marginBottom: 10 }}>
                      k = {outcome.meta.k} · {outcome.meta.score_range}
                      <details style={{ marginTop: 6 }}>
                        <summary>Top-10 from each list before fusion</summary>
                        <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all' }}>
                          BM25: {outcome.meta.keyword_top10?.join(' › ')}<br />
                          Vector: {outcome.meta.vector_top10?.join(' › ')}
                        </div>
                      </details>
                    </div>
                  ) : null}

                  {(outcome?.hits ?? []).map((hit) => (
                    <ResultCard
                      key={hit.chunk_id}
                      hit={hit}
                      mode={mode}
                      max={max}
                      onOpen={(selected) => onOpenChunk(selected, queryVectorOrNull)}
                    />
                  ))}

                  {!outcome?.hits?.length ? <div className="empty">No hits.</div> : null}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="card">
          <div className="card-body">
            <div className="empty">
              Search once and all three retrievers run over the same chunks — compare their top 3 side by side, then open any
              hit to see the vector that produced the score.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
