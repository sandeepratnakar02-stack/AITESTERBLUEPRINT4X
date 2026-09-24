"""Unit tests for the Qdrant Cloud Inference path — no cluster or credentials required.

The inference code cannot be exercised against a real free-tier cluster in this environment, so this
script drives :class:`server.vector_store.QdrantStore` with a stub client that mimics the documented
Qdrant API surface:

* upserts receive **Inference Objects** (``Document(text=..., model=...)``) rather than vectors,
* a dimension mismatch is reported the way Qdrant reports it, so the discovery fallback can be tested,
* queries carry an inference ``Document`` and come back with cosine scores.

Run it with the chapter venv:

    .venv/Scripts/python.exe scripts/test_qdrant_inference.py
"""

from __future__ import annotations

import os
import sys
import types
from pathlib import Path

# Configuration is read at import time, so set a fake cluster before importing the app.
os.environ.setdefault("EMBEDDING_PROVIDER", "qdrant")
os.environ.setdefault("VECTOR_STORE", "qdrant")
os.environ.setdefault("QDRANT_URL", "https://stub-cluster.cloud.qdrant.io:6333")
os.environ.setdefault("QDRANT_API_KEY", "stub-api-key")
os.environ.setdefault("QDRANT_EMBED_MODEL", "sentence-transformers/all-minilm-l6-v2")
os.environ.pop("QDRANT_EMBED_DIMS", None)

# Windows consoles default to cp1252; force UTF-8 so redirected output cannot crash on diagnostics.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - exotic streams
        pass

CHAPTER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CHAPTER_DIR))

from server.search import rrf_fuse  # noqa: E402
from server.vector_store import (  # noqa: E402
    QdrantStore,
    VectorStoreError,
    dims_from_error,
    friendly_qdrant_error,
)

FAILURES: list[str] = []
MODEL = "sentence-transformers/all-minilm-l6-v2"
TRUE_DIMS = 384  # the width our stub model "returns"


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not condition:
        FAILURES.append(label)


# ----------------------------------------------------------------------------------------------
# stub Qdrant surface
# ----------------------------------------------------------------------------------------------
class Distance:
    COSINE = "Cosine"
    DOT = "Dot"


class VectorParams:
    def __init__(self, size: int, distance: str) -> None:
        self.size = size
        self.distance = distance


class Document:
    """Qdrant Cloud Inference object: the text plus the model that should embed it."""

    def __init__(self, text: str, model: str, options=None) -> None:
        self.text = text
        self.model = model
        self.options = options


class PointStruct:
    def __init__(self, id, vector, payload=None) -> None:
        self.id = id
        self.vector = vector
        self.payload = payload


class _Point:
    def __init__(self, id, score, payload) -> None:
        self.id = id
        self.score = score
        self.payload = payload


class _QueryResponse:
    def __init__(self, points) -> None:
        self.points = points


class _CollectionInfo:
    def __init__(self, size, metadata) -> None:
        self.config = types.SimpleNamespace(
            params=types.SimpleNamespace(vectors=types.SimpleNamespace(size=size)),
            metadata=metadata,
        )


class _Record:
    def __init__(self, id, payload, vector=None) -> None:
        self.id = id
        self.payload = payload
        self.vector = vector


class _CollectionsResponse:
    def __init__(self, names) -> None:
        self.collections = [types.SimpleNamespace(name=n) for n in names]


class FakeClient:
    """Records what the store sends and reports a dimension error the way Qdrant does."""

    def __init__(self) -> None:
        self.collections: dict[str, dict] = {}
        self.upserts: list[tuple[str, list]] = []
        self.queries: list[dict] = []
        self.deleted: list[str] = []

    # --- collections -------------------------------------------------------------------
    def collection_exists(self, name: str) -> bool:
        return name in self.collections

    def get_collections(self):
        return _CollectionsResponse(list(self.collections))

    def get_collection(self, name: str):
        entry = self.collections[name]
        return _CollectionInfo(entry["size"], entry.get("metadata"))

    def create_collection(self, collection_name, vectors_config, metadata=None):
        self.collections[collection_name] = {
            "size": vectors_config.size,
            "metadata": metadata,
            "points": [],
        }
        return True

    def delete_collection(self, name):
        self.deleted.append(name)
        self.collections.pop(name, None)
        return True

    # --- points ------------------------------------------------------------------------
    def upsert(self, collection_name, points, wait=True):
        entry = self.collections[collection_name]
        for point in points:
            if isinstance(point.vector, Document):
                if entry["size"] != TRUE_DIMS:
                    # This is the message Qdrant returns; the store parses the "got" value from it.
                    raise Exception(
                        "Wrong input: Vector dimension error: "
                        f"expected dim: {entry['size']}, got {TRUE_DIMS}"
                    )
                stored = [0.01] * TRUE_DIMS
            else:
                if entry["size"] != len(point.vector):
                    raise Exception(
                        "Wrong input: Vector dimension error: "
                        f"expected dim: {entry['size']}, got {len(point.vector)}"
                    )
                stored = list(point.vector)
            entry["points"].append(_Record(point.id, point.payload, stored))
        self.upserts.append((collection_name, points))
        return types.SimpleNamespace(operation_id=1, status="completed")

    def query_points(self, collection_name, query, limit=10, with_payload=True, **kwargs):
        entry = self.collections[collection_name]
        self.queries.append({"collection": collection_name, "query": query, "limit": limit})
        if isinstance(query, Document):
            if entry["size"] != TRUE_DIMS:
                raise Exception(
                    "Wrong input: Vector dimension error: "
                    f"expected dim: {entry['size']}, got {TRUE_DIMS}"
                )
            ranked = [
                _Point(record.id, 0.9 - index * 0.1, record.payload)
                for index, record in enumerate(entry["points"][:limit])
            ]
        else:
            ranked = []
        return _QueryResponse(ranked)

    def count(self, collection_name, exact=True):
        return types.SimpleNamespace(count=len(self.collections[collection_name]["points"]))

    def scroll(self, collection_name, limit=10, offset=None, with_payload=True, with_vectors=False):
        points = self.collections[collection_name]["points"][:limit]
        return points, None

    def retrieve(self, collection_name, ids, with_vectors=False):
        wanted = {str(i) for i in ids}
        return [p for p in self.collections[collection_name]["points"] if str(p.id) in wanted]

    def delete(self, collection_name, points_selector=None, wait=True):
        return types.SimpleNamespace(operation_id=2, status="completed")


def make_store() -> QdrantStore:
    store = QdrantStore()  # real constructor; validates the (stub) configuration
    store.client = FakeClient()
    store.models = types.SimpleNamespace(
        Distance=Distance, VectorParams=VectorParams, Document=Document, PointStruct=PointStruct
    )
    return store


# ----------------------------------------------------------------------------------------------
# tests
# ----------------------------------------------------------------------------------------------
def test_helpers() -> None:
    print("\n== pure helpers")
    check("parses Qdrant's dimension error", dims_from_error(
        "Wrong input: Vector dimension error: expected dim: 1, got 384") == 384)
    check("ignores unrelated errors", dims_from_error("Connection refused") is None)

    billing = friendly_qdrant_error(Exception("402 Payment Required: model is not free"), "embed")
    check("billing error names the free-tier fix", "Cost: Free" in billing and "free tier" in billing)
    limited = friendly_qdrant_error(Exception("429 Too Many Requests"), "embed")
    check("rate limit is explained", "rate-limited" in limited)
    forbidden = friendly_qdrant_error(Exception("403 Forbidden"), "embed")
    check("auth error mentions the key", "QDRANT_API_KEY" in forbidden)

    fused = rrf_fuse(["a", "b"], ["a", "b"], 60, 2)
    check("RRF keeps the double-first chunk on top", fused[0][0] == "a")
    check("RRF total for #1 in both = 2/(k+1)",
          abs(fused[0][1] - 2 / 61) < 1e-9, f"{fused[0][1]:.6f}")
    check("RRF contributions are reported per list",
          fused[0][2]["keyword_rrf"] == fused[0][2]["vector_rrf"])
    inverted = rrf_fuse(["a", "b"], ["b", "a"], 60, 2)
    check("RRF ties when the lists disagree", abs(inverted[0][1] - inverted[1][1]) < 1e-9)


def test_dim_discovery() -> None:
    print("\n== dimension discovery (never guess)")
    store = make_store()
    check("no hint, no collection -> probe learns the width",
          store._resolve_dims("prd_x_c800_o150", None, MODEL) == TRUE_DIMS)
    check("probe collection is cleaned up", "prd__dim_probe" in store.client.deleted)
    check("hint is honoured when there is no collection",
          store._resolve_dims("prd_y_c800_o150", 512, MODEL) == 512)


def test_collection_lifecycle() -> None:
    print("\n== collection lifecycle")
    store = make_store()
    name = "prd_test_c800_o150"
    store.ensure_collection(
        name, embedding_model=MODEL, dims=None, chunk_size=800, overlap=150,
        pdf_sha1="abc", pdf_name="doc.pdf", use_prefixes=False,
    )
    entry = store.client.collections[name]
    check("collection created at the model's real width", entry["size"] == TRUE_DIMS, str(entry["size"]))
    check("ingestion config stored on the collection",
          (entry["metadata"] or {}).get("embedding_dims") == TRUE_DIMS)

    # An existing collection is authoritative, and a contradicting hint is a hard error.
    check("existing collection wins", store._resolve_dims(name, None, MODEL) == TRUE_DIMS)
    try:
        store._resolve_dims(name, 1536, MODEL)
        check("hint/collection mismatch fails clearly", False, "no error raised")
    except VectorStoreError as exc:
        check("hint/collection mismatch fails clearly", "1536" in str(exc) and "384" in str(exc))

    listed = store.list_collections()
    check("collection appears with its metadata",
          listed and listed[0]["metadata"].get("embedding_model") == MODEL)
    check("health reports the width from the cluster", store.health()["dims"] == TRUE_DIMS)


def test_inference_io() -> None:
    print("\n== server-side inference I/O")
    store = make_store()
    name = "prd_infer_c800_o150"
    store.ensure_collection(
        name, embedding_model=MODEL, dims=TRUE_DIMS, chunk_size=800, overlap=150,
        pdf_sha1="abc", pdf_name="doc.pdf", use_prefixes=False,
    )

    written = store.upsert_inference_chunks(
        name,
        ids=["c0000-aaaaaa", "c0001-bbbbbb"],
        texts=["Recipe for baking cookies", "SSO requirements"],
        metadatas=[{"index": 0, "page_start": 1}, {"index": 1, "page_start": 2}],
        model=MODEL,
    )
    check("both rows written", written == 2)

    _, points = store.client.upserts[-1]
    check("documents are sent as Inference Objects",
          all(isinstance(p.vector, Document) for p in points))
    check("the configured model is used", points[0].vector.model == MODEL)
    check("chunk text is preserved in the payload",
          points[0].payload.get("text") == "Recipe for baking cookies")
    check("chunk_id survives the UUID mapping", points[0].payload.get("chunk_id") == "c0000-aaaaaa")

    hits = store.query_by_text(name, "how do I bake cookies", MODEL, top_k=2)
    check("query is sent as an Inference Object",
          isinstance(store.client.queries[-1]["query"], Document))
    check("query uses the same model as ingest", store.client.queries[-1]["query"].model == MODEL)
    check("hits come back with similarity scores", len(hits) == 2 and hits[0].similarity > 0)
    check("distance is normalised to 1 - similarity",
          abs(hits[0].distance - (1 - hits[0].similarity)) < 1e-9)
    check("text and metadata round-trip",
          hits[0].text == "Recipe for baking cookies" and hits[0].metadata.get("page_start") == 1)

    vectors = store.get_all(name, include_embeddings=True)
    check("stored vectors are readable for the heatmap",
          len(vectors["embeddings"][0]) == TRUE_DIMS, str(len(vectors["embeddings"][0])))
    check("get_vector returns the stored width",
          len(store.get_vector(name, "c0000-aaaaaa") or []) == TRUE_DIMS)


def test_misconfiguration() -> None:
    print("\n== misconfiguration is explicit")
    store = make_store()

    # A stale collection created at the wrong width (e.g. a wrong QDRANT_EMBED_DIMS earlier) must
    # surface Qdrant's dimension error as a readable VectorStoreError, never a raw traceback.
    wrong = "prd_wrongwidth_c800_o150"
    store.client.create_collection(
        collection_name=wrong, vectors_config=VectorParams(size=1, distance=Distance.COSINE)
    )
    try:
        store.upsert_inference_chunks(
            wrong, ids=["c0000-aaaaaa"], texts=["hello"], metadatas=[{"index": 0}], model=MODEL
        )
        check("wrong-width collection surfaces Qdrant's error", False, "no error raised")
    except VectorStoreError as exc:
        check("wrong-width collection surfaces Qdrant's error", "dimension" in str(exc).lower(),
              str(exc)[:90])

    # Our own guard: creating with a hint that contradicts the existing collection is refused.
    try:
        store.ensure_collection(
            wrong, embedding_model=MODEL, dims=TRUE_DIMS, chunk_size=800, overlap=150,
            pdf_sha1="abc", pdf_name="doc.pdf", use_prefixes=False,
        )
        check("contradicting hint refused before any write", False, "no error raised")
    except VectorStoreError as exc:
        check("contradicting hint refused before any write", "384" in str(exc), str(exc)[:90])

    try:
        store.query_by_text("prd_does_not_exist", "hello", MODEL, top_k=3)
        check("querying a missing collection fails clearly", False, "no error")
    except VectorStoreError as exc:
        check("querying a missing collection fails clearly", "does not exist" in str(exc))


def main() -> int:
    print("Qdrant Cloud Inference unit tests (stubbed cluster, no credentials)")
    test_helpers()
    test_dim_discovery()
    test_collection_lifecycle()
    test_inference_io()
    test_misconfiguration()

    print("\n== RESULT")
    if FAILURES:
        print("FAILED CHECKS:")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print("ALL QDRANT INFERENCE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
