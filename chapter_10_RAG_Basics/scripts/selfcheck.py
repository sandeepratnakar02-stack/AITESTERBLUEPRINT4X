"""End-to-end smoke test for the RAG pipeline — no HTTP, no UI.

Run it with the chapter venv::

    .venv/Scripts/python.exe scripts/selfcheck.py

It verifies, in order: config and .env wiring, Ollama + nomic-embed-text health, PDF extraction,
chunking, embedding, ChromaDB storage, all three search algorithms, and a grounded Groq answer
(plus an off-topic question that must be refused).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

# Windows consoles default to cp1252, which cannot encode the document's typography (‖, curly
# quotes, …). Force UTF-8 so piping this script's output to a file never crashes the check.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - exotic streams
        pass

CHAPTER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CHAPTER_DIR))

from server.config import settings  # noqa: E402
from server.embeddings import get_embedder  # noqa: E402
from server.ingest import run_ingest  # noqa: E402
from server.main import _retrieve  # noqa: E402
from server.rag import ask  # noqa: E402
from server.vector_store import get_store  # noqa: E402

QUERY = "What are the acceptance criteria and requirements for the login dashboard?"
OFF_TOPIC = "What is the capital of France?"


def header(title: str) -> None:
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")


def main() -> int:
    failures: list[str] = []

    header("1. CONFIG")
    print(f"PDF              : {settings.pdf_path.name}")
    print(f"PDF exists       : {settings.pdf_path.exists()}")
    if settings.uses_cloud_inference:
        print(f"Embeddings       : Qdrant Cloud Inference, model={settings.embedding_model_name}")
        print(f"                   dims hint={settings.embedding_dims_hint} on {settings.qdrant_url}")
    else:
        print(f"Embedding model  : {settings.embed_model} (expect {settings.embed_dims} dims) via {settings.ollama_url}")
    print(f"Vector store     : {settings.vector_store}")
    print(f"Groq model       : {settings.groq_model}")
    print(f"Groq key present : {settings.groq_key_present}")
    print(f"Chunk defaults   : size={settings.chunk_size} overlap={settings.chunk_overlap} prefixes={settings.use_prefixes}")
    if not settings.groq_key_present:
        failures.append("GROQ_API_TOKEN missing from .env")

    header("2. EMBEDDING PROVIDER HEALTH")
    health = get_embedder().health()
    print(json.dumps(
        {k: health.get(k) for k in ("ok", "provider", "mode", "model", "model_present", "dims", "endpoint", "note", "error")},
        indent=2,
        default=str,
    ))
    if not health.get("ok"):
        print("\nFATAL: the embedding provider is not usable — stopping here.")
        return 1
    if settings.embedding_is_local and health.get("dims") != settings.embed_dims:
        failures.append(f"embed dims {health.get('dims')} != configured {settings.embed_dims}")

    header("3. INGEST (extract -> chunk -> embed -> store)")
    if settings.uses_cloud_inference:
        print(f"mode: server-side inference — this uploads the PDF to your Qdrant cluster")
    started = time.perf_counter()
    try:
        artifact = run_ingest()
    except Exception as exc:  # noqa: BLE001
        print(f"INGEST FAILED [{type(exc).__name__}]: {exc}")
        return 1
    elapsed = time.perf_counter() - started

    doc = artifact["document"]
    chunking = artifact["chunking"]
    embedding = artifact["embedding"]
    store = artifact["store"]

    print(f"pages            : {doc['pages']} ({doc['pages_with_text']} with text, {doc['pages_empty']} empty)")
    print(f"chars total      : {doc['chars_total']:,}  words: {doc['words_total']:,}  paragraphs: {doc['paragraphs_total']:,}")
    print(f"extraction modes : {doc['extraction_modes']}")
    print(f"chunks           : {chunking['count']}  (min {chunking['min_chars']} / avg {chunking['avg_chars']} / max {chunking['max_chars']} chars)")
    print(f"embedding        : {embedding['count']} vectors × {embedding['dims']} dims via {embedding['endpoint']}")
    print(f"embed time       : {embedding['ms'] / 1000:.1f}s ({embedding['ms_per_chunk']:.0f} ms/chunk, {embedding['batches']} batches)")
    print(f"collection       : {store['collection']}  rows={store['rows']}  space={store['space']}")
    print(f"total pipeline   : {artifact['total_ms'] / 1000:.1f}s (wall {elapsed:.1f}s)")
    for item in artifact["timeline"]:
        print(f"   - {item['label']:<22} {item['ms']:>8.0f} ms  {item['detail']}")
    for warning in artifact["warnings"]:
        print(f"   ! {warning}")

    sample = artifact["chunks"][0]
    print(f"\nfirst chunk id   : {sample['id']} pages {sample['page_start']}-{sample['page_end']} chars={sample['chars']}")
    print(f"first 300 chars  : {sample['text'][:300]!r}")
    stats = embedding.get("stats") or []
    if stats:
        print(f"vector stats     : norm={stats[0]['norm']} mean={stats[0]['mean']} nonzero={stats[0]['nonzero']}")
    else:
        print("vector stats     : n/a — the cluster embedded server-side, so no local vector exists")

    live_count = get_store().count(store["collection"])
    print(f"{settings.vector_store:<8} rows   : {live_count} (expected {chunking['count']})")
    if live_count != chunking["count"]:
        failures.append(f"stored row count {live_count} != chunk count {chunking['count']}")

    header("4. SEARCH — all three algorithms")
    # The same dispatcher the API uses, so this exercises the real production path in either mode.
    payload, search_ms, top_hits = _retrieve(store["collection"], QUERY, "hybrid", 3, None)
    modes = payload["modes"]
    print(f"query: {QUERY}")
    print(f"embedding: {payload.get('embedding_mode', 'client-side (Ollama)')}   total {search_ms:.1f} ms\n")

    for name in ("keyword", "vector", "hybrid"):
        block = modes[name]
        print(f"-- {name.upper()} ({block['meta']['algorithm']}) in {block['ms']:.1f} ms")
        for hit in block["hits"]:
            detail = hit["breakdown"]
            if name == "keyword":
                tail = f" coverage={detail.get('coverage')} terms={(hit.get('matched_terms') or [])[:4]}"
            elif detail.get("server_side"):
                tail = f" cosine={detail.get('cosine')} model={detail.get('model')}"
            elif "dot_product" in detail:
                tail = (
                    f" dot={detail['dot_product']} ‖q‖={detail['query_norm']} "
                    f"‖d‖={detail['doc_norm']} chroma_d={detail['chroma_distance']} "
                    f"1-d={detail['similarity_from_distance']}"
                )
            else:
                tail = (
                    f" kw_rank={detail.get('keyword_rank')} vec_rank={detail.get('vector_rank')} "
                    f"rrf={detail.get('keyword_rrf')}+{detail.get('vector_rrf')}"
                )
            print(f"   #{hit['rank']} {hit['chunk_id']} score={hit['score']:.5f} p.{hit['page_start']}-{hit['page_end']}{tail}")
        print()

    if not all(len(modes[name]["hits"]) == 3 for name in ("keyword", "vector", "hybrid")):
        failures.append("one of the search modes returned fewer than 3 hits")

    top_detail = modes["vector"]["hits"][0]["breakdown"]
    if top_detail.get("server_side"):
        print(
            f"cosine cross-check: the cluster scored the top chunk at "
            f"{top_detail['cosine']:.6f}. Cloud Inference does not return the raw query vector, "
            f"so the dot-product breakdown is local-only — by design, not a gap."
        )
    else:
        # manual cosine must agree with Chroma's stored cosine distance
        manual = top_detail["cosine"]
        from_distance = top_detail["similarity_from_distance"]
        if from_distance is not None and abs(manual - from_distance) > 1e-3:
            failures.append(f"cosine mismatch: manual {manual} vs 1-distance {from_distance}")
        else:
            print(f"cosine cross-check: manual {manual:.6f} == 1 - chroma_distance {from_distance:.6f} OK")

    winner = modes["hybrid"]["hits"][0]
    print(
        f"hybrid winner: {winner['chunk_id']} (keyword rank "
        f"{winner['breakdown'].get('keyword_rank')}, vector rank {winner['breakdown'].get('vector_rank')})"
    )

    header("5. GROUNDED ANSWER (Groq)")
    started = time.perf_counter()
    result = ask(QUERY, top_hits, "hybrid")
    print(f"latency          : {result['latency_ms']} ms (wall {time.perf_counter() - started:.1f}s)")
    print(f"tokens           : prompt={result['usage']['prompt_tokens']} completion={result['usage']['completion_tokens']} total={result['usage']['total_tokens']}")
    print(f"cost (config)    : ${result['cost_usd']:.8f}")
    print(f"context chars    : {result['context_chars']}  blocks={[b['tag'] for b in result['context_blocks']]}")
    print(f"citations        : {[c['tag'] + '->' + c['chunk_id'] for c in result['citations']]}")
    print(f"grounded         : {result['grounded']}")
    print(f"\n--- answer ---\n{result['answer']}\n")
    if result["usage"]["prompt_tokens"] == 0:
        failures.append("Groq reported 0 prompt tokens")

    header("6. GROUNDING REFUSAL CHECK (off-topic question)")
    off = ask(OFF_TOPIC, top_hits, "hybrid")
    print(f"Q: {OFF_TOPIC}\nA: {off['answer'][:400]}")
    if off["grounded"]:
        failures.append("off-topic question was answered instead of refused")

    header("RESULT")
    if failures:
        print("FAILURES:")
        for failure in failures:
            print(f" - {failure}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
