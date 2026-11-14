#!/usr/bin/env python3
"""
Download every skill from the upstream skillmasterclass repository into skills/.

Source of truth: https://github.com/PramodDutta/skillmasterclass (skillmasterclass/skills).

The download is idempotent and mirror-like: it writes every blob under the upstream
skills/ path, preserving the directory structure, so `skills/` is a faithful local copy.

Usage:
    python scripts/sync_skills.py
    python scripts/sync_skills.py --dest skills --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = "PramodDutta/skillmasterclass"
BRANCH = "main"
ROOT = "skillmasterclass/skills"

USER_AGENT = "testskill-finder-mcp-sync/1.0"


def _get(url: str, *, raw: bool = False, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 - fixed https hosts
        return resp.read()


def list_blobs() -> list[str]:
    """Every file path under ROOT, via the GitHub trees API."""
    api = f"https://api.github.com/repos/{REPO}/git/trees/{BRANCH}?recursive=1"
    payload = json.loads(_get(api))
    if "tree" not in payload:
        raise SystemExit(
            "GitHub API did not return a tree (rate limit or bad repo?): "
            f"{json.dumps(payload)[:300]}"
        )
    prefix = f"{ROOT}/"
    return sorted(
        t["path"]
        for t in payload["tree"]
        if t["type"] == "blob" and t["path"].startswith(prefix)
    )


def raw_url(path: str) -> str:
    return f"https://raw.githubusercontent.com/{REPO}/{BRANCH}/{path}"


def main() -> int:
    parser = argparse.ArgumentParser(description="Mirror upstream skills into a local folder.")
    parser.add_argument("--dest", default="skills", help="destination folder (default: skills)")
    parser.add_argument("--dry-run", action="store_true", help="list what would be written")
    args = parser.parse_args()

    dest_root = Path(args.dest).resolve()
    blobs = list_blobs()
    print(f"Upstream files under {ROOT}/: {len(blobs)}")

    written = skipped = failed = 0
    for path in blobs:
        rel = path[len(ROOT) + 1 :]  # strip 'skillmasterclass/skills/'
        target = dest_root / rel
        if args.dry_run:
            print(f"  would write {rel}")
            continue
        try:
            data = _get(raw_url(path))
        except urllib.error.URLError as exc:
            print(f"  FAILED {rel}: {exc}", file=sys.stderr)
            failed += 1
            continue
        if target.exists() and target.read_bytes() == data:
            skipped += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        written += 1
        print(f"  wrote {rel}")

    if not args.dry_run:
        skills = sorted(dest_root.rglob("SKILL.md"))
        print(
            f"\nwritten={written} unchanged={skipped} failed={failed} "
            f"| SKILL.md files now present: {len(skills)}"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
