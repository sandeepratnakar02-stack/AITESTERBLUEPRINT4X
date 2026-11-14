"""
End-to-end verification of the Test Skill Finder MCP over the REAL MCP protocol (stdio).

Spawns `server.py` as a subprocess exactly as an MCP client would (from a different working
directory, to prove cwd-independence) and exercises every tool, resource and prompt,
asserting on the responses.

Exit code 0 = every check passed.

Run:  .venv/Scripts/python.exe scripts/verify_mcp.py
"""

from __future__ import annotations

import asyncio
import json
import pathlib
import sys

from fastmcp import Client
from fastmcp.client.transports import PythonStdioTransport

# Windows consoles default to cp1252 and the CLI/server output contains non-ASCII (→ — ·).
for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # pragma: no cover - non-reconfigurable stream
        pass

HERE = pathlib.Path(__file__).resolve().parent
PROJECT = HERE.parent
SERVER = PROJECT / "server.py"

EXPECTED_TOOLS = {
    "list_skills",
    "list_packs",
    "get_skill_stats",
    "validate_skills",
    "get_skill",
    "get_skill_metadata",
    "search_skills",
    "find_skill_for_task",
    "search_skill_content",
    "get_related_skills",
    "list_skill_files",
    "read_skill_file",
    "recommend_skills_for_phase",
    "get_skill_index",
    "export_skill_bundle",
}
EXPECTED_PACKS = {"playwright": 11, "selenium": 11, "cypress": 12, "api-testing": 8}
EXPECTED_SKILLS = 56
EXPECTED_PHASES = 7

RESULTS: list[tuple[str, bool, str]] = []


def check(name: str, condition: object, detail: str = "") -> None:
    ok = bool(condition)
    RESULTS.append((name, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"   <- {detail}" if detail and not ok else ""))


def text_of(result) -> str:
    """Flatten a resource/prompt result into one string, defensively.

    Handles the shapes the SDK returns: ResourceContent(.text), a list of those,
    PromptMessage(.content=TextContent) and GetPromptResult(.messages=[PromptMessage]).
    """
    chunks: list[str] = []

    def collect(value) -> None:
        if value is None:
            return
        if isinstance(value, str):
            chunks.append(value)
            return
        if isinstance(value, (list, tuple)):
            for item in value:
                collect(item)
            return
        if isinstance(value, dict):
            collect(value.get("text"))
            collect(value.get("content"))
            collect(value.get("messages"))
            return
        collect(getattr(value, "text", None))
        collect(getattr(value, "content", None))
        collect(getattr(value, "messages", None))

    collect(result)
    return "\n".join(chunks)


async def run() -> int:
    transport = PythonStdioTransport(
        script_path=str(SERVER),
        cwd=str(PROJECT.parent.parent),  # repo root: proves the server does not rely on cwd
    )

    async with Client(transport) as client:
        # ---- surface ---------------------------------------------------------------
        tools = {t.name for t in await client.list_tools()}
        check("15 tools exposed", tools == EXPECTED_TOOLS,
              f"missing={sorted(EXPECTED_TOOLS - tools)} extra={sorted(tools - EXPECTED_TOOLS)}")

        resources = {str(r.uri) for r in await client.list_resources()}
        check("3 static resources", resources == {"skills://index", "skills://packs", "skills://stats"},
              str(sorted(resources)))

        templates = set()
        for template in await client.list_resource_templates():
            # MCP SDK v2 renamed uriTemplate -> uri_template; read either.
            uri = getattr(template, "uri_template", None) or getattr(template, "uriTemplate", None)
            if uri:
                templates.add(str(uri))
        check("skill://{name} resource template", any("skill://" in t for t in templates),
              str(sorted(templates)))

        prompts = {p.name for p in await client.list_prompts()}
        check("3 prompts", prompts == {"find_skill", "apply_skill", "build_skill_chain"},
              str(sorted(prompts)))

        # ---- tools -----------------------------------------------------------------
        async def call(name: str, args: dict | None = None):
            return (await client.call_tool(name, args or {})).data

        listing = await call("list_skills", {"limit": 200})
        check("list_skills returns all 56", listing["total"] == EXPECTED_SKILLS, str(listing["total"]))

        packs = await call("list_packs")
        check("list_packs: 4 packs / 7 STLC phases",
              len(packs["framework_packs"]) == 4 and len(packs["stlc_phases"]) == EXPECTED_PHASES,
              json.dumps({k: len(v) for k, v in packs["framework_packs"].items()}))

        stats = await call("get_skill_stats")
        check("get_skill_stats counts",
              stats["skills_total"] == EXPECTED_SKILLS
              and stats["by_pack"] == EXPECTED_PACKS
              and stats["by_kind"] == {"pack": 42, "stlc": 14},
              json.dumps({"by_pack": stats["by_pack"], "by_kind": stats["by_kind"]}))

        validation = await call("validate_skills")
        check("validate_skills ok", validation["ok"] is True,
              json.dumps(validation["problems"][:3]))

        skill = await call("get_skill", {"name": "cy-wait-fixer"})
        check("get_skill returns body + sections",
              "## Workflow" in skill["body"] and "Guardrails" in skill["sections"]
              and skill["pack"] == "cypress",
              str(skill.get("sections")))

        meta = await call("get_skill_metadata", {"name": "api-auth-tester"})
        check("get_skill_metadata omits the body",
              "body" not in meta and meta["pack"] == "api-testing" and bool(meta["use_when"]))

        search = await call("search_skills", {"query": "playwright api", "limit": 3})
        check("search_skills('playwright api') -> pw-api-tester",
              search["matches"][0]["name"] == "pw-api-tester"
              and bool(search["matches"][0]["matched_on"]),
              str([m["name"] for m in search["matches"]]))

        task = await call("find_skill_for_task",
                          {"task": "I need to stub the payments API in a Cypress test"})
        names = [s["name"] for s in task["suggestions"]]
        check("find_skill_for_task finds mocking skills",
              task["suggestion_count"] > 0 and "cy-network-mocker" in names, str(names))

        content = await call("search_skill_content", {"query": "cy.intercept", "limit": 10})
        check("search_skill_content finds line-anchored hits",
              any(r["name"] == "cy-network-mocker" for r in content["results"])
              and content["results"][0]["first_hit_line"] > 0,
              str([r["name"] for r in content["results"]][:4]))

        related = await call("get_related_skills", {"name": "pw-api-tester", "limit": 5})
        check("get_related_skills returns neighbours",
              len(related["related"]) > 0 and all(r["name"] != "pw-api-tester" for r in related["related"]))

        files = await call("list_skill_files", {"name": "test-plan-generator"})
        check("list_skill_files reports bundled files", files["extra_file_count"] == 4,
              str(files["extra_file_count"]))

        bundled = await call("read_skill_file",
                             {"name": "test-plan-generator",
                              "relative_path": "references/test-plan-template.md"})
        check("read_skill_file reads a bundled file", bundled["bytes"] > 0, str(bundled.get("bytes")))

        chain = await call("recommend_skills_for_phase")
        check("recommend_skills_for_phase returns ordered chain",
              len(chain["chain"]) == EXPECTED_PHASES
              and chain["chain"][0]["phase"] == "Requirement Analysis",
              str([c["phase"] for c in chain["chain"]][:3]))

        index = await call("get_skill_index")
        check("get_skill_index lists every skill", len(index["index"]) == EXPECTED_SKILLS,
              str(len(index["index"])))

        exported = await call("export_skill_bundle",
                              {"names": ["cy-wait-fixer", "api-auth-tester"], "format": "json",
                               "filename": "verify-mcp-tmp.json"})
        export_path = pathlib.Path(exported["path"])
        check("export_skill_bundle writes a file",
              export_path.is_file() and exported["skills_exported"] == 2, str(export_path))
        if export_path.is_file():
            export_path.unlink()

        # traversal guard
        try:
            await client.call_tool("read_skill_file",
                                   {"name": "test-plan-generator", "relative_path": "../../../server.py"})
            check("read_skill_file blocks path traversal", False, "no error raised")
        except Exception as exc:
            check("read_skill_file blocks path traversal", "inside the skill folder" in str(exc),
                  str(exc)[:120])

        # unknown skill error
        try:
            await client.call_tool("get_skill", {"name": "definitely-not-a-skill"})
            check("unknown skill raises an actionable error", False, "no error raised")
        except Exception as exc:
            check("unknown skill raises an actionable error", "No skill named" in str(exc),
                  str(exc)[:120])

        # ---- resources -------------------------------------------------------------
        idx_text = text_of(await client.read_resource("skills://index"))
        check("resource skills://index", f'"skills_total": {EXPECTED_SKILLS}' in idx_text)
        packs_text = text_of(await client.read_resource("skills://packs"))
        check("resource skills://packs", "playwright" in packs_text and "Test Design" in packs_text)
        stats_text = text_of(await client.read_resource("skills://stats"))
        check("resource skills://stats", '"cypress": 12' in stats_text)
        one = text_of(await client.read_resource("skill://cy-wait-fixer"))
        check("resource template skill://{name}",
              "name: cy-wait-fixer" in one and "Guardrails" in one)

        # ---- prompts ---------------------------------------------------------------
        p1 = text_of(await client.get_prompt("find_skill", {"keyword": "cypress intercept"}))
        check("prompt find_skill", "find_skill_for_task" in p1)
        p2 = text_of(await client.get_prompt("apply_skill",
                                             {"skill_name": "cy-wait-fixer", "task": "fix a flaky test"}))
        check("prompt apply_skill", "get_skill" in p2 and "Guardrails" in p2)
        p3 = text_of(await client.get_prompt("build_skill_chain", {"task": "ship a feature"}))
        check("prompt build_skill_chain", "recommend_skills_for_phase" in p3)

    passed = sum(1 for _, ok, _ in RESULTS if ok)
    failed = [n for n, ok, _ in RESULTS if not ok]
    print(f"\n{passed}/{len(RESULTS)} checks passed")
    if failed:
        print("FAILED: " + ", ".join(failed))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
