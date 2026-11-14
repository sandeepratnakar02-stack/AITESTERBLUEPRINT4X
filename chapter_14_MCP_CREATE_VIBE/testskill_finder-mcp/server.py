"""
Test Skill Finder MCP — server definition (FastMCP 4.1.0).

Exposes the `skills/` folder (56 skills: STLC phases, Playwright, Selenium, Cypress,
API testing) as searchable MCP tools, resources and prompts so any LLM client can find
the right skill for the job.

Run:
    python server.py                                   # stdio (default)
    python server.py --transport http --port 8770      # streamable HTTP for sharing
"""

import json
import os
import re
import shutil
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastmcp import FastMCP
from fastmcp.exceptions import ToolError

import skillindex as si
from skillindex import SkillIndex, SkillIndexError

INSTRUCTIONS = """\
Test Skill Finder MCP — the single source of truth is the `skills/` folder (SKILL.md files).

How to use it well
1. Never guess a skill name. Call `list_packs` / `list_skills` (or read `skills://index`) first.
2. To find a capability, call `search_skills` with the words a tester would say —
   e.g. "playwright api", "flaky test", "test plan", "boundary values", "cypress report".
   Results are ranked and every hit reports `matched_on`, so the ranking is explainable.
3. To load the capability, call `get_skill` and then follow its Workflow section literally.
4. `search_skill_content` searches inside the bodies (line-anchored); `get_related_skills`
   finds neighbours; `list_skill_files` + `read_skill_file` expose bundled references/scripts.

Determinism contract
* Search is lexical (token matching) and deterministic: ordered by (-score, name). No LLM calls,
  no embeddings, no randomness.
* Zero results means the skill does not exist locally. Do NOT invent a skill name or its
  contents — say the folder has no match and list the closest `matched_on` results instead.
* Skills are the authors' wording. Quote the skill rather than paraphrasing its guardrails.
"""

mcp = FastMCP("testskill-finder-mcp", instructions=INSTRUCTIONS, version="0.1.0")

OUTPUT_DIR = Path(__file__).resolve().parent / "output"


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------


@contextmanager
def _errors() -> Iterator[None]:
    try:
        yield
    except SkillIndexError as exc:
        raise ToolError(str(exc)) from exc
    except FileNotFoundError as exc:  # pragma: no cover - defensive
        raise ToolError(f"File not found: {exc}") from exc


def _index() -> SkillIndex:
    return si.get_index()


def _clamp(limit: int | None, default: int = 10, maximum: int = 200) -> int:
    value = default if limit is None else int(limit)
    if value < 0:
        raise ToolError("limit must be >= 0")
    return min(value, maximum)


def _require(name: str) -> si.Skill:
    skill = _index().get(name)
    if skill is None:
        close = _index().search(name, limit=5)
        hint = (
            "Closest matches: " + ", ".join(m.skill.name for m in close)
            if close
            else f"Known packs: {_index().valid_packs()}"
        )
        raise ToolError(f"No skill named '{name}'. {hint}")
    return skill


def _page(items: list[Any], limit: int | None, offset: int | None, default: int = 25) -> dict[str, Any]:
    lim, off = _clamp(limit, default=default), max(0, int(offset or 0))
    window = items[off : off + lim]
    return {
        "total": len(items),
        "returned": len(window),
        "offset": off,
        "limit": lim,
        "has_more": off + lim < len(items),
        "items": window,
    }


# --------------------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def list_skills(
    pack: str | None = None,
    kind: str | None = None,
    stlc_phase: str | None = None,
    group: str | None = None,
    limit: int | None = 25,
    offset: int | None = 0,
) -> dict[str, Any]:
    """List skills, optionally filtered. Call this before get_skill so you never guess a name.

    Args:
        pack: framework pack filter - 'playwright', 'selenium', 'cypress', 'api-testing'.
        kind: 'pack' (framework pack) or 'stlc' (software-testing-lifecycle skill).
        stlc_phase: e.g. 'Test Design', 'Defect Management'.
        group: folder group, e.g. '05-test-execution' or 'framework-packs/cypress-pack'.
        limit: max skills to return (default 25, max 200).
        offset: pagination offset.
    """
    with _errors():
        skills = _index().filter(pack=pack, kind=kind, stlc_phase=stlc_phase, group=group)
        rows = [s.to_index_row() for s in skills]
        page = _page(rows, limit, offset)
        page["filters"] = {
            k: v for k, v in
            {"pack": pack, "kind": kind, "stlc_phase": stlc_phase, "group": group}.items() if v
        }
        if not rows:
            page["hint"] = {
                "packs": _index().valid_packs(),
                "stlc_phases": _index().valid_phases(),
                "kinds": ["pack", "stlc"],
            }
        return page


@mcp.tool(tags={"core"})
def list_packs() -> dict[str, Any]:
    """List every framework pack and STLC phase with its skills — the catalogue at a glance."""
    with _errors():
        idx = _index()
        return {
            "total_skills": len(idx.skills),
            "framework_packs": idx.packs(),
            "stlc_phases": idx.phases(),
            "groups": idx.groups(),
        }


@mcp.tool(tags={"core"})
def get_skill_stats() -> dict[str, Any]:
    """Counts by kind, pack, STLC phase and folder group; plus which skills bundle extra files."""
    with _errors():
        return _index().stats()


@mcp.tool(tags={"advanced"})
def validate_skills() -> dict[str, Any]:
    """Check every SKILL.md for structural problems (missing fields, name/folder mismatch, missing sections).

    Run after adding or downloading skills. Returns ok=true when all skills are well-formed.
    """
    with _errors():
        return _index().validate()


# --------------------------------------------------------------------------------------
# Retrieval
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def get_skill(name: str, include_body: bool = True) -> dict[str, Any]:
    """Fetch one skill by name, including its full instructions body.

    Args:
        name: skill name exactly as listed (e.g. 'pw-api-tester'), or its folder/path.
        include_body: include the markdown instructions (default true). False returns metadata only.

    Call this once the right skill is identified, then follow its '## Workflow' literally.
    """
    with _errors():
        skill = _require(name)
        data = skill.to_dict(include_body=include_body)
        data["sections"] = re.findall(r"^##\s+(.+)$", skill.body, re.M)
        data["related"] = [r["name"] for r in _index().related(skill.name, limit=5)]
        return data


@mcp.tool(tags={"advanced"})
def get_skill_metadata(name: str) -> dict[str, Any]:
    """Frontmatter and structure only (no body) — cheap way to check a skill's identity and triggers."""
    with _errors():
        return _require(name).to_dict(include_body=False)


@mcp.tool(tags={"core"})
def search_skills(
    query: str,
    pack: str | None = None,
    kind: str | None = None,
    require_all_tokens: bool = False,
    limit: int | None = 10,
    include_body: bool = False,
) -> dict[str, Any]:
    """Search skills by keyword and return a ranked, explainable list.

    Args:
        query: the words a tester would use - 'playwright api', 'flaky test', 'test plan',
            'boundary values', 'cypress report', 'bug triage', 'accessibility'.
        pack: optional restriction to one pack ('playwright' | 'selenium' | 'cypress' | 'api-testing').
        kind: optional 'pack' or 'stlc'.
        require_all_tokens: true requires every query token to appear in the skill.
        limit: max results (default 10, max 200).
        include_body: include each skill's full markdown (default false).

    Ranking is deterministic (highest score first, then name). Each result lists `matched_on`
    so you can see why it ranked. An empty `matches` list means no local skill covers this —
    report that instead of inventing one.
    """
    with _errors():
        idx = _index()
        matches = idx.search(
            query,
            pack=pack,
            kind=kind,
            require_all_tokens=require_all_tokens,
            limit=_clamp(limit, default=10),
        )
        _, tokens = si.query_tokens(query)
        result: dict[str, Any] = {
            "query": query,
            "tokens_used": tokens,
            "match_count": len(matches),
            "ranking_rule": "sum of field weights (name > pack/phase > description > trigger > title > body); order by (-score, name)",
            "matches": [m.to_dict(include_body=include_body) for m in matches],
        }
        if not matches:
            result["hint"] = {
                "message": "No local skill matched. Do not invent one.",
                "available_packs": idx.valid_packs(),
                "available_phases": idx.valid_phases(),
                "try_broadening": [t for t in tokens] or [query],
            }
        return result


@mcp.tool(tags={"core"})
def find_skill_for_task(task: str, pack: str | None = None, limit: int | None = 5) -> dict[str, Any]:
    """Find the best skill(s) for a described task — the natural entry point.

    Use this when someone says what they want to do in their own words, e.g.
    "I need to stabiliise a flaky Cypress test", "write API tests for /orders",
    "create a test plan from a Jira ticket", "validate this JSON response schema".

    Args:
        task: the task in natural language.
        pack: optional pack restriction.
        limit: max skills to suggest (default 5).

    Returns candidates with `matched_on` (why each was chosen) and the skill's `use_when`
    bullets (the author's own trigger list). Follow up with get_skill for the full instructions.
    """
    with _errors():
        idx = _index()
        matches = idx.search(task, pack=pack, limit=_clamp(limit, default=5))
        suggestions = []
        for m in matches:
            suggestions.append(
                {
                    "name": m.skill.name,
                    "category": m.skill.category,
                    "why": m.matched_on,
                    "matched_tokens": m.matched_tokens,
                    "score": m.score,
                    "use_when": list(m.skill.use_when)[:4],
                    "next": f"get_skill(name='{m.skill.name}')",
                }
            )
        return {
            "task": task,
            "suggestion_count": len(suggestions),
            "suggestions": suggestions,
            "if_none_match": (
                "No local skill covers this task. Say so; do not fabricate a skill."
                if not suggestions
                else None
            ),
        }


@mcp.tool(tags={"advanced"})
def search_skill_content(query: str, limit: int | None = 20) -> dict[str, Any]:
    """Search *inside* skill bodies with line-anchored snippets (e.g. 'cy.intercept', 'p95', 'BOLA').

    Args:
        query: text to find in the markdown bodies.
        limit: max skills to return (default 20).

    Use when you need to find where a technique is documented rather than which skill owns it.
    """
    with _errors():
        results = _index().search_content(query, limit=_clamp(limit, default=20))
        return {
            "query": query,
            "skills_with_hits": len(results),
            "results": results,
        }


@mcp.tool(tags={"advanced"})
def get_related_skills(name: str, limit: int | None = 8) -> dict[str, Any]:
    """Find skills related to one skill: same pack/phase first, then shared vocabulary.

    Args:
        name: the skill to find neighbours for.
        limit: max related skills (default 8).
    """
    with _errors():
        skill = _require(name)
        related = _index().related(skill.name, limit=_clamp(limit, default=8))
        return {"name": skill.name, "category": skill.category, "related": related}


# --------------------------------------------------------------------------------------
# Bundled files
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"advanced"})
def list_skill_files(name: str) -> dict[str, Any]:
    """List the extra files a skill bundles (references, scripts, copilot prompts).

    Args:
        name: skill name.
    """
    with _errors():
        skill = _require(name)
        files = [
            {
                "path": rel,
                "bytes": (skill.path.parent / rel).stat().st_size,
            }
            for rel in skill.extra_files
        ]
        return {
            "name": skill.name,
            "skill_md": skill.rel_path,
            "extra_file_count": len(files),
            "files": files,
            "note": "No extra files — this skill is a single SKILL.md."
            if not files
            else "Read one with read_skill_file(name, relative_path).",
        }


@mcp.tool(tags={"advanced"})
def read_skill_file(name: str, relative_path: str) -> dict[str, Any]:
    """Read a file bundled with a skill (see list_skill_files).

    Args:
        name: skill name.
        relative_path: path as listed, e.g. 'references/test-plan-template.md'.
    """
    with _errors():
        skill = _require(name)
        target = (skill.path.parent / relative_path).resolve()
        base = skill.path.parent.resolve()
        if base not in target.parents and target != base:
            raise ToolError("relative_path must stay inside the skill folder")
        if not target.is_file():
            raise ToolError(
                f"'{relative_path}' is not bundled with '{skill.name}'. "
                f"Available: {list(skill.extra_files) or 'none'}"
            )
        return {
            "name": skill.name,
            "path": relative_path,
            "bytes": target.stat().st_size,
            "content": target.read_text(encoding="utf-8", errors="replace"),
        }


# --------------------------------------------------------------------------------------
# Workflow helpers
# --------------------------------------------------------------------------------------


@mcp.tool(tags={"core"})
def recommend_skills_for_phase(phase: str | None = None) -> dict[str, Any]:
    """Get the skills for one STLC phase, or the whole ordered STLC chain.

    Args:
        phase: e.g. 'Requirement Analysis', 'Test Planning', 'Test Design',
            'Test Case Development', 'Test Execution', 'Defect Management', 'Test Closure'.
            Omit to receive every phase in lifecycle order.

    The order comes from the numeric folder prefix in `skills/` (01..07) — it is the folder
    order, not an opinion about importance.
    """
    with _errors():
        idx = _index()
        phases = idx.phases()

        def order_key(p: str) -> tuple[int, str]:
            for group, names in idx.groups().items():
                if names and any(
                    (s.stlc_phase or "") == p for s in idx.skills if s.name in names
                ):
                    m = re.match(r"^(\d+)", Path(group).name)
                    if m:
                        return (int(m.group(1)), p)
            return (99, p)

        ordered = sorted(phases, key=order_key)
        if phase:
            wanted = [p for p in phases if p.lower() == phase.strip().lower()]
            if not wanted:
                raise ToolError(
                    f"Unknown STLC phase '{phase}'. Valid phases: {ordered}"
                )
            p = wanted[0]
            return {
                "phase": p,
                "skills": [
                    {"name": n, "description": idx.by_name[n].first_sentence} for n in phases[p]
                ],
            }
        return {
            "chain": [
                {
                    "phase": p,
                    "skills": [
                        {"name": n, "description": idx.by_name[n].first_sentence}
                        for n in phases[p]
                    ],
                }
                for p in ordered
            ],
            "note": "Ordered by the numeric folder prefix under skills/.",
        }


@mcp.tool(tags={"advanced"})
def get_skill_index() -> dict[str, Any]:
    """The whole skill catalogue as one compact list (name + category + one-line description).

    Token-efficient index for feeding a complete picture of available skills into context.
    """
    with _errors():
        idx = _index()
        return {
            "skills_total": len(idx.skills),
            "index": [s.to_index_row() for s in idx.skills],
        }


@mcp.tool(tags={"advanced"})
def export_skill_bundle(
    names: list[str] | None = None,
    pack: str | None = None,
    format: str = "md",
    filename: str | None = None,
) -> dict[str, Any]:
    """Export selected skills into the server's output/ folder for sharing.

    Args:
        names: explicit skill names to export.
        pack: alternatively export a whole pack ('playwright', 'cypress', ...).
        format: 'md' (one concatenated markdown document), 'json' (structured array), or
            'bundle' (copy the skill folders verbatim).
        filename: optional name; a timestamped name is generated when omitted.

    Returns the absolute path written, the skill count and the skills included.
    """
    with _errors():
        idx = _index()
        if names:
            selected = [_require(n) for n in names]
        elif pack:
            selected = idx.filter(pack=pack)
            if not selected:
                raise ToolError(f"No skills in pack '{pack}'. Known packs: {idx.valid_packs()}")
        else:
            selected = idx.skills

        fmt = (format or "md").strip().lower()
        if fmt not in ("md", "json", "bundle"):
            raise ToolError("format must be 'md', 'json' or 'bundle'")

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        hint = re.sub(r"[^a-z0-9]+", "-", (pack or "selection").lower()).strip("-")

        if filename:
            safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
            if not safe or safe in (".", ".."):
                raise ToolError("filename must contain at least one letter or digit")
        else:
            suffix = "" if fmt == "bundle" else f".{fmt}"
            safe = f"skills-{hint}-{stamp}{suffix}"

        target = (OUTPUT_DIR / safe).resolve()
        if OUTPUT_DIR.resolve() not in target.parents and target.parent != OUTPUT_DIR.resolve():
            raise ToolError("filename must not contain path separators")

        if fmt == "json":
            target.write_text(
                json.dumps([s.to_dict(include_body=True) for s in selected], indent=2),
                encoding="utf-8",
            )
            written_files = 1
        elif fmt == "md":
            parts = [
                f"# Skill bundle — {pack or 'selection'}",
                "",
                f"Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}",
                f"Skills: {len(selected)}  |  Source: `{idx.root}`",
                "",
                "## Contents",
                "",
            ]
            parts += [f"- {s.name} ({s.category})" for s in selected]
            for s in selected:
                parts += ["", "---", "", s.raw.strip()]
            target.write_text("\n".join(parts) + "\n", encoding="utf-8")
            written_files = 1
        else:
            target.mkdir(parents=True, exist_ok=True)
            written_files = 0
            for s in selected:
                dest = target / s.rel_path
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(s.path, dest)
                written_files += 1
                for rel in s.extra_files:
                    src = s.path.parent / rel
                    d2 = target / Path(s.rel_path).parent / rel
                    d2.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, d2)
                    written_files += 1

        return {
            "path": str(target),
            "format": fmt,
            "skills_exported": len(selected),
            "source_files_written": written_files,
            "skills": [s.name for s in selected],
        }


# --------------------------------------------------------------------------------------
# Resources
# --------------------------------------------------------------------------------------


@mcp.resource("skills://index", mime_type="application/json")
def resource_index() -> dict[str, Any]:
    """The complete skill index (name, category, one-line description, path)."""
    idx = _index()
    return {"skills_total": len(idx.skills), "index": [s.to_index_row() for s in idx.skills]}


@mcp.resource("skills://packs", mime_type="application/json")
def resource_packs() -> dict[str, Any]:
    """Framework packs and STLC phases with their members."""
    idx = _index()
    return {
        "framework_packs": idx.packs(),
        "stlc_phases": idx.phases(),
    }


@mcp.resource("skills://stats", mime_type="application/json")
def resource_stats() -> dict[str, Any]:
    """Catalogue statistics."""
    return _index().stats()


@mcp.resource("skill://{name}", mime_type="text/markdown")
def resource_skill(name: str) -> str:
    """One skill's full SKILL.md, e.g. skill://pw-api-tester."""
    return _require(name).raw


# --------------------------------------------------------------------------------------
# Prompts
# --------------------------------------------------------------------------------------


@mcp.prompt(tags={"core"})
def find_skill(keyword: str) -> str:
    """Find the right skill for a keyword or task and load it."""
    return (
        f"Find the local skill that covers: **{keyword}**\n\n"
        f"1. Call `find_skill_for_task(task='{keyword}')`. If it returns nothing, call\n"
        f"   `search_skills(query='{keyword}')`.\n"
        f"2. Report the top candidates with their `category` and the `matched_on` reason.\n"
        f"3. Call `get_skill(name=<best>)` and state the skill's own `## When to use` bullets.\n"
        f"4. If the skill has bundled files, mention them (`list_skill_files`).\n\n"
        "If no local skill matches, say so plainly and name the closest categories available. "
        "Never invent a skill name or its contents."
    )


@mcp.prompt(tags={"core"})
def apply_skill(skill_name: str, task: str) -> str:
    """Load a named skill and apply it to a concrete task."""
    return (
        f"Apply the skill **{skill_name}** to this task: {task}\n\n"
        f"1. Call `get_skill(name='{skill_name}')` and read its `## Workflow` and "
        f"`## Guardrails` sections.\n"
        f"2. Execute the workflow steps in order for the task above.\n"
        f"3. Produce the output in the shape the skill's `## Output shape` section specifies.\n"
        f"4. Honour every bullet in `## Guardrails` verbatim — do not relax a guardrail.\n"
        f"5. If information the skill requires is missing from the task, list it as an open "
        f"question instead of assuming a value."
    )


@mcp.prompt(tags={"advanced"})
def build_skill_chain(task: str) -> str:
    """Assemble an ordered chain of skills that together deliver a task."""
    return (
        f"Build a chain of local skills that together deliver: {task}\n\n"
        f"1. Call `recommend_skills_for_phase()` to see the STLC phases in lifecycle order.\n"
        f"2. Use `find_skill_for_task(task='{task}')` to identify the relevant entries, and\n"
        f"   add framework-pack skills if automation is involved.\n"
        f"3. Present the chain as: phase -> skill name -> what it contributes -> its output.\n"
        f"4. For each skill in the chain, list the information it needs as input (from its\n"
        f"   `use_when` and Workflow) so gaps are visible before work starts.\n\n"
        "Only use skills that exist in this server; verify names via `list_skills` before citing them."
    )


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Test Skill Finder MCP server")
    parser.add_argument("--transport", default=os.environ.get("MCP_TRANSPORT", "stdio"),
                        choices=["stdio", "http", "sse", "streamable-http"])
    parser.add_argument("--host", default=os.environ.get("MCP_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("MCP_PORT", "8770")))
    args = parser.parse_args()

    if args.transport == "stdio":
        mcp.run()
    else:
        mcp.run(transport=args.transport, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
