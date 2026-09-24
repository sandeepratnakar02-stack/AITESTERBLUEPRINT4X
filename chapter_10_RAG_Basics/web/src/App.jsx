import { useCallback, useEffect, useState } from 'react'
import { api } from './lib/api.js'
import ChatPanel from './components/ChatPanel.jsx'
import ChunkDetail from './components/ChunkDetail.jsx'
import IngestPanel from './components/IngestPanel.jsx'
import SearchPanel from './components/SearchPanel.jsx'
import StatusBar from './components/StatusBar.jsx'

const TABS = [
  { id: 'ingest', label: '1 · Ingest', hint: 'PDF → chunks → vectors' },
  { id: 'search', label: '2 · Search', hint: 'top 3 × 3 algorithms' },
  { id: 'chat', label: '3 · Chat', hint: 'grounded answer' },
]

export default function App() {
  const [health, setHealth] = useState(null)
  const [healthError, setHealthError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [tab, setTab] = useState('ingest')

  const [collection, setCollection] = useState('')
  const [chunks, setChunks] = useState(null)
  const [chunksError, setChunksError] = useState('')

  const [artifact, setArtifact] = useState(null)
  const [ingestBusy, setIngestBusy] = useState(false)
  const [ingestError, setIngestError] = useState('')

  const [searchResult, setSearchResult] = useState(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState('')

  const [messages, setMessages] = useState([])
  const [chatBusy, setChatBusy] = useState(false)
  const [chatError, setChatError] = useState('')

  const [drawer, setDrawer] = useState(null)
  const [selectedChunkId, setSelectedChunkId] = useState('')

  const loadHealth = useCallback(async () => {
    setRefreshing(true)
    try {
      const payload = await api.health()
      setHealth(payload)
      setHealthError('')
      setCollection((previous) => previous || payload.active_collection || '')
    } catch (error) {
      setHealthError(error.message)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const loadChunks = useCallback(async (name) => {
    try {
      const payload = await api.chunks(name)
      setChunks(payload)
      setChunksError('')
    } catch (error) {
      setChunks(null)
      setChunksError(error.message)
    }
  }, [])

  useEffect(() => {
    loadHealth()
    const timer = setInterval(loadHealth, 30000)
    return () => clearInterval(timer)
  }, [loadHealth])

  useEffect(() => {
    if (!collection) {
      setChunks(null)
      return
    }
    loadChunks(collection)
  }, [collection, loadChunks])

  const handleIngest = async (body) => {
    setIngestBusy(true)
    setIngestError('')
    try {
      const { file, ...fields } = body
      const payload = file ? await api.ingestFile(file, fields) : await api.ingest(fields)
      setArtifact(payload)
      setSelectedChunkId('')
      setCollection(payload.store.collection)
      await loadChunks(payload.store.collection)
      loadHealth()
    } catch (error) {
      setIngestError(error.message)
    } finally {
      setIngestBusy(false)
    }
  }

  const handleSearch = async ({ query, top_k, use_prefixes }) => {
    if (!collection) {
      setSearchError('Ingest the PDF first — there is no collection to search.')
      return
    }
    setSearchBusy(true)
    setSearchError('')
    try {
      const payload = await api.search({ query, collection, top_k, use_prefixes })
      setSearchResult(payload)
    } catch (error) {
      setSearchError(error.message)
    } finally {
      setSearchBusy(false)
    }
  }

  const handleSend = async (question, options = {}) => {
    if (!collection) {
      setChatError('Ingest the PDF first — there is no collection to retrieve from.')
      return
    }
    const mode = options.mode ?? 'hybrid'
    const topK = options.topK ?? health?.config?.top_k ?? 3
    setMessages((previous) => [...previous, { role: 'user', content: question }])
    setChatBusy(true)
    setChatError('')
    try {
      const payload = await api.chat({
        question,
        collection,
        mode,
        top_k: topK,
      })
      setMessages((previous) => [
        ...previous,
        {
          role: 'assistant',
          content: payload.generation.answer,
          generation: payload.generation,
          retrieval: payload.retrieval,
        },
      ])
    } catch (error) {
      setChatError(error.message)
      setMessages((previous) => [...previous, { role: 'assistant', content: `**Request failed:** ${error.message}` }])
    } finally {
      setChatBusy(false)
    }
  }

  const openChunk = (chunk, queryVector = null) => {
    setSelectedChunkId(chunk?.chunk_id ?? '')
    setDrawer({ chunk, queryVector })
  }

  const handleDeleteCollection = async () => {
    if (!collection) return
    if (!window.confirm(`Delete collection "${collection}" from ChromaDB?`)) return
    try {
      await api.deleteCollection(collection)
      setCollection('')
      setArtifact(null)
      setChunks(null)
      setSearchResult(null)
      setMessages([])
      loadHealth()
    } catch (error) {
      setHealthError(error.message)
    }
  }

  const collections = health?.chroma?.collections ?? []

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <h1>PRD RAG Explorer</h1>
            <p>
              PDF → chunks → nomic-embed-text vectors → ChromaDB → BM25 / cosine / RRF → Groq{' '}
              {health?.config?.groq_model ?? 'gpt-oss-120b'}
            </p>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={`tab${tab === item.id ? ' active' : ''}`}
              onClick={() => setTab(item.id)}
              title={item.hint}
            >
              {item.label}
              <span className="tab-hint">{item.hint}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="main stack">
        <StatusBar health={health} onRefresh={loadHealth} refreshing={refreshing} />
        {healthError ? <div className="error-box">Could not reach the RAG API: {healthError}</div> : null}

        <div className="card">
          <div className="card-body between">
            <div className="wrap">
              <span className="small muted">Collection</span>
              <select value={collection} onChange={(event) => setCollection(event.target.value)} style={{ width: 320 }}>
                <option value="">— none —</option>
                {collections.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name} ({item.count} rows, {item.metadata?.chunk_size ?? '?'}/{item.metadata?.overlap ?? '?'} chars)
                  </option>
                ))}
              </select>
              <span className="tiny muted mono">{health?.chroma?.path}</span>
            </div>
            <div className="wrap">
              {chunks ? <span className="badge">{chunks.total} chunks in view</span> : null}
              <button className="button sm ghost" onClick={handleDeleteCollection} disabled={!collection}>
                Delete collection
              </button>
            </div>
          </div>
        </div>

        {chunksError ? <div className="error-box">Could not load chunks: {chunksError}</div> : null}

        {tab === 'ingest' ? (
          <IngestPanel
            health={health}
            artifact={artifact}
            chunks={chunks}
            busy={ingestBusy}
            error={ingestError}
            onIngest={handleIngest}
            onOpenChunk={(chunk) => openChunk(chunk)}
            selectedChunkId={selectedChunkId}
            onSelectChunk={(chunk) => openChunk(chunk)}
          />
        ) : null}

        {tab === 'search' ? (
          <SearchPanel
            health={health}
            result={searchResult}
            busy={searchBusy}
            error={searchError}
            onSearch={handleSearch}
            onOpenChunk={openChunk}
          />
        ) : null}

        {tab === 'chat' ? (
          <ChatPanel
            health={health}
            collection={collection}
            messages={messages}
            busy={chatBusy}
            error={chatError}
            onSend={handleSend}
            onOpenChunk={openChunk}
          />
        ) : null}
      </main>

      {drawer ? (
        <ChunkDetail
          collection={collection}
          chunk={drawer.chunk}
          queryVector={drawer.queryVector}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  )
}
