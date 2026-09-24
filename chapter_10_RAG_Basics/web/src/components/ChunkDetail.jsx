import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import VectorHeatmap from './VectorHeatmap.jsx'

const number = (value, digits = 5) => (value === null || value === undefined ? '—' : Number(value).toFixed(digits))

/**
 * Side panel showing one chunk in full, plus the embedding vector that Chroma stores for it.
 * Optionally compares against the query vector to show which dimensions drove the similarity.
 */
export default function ChunkDetail({ collection, chunk, queryVector, onClose }) {
  const [vector, setVector] = useState(null)
  const [stats, setStats] = useState(chunk?.vector_stats ?? null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!collection || !chunk?.chunk_id) return
    let cancelled = false
    setLoading(true)
    setError('')
    setVector(null)
    api
      .vector(collection, chunk.chunk_id)
      .then((payload) => {
        if (cancelled) return
        setVector(payload.vector)
        setStats(payload.stats)
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [collection, chunk?.chunk_id])

  if (!chunk) return null

  const pageLabel = chunk.page_start === chunk.page_end ? `p.${chunk.page_start}` : `p.${chunk.page_start}-${chunk.page_end}`

  // Which dimensions contributed most to this chunk's similarity with the query?
  let topDims = null
  if (vector && queryVector?.length === vector.length) {
    topDims = vector
      .map((value, index) => ({ dim: index, doc: value, query: queryVector[index], product: value * queryVector[index] }))
      .sort((a, b) => Math.abs(b.product) - Math.abs(a.product))
      .slice(0, 10)
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer" onClick={(event) => event.stopPropagation()}>
        <div className="between" style={{ marginBottom: 14 }}>
          <div>
            <h3>
              Chunk <span className="mono">#{chunk.index}</span>
            </h3>
            <div className="wrap" style={{ marginTop: 6 }}>
              <span className="badge page">{pageLabel}</span>
              <span className="badge">{chunk.chunk_id}</span>
              <span className="badge mode">{chunk.chars} chars</span>
              {chunk.overlap_chars ? <span className="badge mode">{chunk.overlap_chars} overlap</span> : null}
            </div>
          </div>
          <button className="button sm ghost" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <div className="error-box" style={{ marginBottom: 12 }}>{error}</div> : null}

        <p className="section-title">Chunk text (what the LLM would see)</p>
        <pre className="raw" style={{ marginBottom: 16 }}>{chunk.text}</pre>

        <p className="section-title">
          Stored embedding {loading ? <span className="spinner" style={{ marginLeft: 6 }} /> : null}
        </p>
        {stats ? (
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            <div className="stat">
              <div className="k">Dimensions</div>
              <div className="v">{stats.dims}</div>
            </div>
            <div className="stat">
              <div className="k">L2 norm</div>
              <div className="v">{stats.norm}</div>
            </div>
            <div className="stat">
              <div className="k">Mean</div>
              <div className="v">{number(stats.mean)}</div>
            </div>
            <div className="stat">
              <div className="k">Std</div>
              <div className="v">{number(stats.std)}</div>
            </div>
            <div className="stat">
              <div className="k">Min / Max</div>
              <div className="v sm">{number(stats.min, 3)} / {number(stats.max, 3)}</div>
            </div>
            <div className="stat">
              <div className="k">Non-zero</div>
              <div className="v">{stats.nonzero}</div>
            </div>
          </div>
        ) : null}

        {vector ? <VectorHeatmap vector={vector} dims={stats?.dims} /> : null}

        {vector ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <div>
              <p className="section-title">First 8 dimensions</p>
              <div className="dims">
                {vector.slice(0, 8).map((value, index) => (
                  <span key={index}>{index}: {number(value, 4)}</span>
                ))}
              </div>
            </div>
            <div>
              <p className="section-title">Last 8 dimensions</p>
              <div className="dims">
                {vector.slice(-8).map((value, index) => (
                  <span key={index}>{vector.length - 8 + index}: {number(value, 4)}</span>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {topDims ? (
          <div style={{ marginTop: 16 }}>
            <p className="section-title">Dimensions that drove this match (doc × query)</p>
            <div className="table-wrap" style={{ maxHeight: 260 }}>
              <table>
                <thead>
                  <tr>
                    <th>Dim</th>
                    <th>Chunk value</th>
                    <th>Query value</th>
                    <th>Product</th>
                  </tr>
                </thead>
                <tbody>
                  {topDims.map((row) => (
                    <tr key={row.dim}>
                      <td className="mono">{row.dim}</td>
                      <td className="mono">{number(row.doc, 4)}</td>
                      <td className="mono">{number(row.query, 4)}</td>
                      <td className="mono">{number(row.product, 5)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
