"""Stage 1 of the RAG pipeline — turn the PDF into per-page, paragraph-structured text.

Deliberately thin on dependencies (``pypdf`` only) but not naive about layout. Design-tool PDFs
frequently emit **one word per line**, which silently destroys paragraphs and wrecks retrieval, so
this module:

1. asks pypdf for ``extraction_mode="layout"`` first (real visual lines, correct reading order),
2. detects the broken one-word-per-line case (>= 60% of lines are <= 3 words) and reflows the raw
   stream into flowing text instead,
3. rebuilds paragraphs from layout lines using "the previous line looks finished, or was a heading"
   heuristics plus bullet detection,
4. normalises ligatures (ﬃ -> ffi), smart quotes and stray whitespace,
5. records which mode was used, plus per-page word/character counts, so the UI can show exactly what
   the parser saw — including pages that yielded nothing (typically scanned images, not OCR'd here).
"""

from __future__ import annotations

import hashlib
import re
import time
from dataclasses import asdict, dataclass
from pathlib import Path

from pypdf import PdfReader


class PdfError(RuntimeError):
    """Raised when the PDF cannot be read at all."""


@dataclass
class PageInfo:
    page: int  # 1-based, matches what a human sees in a PDF viewer
    text: str
    chars: int
    words: int
    has_text: bool
    mode: str  # "layout" or "raw" — which pypdf extraction mode actually produced this text
    paragraphs: int
    preview: str

    def to_dict(self, text_limit: int = 4000) -> dict:
        data = asdict(self)
        if len(data["text"]) > text_limit:
            data["text"] = data["text"][:text_limit].rstrip() + "…"
            data["text_truncated"] = True
        else:
            data["text_truncated"] = False
        data["preview"] = _preview(self.text, 320)
        return data


@dataclass
class PdfDocument:
    path: str
    name: str
    sha1: str
    size_bytes: int
    pages: list[PageInfo]
    extract_ms: float

    @property
    def chars_total(self) -> int:
        return sum(p.chars for p in self.pages)

    @property
    def pages_with_text(self) -> int:
        return sum(1 for p in self.pages if p.has_text)

    def summary(self) -> dict:
        """Small header used by the UI; the full page list is returned separately."""
        modes: dict[str, int] = {}
        for page in self.pages:
            modes[page.mode] = modes.get(page.mode, 0) + 1
        return {
            "path": self.path,
            "name": self.name,
            "sha1": self.sha1,
            "size_bytes": self.size_bytes,
            "pages": len(self.pages),
            "pages_with_text": self.pages_with_text,
            "pages_empty": len(self.pages) - self.pages_with_text,
            "chars_total": self.chars_total,
            "words_total": sum(p.words for p in self.pages),
            "paragraphs_total": sum(p.paragraphs for p in self.pages),
            "extraction_modes": modes,
            "extract_ms": round(self.extract_ms, 1),
        }


# --------------------------------------------------------------------------------------
# text cleanup
# --------------------------------------------------------------------------------------
_WS = re.compile(r"[ \t\u00a0\u2009\u202f]+")
_MULTI_NEWLINE = re.compile(r"\n{3,}")
_PAGE_NOISE = re.compile(r"^\s*(page\s+\d+(\s*(of|/)\s*\d+)?|\d{1,3}|\|\s*\d+\s*\|)\s*$", re.IGNORECASE)
_BULLET = re.compile(r"^\s*(?:[●•▪◦‣]|[-*–—]|\d{1,2}[.)]|[a-z][.)])\s+")
_TERMINAL = (".", ":", ";", "!", "?", "”", '"', ")", "…")

# ligatures and typographic punctuation that PDF fonts emit instead of plain ASCII
_LIGATURES = {
    "\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
    "\ufb05": "st", "\ufb06": "st", "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"',
    "\u2013": "-", "\u2014": "-", "\u2026": "...", "\u00ad": "",
}


def _clean(text: str) -> str:
    for glyph, replacement in _LIGATURES.items():
        text = text.replace(glyph, replacement)
    return text.replace("\r\n", "\n").replace("\r", "\n")


def normalize_text(raw: str) -> str:
    """Collapse PDF extraction artefacts without destroying paragraph structure."""
    text = _WS.sub(" ", _clean(raw))
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _MULTI_NEWLINE.sub("\n\n", text).strip()


def _is_heading(line: str) -> bool:
    """Short, unpunctuated lines are almost always headings in this kind of document."""
    return len(line) <= 60 and len(line.split()) <= 9 and not line.endswith(_TERMINAL)


def _is_fragmented(lines: list[str]) -> bool:
    """True when the extractor emitted roughly one word per line (common with design-tool PDFs)."""
    if len(lines) < 12:
        return False
    short = sum(1 for line in lines if len(line.split()) <= 3)
    return short / len(lines) >= 0.6


def _reflow_layout(raw_page: str) -> list[str]:
    """Rebuild paragraphs from layout-mode lines.

    Layout mode gives real visual lines, but no paragraph markers. A new paragraph starts when the
    previous line looks finished (ends with terminal punctuation) or was a heading, or when the line
    is a bullet.
    """
    paragraphs: list[str] = []
    current = ""
    previous = ""

    for raw_line in raw_page.split("\n"):
        line = raw_line.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current = ""
            previous = ""
            continue
        if _PAGE_NOISE.match(line):
            previous = ""
            continue

        indent = len(raw_line) - len(raw_line.lstrip())
        bullet = _BULLET.match(raw_line)
        new_paragraph = (
            not current
            or bullet is not None
            or (indent == 0 and previous and (previous.endswith(_TERMINAL) or _is_heading(previous)))
        )

        if new_paragraph:
            if current:
                paragraphs.append(current)
            current = _BULLET.sub("- ", line) if bullet else line
        else:
            current = f"{current} {line}" if current else line
        previous = line

    if current:
        paragraphs.append(current)
    return paragraphs


def _extract_page(page) -> tuple[str, str, int]:
    """Return (normalized_text, mode_used, paragraph_count) for one page."""
    layout_raw = ""
    layout_error = ""
    try:
        layout_raw = page.extract_text(extraction_mode="layout") or ""
    except Exception as exc:  # noqa: BLE001 - older pypdf, or a malformed page
        layout_error = str(exc)

    raw = ""
    try:
        raw = page.extract_text() or ""
    except Exception as exc:  # noqa: BLE001
        if not layout_raw:
            raise PdfError(str(exc)) from exc

    layout_lines = [l for l in _clean(layout_raw).split("\n") if l.strip()]
    raw_lines = [l for l in _clean(raw).split("\n") if l.strip()]

    # Prefer layout mode, but only if it actually produced well-formed lines.
    if layout_raw and layout_lines and not _is_fragmented(layout_lines):
        paragraphs = _reflow_layout(layout_raw)
        return "\n\n".join(paragraphs).strip(), "layout", len(paragraphs)

    # Fallback: the raw stream is word-per-line, so join it back into flowing text.
    if raw_lines:
        if _is_fragmented(raw_lines):
            return normalize_text(" ".join(line.strip() for line in raw_lines)), "raw (reflowed)", 1
        paragraphs = _reflow_layout(raw)
        return "\n\n".join(paragraphs).strip(), "raw", len(paragraphs)

    if layout_error:
        raise PdfError(layout_error)
    return "", "empty", 0


def _preview(text: str, limit: int) -> str:
    flat = " ".join(text.split())
    return flat if len(flat) <= limit else flat[:limit].rstrip() + "…"


def load_pdf(path: str | Path) -> PdfDocument:
    """Read a PDF and return its pages with normalized, paragraph-structured text."""
    pdf_path = Path(path)
    if not pdf_path.exists():
        raise PdfError(f"PDF not found: {pdf_path}")

    started = time.perf_counter()
    try:
        reader = PdfReader(str(pdf_path))
        page_count = len(reader.pages)
        pages: list[PageInfo] = []
        for index, page in enumerate(reader.pages, start=1):
            try:
                text, mode, paragraphs = _extract_page(page)
            except Exception as exc:  # a single bad page must not kill the whole ingest
                pages.append(
                    PageInfo(index, "", 0, 0, False, "failed", 0, f"[page {index} could not be parsed: {exc}]")
                )
                continue
            words = len(text.split())
            pages.append(
                PageInfo(
                    page=index,
                    text=text,
                    chars=len(text),
                    words=words,
                    has_text=words > 0,
                    mode=mode,
                    paragraphs=paragraphs,
                    preview=_preview(text, 320),
                )
            )
    except PdfError:
        raise
    except Exception as exc:
        raise PdfError(f"Could not read {pdf_path.name}: {exc}") from exc

    if page_count == 0:
        raise PdfError(f"{pdf_path.name} has no pages")

    return PdfDocument(
        path=str(pdf_path),
        name=pdf_path.name,
        sha1=hashlib.sha1(pdf_path.read_bytes()).hexdigest(),
        size_bytes=pdf_path.stat().st_size,
        pages=pages,
        extract_ms=(time.perf_counter() - started) * 1000,
    )
