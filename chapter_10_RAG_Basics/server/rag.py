"""Stage 6 of the RAG pipeline — build the grounded prompt and call Groq.

The model is ``openai/gpt-oss-120b`` served by Groq, called over the OpenAI-compatible
``/openai/v1/chat/completions`` endpoint so the request/response shape (and the ``usage`` block that
feeds the cost panel) is explicit rather than hidden behind an SDK version.

Grounding rules are enforced in the system prompt, and the ``[C#]`` tags the model must use are
parsed back out so the UI can turn them into clickable citations pointing at the exact chunk.
"""

from __future__ import annotations

import re
import time

import httpx

from .config import Settings, settings as default_settings
from .search import Hit

CITATION = re.compile(r"[\[【]\s*C\s*(\d+)\s*[\]】]")


def _normalize_citations(answer: str) -> str:
    """Models sometimes emit 【C1】 (full-width) — normalise so the UI can always parse ``[C#]``."""
    return CITATION.sub(lambda match: f"[C{match.group(1)}]", answer or "")

SYSTEM_PROMPT = """You are a retrieval-grounded assistant for a confidential Product Requirements Document (PRD).

Rules:
1. Answer ONLY from the numbered CONTEXT blocks provided in the user message. Never use outside knowledge.
2. Cite the block that supports each statement using its tag, e.g. [C1] or [C2]. Several tags may apply.
3. If the CONTEXT does not contain the answer, reply exactly: The document does not contain this information.
   Do not offer a best guess, a summary of something adjacent, or a partial answer in that case.
4. Never invent, rename or upgrade section headings. If the document has no section called
   "acceptance criteria", do not present other content under that label — answer strictly with the
   document's own terminology, or refuse per rule 3.
5. Be concise, factual and specific. Use short bullet points when listing requirements."""


class GroqError(RuntimeError):
    """Raised when the Groq call cannot be made or returns an error."""


def build_context(hits: list[Hit], char_budget: int) -> tuple[str, list[dict]]:
    """Render the retrieved chunks as tagged blocks, respecting a character budget."""
    blocks: list[str] = []
    used: list[dict] = []
    total = 0

    for rank, hit in enumerate(hits, start=1):
        span = f"p.{hit.page_start}" if hit.page_start == hit.page_end else f"p.{hit.page_start}-{hit.page_end}"
        block = f"[C{rank} | {span}]\n{hit.text.strip()}"
        if total + len(block) > char_budget and blocks:
            break
        blocks.append(block)
        total += len(block)
        used.append({"tag": f"C{rank}", "chunk_id": hit.chunk_id, "page_start": hit.page_start, "page_end": hit.page_end})

    return "\n\n---\n\n".join(blocks), used


def _extract_citations(answer: str, used: list[dict]) -> list[dict]:
    """Map ``[C#]`` mentions back to the chunk they refer to."""
    by_tag = {item["tag"]: item for item in used}
    seen: list[str] = []
    for match in CITATION.finditer(answer or ""):
        tag = f"C{match.group(1)}"
        if tag in by_tag and tag not in seen:
            seen.append(tag)
    return [{**by_tag[tag], "used": True} for tag in seen]


def ask(
    question: str,
    hits: list[Hit],
    mode: str,
    settings: Settings | None = None,
    total_retrieval_ms: float = 0.0,
) -> dict:
    """Answer ``question`` from ``hits`` with Groq, returning the answer plus everything the UI needs."""
    cfg = settings or default_settings
    if not cfg.groq_key_present:
        raise GroqError(
            "No Groq API key found. Add GROQ_API_TOKEN=... to chapter_10_RAG_Basics/.env and restart the API."
        )
    if not hits:
        raise GroqError("No chunks were retrieved, so there is nothing to ground an answer in.")

    context, used = build_context(hits, cfg.context_char_budget)
    user_message = f"QUESTION:\n{question}\n\nCONTEXT:\n{context}"
    payload = {
        "model": cfg.groq_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
    }

    started = time.perf_counter()
    try:
        response = httpx.post(
            f"{cfg.groq_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {cfg.groq_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=cfg.groq_timeout,
        )
    except httpx.ConnectError as exc:
        raise GroqError("Could not reach the Groq API — check your internet connection.") from exc
    except httpx.TimeoutException as exc:
        raise GroqError(f"Groq timed out after {cfg.groq_timeout:g}s.") from exc
    latency_ms = (time.perf_counter() - started) * 1000

    if response.status_code >= 400:
        detail = response.text[:500]
        if response.status_code in (401, 403):
            raise GroqError(f"Groq rejected the API key ({response.status_code}). {detail}")
        if response.status_code == 404:
            raise GroqError(
                f"Groq does not know the model '{cfg.groq_model}' (404). Verify the model id at "
                f"console.groq.com/models or override GROQ_MODEL in .env. {detail}"
            )
        raise GroqError(f"Groq returned {response.status_code}: {detail}")

    data = response.json()
    choices = data.get("choices") or []
    if not choices:
        raise GroqError(f"Groq returned no choices: {str(data)[:300]}")

    answer = (choices[0].get("message") or {}).get("content") or ""
    answer = _normalize_citations(answer)
    usage = data.get("usage") or {}
    prompt_tokens = int(usage.get("prompt_tokens") or 0)
    completion_tokens = int(usage.get("completion_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))

    cost = (
        prompt_tokens / 1_000_000 * cfg.price_in_per_mtok
        + completion_tokens / 1_000_000 * cfg.price_out_per_mtok
    )

    return {
        "answer": answer.strip(),
        "citations": _extract_citations(answer, used),
        "context_blocks": used,
        "context_chars": len(context),
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
        },
        "cost_usd": round(cost, 8),
        "pricing": {"in_per_mtok": cfg.price_in_per_mtok, "out_per_mtok": cfg.price_out_per_mtok},
        "latency_ms": round(latency_ms, 1),
        "retrieval_ms": round(total_retrieval_ms, 1),
        "model": cfg.groq_model,
        "mode": mode,
        "temperature": cfg.temperature,
        "max_tokens": cfg.max_tokens,
        "grounded": "The document does not contain this information" not in answer,
    }
