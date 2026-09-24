"""Stage 5 of the RAG pipeline — the search algorithms, with their maths left visible.

Three retrievers run over the same chunks so their differences can be *seen* rather than asserted:

* ``keyword`` — a hand-written **BM25** (k1/b from config). Good at exact tokens such as
  "VWO-1234" or "SSO"; blind to paraphrases.
* ``vector`` — **cosine similarity** between the query embedding and each stored chunk embedding.
  Finds meaning ("how do users sign in" matches "login flow") but can miss rare identifiers.
* ``hybrid`` — **Reciprocal Rank Fusion**: ``sum(1 / (k + rank))`` across the two ranked lists.
  Robust when one retriever is confident and the other is noise.

Nothing is hidden behind a library: every hit carries the per-term BM25 contributions, the cosine
components (dot product and both norms), or the RRF rank contributions, so the UI can show exactly
why a chunk won.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

from .config import Settings, settings as default_settings

_TOKEN = re.compile(r"[a-z0-9][a-z0-9_\-./]*[a-z0-9]|[a-z0-9]")

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "has", "have", "how",
    "i", "if", "in", "into", "is", "it", "its", "of", "on", "or", "our", "should", "so", "that",
    "the", "their", "then", "there", "these", "they", "this", "to", "was", "we", "were", "what",
    "when", "where", "which", "who", "will", "with", "would", "you", "your",
}


def tokenize(text: str) -> list[str]:
    """Lowercase word tokens, stop-words removed."""
    return [t for t in _TOKEN.findall(text.lower()) if t not in STOPWORDS]


def rrf_fuse(
    keyword_ranking: list[str],
    vector_ranking: list[str],
    k: int,
    top_k: int,
    server_side_vector: bool = False,
) -> list[tuple[str, float, dict]]:
    """Reciprocal Rank Fusion of two ranked chunk-id lists.

    One implementation for both deployment shapes: locally the vector ranking comes from the
    in-process cosine matrix, in production it comes from Qdrant Cloud Inference. The arithmetic is
    therefore identical, and the breakdown keeps the same keys either way.

    Returns ``[(chunk_id, score, breakdown), ...]`` sorted by descending score.
    """
    keyword_pos = {chunk_id: rank for rank, chunk_id in enumerate(keyword_ranking, start=1)}
    vector_pos = {chunk_id: rank for rank, chunk_id in enumerate(vector_ranking, start=1)}

    fused: list[tuple[str, float, dict]] = []
    for chunk_id in dict.fromkeys([*keyword_ranking, *vector_ranking]):
        kw_rank = keyword_pos.get(chunk_id)
        vec_rank = vector_pos.get(chunk_id)
        kw_part = 1 / (k + kw_rank) if kw_rank else 0.0
        vec_part = 1 / (k + vec_rank) if vec_rank else 0.0
        fused.append(
            (
                chunk_id,
                kw_part + vec_part,
                {
                    "formula": "RRF = \u03a3 1 / (k + rank)  over each ranked list",
                    "k": k,
                    "keyword_rank": kw_rank,
                    "vector_rank": vec_rank,
                    "keyword_rrf": round(kw_part, 6),
                    "vector_rrf": round(vec_part, 6),
                    "total_rrf": round(kw_part + vec_part, 6),
                    "server_side_vector": server_side_vector,
                },
            )
        )

    fused.sort(key=lambda item: -item[1])
    return fused[:top_k]


@dataclass
class IndexedChunk:
    id: str
    index: int
    text: str
    page_start: int
    page_end: int
    chars: int
    tokens_est: int
    overlap_chars: int
    paragraphs: int


@dataclass
class Hit:
    chunk_id: str
    score: float
    rank: int
    text: str
    page_start: int
    page_end: int
    index: int
    chars: int
    matched_terms: list[str] = field(default_factory=list)
    breakdown: dict = field(default_factory=dict)

    def preview(self, limit: int = 1200) -> str:
        flat = self.text.strip()
        return flat if len(flat) <= limit else flat[:limit].rstrip() + "…"

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "score": round(self.score, 6),
            "rank": self.rank,
            "text": self.preview(),
            "page_start": self.page_start,
            "page_end": self.page_end,
            "index": self.index,
            "chars": self.chars,
            "matched_terms": self.matched_terms,
            "breakdown": self.breakdown,
        }


@dataclass
class SearchOutcome:
    mode: str
    hits: list[Hit]
    ms: float
    meta: dict

    def to_dict(self) -> dict:
        return {
            "mode": self.mode,
            "ms": round(self.ms, 2),
            "meta": self.meta,
            "hits": [h.to_dict() for h in self.hits],
        }


class SearchIndex:
    """In-memory BM25 + cosine index over one collection.

    ``embeddings`` may be ``None``: BM25 needs only the text, and when embeddings are produced
    server-side (Qdrant Cloud Inference) the vector ranking comes from the database instead — see
    :func:`rrf_fuse` and ``_retrieve_remote`` in :mod:`server.main`.
    """

    def __init__(
        self,
        chunks: list[IndexedChunk],
        embeddings: np.ndarray | None,
        settings: Settings,
    ) -> None:
        self.chunks = chunks
        self.settings = settings
        self.has_vectors = embeddings is not None and len(embeddings) == len(chunks)

        if self.has_vectors:
            self.embeddings = np.asarray(embeddings, dtype=np.float32)
            self.norms = np.linalg.norm(self.embeddings, axis=1)
            self.norms[self.norms == 0] = 1e-9
        else:
            self.embeddings = np.zeros((len(chunks), 0), dtype=np.float32)
            self.norms = np.zeros(len(chunks), dtype=np.float32)

        self.tokens: list[list[str]] = [tokenize(c.text) for c in chunks]
        self.tf: list[Counter[str]] = [Counter(tokens) for tokens in self.tokens]
        self.doc_len = np.array([len(t) for t in self.tokens], dtype=np.float32)
        self.avgdl = float(self.doc_len.mean()) if len(self.doc_len) else 0.0

        df: Counter[str] = Counter()
        for tokens in self.tokens:
            df.update(set(tokens))
        self.df = df
        self.n_docs = len(chunks)

    # ------------------------------------------------------------------ BM25
    def keyword(self, query: str, top_k: int | None = None) -> SearchOutcome:
        import time

        started = time.perf_counter()
        top_k = top_k or self.settings.top_k
        k1, b = self.settings.bm25_k1, self.settings.bm25_b
        query_terms = list(dict.fromkeys(tokenize(query)))

        scores = np.zeros(self.n_docs, dtype=np.float32)
        contributions: list[dict[str, dict]] = [dict() for _ in range(self.n_docs)]

        for term in query_terms:
            df = self.df.get(term, 0)
            if df == 0:  # term never appears -> BM25 contributes nothing
                continue
            idf = math.log(1 + (self.n_docs - df + 0.5) / (df + 0.5))
            for i, tf_map in enumerate(self.tf):
                freq = tf_map.get(term, 0)
                if not freq:
                    continue
                length_norm = 1 - b + b * (self.doc_len[i] / self.avgdl if self.avgdl else 1.0)
                weight = (freq * (k1 + 1)) / (freq + k1 * length_norm)
                contribution = idf * weight
                scores[i] += contribution
                contributions[i][term] = {
                    "tf": freq,
                    "df": df,
                    "idf": round(float(idf), 4),
                    # float() matters: length_norm is a numpy float32, so round() would hand FastAPI
                    # a numpy scalar it cannot serialise.
                    "tf_weight": round(float(weight), 4),
                    "contribution": round(float(contribution), 4),
                }

        order = np.argsort(-scores)[:top_k]
        hits: list[Hit] = []
        for rank, i in enumerate(order, start=1):
            idx = int(i)
            terms = sorted(
                contributions[idx].items(), key=lambda kv: -kv[1]["contribution"]
            )
            hits.append(
                Hit(
                    chunk_id=self.chunks[idx].id,
                    score=float(scores[idx]),
                    rank=rank,
                    text=self.chunks[idx].text,
                    page_start=self.chunks[idx].page_start,
                    page_end=self.chunks[idx].page_end,
                    index=self.chunks[idx].index,
                    chars=self.chunks[idx].chars,
                    matched_terms=[t for t, _ in terms],
                    breakdown={
                        "formula": "score = Σ idf(term) × tf × (k1 + 1) / (tf + k1 × (1 − b + b × docLen / avgDocLen))",
                        "k1": k1,
                        "b": b,
                        "query_terms": query_terms,
                        "terms": [{"term": t, **info} for t, info in terms],
                        "doc_len": int(self.doc_len[idx]),
                        "avg_doc_len": round(self.avgdl, 2),
                        "matched_unique_terms": len(terms),
                        "coverage": round(len(terms) / max(1, len(query_terms)), 3),
                    },
                )
            )

        return SearchOutcome(
            mode="keyword",
            hits=hits,
            ms=(time.perf_counter() - started) * 1000,
            meta={
                "algorithm": "BM25",
                "n_docs": self.n_docs,
                "avg_doc_len": round(self.avgdl, 2),
                "query_terms": query_terms,
                "terms_not_in_corpus": [t for t in query_terms if self.df.get(t, 0) == 0],
                "k1": k1,
                "b": b,
            },
        )

    # ------------------------------------------------------------------ cosine
    def vector(
        self,
        query_vector: list[float],
        top_k: int | None = None,
        chroma_distances: dict[str, float] | None = None,
    ) -> SearchOutcome:
        import time

        if not self.has_vectors:
            raise ValueError(
                "This index holds no vectors (embeddings are produced server-side, e.g. by Qdrant "
                "Cloud Inference), so the exact-cosine path is unavailable. Use the vector ranking "
                "returned by the vector store instead."
            )

        started = time.perf_counter()
        top_k = top_k or self.settings.top_k
        query = np.asarray(query_vector, dtype=np.float32)
        query_norm = float(np.linalg.norm(query)) or 1e-9

        dots = self.embeddings @ query
        cosines = dots / (self.norms * query_norm)

        order = np.argsort(-cosines)[:top_k]
        hits: list[Hit] = []
        for rank, i in enumerate(order, start=1):
            idx = int(i)
            doc = self.embeddings[idx]
            products = np.abs(doc * query)
            top_dims = np.argsort(-products)[:5]
            distance = (chroma_distances or {}).get(self.chunks[idx].id)
            hits.append(
                Hit(
                    chunk_id=self.chunks[idx].id,
                    score=float(cosines[idx]),
                    rank=rank,
                    text=self.chunks[idx].text,
                    page_start=self.chunks[idx].page_start,
                    page_end=self.chunks[idx].page_end,
                    index=self.chunks[idx].index,
                    chars=self.chunks[idx].chars,
                    breakdown={
                        "formula": "cos θ = (q · d) / (‖q‖ × ‖d‖)",
                        "dot_product": round(float(dots[idx]), 4),
                        "query_norm": round(query_norm, 4),
                        "doc_norm": round(float(self.norms[idx]), 4),
                        "cosine": round(float(cosines[idx]), 6),
                        "chroma_distance": round(distance, 6) if distance is not None else None,
                        "similarity_from_distance": round(1 - distance, 6) if distance is not None else None,
                        "top_dimensions": [
                            {
                                "dim": int(d),
                                "query": round(float(query[d]), 5),
                                "doc": round(float(doc[d]), 5),
                                "product": round(float(doc[d] * query[d]), 6),
                            }
                            for d in top_dims
                        ],
                    },
                )
            )

        return SearchOutcome(
            mode="vector",
            hits=hits,
            ms=(time.perf_counter() - started) * 1000,
            meta={
                "algorithm": "cosine similarity (Chroma hnsw:space=cosine)",
                "n_docs": self.n_docs,
                "dims": int(query.size),
                "query_norm": round(query_norm, 4),
                "score_range": "−1 (opposite) … 0 (unrelated) … 1 (identical direction)",
            },
        )

    # ------------------------------------------------------------------ RRF
    def hybrid(self, query: str, query_vector: list[float], top_k: int | None = None) -> SearchOutcome:
        import time

        started = time.perf_counter()
        top_k = top_k or self.settings.top_k
        k = self.settings.rrf_k

        keyword_full = self._full_keyword_ranking(query)
        vector_full = self._full_vector_ranking(query_vector)

        combined = rrf_fuse(
            [chunk_id for chunk_id, _ in keyword_full],
            [chunk_id for chunk_id, _ in vector_full],
            k,
            top_k,
        )
        by_id = {c.id: c for c in self.chunks}
        hits: list[Hit] = []
        for rank, (chunk_id, score, breakdown) in enumerate(combined, start=1):
            chunk = by_id[chunk_id]
            hits.append(
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

        return SearchOutcome(
            mode="hybrid",
            hits=hits,
            ms=(time.perf_counter() - started) * 1000,
            meta={
                "algorithm": "Reciprocal Rank Fusion over BM25 + cosine",
                "n_docs": self.n_docs,
                "k": k,
                "keyword_top10": [c for c, _ in keyword_full[:10]],
                "vector_top10": [c for c, _ in vector_full[:10]],
                "score_range": f"max possible with 2 lists ranked #1 = {2 / (k + 1):.4f}",
            },
        )

    # ------------------------------------------------------------------ helpers
    def keyword_ranking(self, query: str) -> list[tuple[str, float]]:
        """Full BM25 ranking (ids only, positive scores first), used by RRF."""
        outcome = self.keyword(query, top_k=self.n_docs)
        ranked = [(h.chunk_id, h.score) for h in outcome.hits if h.score > 0]
        return ranked or [(h.chunk_id, h.score) for h in outcome.hits]

    def vector_ranking(self, query_vector: list[float]) -> list[tuple[str, float]]:
        outcome = self.vector(query_vector, top_k=self.n_docs)
        return [(h.chunk_id, h.score) for h in outcome.hits]

    def _full_keyword_ranking(self, query: str) -> list[tuple[str, float]]:
        return self.keyword_ranking(query)

    def _full_vector_ranking(self, query_vector: list[float]) -> list[tuple[str, float]]:
        return self.vector_ranking(query_vector)


# --------------------------------------------------------------------------------------
# cache + loader
# --------------------------------------------------------------------------------------
_index_cache: dict[tuple[str, int], SearchIndex] = {}


def load_index(
    collection: str,
    force: bool = False,
    settings: Settings | None = None,
    include_vectors: bool = True,
) -> SearchIndex:
    """Build (or reuse) the search index for a Chroma/Qdrant collection.

    ``include_vectors=False`` builds a BM25-only index, which is what production needs when the
    embeddings live (and are generated) server-side in Qdrant Cloud Inference.
    """
    global _index_cache

    from .vector_store import get_store

    cfg = settings or default_settings
    store = get_store()
    count = store.count(collection)
    key = (collection, count, include_vectors)
    if not force and key in _index_cache:
        return _index_cache[key]

    data = store.get_all(collection, include_embeddings=include_vectors)
    if include_vectors and not data["embeddings"]:
        raise ValueError(f"Collection '{collection}' has no embeddings — run an ingest first.")

    # Keep every row's id/text/metadata glued to its own vector *before* any sorting. Chroma happens
    # to return rows in insertion order today, but sorting the chunk list without sorting the matrix
    # alongside it would silently pair chunk A's text with chunk B's vector.
    rows = list(
        zip(
            data["ids"],
            data["documents"],
            data["metadatas"],
            data["embeddings"] if include_vectors else [None] * len(data["ids"]),
        )
    )
    rows.sort(key=lambda row: int(row[2].get("index", 0)))

    chunks: list[IndexedChunk] = []
    vectors: list[list[float]] = []
    for chunk_id, text, metadata, vector in rows:
        chunks.append(
            IndexedChunk(
                id=chunk_id,
                index=int(metadata.get("index", len(chunks))),
                text=text,
                page_start=int(metadata.get("page_start", 0)),
                page_end=int(metadata.get("page_end", 0)),
                chars=int(metadata.get("chars", 0)),
                tokens_est=int(metadata.get("tokens_est", 0)),
                overlap_chars=int(metadata.get("overlap_chars", 0)),
                paragraphs=int(metadata.get("paragraphs", 0)),
            )
        )
        if vector is not None:
            vectors.append(list(map(float, vector)))

    matrix = np.asarray(vectors, dtype=np.float32) if include_vectors and vectors else None
    index = SearchIndex(chunks=chunks, embeddings=matrix, settings=cfg)
    _index_cache[key] = index
    _index_cache = {k: v for k, v in _index_cache.items() if k[0] != collection or k == key}
    return index


def invalidate(collection: str) -> None:
    global _index_cache
    _index_cache = {k: v for k, v in _index_cache.items() if k[0] != collection}