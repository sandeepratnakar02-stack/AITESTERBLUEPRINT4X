"""Stage 3 of the RAG pipeline — turn text into embedding vectors.

Two **free** providers sit behind one interface, selected by ``EMBEDDING_PROVIDER``:

* **``ollama``** (default, local development) — ``nomic-embed-text`` on a local Ollama server,
  768 dimensions, no network cost. Groq has no embeddings endpoint, so the vectors must come from
  somewhere we control, and this keeps the confidential PRD on the machine.
* **``qdrant``** (production, e.g. Vercel) — **Qdrant Cloud Inference**. The same free-tier cluster
  that stores the vectors also generates them, so there is no third-party embedding provider and no
  extra API key. Embeddings are produced *inside* the cluster from Inference Objects, which means no
  vector ever has to be computed client-side (see :class:`QdrantInferenceEmbedder`).

There is deliberately no paid embedding branch: no OpenAI/Cohere/Jina key is required anywhere, and
nothing can silently fall back to a billable service.

The functions here are the ones that make the *weights* visible in the UI: every vector gets a small
statistics bundle (dimension, L2 norm, min/max/mean, first and last dimensions) plus, on demand, the
full vector for the heatmap.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import httpx
import numpy as np

from .config import Settings, settings as default_settings


class EmbeddingError(RuntimeError):
    """Raised when the configured embedding provider is unreachable, misconfigured or refuses."""


@dataclass
class EmbedResult:
    vectors: list[list[float]]
    model: str
    dims: int
    batches: int
    ms: float
    endpoint: str
    prefixed: bool

    @property
    def ms_per_chunk(self) -> float:
        return self.ms / max(1, len(self.vectors))


def vector_stats(vector: list[float] | np.ndarray) -> dict:
    """Small, human-readable summary of one embedding vector."""
    arr = np.asarray(vector, dtype=np.float32)
    return {
        "dims": int(arr.size),
        "norm": round(float(np.linalg.norm(arr)), 4),
        "mean": round(float(arr.mean()), 5),
        "std": round(float(arr.std()), 5),
        "min": round(float(arr.min()), 5),
        "max": round(float(arr.max()), 5),
        "nonzero": int(np.count_nonzero(arr)),
        "first8": [round(float(v), 5) for v in arr[:8]],
        "last8": [round(float(v), 5) for v in arr[-8:]],
    }


class OllamaEmbedder:
    """Thin client for Ollama's embedding endpoints.

    Uses the modern ``/api/embed`` (supports a batch of inputs in one call) and transparently falls
    back to the legacy ``/api/embeddings`` (one prompt at a time) for older Ollama builds.
    """

    provider = "ollama"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or default_settings
        self.base_url = self.settings.ollama_url.rstrip("/")
        self.model = self.settings.embed_model
        self._legacy = False

    # ------------------------------------------------------------------ internals
    def _post(self, path: str, payload: dict, timeout: float) -> dict:
        url = f"{self.base_url}{path}"
        try:
            response = httpx.post(url, json=payload, timeout=timeout)
        except httpx.ConnectError as exc:
            raise EmbeddingError(
                f"Could not reach Ollama at {self.base_url}. Start it with `ollama serve` "
                f"and make sure the model is pulled with `ollama pull {self.model}`."
            ) from exc
        except httpx.TimeoutException as exc:
            raise EmbeddingError(f"Ollama timed out after {timeout:g}s while embedding.") from exc

        if response.status_code == 404:
            raise FileNotFoundError(path)
        if response.status_code >= 400:
            detail = response.text[:300]
            if "not found" in detail.lower() or response.status_code == 404:
                raise EmbeddingError(
                    f"Ollama does not have the model '{self.model}'. Run: ollama pull {self.model}"
                )
            raise EmbeddingError(f"Ollama returned {response.status_code}: {detail}")
        return response.json()

    def _embed_batch(self, texts: list[str]) -> tuple[list[list[float]], str]:
        if not self._legacy:
            try:
                data = self._post(
                    "/api/embed",
                    {"model": self.model, "input": texts},
                    self.settings.embed_timeout,
                )
                vectors = data.get("embeddings") or []
                if len(vectors) != len(texts):
                    raise EmbeddingError(
                        f"Ollama returned {len(vectors)} embeddings for {len(texts)} inputs."
                    )
                return [list(map(float, v)) for v in vectors], "/api/embed"
            except FileNotFoundError:
                self._legacy = True  # old Ollama: fall through to the legacy endpoint

        vectors: list[list[float]] = []
        for text in texts:
            data = self._post(
                "/api/embeddings",
                {"model": self.model, "prompt": text},
                self.settings.embed_timeout,
            )
            vectors.append(list(map(float, data["embedding"])))
        return vectors, "/api/embeddings"

    # ------------------------------------------------------------------ public API
    def embed_documents(self, texts: list[str], use_prefixes: bool | None = None) -> EmbedResult:
        prefixed = self.settings.use_prefixes if use_prefixes is None else use_prefixes
        payload = [f"{self.settings.doc_prefix}{t}" if prefixed else t for t in texts]
        return self._embed(payload, prefixed, len(texts))

    def embed_query(self, text: str, use_prefixes: bool | None = None) -> EmbedResult:
        prefixed = self.settings.use_prefixes if use_prefixes is None else use_prefixes
        payload = [f"{self.settings.query_prefix}{text}" if prefixed else text]
        return self._embed(payload, prefixed, 1)

    def _embed(self, payload: list[str], prefixed: bool, total: int) -> EmbedResult:
        if not payload:
            return EmbedResult([], self.model, self.settings.embed_dims, 0, 0.0, "none", prefixed)

        started = time.perf_counter()
        vectors: list[list[float]] = []
        batches = 0
        endpoint = "/api/embed"
        size = max(1, self.settings.embed_batch)
        for start in range(0, len(payload), size):
            batch = payload[start : start + size]
            batch_vectors, endpoint = self._embed_batch(batch)
            vectors.extend(batch_vectors)
            batches += 1

        dims = len(vectors[0]) if vectors else 0
        if total and dims and dims != self.settings.embed_dims:
            # Not fatal (nomic-embed-text is 768), but we want it loud rather than silently wrong.
            print(
                f"[embeddings] warning: {self.model} returned {dims} dims, "
                f"config expects {self.settings.embed_dims}"
            )
        return EmbedResult(
            vectors=vectors,
            model=self.model,
            dims=dims,
            batches=batches,
            ms=(time.perf_counter() - started) * 1000,
            endpoint=endpoint,
            prefixed=prefixed,
        )

    def health(self) -> dict:
        """Is Ollama up, is the model installed, and how wide are its vectors?"""
        result = {
            "ok": False,
            "provider": self.provider,
            "url": self.base_url,
            "model": self.model,
            "model_present": False,
            "installed_models": [],
            "dims": None,
            "endpoint": None,
            "error": None,
        }
        try:
            tags = httpx.get(f"{self.base_url}/api/tags", timeout=5.0)
            tags.raise_for_status()
            names = [m.get("name", "") for m in tags.json().get("models", [])]
            result["installed_models"] = names
            result["model_present"] = any(n.split(":")[0] == self.model for n in names)
        except Exception as exc:  # noqa: BLE001 - health must never raise
            result["error"] = f"Ollama not reachable at {self.base_url}: {exc}"
            return result

        try:
            probe = self.embed_query("ping", use_prefixes=False)
            result["dims"] = probe.dims
            result["endpoint"] = probe.endpoint
            result["ok"] = probe.dims > 0
        except Exception as exc:  # noqa: BLE001
            result["error"] = str(exc)
        return result


class QdrantInferenceEmbedder:
    """Embeddings produced by **Qdrant Cloud Inference** — no third-party provider, no extra key.

    Qdrant Cloud Inference does not expose a "text to vector" endpoint. Instead you send an
    *Inference Object* — ``{"text": ..., "model": ...}`` — as the ``vector`` when upserting a point,
    or as the ``query`` when searching, and the cluster generates the embedding server-side. So this
    class deliberately produces **no local vectors**: :mod:`server.vector_store` sends Inference
    Objects instead.

    It exists so the rest of the pipeline has a single place to report the active model, its
    dimensions and its configuration problems. Any attempt to embed locally fails loudly rather than
    silently using a different (or paid) provider.
    """

    provider = "qdrant"
    server_side = True

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or default_settings
        self.model = self.settings.qdrant_embed_model
        self.base_url = self.settings.qdrant_url or ""
        self.dims = self.settings.qdrant_embed_dims or None

    def _unsupported(self) -> EmbeddingError:
        return EmbeddingError(
            "Qdrant Cloud Inference generates embeddings inside the cluster, so they cannot be "
            "computed on the client. Ingest and search send Inference Objects "
            '({"text": ..., "model": ...}) to Qdrant instead — see DEPLOYMENT.md.'
        )

    def embed_documents(self, texts: list[str], use_prefixes: bool | None = None) -> EmbedResult:
        raise self._unsupported()

    def embed_query(self, text: str, use_prefixes: bool | None = None) -> EmbedResult:
        raise self._unsupported()

    def health(self) -> dict:
        """Report whether Cloud Inference is configured, and which model/dimensions are in play.

        The actual model availability cannot be probed without a collection, so this reports the
        configuration; the vector store's own health covers cluster reachability, and the model is
        truly exercised by the first upsert/query (which fails loudly if it is not usable).
        """
        result = {
            "ok": False,
            "provider": self.provider,
            "mode": "server-side (Qdrant Cloud Inference)",
            "url": self.base_url,
            "model": self.model,
            "model_present": False,
            "installed_models": [],
            "dims": self.dims,
            "endpoint": "cloud-inference",
            "error": None,
        }
        if not (self.settings.qdrant_url and self.settings.qdrant_api_key):
            result["error"] = (
                "Qdrant Cloud Inference needs QDRANT_URL and QDRANT_API_KEY. Add them in the Vercel "
                "project environment variables (see DEPLOYMENT.md)."
            )
            return result

        result["model_present"] = True
        result["ok"] = True
        result["note"] = (
            'Verify the model is labelled "Cost: Free" in the Inference tab of your cluster; free '
            "embedding models are hosted in the US region only. Dimensions are read from the "
            "collection (or the vectors it produced) rather than assumed."
        )
        return result


# --------------------------------------------------------------------------------------
# provider factory — free providers only
# --------------------------------------------------------------------------------------
_OLLAMA_PROVIDERS = {"ollama", "local"}
_QDRANT_INFERENCE_PROVIDERS = {"qdrant", "qdrant-inference", "cloud-inference"}


def get_embedder(settings: Settings | None = None) -> OllamaEmbedder | QdrantInferenceEmbedder:
    """Return the embedder selected by ``EMBEDDING_PROVIDER``.

    Only free options exist:

    * ``ollama`` (default)   — local ``nomic-embed-text``, used by local development.
    * ``qdrant``             — Qdrant Cloud Inference, free-tier friendly, used in production.

    There is deliberately no paid-provider branch, so no API key for OpenAI/Cohere/Jina is ever
    required and embeddings can never fall back to a billable service.
    """
    cfg = settings or default_settings
    provider = (cfg.embedding_provider or "ollama").lower()
    if provider in _OLLAMA_PROVIDERS:
        return OllamaEmbedder(cfg)
    if provider in _QDRANT_INFERENCE_PROVIDERS:
        return QdrantInferenceEmbedder(cfg)
    raise EmbeddingError(
        f"Unknown EMBEDDING_PROVIDER '{provider}'. Use 'ollama' (local, free) or 'qdrant' "
        f"(Qdrant Cloud Inference, free tier). Paid embedding providers are intentionally not supported."
    )
