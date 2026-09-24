import { useEffect, useState } from 'react'
import { formatBytes, formatMs } from '../lib/api.js'
import PipelineStepper from './PipelineStepper.jsx'

const PAGE_PREVIEW = 220

export default function IngestPanel({ health, artifact, chunks, busy, error, onIngest, onOpenChunk, selectedChunkId, onSelectChunk }) {
  const config = health?.config
  const [chunkSize, setChunkSize] = useState(config?.chunk_size ?? 800)
  const [overlap, setOverlap] = useState(config?.chunk_overlap ?? 150)
  const [usePrefixes, setUsePrefixes] = useState(config?.use_prefixes_default ?? true)
  const [file, setFile] = useState(null)

  useEffect(() => {
    if (!config) return
    setChunkSize(config.chunk_size)
    setOverlap(config.chunk_overlap)
    setUsePrefixes(config.use_prefixes_default)
  }, [config?.chunk_size, config?.chunk_overlap, config?.use_prefixes_default])

  const safeOverlap = Math.min(overlap, chunkSize - 50)
  const chunking = artifact?.chunking
  const embedding = artifact?.embedding
  const store = artifact?.store
  const document_ = artifact?.document
  const activeChunks = chunks?.chunks ?? []
  const totalChars = activeChunks.reduce((sum, chunk) => sum + (chunk.chars || 0), 0)

  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h2>1 · Source document</h2>
            {document_ ? <span className="badge">{document_.extraction_modes ? Object.keys(document_.extraction_modes).join('+') : 'parsed'}</span> : null}
          </div>
          <div className="card-body stack">
            <div>
              <div className="mono small" style={{ wordBreak: 'break-all' }}>{document_?.name || config?.pdf_name || '—'}</div>
              <div className="tiny muted" style={{ wordBreak: 'break-all' }}>{document_?.path || config?.pdf_path}</div>
            </div>

            {document_ ? (
              <div className="stat-grid">
                <div className="stat"><div className="k">Pages</div><div className="v">{document_.pages}</div></div>
                <div className="stat"><div className="k">With text</div><div className="v">{document_.pages_with_text}</div></div>
                <div className="stat"><div className="k">Characters</div><div className="v">{document_.chars_total.toLocaleString()}</div></div>
                <div className="stat"><div className="k">Words</div><div className="v">{document_.words_total.toLocaleString()}</div></div>
                <div className="stat"><div className="k">Paragraphs</div><div className="v">{(document_.paragraphs_total ?? 0).toLocaleString()}</div></div>
                <div className="stat"><div className="k">File size</div><div className="v">{formatBytes(document_.size_bytes)}</div></div>
              </div>
            ) : (
              <p className="small muted">
                {config?.pdf_name ? `${config.pdf_name} — run the pipeline to parse, chunk and embed it.` : 'No PDF configured.'}
              </p>
            )}

            <div className="grid-2" style={{ gap: 12 }}>
              <label className="field">
                <span className="label">
                  Chunk size (characters) <b>{chunkSize}</b>
                </span>
                <input type="range" min="200" max="2000" step="50" value={chunkSize} onChange={(event) => setChunkSize(Number(event.target.value))} />
              </label>
              <label className="field">
                <span className="label">
                  Overlap (characters) <b>{safeOverlap}</b>
                </span>
                <input type="range" min="0" max="600" step="10" value={safeOverlap} onChange={(event) => setOverlap(Number(event.target.value))} />
              </label>
            </div>

            <label className="checkbox">
              <input type="checkbox" checked={usePrefixes} onChange={(event) => setUsePrefixes(event.target.checked)} />
              Use task prefixes (<span className="mono">search_document:</span> / <span className="mono">search_query:</span>) — nomic-embed-text is trained with them
            </label>

            <div className="between">
              <button className="button primary" disabled={busy} onClick={() => onIngest({ file, chunk_size: chunkSize, overlap: safeOverlap, use_prefixes: usePrefixes })}>
                {busy ? 'Running pipeline…' : file ? `Ingest ${file.name}` : 'Ingest / re-chunk PDF'}
              </button>
              <span className="tiny muted">Re-ingesting rebuilds the collection — stale chunks are deleted.</span>
            </div>

            <label className="field">
              <span className="label">
                Upload a PDF instead <span className="tiny muted">(used on a deployment, where the source PDF is not shipped)</span>
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <p className="tiny muted" style={{ margin: 0 }}>
              {file
                ? `The uploaded file is staged in a temp directory, parsed, embedded and deleted — it is never stored as a static asset. Vercel's request body limit is ~4.5 MB.`
                : 'Leave empty to ingest the PDF on disk (local development).'}
            </p>

            {error ? <div className="error-box">{error}</div> : null}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <h2>2 · What the pipeline produced</h2>
            {artifact ? <span className="badge">total {formatMs(artifact.total_ms)}</span> : null}
          </div>
          <div className="card-body stack">
            {artifact ? (
              <>
                <PipelineStepper timeline={artifact.timeline} totalMs={artifact.total_ms} />

                <div className="stat-grid">
                  <div className="stat"><div className="k">Chunks</div><div className="v">{chunking.count}</div></div>
                  <div className="stat"><div className="k">Avg chars</div><div className="v">{chunking.avg_chars}</div></div>
                  <div className="stat"><div className="k">Min / Max</div><div className="v sm">{chunking.min_chars} / {chunking.max_chars}</div></div>
                  <div className="stat"><div className="k">Embeddings</div><div className="v">{embedding.count} × {embedding.dims}d</div></div>
                  <div className="stat"><div className="k">Embed time</div><div className="v">{formatMs(embedding.ms)}</div></div>
                  <div className="stat"><div className="k">ms / chunk</div><div className="v">{embedding.ms_per_chunk}</div></div>
                </div>

                <div className="tiny muted">
                  embedder <span className="mono">{embedding.model}</span> via <span className="mono">{embedding.endpoint}</span> in{' '}
                  {embedding.batches} batch(es) · stored in <span className="mono">{store.collection}</span> ({store.space} space,{' '}
                  {store.rows} rows{store.replaced_rows ? `, replaced ${store.replaced_rows}` : ''}) · chroma dir{' '}
                  <span className="mono">{store.dir}</span>
                </div>

                {artifact.warnings?.length ? (
                  <div className="warnings">
                    {artifact.warnings.map((warning, index) => (
                      <div className="warning" key={index}><span>ℹ</span><span>{warning}</span></div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="small muted">
                Nothing ingested in this session yet. Run the pipeline on the left — every stage is timed and reported here.
              </p>
            )}
          </div>
        </div>
      </div>

      {activeChunks.length ? (
        <div className="grid-2">
          <div className="card">
            <div className="card-head">
              <h2>3 · Chunks ({activeChunks.length})</h2>
              <span className="small muted">{totalChars.toLocaleString()} chars across chunks</span>
            </div>
            <div className="card-body">
              <p className="tiny muted" style={{ marginTop: 0 }}>
                Each bar is one chunk, sized by its character count — overlap means neighbouring chunks share text.
                Click a chunk (here or in the table) to inspect its embedding.
              </p>
              <div className="chunkmap">
                {activeChunks.map((chunk) => (
                  <div
                    key={chunk.chunk_id}
                    className={`chunkmap-seg${selectedChunkId === chunk.chunk_id ? ' selected' : ''}`}
                    style={{ flexGrow: chunk.chars || 1 }}
                    title={`#${chunk.index} · p.${chunk.page_start}-${chunk.page_end} · ${chunk.chars} chars`}
                    onClick={() => onSelectChunk(chunk)}
                  />
                ))}
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Pages</th>
                      <th>Chars</th>
                      <th>Tokens*</th>
                      <th>Overlap</th>
                      <th>‖vector‖</th>
                      <th>Snippet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeChunks.map((chunk) => (
                      <tr
                        key={chunk.chunk_id}
                        className={selectedChunkId === chunk.chunk_id ? 'selected' : ''}
                        onClick={() => onSelectChunk(chunk)}
                      >
                        <td className="mono">{chunk.index}</td>
                        <td className="mono nowrap">
                          {chunk.page_start === chunk.page_end ? chunk.page_start : `${chunk.page_start}-${chunk.page_end}`}
                        </td>
                        <td className="mono">{chunk.chars}</td>
                        <td className="mono">{chunk.tokens_est}</td>
                        <td className="mono">{chunk.overlap_chars || 0}</td>
                        <td className="mono">{chunk.vector_stats?.norm ?? '—'}</td>
                        <td><span className="snippet">{chunk.text}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted">*token count is estimated as characters ÷ 4 — no tokenizer dependency.</p>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>4 · Pages as parsed</h2>
              <span className="small muted">what pypdf saw, before chunking</span>
            </div>
            <div className="card-body stack">
              {(artifact?.pages ?? []).length ? (
                artifact.pages.map((page) => (
                  <details className="card" key={page.page} style={{ background: '#0e1421' }}>
                    <summary style={{ cursor: 'pointer', padding: '10px 12px' }} className="between">
                      <span className="mono small">page {page.page}</span>
                      <span className="tiny muted">
                        {page.mode} · {page.words} words · {page.paragraphs} paragraphs
                      </span>
                    </summary>
                    <div style={{ padding: '0 12px 12px' }}>
                      <pre className="raw" style={{ maxHeight: 200 }}>{page.text?.slice(0, 2600) || page.preview}</pre>
                    </div>
                  </details>
                ))
              ) : (
                <p className="small muted">
                  Page-level detail is only available right after an ingest in this session. The chunk table on the left is
                  restored from ChromaDB and always available.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
