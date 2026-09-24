"""Stage 2 of the RAG pipeline — split page text into overlapping chunks.

The strategy is intentionally simple enough to explain on a whiteboard:

1. every page is cut into **paragraphs** (blank-line separated),
2. paragraphs that are already bigger than ``chunk_size`` are cut into **sentences**,
   and any sentence still too long is hard-split on a word boundary,
3. the resulting units are greedily packed until adding the next one would exceed ``chunk_size``,
4. each chunk (after the first) is prefixed with the last ``overlap`` characters of the previous
   chunk, so a sentence that straddles a boundary is never lost.

Every chunk keeps its page span and character span in the normalised document text, which is what
lets the UI show *where* in the PDF each chunk came from.
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import asdict, dataclass

from .pdf_loader import PdfDocument

_SENTENCE = re.compile(r"(?<=[.!?])\s+")


class ChunkError(RuntimeError):
    """Raised when no usable text could be chunked."""


@dataclass
class Chunk:
    id: str
    index: int
    text: str
    page_start: int
    page_end: int
    char_start: int
    char_end: int
    chars: int
    tokens_est: int
    overlap_chars: int
    paragraphs: int

    def to_dict(self, text_limit: int | None = 400) -> dict:
        data = asdict(self)
        if text_limit is not None and len(self.text) > text_limit:
            data["text"] = self.text[:text_limit].rstrip() + "…"
            data["truncated"] = True
        else:
            data["truncated"] = False
        return data


@dataclass
class ChunkSet:
    chunk_size: int
    overlap: int
    count: int
    chunks: list[Chunk]
    doc_chars: int
    avg_chars: float
    min_chars: int
    max_chars: int
    chunk_ms: float

    def summary(self) -> dict:
        return {
            "chunk_size": self.chunk_size,
            "overlap": self.overlap,
            "count": self.count,
            "doc_chars": self.doc_chars,
            "avg_chars": round(self.avg_chars, 1),
            "min_chars": self.min_chars,
            "max_chars": self.max_chars,
            "chunk_ms": round(self.chunk_ms, 1),
        }


# --------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------
def _paragraph_spans(text: str) -> list[tuple[int, int]]:
    """Spans of blank-line separated paragraphs inside one page's text."""
    spans: list[tuple[int, int]] = []
    i, n = 0, len(text)
    while i < n:
        while i < n and text[i] == "\n":
            i += 1
        if i >= n:
            break
        start = i
        while i < n and not (text[i] == "\n" and text[i + 1 : i + 2] == "\n"):
            i += 1
        spans.append((start, i))
    return spans


def _hard_split(text: str, limit: int) -> list[str]:
    """Last resort: cut on a word boundary every ``limit`` characters."""
    pieces: list[str] = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind(" ", 0, limit)
        if cut < limit // 2:
            cut = limit
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        pieces.append(remaining)
    return pieces


def _sentence_units(text: str, limit: int) -> list[str]:
    """Break an oversized paragraph into <=limit pieces, keeping sentences whole where possible."""
    if len(text) <= limit:
        return [text]

    units: list[str] = []
    for sentence in _SENTENCE.split(text):
        sentence = sentence.strip()
        if not sentence:
            continue
        units.extend(_hard_split(sentence, limit) if len(sentence) > limit else [sentence])

    # merge neighbouring short sentences back together so we do not emit 20-character chunks
    merged: list[str] = []
    for unit in units:
        if merged and len(merged[-1]) + 1 + len(unit) <= limit:
            merged[-1] = f"{merged[-1]} {unit}"
        else:
            merged.append(unit)
    return merged


def _tail_words(text: str, n: int) -> str:
    """Last ``n`` characters of ``text``, nudged forward to the next word boundary."""
    if n <= 0 or len(text) <= n:
        return ""
    tail = text[-n:]
    space = tail.find(" ")
    return tail[space + 1 :] if 0 <= space < 40 else tail


def _build_units(doc: PdfDocument, chunk_size: int) -> tuple[str, list[tuple[int, str, int, int]]]:
    """Return the normalised document text and the ordered (page, text, start, end) units."""
    doc_text = ""
    units: list[tuple[int, str, int, int]] = []

    for page in doc.pages:
        if not page.has_text:
            continue
        page_start = len(doc_text)
        page_text = page.text
        for start, end in _paragraph_spans(page_text):
            paragraph = page_text[start:end].strip()
            if not paragraph:
                continue
            for piece in _sentence_units(paragraph, chunk_size):
                units.append((page.page, piece, page_start + start, page_start + start + len(piece)))
        doc_text += page_text + "\n\n"

    if not units:
        raise ChunkError("No extractable text found in the PDF — it may be a scanned document (OCR is out of scope).")

    return doc_text.rstrip(), units


# --------------------------------------------------------------------------------------
# main entry point
# --------------------------------------------------------------------------------------
def chunk_document(
    doc: PdfDocument,
    chunk_size: int = 800,
    overlap: int = 150,
    min_size: int = 120,
) -> ChunkSet:
    """Turn a parsed PDF into overlapping chunks."""
    if chunk_size < 120:
        raise ChunkError("chunk_size must be at least 120 characters")
    if overlap < 0 or overlap >= chunk_size:
        raise ChunkError("overlap must be >= 0 and smaller than chunk_size")

    started = time.perf_counter()
    doc_text, units = _build_units(doc, chunk_size)

    # locate each unit in the normalised text so char offsets are real, not accumulated guesses
    located: list[tuple[int, str, int, int]] = []
    cursor = 0
    for page, piece, _approx_start, _approx_end in units:
        idx = doc_text.find(piece, cursor)
        if idx < 0:  # should not happen, but never let offsets break ingestion
            idx = cursor
        located.append((page, piece, idx, idx + len(piece)))
        cursor = idx + len(piece)

    raw: list[dict] = []
    current: list[tuple[int, str, int, int]] = []
    previous_text = ""

    def flush() -> None:
        nonlocal current, previous_text
        if not current:
            return
        body = "\n\n".join(unit[1] for unit in current)
        overlap_text = _tail_words(previous_text, overlap)
        text = f"{overlap_text}\n\n{body}" if overlap_text else body
        raw.append(
            {
                "text": text,
                "page_start": min(unit[0] for unit in current),
                "page_end": max(unit[0] for unit in current),
                "char_start": current[0][2],
                "char_end": current[-1][3],
                "overlap_chars": len(overlap_text) + 2 if overlap_text else 0,
                "paragraphs": len(current),
            }
        )
        previous_text = text
        current = []

    current_len = 0
    for unit in located:
        addition = len(unit[1]) + (2 if current else 0)
        if current and current_len + addition > chunk_size:
            flush()
            current_len = 0
        current.append(unit)
        current_len += addition
    flush()

    # fold a runt final chunk back into its predecessor
    if len(raw) > 1 and len(raw[-1]["text"]) < min_size:
        runt = raw.pop()
        previous = raw[-1]
        previous["text"] = f"{previous['text']}\n\n{runt['text']}"
        previous["page_end"] = max(previous["page_end"], runt["page_end"])
        previous["char_end"] = max(previous["char_end"], runt["char_end"])
        previous["paragraphs"] += runt["paragraphs"]

    chunks: list[Chunk] = []
    for index, item in enumerate(raw):
        text = item["text"]
        digest = hashlib.sha1(text.encode("utf-8")).hexdigest()[:6]
        chunks.append(
            Chunk(
                id=f"c{index:04d}-{digest}",
                index=index,
                text=text,
                page_start=item["page_start"],
                page_end=item["page_end"],
                char_start=item["char_start"],
                char_end=item["char_end"],
                chars=len(text),
                tokens_est=max(1, round(len(text) / 4)),
                overlap_chars=item["overlap_chars"],
                paragraphs=item["paragraphs"],
            )
        )

    sizes = [c.chars for c in chunks]
    return ChunkSet(
        chunk_size=chunk_size,
        overlap=overlap,
        count=len(chunks),
        chunks=chunks,
        doc_chars=len(doc_text),
        avg_chars=sum(sizes) / len(sizes),
        min_chars=min(sizes),
        max_chars=max(sizes),
        chunk_ms=(time.perf_counter() - started) * 1000,
    )
