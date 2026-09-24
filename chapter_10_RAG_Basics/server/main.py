"""FastAPI application — the only place the Groq key and the vector store are touched.

Run it with::

    .venv/Scripts/python.exe -m uvicorn server.main:app --port 8011 --reload

The React UI in ``web/`` proxies ``/api/*`` here in development, and in production Vercel serves this
same app (via ``api/index.py``) on the frontend's own domain — so the key never reaches the browser
either way.

Providers are chosen by environment variables, which is what makes one codebase work both locally
and on Vercel: ``EMBEDDING_PROVIDER=ollama|openai`` and ``VECTOR_STORE=chroma|qdrant``.

Endpoints
    GET    /api/health                               everything the status bar needs
    GET    /api/documents                            ingested collections
    POST   /api/ingest                               run the whole pipeline (JSON path or file upload)
    GET    /api/chunks/{collection}                  chunk table (paged)
    GET    /api/chunks/{collection}/{chunk_id}/vector full embedding for the heatmap
    POST   /api/search                               BM25 + cosine + RRF, top 3 each
    POST   /api/chat                                 grounded answer with citations + usage
    DELETE /api/collections/{collection}             drop a collection
"""

from __future__ import annotations

import shutil
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError

from .config import CHAPTER_DIR, settings
from .embeddings import EmbeddingError, get_embedder, vector_stats
from .ingest import ingest_error, last_artifact, run_ingest
from .pdf_loader import PdfError
from .rag import GroqError, ask
from .search import Hit, SearchOutcome, invalidate, load_index, rrf_fuse
from .vector_store import VectorStoreError, get_store

app = FastAPI(
    title="PRD RAG Explorer",
    description="Local-first RAG over a PDF: nomic-embed-text (Ollama) + ChromaDB + Groq gpt-oss-120b.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://localhost:{settings.ui_port}",
        f"http://127.0.0.1:{settings.ui_port}",
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------------------
# request models
# --------------------------------------------------------------------------------------
class IngestRequest(BaseModel):
    pdf_path: str | None = None
    chunk_size: int | None = Field(default=None, ge=120, le=4000)
    overlap: int | None = Field(default=None, ge=0, le=1500)
    use_prefixes: bool | None = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    collection: str | None = None
    top_k: int = Field(default=3, ge=1, le=10)
    use_prefixes: bool | None = None


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    collection: str | None = None
    mode: str = Field(default="hybrid", pattern="^(keyword|vector|hybrid)$")
    top_k: int = Field(default=3, ge=1, le=10)
    use_prefixes: bool | None = None


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------
_groq_models_cache: dict = {"at": 0.0, "models": [], "error": None}


def _json_safe(node):
    """Recursively convert numpy scalars/arrays so FastAPI can always serialise the response.

    The search code is careful to cast to float(), but a cheap safety net here means a future numpy
    value can never turn a 200 into a 500.
    """
    import numpy as np

    if isinstance(node, dict):
        return {key: _json_safe(value) for key, value in node.items()}
    if isinstance(node, (list, tuple)):
        return [_json_safe(value) for value in node]
    if isinstance(node, np.ndarray):
        return [_json_safe(value) for value in node.tolist()]
    if isinstance(node, np.generic):
        return node.item()
    return node


def _groq_health() -> dict:
    """Check the key works and whether the configured model id exists. Cached for 5 minutes."""
    result = {
        "ok": False,
        "key_present": settings.groq_key_present,
        "model": settings.groq_model,
        "model_available": None,
        "url": settings.groq_url,
        "error": None,
    }
    if not settings.groq_key_present:
        result["error"] = "GROQ_API_TOKEN is missing from chapter_10_RAG_Basics/.env"
        return result

    if time.time() - _groq_models_cache["at"] > 300:
        try:
            response = httpx.get(
                f"{settings.groq_url.rstrip('/')}/models",
                headers={"Authorization": f"Bearer {settings.groq_key}"},
                timeout=15.0,
            )
            response.raise_for_status()
            _groq_models_cache["models"] = [m.get("id", "") for m in response.json().get("data", [])]
            _groq_models_cache["error"] = None
        except Exception as exc:  # noqa: BLE001 - offline must not break /api/health
            _groq_models_cache["models"] = []
            _groq_models_cache["error"] = f"Could not list Groq models: {exc}"
        _groq_models_cache["at"] = time.time()

    models = _groq_models_cache["models"]
    result["models_count"] = len(models)
    if models:
        result["ok"] = True
        result["model_available"] = settings.groq_model in models
        if not result["model_available"]:
            result["error"] = (
                f"'{settings.groq_model}' is not in your Groq model list. Set GROQ_MODEL in .env "
                f"to one of: {', '.join(models[:8])}"
            )
    else:
        result["error"] = _groq_models_cache["error"]
    return result


def _resolve_collection(name: str | None) -> str:
    """Pick the collection to work on: explicit -> last ingest -> the PRD-shaped one -> largest."""
    try:
        store = get_store()
        collections = store.list_collections()
    except VectorStoreError as exc:
        # e.g. VECTOR_STORE=qdrant without credentials — a configuration error, not a 500.
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not collections:
        raise HTTPException(
            status_code=404,
            detail="No collections yet. Run an ingest first (POST /api/ingest or the Ingest tab).",
        )
    if name:
        if not any(c["name"] == name for c in collections):
            raise HTTPException(status_code=404, detail=f"Collection '{name}' does not exist.")
        return name

    cached = last_artifact()
    if cached:
        return cached["store"]["collection"]

    for collection in collections:
        if collection["metadata"].get("pdf_name") == settings.pdf_path.name:
            return collection["name"]
    return max(collections, key=lambda c: c["count"])["name"]


def _retrieve(collection: str, query: str, mode: str, top_k: int, use_prefixes: bool | None) -> tuple[dict, float, list]:
    """Run all three retrievers and return (payload, total_ms, hits_for_the_chosen_mode)."""
    if settings.uses_cloud_inference:
        return _retrieve_remote(collection, query, mode, top_k)

    store = get_store()
    index = load_index(collection)
    embedder = get_embedder()

    embed_started = time.perf_counter()
    query_embed = embedder.embed_query(query, use_prefixes=use_prefixes)
    embed_ms = (time.perf_counter() - embed_started) * 1000

    keyword = index.keyword(query, top_k=top_k)

    # Chroma performs the same cosine search; keeping its distances lets the UI cross-check the maths.
    # Chroma's HNSW index is *approximate*, so ask for a generous window to be sure our exact top-3
    # are included, and remember that a slight ordering difference is expected, not a bug.
    chroma_distances: dict[str, float] = {}
    chroma_ms = 0.0
    try:
        chroma_started = time.perf_counter()
        for hit in store.query(collection, query_embed.vectors[0], top_k=min(index.n_docs, 50)):
            chroma_distances[hit.chunk_id] = hit.distance
        chroma_ms = (time.perf_counter() - chroma_started) * 1000
    except VectorStoreError:
        chroma_distances = {}

    vector = index.vector(query_embed.vectors[0], top_k=top_k, chroma_distances=chroma_distances)
    hybrid = index.hybrid(query, query_embed.vectors[0], top_k=top_k)

    modes = {"keyword": keyword, "vector": vector, "hybrid": hybrid}
    chosen = modes.get(mode, hybrid)

    payload = {
        "ok": True,
        "query": query,
        "collection": collection,
        # Which retriever produced ``hits`` — the UI needs this to resolve [C#] tags back to chunks.
        "mode": mode,
        "top_k": top_k,
        "use_prefixes": query_embed.prefixed,
        "query_vector": {
            "dims": query_embed.dims,
            "endpoint": query_embed.endpoint,
            "vector": query_embed.vectors[0] if query_embed.vectors else [],
            "stats": vector_stats(query_embed.vectors[0]) if query_embed.vectors else {},
        },
        "timings": {
            "embed_query_ms": round(embed_ms, 2),
            "chroma_query_ms": round(chroma_ms, 2),
            "keyword_ms": round(keyword.ms, 2),
            "vector_ms": round(vector.ms, 2),
            "hybrid_ms": round(hybrid.ms, 2),
        },
        "modes": {name: outcome.to_dict() for name, outcome in modes.items()},
        "indexed_chunks": index.n_docs,
    }
    return payload, embed_ms + keyword.ms + vector.ms + hybrid.ms, chosen.hits


# --------------------------------------------------------------------------------------
# retrieval without a local embedder (Qdrant Cloud Inference, free tier)
# --------------------------------------------------------------------------------------
def _retrieve_remote(collection: str, query: str, mode: str, top_k: int) -> tuple[dict, float, list]:
    """Retrieval when embeddings are generated by Qdrant Cloud Inference.

    The cluster embeds the documents *and* the query, so the query and the corpus always use exactly
    the same model and width — there is no client-side vector to compute, and no embedding key.
    BM25 still runs locally over the chunk text stored in each payload, and RRF fuses the two
    rankings with the identical formula used locally.
    """
    store = get_store()
    model = settings.embedding_model_name
    index = load_index(collection, include_vectors=False)

    # --- BM25 over the stored text (unchanged, local) -----------------------------
    keyword = index.keyword(query, top_k=top_k)
    keyword_full = index.keyword_ranking(query)

    # --- vector side: the cluster embeds the query and returns cosine scores -------
    vector_started = time.perf_counter()
    remote = store.query_by_text(collection, query, model, top_k=max(top_k, index.n_docs))
    vector_ms = (time.perf_counter() - vector_started) * 1000

    by_id = {chunk.id: chunk for chunk in index.chunks}

    vector_hits: list[Hit] = []
    for rank, hit in enumerate(remote[:top_k], start=1):
        chunk = by_id.get(hit.chunk_id)
        vector_hits.append(
            Hit(
                chunk_id=hit.chunk_id,
                score=hit.similarity,
                rank=rank,
                text=hit.text or (chunk.text if chunk else ""),
                page_start=int(hit.metadata.get("page_start", chunk.page_start if chunk else 0)),
                page_end=int(hit.metadata.get("page_end", chunk.page_end if chunk else 0)),
                index=int(hit.metadata.get("index", chunk.index if chunk else 0)),
                chars=int(hit.metadata.get("chars", chunk.chars if chunk else 0)),
                breakdown={
                    "formula": "cos \u03b8  (query embedded and scored by Qdrant Cloud Inference)",
                    "server_side": True,
                    "model": model,
                    "cosine": round(hit.similarity, 6),
                    "qdrant_score": round(hit.similarity, 6),
                    "distance": round(hit.distance, 6),
                    "note": (
                        "The cluster embedded the query with the same model that embedded the "
                        "documents and returned this cosine similarity. Cloud Inference does not "
                        "expose the raw query vector, so the dot-product breakdown is only "
                        "available in local (Ollama) mode."
                    ),
                },
            )
        )

    vector = SearchOutcome(
        mode="vector",
        hits=vector_hits,
        ms=vector_ms,
        meta={
            "algorithm": f"cosine similarity via Qdrant Cloud Inference ({model})",
            "server_side": True,
            "n_docs": index.n_docs,
            "dims": store.resolved_dims(collection) if hasattr(store, "resolved_dims") else None,
            "score_range": "\u22121 (opposite) \u2026 0 (unrelated) \u2026 1 (identical direction)",
        },
    )

    # --- RRF hybrid over the two rankings (same formula as local) -----------------
    hybrid_started = time.perf_counter()
    fused = rrf_fuse(
        [chunk_id for chunk_id, _ in keyword_full],
        [hit.chunk_id for hit in remote],
        settings.rrf_k,
        top_k,
        server_side_vector=True,
    )
    hybrid_hits: list[Hit] = []
    for rank, (chunk_id, score, breakdown) in enumerate(fused, start=1):
        chunk = by_id.get(chunk_id)
        if chunk is None:
            continue
        hybrid_hits.append(
            Hit(
                chunk_id=chunk.id,
                score=score,
                rank=rank,
                text=chunk.text,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                index=chunk.index,
                chars=chunk.chars,
                breakdown=breakdown,
            )
        )
    hybrid_ms = (time.perf_counter() - hybrid_started) * 1000 + vector_ms
    hybrid = SearchOutcome(
        mode="hybrid",
        hits=hybrid_hits,
        ms=hybrid_ms,
        meta={
            "algorithm": "Reciprocal Rank Fusion over BM25 + Qdrant Cloud Inference",
            "server_side": True,
            "n_docs": index.n_docs,
            "k": settings.rrf_k,
            "inference_model": model,
            "keyword_top10": [chunk_id for chunk_id, _ in keyword_full[:10]],
            "vector_top10": [hit.chunk_id for hit in remote[:10]],
            "score_range": f"max possible with 2 lists ranked #1 = {2 / (settings.rrf_k + 1):.4f}",
        },
    )

    modes = {"keyword": keyword, "vector": vector, "hybrid": hybrid}
    chosen = modes.get(mode, hybrid)

    payload = {
        "ok": True,
        "query": query,
        "collection": collection,
        "mode": mode,
        "top_k": top_k,
        "use_prefixes": False,
        "embedding_mode": "server-side (Qdrant Cloud Inference)",
        "embedding_model": model,
        # Cloud Inference embeds the query inside the cluster and does not return the raw vector, so
        # the query-vector heatmap is intentionally absent in production.
        "query_vector": None,
        "query_vector_unavailable_reason": (
            "Qdrant Cloud Inference embeds the query inside the cluster and does not expose the "
            "raw vector. Chunk vectors are still available from the stored points."
        ),
        "prefix_note": (
            "Qdrant Cloud Inference applies the model's own query/passage prefixes automatically, "
            "so the nomic-specific search_document:/search_query: prefixes stay off."
        ),
        "timings": {
            "embed_query_ms": 0.0,
            "chroma_query_ms": round(vector_ms, 2),
            "keyword_ms": round(keyword.ms, 2),
            "vector_ms": round(vector_ms, 2),
            "hybrid_ms": round(hybrid_ms, 2),
        },
        "modes": {name: outcome.to_dict() for name, outcome in modes.items()},
        "indexed_chunks": index.n_docs,
    }
    return payload, keyword.ms + vector_ms + hybrid_ms, chosen.hits


# ------------------------------------------------------------------------------------
# routes
# ------------------------------------------------------------------------------------
@app.get("/api/health")
def health() -> dict:
    """Everything the status bar needs — and the quickest way to verify a deployment.

    Contains booleans, model names and counts only: never a key, never a token. Reported against
    whichever providers are active (Ollama/Chroma locally, hosted embeddings/Qdrant in production).
    """
    embedding = get_embedder().health()

    try:
        store_health = get_store().health()
    except VectorStoreError as exc:
        # A missing QDRANT_URL must be *reported* here, not turn the health check into a 500.
        store_health = {"ok": False, "path": "", "collections": [], "error": str(exc)}

    # The vector width is never assumed: it is whatever the cluster (or the configured hint) says.
    resolved_dims = (
        settings.embedding_dims_hint
        or store_health.get("dims")  # noqa: B009 - plain dict from store.health()
        or embedding.get("dims")
    )
    embedding["dims"] = resolved_dims
    embedding["mode"] = (
        "server-side (Qdrant Cloud Inference)" if settings.uses_cloud_inference else "client-side (Ollama)"
    )
    embedding["model"] = settings.embedding_model_name

    groq = _groq_health()

    pdf = {
        "path": str(settings.pdf_path),
        "name": settings.pdf_path.name,
        "exists": settings.pdf_path.exists(),
        "size_bytes": settings.pdf_path.stat().st_size if settings.pdf_path.exists() else 0,
    }

    warnings: list[str] = []

    def warn(message: str) -> None:
        """Keep the list readable — Qdrant problems are often reported by two components at once."""
        if message and message not in warnings:
            warnings.append(message)

    if not embedding["ok"]:
        warn(embedding["error"] or f"The '{settings.embedding_provider}' embedding provider is not usable.")
    if embedding["ok"] and settings.embedding_is_local and not embedding["model_present"]:
        warn(
            f"Ollama is up but '{settings.embed_model}' is not pulled: ollama pull {settings.embed_model}"
        )
    # A deployment that still points at the local stack fails with a confusing connection error;
    # name the missing variables instead. Neither warning can happen locally, and both only ever
    # suggest a *free* provider.
    if settings.is_vercel and settings.embedding_is_local:
        warn(
            "EMBEDDING_PROVIDER is not set on this deployment, so it is pointing at local Ollama at "
            f"{settings.ollama_url}, which Vercel cannot reach. Set EMBEDDING_PROVIDER=qdrant (plus "
            "QDRANT_URL, QDRANT_API_KEY and QDRANT_EMBED_MODEL) — Qdrant Cloud Inference is free."
        )
    if settings.is_vercel and settings.vector_store == "chroma":
        warn(
            "VECTOR_STORE is not set on this deployment, so it is using the embedded ChromaDB, which "
            "is not installed in the serverless bundle. Set VECTOR_STORE=qdrant."
        )
    if not store_health["ok"]:
        warn(store_health["error"] or f"The '{settings.vector_store}' vector store could not be opened.")
    if not groq["key_present"]:
        warn("GROQ_API_TOKEN / GROQ_API_KEY missing — chat will fail, search still works.")
    elif groq["model_available"] is False:
        warn(groq["error"] or "Configured Groq model not found.")
    if not pdf["exists"]:
        warn(
            f"PDF not found at {pdf['path']}"
            + (
                " (expected in production: the confidential PDF is deliberately not deployed — use the "
                "Ingest tab's upload instead)."
                if settings.is_vercel
                else ""
            )
        )

    active = None
    try:
        active = _resolve_collection(None)
    except HTTPException:
        warn("No document ingested yet — open the Ingest tab and run the pipeline.")

    checks = [embedding["ok"], store_health["ok"], groq["key_present"]]
    status = "ok" if all(checks) else ("degraded" if any(checks) else "error")

    return {
        # --- stable, production-facing summary -----------------------------------
        "status": status,
        "environment": settings.environment,
        "vercel_env": settings.vercel_env,
        "groq_configured": groq["key_present"],
        "embedding_provider": settings.embedding_provider,
        "embedding_model": settings.embedding_model_name,
        "embedding_dims": resolved_dims,
        "vector_store": settings.vector_store,
        "qdrant_configured": settings.qdrant_configured,
        # --- detail (the existing UI reads these keys) ---------------------------
        "ok": embedding["ok"] and store_health["ok"],
        "embedding": embedding,
        "ollama": embedding,  # kept for the current UI; reflects the active embedding provider
        "store": store_health,
        "chroma": store_health,  # kept for the current UI; reflects the active vector store
        "groq": groq,
        "pdf": pdf,
        "active_collection": active,
        "config": settings.public_config(),
        "warnings": warnings,
    }


@app.get("/api/config")
def config() -> dict:
    return settings.public_config()


@app.get("/api/documents")
def documents() -> dict:
    store = get_store()
    collections = store.list_collections()
    cached = last_artifact()
    for collection in collections:
        collection["is_active_candidate"] = bool(cached and cached["store"]["collection"] == collection["name"])
    return {"ok": True, "collections": collections, "chroma_dir": str(settings.chroma_dir)}


def _form_int(form, key: str) -> int | None:
    value = form.get(key)
    if value in (None, ""):
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _form_bool(form, key: str) -> bool | None:
    value = form.get(key)
    if value in (None, ""):
        return None
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _persist_upload(data: bytes, filename: str) -> tuple[Path, Any]:
    """Write an uploaded PDF somewhere writable (``/tmp`` on Vercel) and return a cleanup callable.

    The upload is only ever a temporary staging file: it is parsed, chunked and embedded, and then
    deleted. It is never written to a public directory or committed anywhere.
    """
    suffix = Path(filename).suffix or ".pdf"
    tmpdir = Path(tempfile.mkdtemp(prefix="prd-rag-upload-"))
    target = tmpdir / f"upload{suffix}"
    target.write_bytes(data)
    return target, lambda: shutil.rmtree(tmpdir, ignore_errors=True)


@app.post("/api/ingest")
async def ingest(request: Request) -> JSONResponse:
    """Run the whole pipeline (extract → chunk → embed → store).

    Two accepted shapes, so the local UI is untouched:

    * ``application/json`` — ``{"pdf_path"?, "chunk_size"?, "overlap"?, "use_prefixes"?}``, the
      original contract, reading the PDF from disk (local development).
    * ``multipart/form-data`` with a ``file`` part — the only workable path in production, where the
      confidential PDF is deliberately not deployed. The file is staged in a temp dir and removed.
    """
    cleanup = None
    try:
        content_type = (request.headers.get("content-type") or "").lower()
        if content_type.startswith("multipart/form-data"):
            form = await request.form()
            upload = form.get("file") or form.get("pdf")
            if upload is None or isinstance(upload, str):
                return JSONResponse(
                    status_code=400,
                    content={
                        "ok": False,
                        "stage": "extract",
                        "error": "Send the PDF as a 'file' part of a multipart/form-data request.",
                    },
                )
            data = await upload.read()
            if not data:
                return JSONResponse(
                    status_code=400,
                    content={"ok": False, "stage": "extract", "error": "The uploaded file was empty."},
                )
            pdf_path, cleanup = _persist_upload(data, getattr(upload, "filename", None) or "upload.pdf")
            artifact = run_ingest(
                pdf_path=pdf_path,
                chunk_size=_form_int(form, "chunk_size"),
                overlap=_form_int(form, "overlap"),
                use_prefixes=_form_bool(form, "use_prefixes"),
            )
        else:
            try:
                raw = await request.json()
            except Exception:  # noqa: BLE001 - an empty body simply means "all defaults"
                raw = {}
            payload = IngestRequest.model_validate(raw or {})
            artifact = run_ingest(
                pdf_path=payload.pdf_path,
                chunk_size=payload.chunk_size,
                overlap=payload.overlap,
                use_prefixes=payload.use_prefixes,
            )
    except ValidationError as exc:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "stage": "request", "error": f"Invalid ingest request: {exc.errors()}"},
        )
    except (PdfError, EmbeddingError, VectorStoreError) as exc:
        status, body = ingest_error(exc)
        return JSONResponse(status_code=status, content=body)
    except Exception as exc:  # noqa: BLE001
        status, body = ingest_error(exc)
        return JSONResponse(status_code=status, content=body)
    finally:
        if cleanup:
            cleanup()

    return JSONResponse(content=artifact)


@app.get("/api/chunks/{collection}")
def chunks(collection: str, limit: int = Query(default=500, ge=1, le=5000), offset: int = Query(default=0, ge=0)) -> dict:
    store = get_store()
    try:
        data = store.get_all(collection, include_embeddings=True)
    except VectorStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    rows = list(zip(data["ids"], data["documents"], data["metadatas"], data["embeddings"] or [None] * len(data["ids"])))
    rows.sort(key=lambda row: int(row[2].get("index", 0)))
    window = rows[offset : offset + limit]

    items = []
    for chunk_id, text, metadata, vector in window:
        items.append(
            {
                "chunk_id": chunk_id,
                "text": text,
                "index": int(metadata.get("index", 0)),
                "page_start": int(metadata.get("page_start", 0)),
                "page_end": int(metadata.get("page_end", 0)),
                "chars": int(metadata.get("chars", len(text))),
                "tokens_est": int(metadata.get("tokens_est", 0)),
                "overlap_chars": int(metadata.get("overlap_chars", 0)),
                "paragraphs": int(metadata.get("paragraphs", 0)),
                "vector_stats": vector_stats(vector) if vector is not None else None,
            }
        )

    artifact = last_artifact(collection)
    return {
        "ok": True,
        "collection": collection,
        "total": len(rows),
        "offset": offset,
        "limit": limit,
        "chunks": items,
        "document": artifact["document"] if artifact else None,
        "chunking": artifact["chunking"] if artifact else None,
        "embedding": {k: v for k, v in (artifact["embedding"] or {}).items() if k != "stats"} if artifact else None,
        "pages": artifact["pages"] if artifact else None,
        "timeline": artifact["timeline"] if artifact else None,
    }


@app.get("/api/chunks/{collection}/{chunk_id}/vector")
def chunk_vector(collection: str, chunk_id: str) -> dict:
    store = get_store()
    try:
        vector = store.get_vector(collection, chunk_id)
    except VectorStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if vector is None:
        raise HTTPException(status_code=404, detail=f"Chunk '{chunk_id}' not found in '{collection}'.")
    return {
        "ok": True,
        "collection": collection,
        "chunk_id": chunk_id,
        "embedding_model": settings.embed_model,
        "vector": vector,
        "stats": vector_stats(vector),
    }


@app.post("/api/search")
def search(request: SearchRequest) -> dict:
    collection = _resolve_collection(request.collection)
    try:
        payload, _total_ms, _hits = _retrieve(
            collection, request.query, "hybrid", request.top_k, request.use_prefixes
        )
    except EmbeddingError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except VectorStoreError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return _json_safe(payload)


@app.post("/api/chat")
def chat(request: ChatRequest) -> JSONResponse:
    collection = _resolve_collection(request.collection)
    try:
        payload, retrieval_ms, hits = _retrieve(
            collection, request.question, request.mode, request.top_k, request.use_prefixes
        )
        answer = ask(request.question, hits, request.mode, total_retrieval_ms=retrieval_ms)
    except GroqError as exc:
        return JSONResponse(status_code=503, content={"ok": False, "stage": "generate", "error": str(exc)})
    except EmbeddingError as exc:
        return JSONResponse(status_code=503, content={"ok": False, "stage": "embed", "error": str(exc)})
    except VectorStoreError as exc:
        return JSONResponse(status_code=500, content={"ok": False, "stage": "retrieve", "error": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"ok": False, "stage": "retrieve", "error": str(exc)})

    return JSONResponse(
        content=_json_safe(
            {
                "ok": True,
                "question": request.question,
                "collection": collection,
                "mode": request.mode,
                "retrieval": payload,
                "generation": answer,
            }
        )
    )


@app.delete("/api/collections/{collection}")
def delete_collection(collection: str) -> dict:
    try:
        get_store().delete(collection)
    except VectorStoreError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    invalidate(collection)
    return {"ok": True, "deleted": collection}


# --------------------------------------------------------------------------------------
# optional: serve the built UI (web/dist) so one process can demo everything
# --------------------------------------------------------------------------------------
_dist = CHAPTER_DIR / "web" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="ui")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("server.main:app", host="127.0.0.1", port=settings.api_port, reload=False)
