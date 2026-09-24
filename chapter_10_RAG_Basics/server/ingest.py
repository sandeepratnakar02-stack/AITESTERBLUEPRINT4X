"""The ingestion pipeline, wired end to end and instrumented.

``run_ingest`` performs every stage in order and returns a single JSON-safe artifact that documents
what happened — pages parsed, chunks produced, vectors created, rows stored — with a timing for each
stage. That artifact is what the "Ingest" tab renders, so the pipeline is auditable rather than
magic.
"""

from __future__ import annotations

import time
from pathlib import Path

from .chunker import chunk_document
from .config import Settings, settings as default_settings
from .embeddings import EmbeddingError, get_embedder, vector_stats
from .pdf_loader import PdfError, load_pdf
from .vector_store import VectorStoreError, get_store

# collection name -> artifact from the most recent successful ingest (for fast UI reloads)
_artifacts: dict[str, dict] = {}


def last_artifact(collection: str | None = None) -> dict | None:
    if collection is None:
        return next(reversed(_artifacts.values()), None) if _artifacts else None
    return _artifacts.get(collection)


def run_ingest(
    pdf_path: str | Path | None = None,
    chunk_size: int | None = None,
    overlap: int | None = None,
    use_prefixes: bool | None = None,
    settings: Settings | None = None,
) -> dict:
    cfg = settings or default_settings
    pdf_path = Path(pdf_path) if pdf_path else cfg.pdf_path
    chunk_size = chunk_size or cfg.chunk_size
    overlap = cfg.chunk_overlap if overlap is None else overlap
    use_prefixes = cfg.use_prefixes if use_prefixes is None else use_prefixes

    timeline: list[dict] = []
    warnings: list[str] = []
    total_started = time.perf_counter()

    def stage(name: str, label: str, ms: float, detail: str) -> None:
        timeline.append({"stage": name, "label": label, "ms": round(ms, 1), "detail": detail})

    # 1 — read the PDF -----------------------------------------------------------------
    doc = load_pdf(pdf_path)  # raises PdfError
    stage("extract", "Read PDF", doc.extract_ms, f"{len(doc.pages)} pages, {doc.chars_total:,} chars")
    empty_pages = [p.page for p in doc.pages if not p.has_text]
    if empty_pages:
        warnings.append(
            f"{len(empty_pages)} page(s) produced no text (likely scanned images, e.g. page "
            f"{empty_pages[0]}) — OCR is out of scope for this chapter."
        )

    # 2 — chunk ------------------------------------------------------------------------
    chunk_set = chunk_document(doc, chunk_size=chunk_size, overlap=overlap, min_size=cfg.chunk_min_size)
    stage(
        "chunk",
        "Chunk text",
        chunk_set.chunk_ms,
        f"{chunk_set.count} chunks · target {chunk_size} chars · overlap {overlap}",
    )

    texts = [c.text for c in chunk_set.chunks]
    ids = [c.id for c in chunk_set.chunks]
    metadatas = [
        {
            "index": c.index,
            "page_start": c.page_start,
            "page_end": c.page_end,
            "chars": c.chars,
            "tokens_est": c.tokens_est,
            "overlap_chars": c.overlap_chars,
            "paragraphs": c.paragraphs,
        }
        for c in chunk_set.chunks
    ]

    # 3 — embed ------------------------------------------------------------------------
    # Two free shapes: locally Ollama produces the vectors on this machine; in production Qdrant
    # Cloud Inference produces them *inside* the cluster, so no vector is ever computed here.
    server_side = cfg.uses_cloud_inference
    model_name = cfg.embedding_model_name
    dims_hint = cfg.embedding_dims_hint
    embed_result = None
    stats: list[dict] = []

    if server_side:
        stage(
            "embed",
            f"Embed ({model_name})",
            0.0,
            f"server-side via Qdrant Cloud Inference · {len(texts)} chunks · "
            f"{f'{dims_hint} dims (configured)' if dims_hint else 'dims resolved from the cluster'}",
        )
    else:
        embedder = get_embedder(cfg)
        embed_result = embedder.embed_documents(texts, use_prefixes=use_prefixes)  # raises EmbeddingError
        if embed_result.prefixed:
            warnings.append(
                "Task prefixes are ON: documents were embedded as 'search_document: …' and the query as "
                "'search_query: …'. Turn them off in the UI to compare scores."
            )
        stage(
            "embed",
            f"Embed ({embed_result.model})",
            embed_result.ms,
            f"{len(embed_result.vectors)} vectors × {embed_result.dims} dims · {embed_result.batches} batch(es) "
            f"· {embed_result.endpoint} · {embed_result.ms_per_chunk:.0f} ms/chunk",
        )
        stats = [vector_stats(v) for v in embed_result.vectors]

    # 4 — store (and, in production, embed) in the vector database ----------------------
    collection_name = cfg.collection_name(doc.sha1, chunk_size, overlap)
    store = get_store()
    previous_rows = store.count(collection_name)

    store_started = time.perf_counter()
    if previous_rows:
        # A re-ingest is a rebuild: chunk ids change when the text or chunking changes, so old rows
        # must go or they linger forever and pollute retrieval with duplicates.
        store.delete(collection_name)
    store.ensure_collection(
        collection_name,
        embedding_model=model_name,
        # In inference mode the width comes from the cluster, so pass only a verified hint (or None).
        dims=dims_hint if server_side else embed_result.dims,
        chunk_size=chunk_size,
        overlap=overlap,
        pdf_sha1=doc.sha1,
        pdf_name=doc.name,
        use_prefixes=bool(use_prefixes),
    )
    if server_side:
        written = store.upsert_inference_chunks(
            collection_name, ids, texts, metadatas, model_name
        )
    else:
        written = store.upsert_chunks(collection_name, ids, texts, metadatas, embed_result.vectors)
    store_ms = (time.perf_counter() - store_started) * 1000
    stage(
        "store",
        "Store in Qdrant" if server_side else "Store in ChromaDB",
        store_ms,
        f"collection '{collection_name}' · {written} rows upserted (cosine space)"
        + (" · includes server-side embedding" if server_side else ""),
    )

    # In inference mode the vector width is only knowable from the cluster, so read it back and
    # check it rather than trusting the hint.
    resolved_dims = dims_hint
    if server_side:
        read_back = getattr(store, "resolved_dims", lambda _name: None)(collection_name)
        if read_back:
            resolved_dims = int(read_back)
            if dims_hint and int(dims_hint) != resolved_dims:
                warnings.append(
                    f"QDRANT_EMBED_DIMS is {dims_hint} but the cluster stores {resolved_dims} "
                    f"dimensions. Update the variable to {resolved_dims}."
                )
        else:
            warnings.append(
                "Could not read the vector width back from the cluster; the collection was created "
                "from the configured value."
            )

    embedding_detail = {
        "mode": "server-side (Qdrant Cloud Inference)" if server_side else "client-side",
        "model": model_name,
        "dims": resolved_dims,
        "count": len(texts),
        "batches": embed_result.batches if embed_result else max(1, -(-len(texts) // 32)),
        "endpoint": "cloud-inference" if server_side else embed_result.endpoint,
        "prefixed": bool(embed_result.prefixed) if embed_result else bool(use_prefixes),
        # In inference mode the embedding happens during the upsert, so that timing is the honest one.
        "ms": round(store_ms if server_side else embed_result.ms, 1),
        "ms_per_chunk": round((store_ms if server_side else embed_result.ms) / max(1, len(texts)), 2),
        "stats": stats,
    }

    # refresh the in-memory search index so /api/search sees the new vectors immediately
    from .search import invalidate

    invalidate(collection_name)
    if previous_rows:
        warnings.append(
            f"Collection '{collection_name}' already held {previous_rows} rows and was rebuilt "
            f"with {written} fresh rows (stale chunks removed)."
        )

    total_ms = (time.perf_counter() - total_started) * 1000

    artifact = {
        "ok": True,
        "document": doc.summary(),
        "pages": [page.to_dict() for page in doc.pages],
        "chunking": chunk_set.summary(),
        "chunks": [chunk.to_dict() for chunk in chunk_set.chunks],
        "embedding": {
            **embedding_detail,
            "doc_prefix": cfg.doc_prefix if embedding_detail["prefixed"] else "",
            "query_prefix": cfg.query_prefix if embedding_detail["prefixed"] else "",
        },
        "store": {
            "collection": collection_name,
            "rows": written,
            "space": "cosine",
            "backend": cfg.vector_store,
            "dir": f"qdrant://{getattr(store, 'hostname', '')}"
            if cfg.vector_store == "qdrant"
            else str(cfg.chroma_dir),
            "upsert_ms": round(store_ms, 1),
            "replaced_rows": previous_rows,
        },
        "timeline": timeline,
        "total_ms": round(total_ms, 1),
        "warnings": warnings,
    }

    _artifacts[collection_name] = artifact
    return artifact


def ingest_error(exc: Exception) -> tuple[int, dict]:
    """Map pipeline exceptions onto an HTTP status + a message a human can act on."""
    if isinstance(exc, PdfError):
        return 400, {"ok": False, "stage": "extract", "error": str(exc)}
    if isinstance(exc, EmbeddingError):
        return 503, {"ok": False, "stage": "embed", "error": str(exc)}
    if isinstance(exc, VectorStoreError):
        return 500, {"ok": False, "stage": "store", "error": str(exc)}
    return 500, {"ok": False, "stage": "unknown", "error": f"{type(exc).__name__}: {exc}"}
