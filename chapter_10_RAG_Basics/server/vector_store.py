"""Stage 4 of the RAG pipeline — the vector store.

Two interchangeable implementations sit behind one duck-typed interface, selected by
``VECTOR_STORE``:

* **``chroma``** (default, local development) — ChromaDB embedded through ``PersistentClient``, so
  there is no second server to start: the FastAPI process owns the database and writes it to
  ``chapter_10_RAG_Basics/.chroma/``.
* **``qdrant``** (production, e.g. Vercel) — a remote Qdrant cluster. Vercel's filesystem is
  ephemeral, so the embedded directory cannot be production storage; a hosted database also keeps
  the confidential PRD out of the deployment bundle.

Details that matter for correctness, in both backends:

* the distance metric is **cosine**, and ``StoreHit.distance`` is always ``1 - similarity`` (Chroma
  returns that distance natively; Qdrant returns the similarity, so we convert) — the search layer
  de-duplicates nothing and the UI shows both numbers,
* vectors are **always passed explicitly**. Chroma is never asked to embed anything (no
  ``query_texts``, no ``documents=`` without ``embeddings=``), so its default ONNX MiniLM model is
  never downloaded or used, and the configured embedder stays the only one.

``chromadb`` and ``qdrant_client`` are imported **lazily**, inside the class that needs them, so a
production deployment never has to ship — or even install — the backend it does not use.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .config import Settings
from .config import settings as default_settings


class VectorStoreError(RuntimeError):
    """Raised for anything that goes wrong talking to the configured vector store."""


@dataclass
class StoreHit:
    chunk_id: str
    text: str
    metadata: dict
    distance: float
    similarity: float


# --------------------------------------------------------------------------------------
# local development store: ChromaDB (embedded)
# --------------------------------------------------------------------------------------
def _new_client(path: Path) -> Any:
    import chromadb
    from chromadb.config import Settings as ChromaSettings

    path.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(
        path=str(path),
        settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
    )


class VectorStore:
    """Small wrapper around a persistent, embedded Chroma client (local development)."""

    kind = "chroma"

    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path or default_settings.chroma_dir)
        try:
            self.client = _new_client(self.path)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not open the Chroma store at {self.path}: {exc}") from exc

    # ------------------------------------------------------------------ collections
    def ensure_collection(
        self,
        name: str,
        *,
        embedding_model: str,
        dims: int,
        chunk_size: int,
        overlap: int,
        pdf_sha1: str,
        pdf_name: str,
        use_prefixes: bool,
    ) -> Any:
        metadata = {
            "hnsw:space": "cosine",  # distance = 1 - cosine similarity
            "embedding_model": embedding_model,
            "embedding_dims": int(dims),
            "chunk_size": int(chunk_size),
            "overlap": int(overlap),
            "pdf_sha1": pdf_sha1,
            "pdf_name": pdf_name,
            "use_prefixes": bool(use_prefixes),
        }
        try:
            return self.client.get_or_create_collection(name=name, metadata=metadata)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not create collection '{name}': {exc}") from exc

    def collection(self, name: str) -> Any:
        try:
            return self.client.get_collection(name=name)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Collection '{name}' does not exist. Ingest the PDF first.") from exc

    def list_collections(self) -> list[dict]:
        out: list[dict] = []
        for item in self.client.list_collections():
            name = getattr(item, "name", None) or str(item)
            metadata = dict(getattr(item, "metadata", None) or {})
            try:
                count = self.client.get_collection(name).count()
            except Exception:  # noqa: BLE001
                count = 0
            out.append({"name": name, "count": count, "metadata": metadata})
        out.sort(key=lambda c: c["name"])
        return out

    def count(self, name: str) -> int:
        try:
            return self.collection(name).count()
        except VectorStoreError:
            return 0

    def delete(self, name: str) -> None:
        try:
            self.client.delete_collection(name)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not delete collection '{name}': {exc}") from exc

    # ------------------------------------------------------------------ writes
    def upsert_chunks(
        self,
        name: str,
        ids: list[str],
        texts: list[str],
        metadatas: list[dict],
        embeddings: list[list[float]],
        batch_size: int = 100,
    ) -> int:
        collection = self.collection(name)
        written = 0
        for start in range(0, len(ids), batch_size):
            stop = start + batch_size
            try:
                collection.upsert(
                    ids=ids[start:stop],
                    documents=texts[start:stop],
                    metadatas=metadatas[start:stop],
                    embeddings=embeddings[start:stop],
                )
            except Exception as exc:  # noqa: BLE001
                raise VectorStoreError(f"Chroma upsert failed at rows {start}-{stop}: {exc}") from exc
            written += len(ids[start:stop])
        return written

    # ------------------------------------------------------------------ reads
    def query(self, name: str, query_embedding: list[float], top_k: int) -> list[StoreHit]:
        """Cosine similarity search. ``query_embeddings`` only — never ``query_texts``."""
        collection = self.collection(name)
        try:
            result = collection.query(
                query_embeddings=[query_embedding],
                n_results=max(1, top_k),
                include=["documents", "metadatas", "distances"],
            )
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Chroma query failed: {exc}") from exc

        ids = (result.get("ids") or [[]])[0]
        documents = (result.get("documents") or [[]])[0]
        metadatas = (result.get("metadatas") or [[]])[0]
        distances = (result.get("distances") or [[]])[0]

        hits: list[StoreHit] = []
        for i, chunk_id in enumerate(ids):
            distance = float(distances[i]) if i < len(distances) else 0.0
            hits.append(
                StoreHit(
                    chunk_id=chunk_id,
                    text=documents[i] if i < len(documents) else "",
                    metadata=dict(metadatas[i] or {}) if i < len(metadatas) else {},
                    distance=distance,
                    similarity=1.0 - distance,  # cosine space -> similarity
                )
            )
        return hits

    def get_all(self, name: str, include_embeddings: bool = True) -> dict:
        """Every row in a collection, used to rebuild the chunk table and the BM25 index."""
        collection = self.collection(name)
        include = ["documents", "metadatas"] + (["embeddings"] if include_embeddings else [])
        try:
            result = collection.get(include=include)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Chroma get failed: {exc}") from exc

        embeddings_raw = result.get("embeddings")
        embeddings = [list(map(float, v)) for v in embeddings_raw] if embeddings_raw is not None else None
        return {
            "ids": list(result.get("ids") or []),
            "documents": list(result.get("documents") or []),
            "metadatas": [dict(m or {}) for m in (result.get("metadatas") or [])],
            "embeddings": embeddings,
        }

    def get_vector(self, name: str, chunk_id: str) -> list[float] | None:
        collection = self.collection(name)
        try:
            result = collection.get(ids=[chunk_id], include=["embeddings"])
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Chroma get failed: {exc}") from exc
        embeddings = result.get("embeddings")
        if embeddings is None or len(embeddings) == 0:
            return None
        return list(map(float, embeddings[0]))

    def health(self) -> dict:
        try:
            collections = self.list_collections()
            return {"ok": True, "path": str(self.path), "collections": collections, "error": None}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "path": str(self.path), "collections": [], "error": str(exc)}


# --------------------------------------------------------------------------------------
# production store: Qdrant (remote, survives Vercel's ephemeral filesystem)
# --------------------------------------------------------------------------------------
_META_SUFFIX = "__meta"
_UUID_NAMESPACE = uuid.UUID("6f1d4a3e-6b0a-4c2f-9a1e-8f2b7c5d4e10")


def _point_id(chunk_id: str) -> str:
    """Qdrant only accepts unsigned integers or UUIDs as point ids.

    Our chunk ids look like ``c0007-948fa6``, so they are mapped through a stable UUIDv5 and the
    original id is kept in the payload — nothing downstream has to know about the mapping.
    """
    return str(uuid.uuid5(_UUID_NAMESPACE, f"chunk:{chunk_id}"))


# Qdrant rejects an upsert whose vector width does not match the collection, and says so:
#   "Vector dimension error: expected dim: 1, got 384"
# We use that reply only as a *fallback* way to learn the embedding width of a Cloud Inference model
# when neither the collection nor QDRANT_EMBED_DIMS tells us. "got" is the model's real output size.
_DIMS_ERROR = re.compile(r"expected\s*dim[:\s]+(\d+)[,\s]+got[:\s]+(\d+)", re.IGNORECASE)


def dims_from_error(message: str) -> int | None:
    """Extract the model's actual output width from a Qdrant dimension-mismatch error."""
    match = _DIMS_ERROR.search(message or "")
    if not match:
        return None
    try:
        dims = int(match.group(2))
    except (TypeError, ValueError):
        return None
    return dims if dims > 0 else None


def friendly_qdrant_error(exc: Exception, action: str) -> str:
    """Turn a raw Qdrant failure into something a human can act on — never a silent fallback.

    Free-tier safety matters here: if the configured model is billable, unavailable on a free
    cluster, or the account is rate limited, the operator must be told, not quietly downgraded to
    another (possibly paid) provider.
    """
    message = str(exc)
    lowered = message.lower()

    if "402" in message or "payment" in lowered or "billing" in lowered or "quota" in lowered:
        return (
            f"Qdrant Cloud refused {action}: the configured model looks billable or the free quota is "
            f"exhausted. Choose a model labelled \"Cost: Free\" in your cluster's Inference tab, and "
            f"make sure the cluster is on the free tier. ({message[:200]})"
        )
    if "403" in message or "forbidden" in lowered or "unauthorized" in lowered or "401" in message:
        return (
            f"Qdrant Cloud rejected {action}: check QDRANT_API_KEY (and that the key belongs to this "
            f"cluster). ({message[:200]})"
        )
    if "429" in message or "rate limit" in lowered or "too many requests" in lowered:
        return (
            f"Qdrant Cloud rate-limited {action}. The free tier has request limits — retry in a "
            f"moment, or ingest the document locally (see DEPLOYMENT.md §9d). ({message[:200]})"
        )
    if "not found" in lowered and "model" in lowered:
        return (
            f"The inference model is not available on this cluster for {action}. Copy the exact model "
            f"id from the Inference tab of your cluster into QDRANT_EMBED_MODEL. ({message[:200]})"
        )
    return f"Qdrant Cloud failed to {action}: {message[:300]}"


class QdrantStore:
    """Remote vector store for deployments (Qdrant / Qdrant Cloud).

    Configured entirely from the environment: ``VECTOR_STORE=qdrant``, ``QDRANT_URL`` and
    ``QDRANT_API_KEY``. Missing credentials raise an explicit :class:`VectorStoreError` rather than
    silently degrading to a filesystem store that would vanish on the next cold start.

    Embeddings are produced by the cluster itself (Cloud Inference), so the text is sent as an
    inference object instead of a vector — see :class:`server.embeddings.QdrantInferenceEmbedder`.

    The ingestion config the UI needs is stored as collection metadata (``create_collection`` gained
    a ``metadata`` argument in qdrant-client 1.16, readable back via ``config.metadata``). Older
    clusters that reject it fall back to a tiny side collection (``<prefix>prd_meta``) holding one
    point per data collection.
    """

    kind = "qdrant"

    def __init__(self, settings: Settings | None = None) -> None:
        cfg = settings or default_settings
        self.settings = cfg
        self.url = cfg.qdrant_url
        self.api_key = cfg.qdrant_api_key
        self.prefix = cfg.collection_prefix

        if not self.url:
            raise VectorStoreError(
                "VECTOR_STORE=qdrant but QDRANT_URL is not set, so production vector storage is not "
                "configured. Add QDRANT_URL and QDRANT_API_KEY to the Vercel project environment "
                "variables (see DEPLOYMENT.md)."
            )
        if not self.api_key:
            raise VectorStoreError(
                "VECTOR_STORE=qdrant but QDRANT_API_KEY is not set. Add the cluster API key to the "
                "Vercel project environment variables (see DEPLOYMENT.md)."
            )

        try:
            from qdrant_client import QdrantClient, models
        except ImportError as exc:  # pragma: no cover - dependency is declared
            raise VectorStoreError(
                "qdrant-client is required when VECTOR_STORE=qdrant. Install requirements.txt."
            ) from exc

        self.models = models
        try:
            self.client = QdrantClient(url=self.url, api_key=self.api_key, timeout=cfg.qdrant_timeout)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not create a Qdrant client for {self.hostname}: {exc}") from exc

    # ------------------------------------------------------------------ helpers
    @property
    def hostname(self) -> str:
        return urlparse(self.url).netloc or self.url

    @property
    def meta_collection(self) -> str:
        return f"{self.prefix}prd{_META_SUFFIX}"

    def _is_ours(self, name: str) -> bool:
        """Only touch collections this app created — the cluster may host other projects."""
        return name.startswith(f"{self.prefix}prd_") and name != self.meta_collection

    def _vector_size(self, name: str) -> int | None:
        try:
            vectors = self.client.get_collection(name).config.params.vectors
            return getattr(vectors, "size", None)
        except Exception:  # noqa: BLE001
            return None

    def _ensure_meta_collection(self) -> None:
        if not self.client.collection_exists(self.meta_collection):
            self.client.create_collection(
                collection_name=self.meta_collection,
                vectors_config=self.models.VectorParams(size=1, distance=self.models.Distance.DOT),
            )

    def _write_meta(self, name: str, metadata: dict) -> None:
        self._ensure_meta_collection()
        self.client.upsert(
            collection_name=self.meta_collection,
            points=[
                self.models.PointStruct(
                    id=str(uuid.uuid5(_UUID_NAMESPACE, f"meta:{name}")),
                    vector=[0.0],
                    payload={"collection": name, **metadata},
                )
            ],
        )

    def _read_meta(self) -> dict[str, dict]:
        try:
            if not self.client.collection_exists(self.meta_collection):
                return {}
            records, _ = self.client.scroll(self.meta_collection, limit=512, with_payload=True)
        except Exception:  # noqa: BLE001 - bookkeeping must never break a request
            return {}
        out: dict[str, dict] = {}
        for record in records:
            payload = dict(record.payload or {})
            name = payload.pop("collection", None)
            if name:
                out[name] = payload
        return out

    # ------------------------------------------------------------------ collections
    def ensure_collection(
        self,
        name: str,
        *,
        embedding_model: str,
        dims: int | None,
        chunk_size: int,
        overlap: int,
        pdf_sha1: str,
        pdf_name: str,
        use_prefixes: bool,
    ) -> str:
        """Create the collection if needed and settle its vector width.

        The width is never guessed: it comes from an explicit ``QDRANT_EMBED_DIMS``, or from the
        collection itself when it already exists, or — as a last resort — from the model's own reply
        (see :meth:`_model_dims`). A disagreement between the configured value and the collection is
        a hard error, never a silent shrug, because a wrong width would corrupt every score.
        """
        resolved = self._resolve_dims(name, dims, embedding_model)

        metadata = {
            "space": "cosine",
            "embedding_model": embedding_model,
            "embedding_dims": int(resolved),
            "chunk_size": int(chunk_size),
            "overlap": int(overlap),
            "pdf_sha1": pdf_sha1,
            "pdf_name": pdf_name,
            "use_prefixes": bool(use_prefixes),
        }

        try:
            if not self.client.collection_exists(name):
                self._create_collection(name, int(resolved), metadata)
        except VectorStoreError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(
                friendly_qdrant_error(exc, f"create collection '{name}'")
            ) from exc

        self._write_meta(name, metadata)
        return name

    # ------------------------------------------------------------------ dimensions
    def _resolve_dims(self, name: str, hint: int | None, model: str) -> int:
        """Decide the vector width for a collection, preferring authoritative sources."""
        hint = int(hint) if hint else None

        if self.client.collection_exists(name):
            existing = self._vector_size(name)
            if existing:
                if hint and hint != int(existing):
                    raise VectorStoreError(
                        f"Collection '{name}' stores {existing}-dimensional vectors but "
                        f"QDRANT_EMBED_DIMS is {hint}. Point both at the same model, or delete the "
                        f"collection so it is rebuilt for the new model."
                    )
                return int(existing)

        if hint:
            return hint

        discovered = self._model_dims(model)
        if discovered:
            return discovered

        raise VectorStoreError(
            f"Could not determine the vector width of inference model '{model}'. Copy the "
            f"dimensionality from the Inference tab of your cluster (Cluster detail \u2192 Inference) "
            f"into QDRANT_EMBED_DIMS, or reuse an existing collection. Nothing is guessed on purpose: "
            f"a wrong width would make every similarity score meaningless."
        )

    def _create_collection(self, name: str, dims: int, metadata: dict) -> None:
        """Create a cosine collection, using collection metadata when the cluster supports it."""
        vectors = self.models.VectorParams(size=int(dims), distance=self.models.Distance.COSINE)
        try:
            self.client.create_collection(
                collection_name=name, vectors_config=vectors, metadata=metadata
            )
        except Exception:
            # Clusters older than 1.16 have no collection metadata — keep the config in the side
            # collection instead (which _write_meta always does anyway).
            if self.client.collection_exists(name):
                raise
            self.client.create_collection(collection_name=name, vectors_config=vectors)

    def _model_dims(self, model: str) -> int | None:
        """Learn a Cloud Inference model's output width without guessing.

        Cloud Inference has no "text \u2192 vector" endpoint, so the width is learned from a throwaway
        1-dimensional probe collection: upserting one Inference Object there is *documented* to fail
        with a dimension error that names the model's real width. The probe is always deleted.
        """
        probe = f"{self.prefix}prd__dim_probe"
        try:
            if self.client.collection_exists(probe):
                self.client.delete_collection(probe)
            self.client.create_collection(
                collection_name=probe,
                vectors_config=self.models.VectorParams(size=1, distance=self.models.Distance.COSINE),
            )
        except Exception:  # noqa: BLE001 - probing is best effort
            return None

        try:
            self.client.upsert(
                collection_name=probe,
                wait=True,
                points=[
                    self.models.PointStruct(
                        id=1,
                        vector=self.models.Document(text="dimension probe", model=model),
                    )
                ],
            )
            # Unexpected success: read the stored vector back and count its dimensions.
            records = self.client.retrieve(collection_name=probe, ids=[1], with_vectors=True)
            if records and records[0].vector is not None:
                return len(records[0].vector)
            return None
        except Exception as exc:  # noqa: BLE001
            return dims_from_error(str(exc))
        finally:
            try:
                if self.client.collection_exists(probe):
                    self.client.delete_collection(probe)
            except Exception:  # noqa: BLE001
                pass

    def resolved_dims(self, name: str) -> int | None:
        """The collection's vector width, read from Qdrant (authoritative), if it exists."""
        try:
            return self._vector_size(name) if self.client.collection_exists(name) else None
        except Exception:  # noqa: BLE001
            return None

    def collection(self, name: str) -> str:
        try:
            exists = self.client.collection_exists(name)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not reach Qdrant at {self.hostname}: {exc}") from exc
        if not exists:
            raise VectorStoreError(f"Collection '{name}' does not exist. Ingest the PDF first.")
        return name

    def list_collections(self) -> list[dict]:
        try:
            names = [c.name for c in self.client.get_collections().collections]
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(friendly_qdrant_error(exc, "list collections")) from exc

        fallback = self._read_meta()
        out = [
            {"name": name, "count": self.count(name), "metadata": self._collection_metadata(name, fallback)}
            for name in names
            if self._is_ours(name)
        ]
        out.sort(key=lambda c: c["name"])
        return out

    def _collection_metadata(self, name: str, fallback: dict[str, dict]) -> dict:
        """Ingestion config for a collection — from the collection itself, else the side collection."""
        try:
            info = self.client.get_collection(name)
            meta = getattr(getattr(info, "config", None), "metadata", None)
            if meta:
                return dict(meta)
        except Exception:  # noqa: BLE001
            pass
        return fallback.get(name, {})

    def count(self, name: str) -> int:
        try:
            return int(self.client.count(collection_name=name, exact=True).count)
        except Exception:  # noqa: BLE001
            return 0

    def delete(self, name: str) -> None:
        try:
            if self.client.collection_exists(name):
                self.client.delete_collection(name)
            if self.client.collection_exists(self.meta_collection):
                self.client.delete(
                    collection_name=self.meta_collection,
                    points_selector=[str(uuid.uuid5(_UUID_NAMESPACE, f"meta:{name}"))],
                )
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Could not delete collection '{name}': {exc}") from exc

    # ------------------------------------------------------------------ writes
    def upsert_chunks(
        self,
        name: str,
        ids: list[str],
        texts: list[str],
        metadatas: list[dict],
        embeddings: list[list[float]],
        batch_size: int = 100,
    ) -> int:
        self.collection(name)
        written = 0
        for start in range(0, len(ids), batch_size):
            stop = start + batch_size
            points = [
                self.models.PointStruct(
                    id=_point_id(chunk_id),
                    vector=list(map(float, vector)),
                    payload={"chunk_id": chunk_id, "text": text, **metadata},
                )
                for chunk_id, text, metadata, vector in zip(
                    ids[start:stop], texts[start:stop], metadatas[start:stop], embeddings[start:stop]
                )
            ]
            try:
                self.client.upsert(collection_name=name, points=points, wait=True)
            except Exception as exc:  # noqa: BLE001
                raise VectorStoreError(f"Qdrant upsert failed at rows {start}-{stop}: {exc}") from exc
            written += len(points)
        return written

    # ------------------------------------------------------------------ reads
    def query(self, name: str, query_embedding: list[float], top_k: int) -> list[StoreHit]:
        """Cosine similarity search over pre-computed vectors (local embeddings)."""
        self.collection(name)
        try:
            response = self.client.query_points(
                collection_name=name,
                query=list(map(float, query_embedding)),
                limit=max(1, top_k),
                with_payload=True,
            )
            points = getattr(response, "points", response)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(friendly_qdrant_error(exc, "search")) from exc
        return self._to_hits(points)

    def query_by_text(self, name: str, text: str, model: str, top_k: int) -> list[StoreHit]:
        """Cosine search where the cluster embeds the query itself (Qdrant Cloud Inference).

        The query text is sent as an Inference Object, so the model that embeds the query is by
        construction the same one that embedded the documents — and no embedding key is needed.
        """
        self.collection(name)
        try:
            response = self.client.query_points(
                collection_name=name,
                query=self.models.Document(text=text, model=model),
                limit=max(1, top_k),
                with_payload=True,
            )
            points = getattr(response, "points", response)
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(friendly_qdrant_error(exc, "embed the query and search")) from exc
        return self._to_hits(points)

    def _to_hits(self, points: Any) -> list[StoreHit]:
        hits: list[StoreHit] = []
        for point in points:
            payload = dict(point.payload or {})
            similarity = float(point.score)  # Qdrant returns the similarity for cosine space
            hits.append(
                StoreHit(
                    chunk_id=payload.get("chunk_id") or str(point.id),
                    text=payload.get("text", ""),
                    metadata={k: v for k, v in payload.items() if k not in {"chunk_id", "text"}},
                    distance=1.0 - similarity,  # same convention as Chroma's cosine distance
                    similarity=similarity,
                )
            )
        return hits

    def upsert_inference_chunks(
        self,
        name: str,
        ids: list[str],
        texts: list[str],
        metadatas: list[dict],
        model: str,
        batch_size: int = 32,
    ) -> int:
        """Store chunks and let Qdrant Cloud Inference produce the vectors server-side.

        The chunk text is also kept in the payload: the client-side BM25 retriever, the citations and
        the chunk table all still need it (Cloud Inference itself does not persist the input).
        """
        self.collection(name)
        written = 0
        for start in range(0, len(ids), batch_size):
            stop = start + batch_size
            points = [
                self.models.PointStruct(
                    id=_point_id(chunk_id),
                    vector=self.models.Document(text=text, model=model),
                    payload={"chunk_id": chunk_id, "text": text, **metadata},
                )
                for chunk_id, text, metadata in zip(
                    ids[start:stop], texts[start:stop], metadatas[start:stop]
                )
            ]
            try:
                self.client.upsert(collection_name=name, points=points, wait=True)
            except Exception as exc:  # noqa: BLE001
                raise VectorStoreError(
                    friendly_qdrant_error(exc, f"embed and store rows {start}-{stop}")
                ) from exc
            written += len(points)
        return written

    def get_all(self, name: str, include_embeddings: bool = True) -> dict:
        """Every row in a collection, used to rebuild the chunk table and the BM25 index."""
        self.collection(name)
        ids: list[str] = []
        documents: list[str] = []
        metadatas: list[dict] = []
        embeddings: list[list[float]] = []
        offset: Any = None
        try:
            while True:
                records, offset = self.client.scroll(
                    collection_name=name,
                    limit=256,
                    offset=offset,
                    with_payload=True,
                    with_vectors=include_embeddings,
                )
                for record in records:
                    payload = dict(record.payload or {})
                    ids.append(payload.get("chunk_id") or str(record.id))
                    documents.append(payload.get("text", ""))
                    metadatas.append({k: v for k, v in payload.items() if k not in {"chunk_id", "text"}})
                    if include_embeddings:
                        embeddings.append(list(map(float, record.vector or [])))
                if offset is None or not records:
                    break
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Qdrant scroll failed: {exc}") from exc

        return {
            "ids": ids,
            "documents": documents,
            "metadatas": metadatas,
            "embeddings": embeddings if include_embeddings else None,
        }

    def get_vector(self, name: str, chunk_id: str) -> list[float] | None:
        self.collection(name)
        try:
            records = self.client.retrieve(
                collection_name=name, ids=[_point_id(chunk_id)], with_vectors=True
            )
        except Exception as exc:  # noqa: BLE001
            raise VectorStoreError(f"Qdrant retrieve failed: {exc}") from exc
        if not records:
            return None
        vector = records[0].vector
        if vector is None:
            return None
        if isinstance(vector, dict):  # named vectors would arrive as a mapping
            vector = next(iter(vector.values()))
        return list(map(float, vector))

    def health(self) -> dict:
        target = f"qdrant://{self.hostname}"
        result = {
            "ok": False,
            "path": target,
            "collections": [],
            "error": None,
            "dims": None,
            "inference_model": self.settings.qdrant_embed_model if self.settings.uses_cloud_inference else None,
        }
        try:
            collections = self.list_collections()
            result["ok"] = True
            result["collections"] = collections
            # Report the width the cluster actually uses, so /api/health never relies on a constant.
            for collection in collections:
                dims = collection["metadata"].get("embedding_dims")
                if dims:
                    result["dims"] = int(dims)
                    break
            if result["dims"] is None and collections:
                result["dims"] = self.resolved_dims(collections[0]["name"])
        except Exception as exc:  # noqa: BLE001
            result["error"] = friendly_qdrant_error(exc, "read the cluster")
        return result


# --------------------------------------------------------------------------------------
# store factory
# --------------------------------------------------------------------------------------
_CHROMA_STORES = {"chroma", "local"}
_QDRANT_STORES = {"qdrant"}
_REMOTE_STORES = {"qdrant"}

_store: Any = None


def get_store() -> VectorStore | QdrantStore:
    """Process-wide singleton for whichever store ``VECTOR_STORE`` selects.

    Defaults to the embedded ChromaDB so local development is unchanged; production sets
    ``VECTOR_STORE=qdrant`` with a remote cluster.
    """
    global _store
    if _store is None:
        name = (default_settings.vector_store or "chroma").lower()
        if name in _CHROMA_STORES:
            _store = VectorStore()
        elif name in _QDRANT_STORES:
            _store = QdrantStore()
        else:
            raise VectorStoreError(
                f"Unknown VECTOR_STORE '{name}'. Use 'chroma' for local development or 'qdrant' "
                f"for a remote database."
            )
    return _store
