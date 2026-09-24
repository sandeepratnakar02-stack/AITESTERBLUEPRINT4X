"""Central configuration for the PRD RAG explorer.

Every path, model id, chunk default and rate lives here so no other module reads
``os.environ`` directly. Nothing in this file is ever shipped to the browser: the Groq key stays
inside the FastAPI process (``public_config()`` deliberately omits it).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# --------------------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------------------
CHAPTER_DIR = Path(__file__).resolve().parent.parent  # chapter_10_RAG_Basics/
ENV_PATH = CHAPTER_DIR / ".env"

load_dotenv(ENV_PATH)

# ChromaDB ships with anonymous telemetry that phones home (posthog). Keep this chapter offline-safe.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "False")
os.environ.setdefault("CHROMA_TELEMETRY_ENABLED", "False")

DEFAULT_PDF = CHAPTER_DIR / "Product Requirements Document_ VWO Login Dashboard.pdf"
CHROMA_DIR = CHAPTER_DIR / ".chroma"


def _env(*names: str, default: str = "") -> str:
    """First non-empty environment variable among ``names``."""
    for name in names:
        value = os.getenv(name)
        if value and value.strip():
            return value.strip()
    return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(_env(name, default=str(default)))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(_env(name, default=str(default)))
    except ValueError:
        return default


def _env_bool(name: str, default: bool) -> bool:
    raw = _env(name, default="true" if default else "false").lower()
    return raw in {"1", "true", "yes", "on"}


# Read once at import time: field ``default_factory`` callables take no arguments, so a value that
# other defaults depend on has to be resolved here (e.g. task prefixes are a nomic/Ollama idea and
# would actively hurt a hosted embedding model).
EMBEDDING_PROVIDER = _env("EMBEDDING_PROVIDER", default="ollama").lower()


# --------------------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Settings:
    # --- document ---------------------------------------------------------------
    pdf_path: Path = field(default_factory=lambda: Path(_env("RAG_PDF_PATH", default=str(DEFAULT_PDF))))

    # --- embeddings: local Ollama, nomic-embed-text ------------------------------
    ollama_url: str = field(default_factory=lambda: _env("OLLAMA_URL", default="http://localhost:11434"))
    embed_model: str = field(default_factory=lambda: _env("EMBED_MODEL", default="nomic-embed-text"))
    embed_dims: int = field(default_factory=lambda: _env_int("EMBED_DIMS", 768))
    embed_batch: int = field(default_factory=lambda: _env_int("EMBED_BATCH", 32))
    embed_timeout: float = field(default_factory=lambda: _env_float("EMBED_TIMEOUT", 120.0))
    use_prefixes: bool = field(
        default_factory=lambda: _env_bool("EMBED_USE_PREFIXES", EMBEDDING_PROVIDER == "ollama")
    )
    doc_prefix: str = "search_document: "
    query_prefix: str = "search_query: "

    # --- embeddings: hosted service (production) ---------------------------------
    # ``EMBEDDING_PROVIDER=qdrant`` uses **Qdrant Cloud Inference**: the same Qdrant cluster that
    # stores the vectors also generates them, so no third-party embedding key is ever needed.
    # EMBED_MODEL / EMBED_DIMS below stay the Ollama (local) values.
    embedding_provider: str = field(
        default_factory=lambda: _env("EMBEDDING_PROVIDER", default="ollama").lower()
    )
    qdrant_embed_model: str = field(
        default_factory=lambda: _env(
            # Canonical spelling, exactly as it appears in the Qdrant Cloud Inference tab. Model ids
            # are matched case-sensitively, so the default mirrors the console verbatim.
            "QDRANT_EMBED_MODEL",
            default="sentence-transformers/all-MiniLM-L6-v2",
        )
    )
    # 0 means "not specified" — the real width is then read from the cluster (existing collection or
    # the vectors it actually produced) instead of being trusted from a constant here.
    qdrant_embed_dims: int = field(default_factory=lambda: _env_int("QDRANT_EMBED_DIMS", 0))

    # --- vector store: ChromaDB (local) or a remote database (production) --------
    chroma_dir: Path = field(default_factory=lambda: CHROMA_DIR)
    vector_store: str = field(default_factory=lambda: _env("VECTOR_STORE", default="chroma").lower())
    qdrant_url: str = field(default_factory=lambda: _env("QDRANT_URL"))
    qdrant_api_key: str = field(default_factory=lambda: _env("QDRANT_API_KEY"))
    qdrant_prefix: str = field(default_factory=lambda: _env("QDRANT_COLLECTION_PREFIX"))
    qdrant_timeout: float = field(default_factory=lambda: _env_float("QDRANT_TIMEOUT", 30.0))

    # --- chunking defaults (UI sliders start here) -------------------------------
    chunk_size: int = field(default_factory=lambda: _env_int("CHUNK_SIZE", 800))
    chunk_overlap: int = field(default_factory=lambda: _env_int("CHUNK_OVERLAP", 150))
    chunk_min_size: int = 120

    # --- retrieval ---------------------------------------------------------------
    top_k: int = field(default_factory=lambda: _env_int("TOP_K", 3))
    bm25_k1: float = field(default_factory=lambda: _env_float("BM25_K1", 1.5))
    bm25_b: float = field(default_factory=lambda: _env_float("BM25_B", 0.75))
    rrf_k: int = field(default_factory=lambda: _env_int("RRF_K", 60))

    # --- generation: Groq openai/gpt-oss-120b ------------------------------------
    groq_key: str = field(default_factory=lambda: _env("GROQ_API_TOKEN", "GROQ_API_KEY", "GROQ_KEY"))
    groq_model: str = field(default_factory=lambda: _env("GROQ_MODEL", default="openai/gpt-oss-120b"))
    groq_url: str = field(default_factory=lambda: _env("GROQ_URL", default="https://api.groq.com/openai/v1"))
    groq_timeout: float = field(default_factory=lambda: _env_float("GROQ_TIMEOUT", 90.0))
    temperature: float = field(default_factory=lambda: _env_float("LLM_TEMPERATURE", 0.1))
    max_tokens: int = field(default_factory=lambda: _env_int("LLM_MAX_TOKENS", 1500))
    context_char_budget: int = field(default_factory=lambda: _env_int("CONTEXT_CHAR_BUDGET", 8000))

    # --- cost panel: shown as "$/1M tokens", please verify current Groq rates ----
    price_in_per_mtok: float = field(default_factory=lambda: _env_float("GROQ_PRICE_IN", 0.15))
    price_out_per_mtok: float = field(default_factory=lambda: _env_float("GROQ_PRICE_OUT", 0.75))

    # --- server -------------------------------------------------------------------
    api_port: int = field(default_factory=lambda: _env_int("API_PORT", 8011))
    ui_port: int = field(default_factory=lambda: _env_int("UI_PORT", 5190))

    # ----------------------------------------------------------------------------
    @property
    def groq_key_present(self) -> bool:
        return bool(self.groq_key)

    # --- environment --------------------------------------------------------------
    @property
    def environment(self) -> str:
        """``vercel`` when deployed, otherwise ``local``.

        Deliberately the literal ``vercel`` rather than Vercel's own stage name, so the health
        contract is stable: use :attr:`vercel_env` for ``production`` / ``preview`` / ``development``.
        """
        return "vercel" if self.is_vercel else "local"

    @property
    def vercel_env(self) -> str | None:
        """Vercel's own ``VERCEL_ENV`` (``production``, ``preview``, ...), or ``None`` locally."""
        return _env("VERCEL_ENV") or None

    @property
    def is_vercel(self) -> bool:
        return bool(_env("VERCEL") or _env("VERCEL_ENV"))

    # --- capability probes: booleans only, never the values ------------------------
    @property
    def embedding_is_local(self) -> bool:
        return self.embedding_provider == "ollama"

    @property
    def uses_cloud_inference(self) -> bool:
        """True when embeddings are produced server-side by Qdrant Cloud Inference."""
        return self.embedding_provider == "qdrant"

    @property
    def embedding_model_name(self) -> str:
        """The model actually in use — also part of the collection fingerprint.

        For ``ollama`` this is identical to ``EMBED_MODEL``, so local collection names are unchanged.
        """
        return self.qdrant_embed_model if self.uses_cloud_inference else self.embed_model

    @property
    def embedding_dims_hint(self) -> int | None:
        """Configured vector width, or ``None`` when it should be derived from the cluster."""
        dims = self.qdrant_embed_dims if self.uses_cloud_inference else self.embed_dims
        return dims or None

    @property
    def qdrant_configured(self) -> bool:
        return bool(self.qdrant_url and self.qdrant_api_key)

    @property
    def remote_store_configured(self) -> bool:
        """True when a remote vector store has an endpoint — exposes the boolean, never the value."""
        return bool(self.qdrant_url)

    @property
    def collection_prefix(self) -> str:
        return self.qdrant_prefix or ""

    def collection_name(self, pdf_sha1: str, chunk_size: int, overlap: int) -> str:
        """Fingerprint the ingestion config into the collection name.

        Different chunk settings therefore land in different collections and can be compared,
        which is the whole point of exposing the sliders.
        """
        seed = f"{pdf_sha1}|{chunk_size}|{overlap}|{self.embedding_model_name}"
        import hashlib

        digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8]
        # The store's listing filter uses the same prefix, so a shared cluster only shows our data.
        return f"{self.collection_prefix}prd_{digest}_c{chunk_size}_o{overlap}"

    def public_config(self) -> dict:
        """Config safe to hand to the browser (never includes the API key)."""
        return {
            "pdf_path": str(self.pdf_path),
            "pdf_name": self.pdf_path.name,
            "environment": self.environment,
            "is_vercel": self.is_vercel,
            "vercel_env": self.vercel_env,
            "embedding_provider": self.embedding_provider,
            "embedding_is_local": self.embedding_is_local,
            "embedding_model": self.embedding_model_name,
            "embedding_dims": self.embedding_dims_hint,
            "uses_cloud_inference": self.uses_cloud_inference,
            "vector_store": self.vector_store,
            "qdrant_configured": self.qdrant_configured,
            "remote_store_configured": self.remote_store_configured,
            "ollama_url": self.ollama_url,
            "embed_model": self.embed_model,
            "embed_dims": self.embed_dims,
            "embed_batch": self.embed_batch,
            "doc_prefix": self.doc_prefix,
            "query_prefix": self.query_prefix,
            "use_prefixes_default": self.use_prefixes,
            "chroma_dir": str(self.chroma_dir),
            "chunk_size": self.chunk_size,
            "chunk_overlap": self.chunk_overlap,
            "top_k": self.top_k,
            "bm25_k1": self.bm25_k1,
            "bm25_b": self.bm25_b,
            "rrf_k": self.rrf_k,
            "groq_url": self.groq_url,
            "groq_model": self.groq_model,
            "groq_key_present": self.groq_key_present,
            "pricing": {
                "in_per_mtok": self.price_in_per_mtok,
                "out_per_mtok": self.price_out_per_mtok,
                "note": "Editable in server/config.py via GROQ_PRICE_IN / GROQ_PRICE_OUT — verify current Groq rates.",
            },
            "api_port": self.api_port,
            "ui_port": self.ui_port,
        }


settings = Settings()
