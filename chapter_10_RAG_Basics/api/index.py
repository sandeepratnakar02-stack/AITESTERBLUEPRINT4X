"""Vercel entrypoint for the Chapter 10 RAG API.

Vercel treats a Python module exporting an ASGI ``app`` as **one Vercel Function** and routes every
incoming request to it, letting FastAPI's own router match the path. ``api/`` is one of the
recognised entrypoint locations, so this file is all the adapter that is needed — no rewrites, no
path juggling, and the existing ``/api/*`` routes keep their exact paths on the deployed domain.

This module intentionally contains **no application logic**: it only makes the project importable and
re-exports the very same ``server.main:app`` object that local development runs.

    local development:  uvicorn server.main:app --port 8011
    Vercel:             api/index.py  ->  server.main:app

Anything that differs between the two environments (embeddings, vector store, PDF location) is driven
by environment variables inside ``server/config.py``, not by separate code paths here.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The function bundle runs from the project root, but do not depend on that: make the `server`
# package importable regardless of how the runtime sets sys.path / the working directory.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.main import app  # noqa: E402  (must follow the sys.path fix above)

__all__ = ["app"]
