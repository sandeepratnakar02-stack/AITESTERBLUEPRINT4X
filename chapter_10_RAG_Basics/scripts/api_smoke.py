"""Route-level smoke test for the Chapter 10 RAG API.

Works two ways, which makes it useful both before and after deploying:

* **in-process** (default) — drives the real ASGI app through ``TestClient``, so no uvicorn is needed:

      .venv/Scripts/python.exe scripts/api_smoke.py

* **against a running deployment** — same checks over HTTP, so the exact paths Vercel serves can be
  verified after a deploy:

      .venv/Scripts/python.exe scripts/api_smoke.py --url https://<your-project>.vercel.app

It checks the documented routes (``/api/health``, ``/api/ingest``, ``/api/search``, ``/api/chat``,
``/api/chunks/...``) and, when a PDF is available locally, exercises both ingest shapes (JSON path and
multipart upload). It never prints a secret.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Windows consoles default to cp1252; force UTF-8 so redirected output cannot crash on the
# document's typography (‖, curly quotes, …).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):  # pragma: no cover - exotic streams
        pass

CHAPTER_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CHAPTER_DIR))

FAILURES: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    print(f"  {'PASS' if condition else 'FAIL'}  {label}{f' — {detail}' if detail else ''}")
    if not condition:
        FAILURES.append(label)


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test the RAG API routes.")
    parser.add_argument("--url", help="Base URL of a running deployment (omit for in-process)")
    args = parser.parse_args()

    if args.url:
        import httpx

        client = httpx.Client(base_url=args.url.rstrip("/"), timeout=120.0)
        print(f"Target: {args.url} (over HTTP)")
    else:
        from fastapi.testclient import TestClient

        from server.main import app

        client = TestClient(app)
        print("Target: in-process ASGI app (no server needed)")

    # ---------------------------------------------------------------- /api/health
    print("\n== GET /api/health")
    response = client.get("/api/health")
    check("200 OK", response.status_code == 200, str(response.status_code))
    health = response.json()
    for key in ("status", "environment", "groq_configured", "embedding_provider", "vector_store"):
        check(f"has '{key}'", key in health, repr(health.get(key)))
    check("status is usable", health.get("status") in {"ok", "degraded"}, str(health.get("status")))
    check("embedding provider reported", bool(health.get("embedding_provider")))
    check("vector store reported", bool(health.get("vector_store")))
    for warning in health.get("warnings") or []:
        print(f"        warning: {warning}")

    # never leak secrets
    blob = json.dumps(health)
    for secret in ("gsk_", "sk-", "Bearer "):
        check(f"no '{secret}' in health payload", secret not in blob)

    config = health.get("config") or {}
    check("config exposes pdf_name", "pdf_name" in config)
    check("config has no key material", not any("key" in k and isinstance(v, str) and v for k, v in config.items()))

    active = health.get("active_collection")
    print(f"        active_collection = {active!r}")

    # ---------------------------------------------------------------- /api/config + /api/documents
    print("\n== GET /api/config and /api/documents")
    check("config 200", client.get("/api/config").status_code == 200)
    documents = client.get("/api/documents")
    check("documents 200", documents.status_code == 200)
    collections = (documents.json() or {}).get("collections") or []
    print(f"        collections: {[c['name'] for c in collections] or 'none'}")

    # ---------------------------------------------------------------- /api/ingest (both shapes)
    if config.get("pdf_path") and Path(config["pdf_path"]).exists():
        print("\n== POST /api/ingest (JSON path, reads the PDF from disk)")
        ingested = client.post("/api/ingest", json={"chunk_size": 800, "overlap": 150})
        check("200 OK", ingested.status_code == 200, ingested.text[:200])
        if ingested.status_code == 200:
            artifact = ingested.json()
            check("chunks created", artifact["chunking"]["count"] > 0, str(artifact["chunking"]["count"]))
            check("rows stored == chunks", artifact["store"]["rows"] == artifact["chunking"]["count"])
            check("vectors match chunk count", artifact["embedding"]["count"] == artifact["chunking"]["count"])
            active = artifact["store"]["collection"]

        print("\n== POST /api/ingest (multipart upload — the production path)")
        pdf_bytes = Path(config["pdf_path"]).read_bytes()
        uploaded = client.post(
            "/api/ingest",
            files={"file": ("smoke-test.pdf", pdf_bytes, "application/pdf")},
            data={"chunk_size": "800", "overlap": "150"},
        )
        check("200 OK", uploaded.status_code == 200, uploaded.text[:200])
        if uploaded.status_code == 200:
            check("upload produced chunks", uploaded.json()["chunking"]["count"] > 0)
        bad = client.post("/api/ingest", files={"nope": ("x.pdf", pdf_bytes, "application/pdf")})
        check("missing 'file' part -> 400", bad.status_code == 400, str(bad.status_code))
    else:
        print("\n== POST /api/ingest skipped (no local PDF — expected on a deployment)")
        print("        verifying the error contract instead")
        bad = client.post("/api/ingest", json={"pdf_path": "does-not-exist.pdf"})
        check("missing PDF -> 400 with a clear message", bad.status_code == 400, bad.text[:160])

    # ---------------------------------------------------------------- /api/chunks/{collection}
    if active:
        print(f"\n== GET /api/chunks/{active}")
        chunks = client.get(f"/api/chunks/{active}")
        check("200 OK", chunks.status_code == 200, str(chunks.status_code))
        payload = chunks.json()
        check("chunks returned", len(payload["chunks"]) > 0, str(payload.get("total")))
        first = payload["chunks"][0]

        vector = client.get(f"/api/chunks/{active}/{first['chunk_id']}/vector")
        check("vector 200", vector.status_code == 200)
        if vector.status_code == 200:
            body = vector.json()
            # The active width: the Cloud Inference hint in production, the Ollama width locally.
            expected_dims = config.get("embedding_dims") or config.get("embed_dims")
            check("vector dims match config", body["stats"]["dims"] == expected_dims,
                  f"{body['stats']['dims']} vs {expected_dims}")

    # ---------------------------------------------------------------- /api/search
    if active:
        print("\n== POST /api/search")
        search = client.post(
            "/api/search",
            json={"query": "What are the security specifications for authentication?", "top_k": 3},
        )
        check("200 OK", search.status_code == 200, search.text[:200])
        if search.status_code == 200:
            result = search.json()
            modes = result["modes"]
            for mode in ("keyword", "vector", "hybrid"):
                check(f"{mode} returned 3 hits", len(modes[mode]["hits"]) == 3, str(len(modes[mode]["hits"])))
            vector_hit = modes["vector"]["hits"][0]
            breakdown = vector_hit["breakdown"]
            if breakdown.get("server_side"):
                # Cloud Inference embeds the query in the cluster and returns the cosine score; the
                # raw query vector (and therefore the dot-product breakdown) is not exposed.
                check("vector score reported by the cluster", vector_hit["score"] is not None,
                      str(vector_hit["score"]))
            else:
                manual = breakdown["cosine"]
                from_distance = breakdown["similarity_from_distance"]
                if from_distance is not None:
                    check("manual cosine == 1 - stored distance",
                          abs(manual - from_distance) < 1e-3, f"{manual} vs {from_distance}")
            query_vector = result.get("query_vector")
            if query_vector:
                check("query vector returned", len(query_vector["vector"]) == expected_dims)
            else:
                check(
                    "query embedding is server-side (no raw vector exposed)",
                    result.get("embedding_mode", "").startswith("server-side"),
                    str(result.get("query_vector_unavailable_reason"))[:80],
                )
            check("mode echoed back", result.get("mode") in {"keyword", "vector", "hybrid"})

        # ------------------------------------------------------------ /api/chat
        print("\n== POST /api/chat")
        chat = client.post(
            "/api/chat",
            json={
                "question": "What are the functional requirements for the authentication system?",
                "mode": "hybrid",
                "top_k": 3,
            },
        )
        check("200 OK", chat.status_code == 200, chat.text[:240])
        if chat.status_code == 200:
            generation = chat.json()["generation"]
            check("answer is non-empty", len(generation["answer"]) > 0)
            check("tokens reported", generation["usage"]["prompt_tokens"] > 0)
            check("latency reported", generation["latency_ms"] > 0)
            print(f"        citations: {[c['tag'] + '->' + c['chunk_id'] for c in generation['citations']]}")

    print("\n== RESULT")
    if FAILURES:
        print("FAILED CHECKS:")
        for failure in FAILURES:
            print(f"  - {failure}")
        return 1
    print("ALL SMOKE CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
