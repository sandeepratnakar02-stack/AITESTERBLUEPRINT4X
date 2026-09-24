# Chapter 10 — plan & implementation record

**Goal:** a lightweight, fully observable RAG explorer over the confidential PRD
(`Product Requirements Document_ VWO Login Dashboard.pdf`) that shows how a PDF becomes chunks,
how chunks become vectors, how search picks the top three, and how the answer is grounded — with
`nomic-embed-text` (Ollama) for embeddings and **ChromaDB** as the vector database.

Status: **implemented and verified** (see `README.md` §3 for measured results).

---

## 1. Decisions that shaped the build

| Decision | Choice | Why |
| --- | --- | --- |
| Embeddings | Ollama **`nomic-embed-text`**, 768-dim, local | Groq has no embeddings endpoint; the model was already pulled, so it is free and offline |
| Vector DB | **ChromaDB 1.5.9**, embedded `PersistentClient`, `hnsw:space=cosine` | Single process, no server to run; `chromadb` was already on disk in the Chapter 09 venv so the install is a cache hit |
| Python env | **New `chapter_10_RAG_Basics/.venv` on CPython 3.13 via uv** | Per-chapter isolation (repo convention) while matching the interpreter chromadb is proven on; the repo-root 3.14 venv has neither chromadb nor fastapi |
| Loose coupling to Chroma | Vectors **always passed explicitly**, never `query_texts` | Prevents Chroma's default ONNX MiniLM from ever being downloaded or used |
| Search | Hand-written **BM25 + cosine + RRF** | The term-by-term arithmetic is the teaching payload; `rank_bm25` would hide it |
| Generation | Groq **`openai/gpt-oss-120b`** over the OpenAI-compatible endpoint with plain `httpx` | Explicit request/response and a real `usage` object for the cost panel; no SDK version drift |
| UI | Vite 7 + React 19, hand-rolled CSS, `marked` + `DOMPurify` for answers | Matches the Chapter 09 app's dependency-light style; markdown answers render safely |
| Secrets | Groq key lives only in the FastAPI process; Vite proxies `/api/*` | Same rule as the Chapter 09 Langflow proxy — nothing sensitive reaches the browser bundle |
| Ports | API **8011**, UI **5190** (strictPort) | Avoids the ports already used by other chapters |

## 2. Delivered structure

`server/` — `config.py`, `pdf_loader.py`, `chunker.py`, `embeddings.py`, `vector_store.py`,
`search.py`, `rag.py`, `ingest.py`, `main.py`
`web/src/` — `App.jsx`, `lib/{api,markdown}.js`, `components/{StatusBar, IngestPanel, PipelineStepper,
ChunkDetail, VectorHeatmap, SearchPanel, ResultCard, ScoreMath, ChatPanel, CostPanel}.jsx`
Plus `README.md`, `requirements.txt`, `.gitignore`, `.vscode/tasks.json`, `scripts/selfcheck.py`.

## 3. Verification performed

1. `uv venv --python 3.13` + install → chromadb 1.5.9, fastapi 0.141.1, pypdf 6.19.0, numpy 2.5.3.
2. Ollama health → `/api/embed`, `nomic-embed-text`, **768 dims**.
3. `scripts/selfcheck.py` → extract 7 pages, 13 chunks, 13 vectors, `chroma rows == chunk count`,
   all three retrievers returning 3 hits, **manual cosine == 1 − chroma_distance**, grounded answer
   with citations, off-topic question refused. Exit code 0.
4. UI (browser-driven): ingest from the sliders → stepper/stat/chunk-map/table/pages all populate;
   search → three columns with scores and maths; chat → answer, clickable citations, context blocks,
   cost panel; citation click → drawer with the 768-cell heatmap.
5. Failure paths: missing collection, off-topic question, and a required-key error all return readable
   messages instead of stack traces.

## 4. Bugs found and fixed during the build

| Bug | Symptom | Fix |
| --- | --- | --- |
| Unclosed cache rebinding | `UnboundLocalError` on `_index_cache` | `global _index_cache` in `load_index` |
| One word per line in this PDF | 1,205 one-word "paragraphs", unreadable chunks | Prefer `extraction_mode="layout"`, detect the fragmented case, rebuild paragraphs |
| Stale rows on re-ingest | 27 rows in a 13-chunk collection | Rebuild (delete + create) the collection on every ingest |
| Full-width citations | `【C1】` from the model → zero citations parsed | Tolerant citation regex + normalise markers to `[C#]` |
| `round()` on numpy | `/api/search` 500 — `numpy.float32` not serialisable | Cast BM25 term weights with `float()`; added `_json_safe()` as a safety net |
| Missing `mode` in the search payload | Chat context blocks showed "(text unavailable)" | Return `mode` alongside `modes` |
| Chunk/vector alignment risk | Sorting chunks without sorting the matrix would pair the wrong vector | Sort id/text/metadata/vector together as rows |
| Invented section heading | Model answered "Acceptance criteria" though the PRD has none | Prompt rule forbidding renamed headings + an explicit refusal rule; demo question changed |

## 5. Deliberately out of scope

OCR for scanned pages, file upload, streaming, authentication/multi-user, cloud vector stores,
multi-document corpora, reranking, and tokenizer-exact token counts.

## 6. If you extend it

* **Reranking** — add a cross-encoder over the top-10 before the LLM; the search layer already keeps
  the full ranked lists.
* **Chunking experiments** — the fingerprint in the collection name means several configurations can
  coexist; add a comparison view over `GET /api/documents`.
* **Evaluation** — `scripts/selfcheck.py` is the natural place to grow a small retrieval scorecard
  (hit-rate / MRR over a set of known question → page pairs).
* **Better extraction** — if a future PDF defeats the layout heuristics, swap in a layout-aware
  parser; only `pdf_loader.py` needs to change.
